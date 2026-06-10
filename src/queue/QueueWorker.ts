import { logger } from '../infra/logger.js';
import type { FailedJobStore } from './FailedJobStore.js';
import type { QueueDriver } from './QueueDriver.js';
import { QueueHandlerRegistry } from './QueueHandlerRegistry.js';
import { NoopQueueWorkerControl } from './QueueWorkerControl.js';
import type { QueueWorkerControl, QueueWorkerControlSnapshot } from './QueueWorkerControl.js';
import type {
  FailedJobRecord,
  QueueMetricSink,
  QueueWorkerOptions,
  ReservedJob,
} from './types.js';
import { computeRetryDelaySeconds, normalizeQueueNames, normalizeUnixSeconds } from './types.js';

interface QueueWorkerDependencies {
  driver: QueueDriver;
  handlerRegistry: QueueHandlerRegistry;
  failedJobStore: FailedJobStore;
  control?: QueueWorkerControl;
  metrics?: QueueMetricSink;
  now?: () => number;
  runtimeNowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  resetScope?: () => Promise<void> | void;
  shouldRun?: () => Promise<boolean> | boolean;
}

export class QueueWorker {
  private stopped = false;
  private now: () => number;
  private runtimeNowMs: () => number;
  private sleep: (ms: number) => Promise<void>;
  private control: QueueWorkerControl;
  private previousSecondaryQueueHadJob = false;

  constructor(
    private dependencies: QueueWorkerDependencies,
    private options: QueueWorkerOptions,
  ) {
    this.now = dependencies.now || (() => Math.floor(Date.now() / 1000));
    this.runtimeNowMs = dependencies.runtimeNowMs || (() => Date.now());
    this.sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.control = dependencies.control || new NoopQueueWorkerControl();
    this.options.queues = normalizeQueueNames(options.queues);
    validateWorkerOptions(options);
  }

  stop(): void {
    this.stopped = true;
  }

  async runUntilStopped(): Promise<number> {
    const startedAtMs = this.runtimeNowMs();
    let jobsProcessed = 0;
    let lastRestartTimestamp = (await this.control.getSnapshot(this.options.queues)).restartTimestamp;

    while (!this.stopped) {
      const snapshot = await this.control.getSnapshot(this.options.queues);
      const exitCode = this.stopIfNecessary(snapshot, lastRestartTimestamp, startedAtMs, jobsProcessed, undefined);
      if (exitCode !== null) {
        return exitCode;
      }

      const activeQueues = this.getActiveQueues(snapshot);
      const shouldRun = await resolveBoolean(this.dependencies.shouldRun, true);
      if (!shouldRun || !activeQueues.length) {
        const pausedExitCode = this.stopIfNecessary(snapshot, lastRestartTimestamp, startedAtMs, jobsProcessed, null);
        if (pausedExitCode !== null) {
          return pausedExitCode;
        }
        await this.pauseWorker();
        continue;
      }

      if (this.dependencies.resetScope) {
        await this.dependencies.resetScope();
      }

      const selection = await this.getNextReservedJob(activeQueues);
      if (selection) {
        this.previousSecondaryQueueHadJob = selection.queueIndex > 0;
        jobsProcessed += 1;
        await this.handleReservedJob(selection.queue, selection.reserved);

        if (this.options.restMs && this.options.restMs > 0) {
          await this.sleep(this.options.restMs);
        }
      } else {
        this.previousSecondaryQueueHadJob = false;
        const emptyExitCode = this.stopIfNecessary(snapshot, lastRestartTimestamp, startedAtMs, jobsProcessed, null);
        if (emptyExitCode !== null) {
          return emptyExitCode;
        }

        if (this.options.once) {
          return EXIT_SUCCESS;
        }

        await this.waitForWork(activeQueues);
      }

      const postSnapshot = await this.control.getSnapshot(this.options.queues);
      const postExitCode = this.stopIfNecessary(postSnapshot, lastRestartTimestamp, startedAtMs, jobsProcessed, true);
      if (postExitCode !== null) {
        return postExitCode;
      }

      lastRestartTimestamp = postSnapshot.restartTimestamp ?? lastRestartTimestamp;

      if (this.options.once) {
        return EXIT_SUCCESS;
      }
    }

    return EXIT_SUCCESS;
  }

  private async handleReservedJob(queue: string, reserved: ReservedJob): Promise<void> {
    if (!reserved.envelope) {
      await this.persistFailure(queue, reserved, reserved.parseError || 'Malformed reserved job payload');
      return;
    }

    const envelope = reserved.envelope;
    const resolved = this.dependencies.handlerRegistry.resolve(queue, envelope.name);
    if (!resolved) {
      await this.persistFailure(queue, reserved, `No handler registered for queue=${queue} job=${envelope.name}`);
      return;
    }

    const startedAt = Date.now();
    const abortController = new AbortController();

    try {
      await this.executeHandlerWithTimeout(
        resolved.handler(envelope, {
          queue,
          abortSignal: abortController.signal,
          jobId: envelope.id,
          jobName: envelope.name,
          attempts: envelope.attempts,
          maxAttempts: envelope.maxAttempts,
        }),
        queue,
        envelope,
        resolved.handlerLabel,
        abortController,
      );

      await this.dependencies.driver.ack(queue, reserved.reservedPayload);
      this.emitMetric('queue.succeeded', 1, { queue, job_name: envelope.name, handler: resolved.handlerLabel });
      this.emitMetric('queue.handler.duration_ms', Date.now() - startedAt, { queue, job_name: envelope.name, handler: resolved.handlerLabel });
      logger.info(
        'queue job succeeded queue=%s job=%s attempt=%d handler=%s duration_ms=%d',
        queue,
        envelope.id,
        envelope.attempts,
        resolved.handlerLabel,
        Date.now() - startedAt,
      );
    } catch (error: any) {
      if (error instanceof QueueWorkerExitError) {
        logger.error(
          'queue job timed out queue=%s job=%s attempt=%d handler=%s timeout_seconds=%d',
          queue,
          envelope.id,
          envelope.attempts,
          resolved.handlerLabel,
          error.timeoutSeconds || 0,
        );
        throw error;
      }

      const errorMessage = error?.message || 'Queue handler failed';
      const durationMs = Date.now() - startedAt;

      if (envelope.attempts < envelope.maxAttempts) {
        const delaySeconds = computeRetryDelaySeconds(envelope);
        await this.dependencies.driver.release(queue, reserved.reservedPayload, envelope, delaySeconds);
        this.emitMetric('queue.released', 1, { queue, job_name: envelope.name, handler: resolved.handlerLabel });
        this.emitMetric('queue.handler.duration_ms', durationMs, { queue, job_name: envelope.name, handler: resolved.handlerLabel });
        logger.warn(
          'queue job released queue=%s job=%s attempt=%d handler=%s delay_seconds=%d error=%s',
          queue,
          envelope.id,
          envelope.attempts,
          resolved.handlerLabel,
          delaySeconds,
          errorMessage,
        );
        return;
      }

      await this.persistFailure(queue, reserved, errorMessage, error?.stack);
      this.emitMetric('queue.handler.duration_ms', durationMs, { queue, job_name: envelope.name, handler: resolved.handlerLabel });
    }
  }

  private async persistFailure(
    queue: string,
    reserved: ReservedJob,
    errorMessage: string,
    errorStack?: string,
  ): Promise<void> {
    const record: FailedJobRecord = {
      queue,
      reservedPayload: reserved.reservedPayload,
      envelope: reserved.envelope,
      errorMessage,
      errorStack,
      failedAt: normalizeUnixSeconds(this.now()),
    };
    await this.dependencies.failedJobStore.save(record);
    await this.dependencies.driver.ack(queue, reserved.reservedPayload);

    this.emitMetric('queue.failed', 1, {
      queue,
      job_name: reserved.envelope?.name || 'malformed',
    });
    logger.error(
      'queue job failed queue=%s job=%s attempt=%s error=%s',
      queue,
      reserved.envelope?.id || 'unknown',
      reserved.envelope?.attempts ?? 'unknown',
      errorMessage,
    );
  }

  private async getNextReservedJob(
    queues: string[],
  ): Promise<{ queue: string; reserved: ReservedJob; queueIndex: number } | null> {
    for (const [index, queue] of queues.entries()) {
      await this.dependencies.driver.migrate(queue);
      const reserved = await this.dependencies.driver.reserve(queue);
      if (reserved) {
        return { queue, reserved, queueIndex: index };
      }
    }
    return null;
  }

  private getActiveQueues(snapshot: QueueWorkerControlSnapshot): string[] {
    return this.options.queues.filter((queue) => !snapshot.pausedQueues.has(queue));
  }

  private async pauseWorker(): Promise<void> {
    const sleepMs = Math.max(this.options.idleSleepMs || 0, 1000);
    await this.sleep(sleepMs);
  }

  private async waitForWork(activeQueues: string[]): Promise<void> {
    if (!activeQueues.length) {
      if (this.options.idleSleepMs) {
        await this.sleep(this.options.idleSleepMs);
      }
      return;
    }

    if (this.previousSecondaryQueueHadJob) {
      if (this.options.idleSleepMs) {
        await this.sleep(this.options.idleSleepMs);
      }
      return;
    }

    const signaled = await this.dependencies.driver.waitForNotify(activeQueues[0], this.options.blockForSeconds);
    if (!signaled && this.options.idleSleepMs) {
      await this.sleep(this.options.idleSleepMs);
    }
  }

  private stopIfNecessary(
    snapshot: QueueWorkerControlSnapshot,
    lastRestartTimestamp: number | null,
    startedAtMs: number,
    jobsProcessed: number,
    jobState: boolean | null | undefined,
  ): number | null {
    if (this.stopped) {
      return EXIT_SUCCESS;
    }

    if (snapshot.restartTimestamp !== null && snapshot.restartTimestamp !== lastRestartTimestamp) {
      return EXIT_SUCCESS;
    }

    if (this.options.stopWhenEmpty && jobState === null) {
      return EXIT_SUCCESS;
    }

    if (this.options.maxTimeSeconds && this.runtimeNowMs() - startedAtMs >= this.options.maxTimeSeconds * 1000) {
      return EXIT_SUCCESS;
    }

    if (this.options.maxJobs && jobsProcessed >= this.options.maxJobs) {
      return EXIT_SUCCESS;
    }

    return null;
  }

  private async executeHandlerWithTimeout(
    handlerPromise: Promise<void>,
    queue: string,
    envelope: ReservedJob['envelope'],
    handlerLabel: string,
    abortController: AbortController,
  ): Promise<void> {
    const timeoutSeconds = envelope?.timeout || this.options.workerTimeoutSeconds;
    if (!timeoutSeconds) {
      return handlerPromise;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        abortController.abort();
        reject(new QueueWorkerExitError(
          `queue job timed out queue=${queue} handler=${handlerLabel}`,
          EXIT_ERROR,
          true,
          timeoutSeconds,
        ));
      }, timeoutSeconds * 1000);

      handlerPromise.then(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private emitMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
    if (!this.dependencies.metrics) {
      return;
    }
    this.dependencies.metrics({ name, value, tags });
  }
}

export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;

export class QueueWorkerExitError extends Error {
  constructor(
    message: string,
    public exitCode = EXIT_ERROR,
    public hard = false,
    public timeoutSeconds?: number,
  ) {
    super(message);
  }
}

function validateWorkerOptions(options: QueueWorkerOptions): void {
  if (options.workerTimeoutSeconds !== undefined && options.workerTimeoutSeconds >= options.retryAfterSeconds) {
    throw new Error('workerTimeoutSeconds must be less than retryAfterSeconds');
  }
  if (options.maxJobs !== undefined && (!Number.isFinite(options.maxJobs) || options.maxJobs < 0)) {
    throw new Error('maxJobs must be a non-negative integer');
  }
  if (options.maxTimeSeconds !== undefined && (!Number.isFinite(options.maxTimeSeconds) || options.maxTimeSeconds < 0)) {
    throw new Error('maxTimeSeconds must be a non-negative integer');
  }
}

async function resolveBoolean(
  fn: (() => Promise<boolean> | boolean) | undefined,
  fallback: boolean,
): Promise<boolean> {
  if (!fn) {
    return fallback;
  }
  return Boolean(await fn());
}
