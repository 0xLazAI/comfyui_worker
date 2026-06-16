import {
  QUEUE_KEY_PREFIX,
  REDIS_URL,
  TASK_CONCURRENCY,
  TASK_JOB_NAME,
  TASK_QUEUE_NAME,
  TASK_RETRY_AFTER_SECONDS,
  TASK_TIMEOUT_SECONDS,
} from '../infra/constants.js';
import { closeDatabase } from '../infra/database.js';
import { logger } from '../infra/logger.js';
import { taskTypeDefinitionStore } from '../taskDefinitions/taskTypeDefinitionStore.js';
import { DbFailedJobStore } from '../tasks/dbFailedJobStore.js';
import { handleTaskExecute } from '../tasks/taskExecution.js';
import { taskStore } from '../tasks/taskStore.js';
import { QueueHandlerRegistry } from './QueueHandlerRegistry.js';
import { RedisQueueDriver, connectRedisQueueClient } from './RedisQueueDriver.js';
import { QueueWorker } from './QueueWorker.js';
import { QueueWorkerRunner } from './QueueWorkerRunner.js';

async function main(): Promise<void> {
  if (!REDIS_URL) {
    throw new Error('REDIS_URL is required');
  }

  await taskStore.ensureReady();
  await taskTypeDefinitionStore.ensureReady();
  const registry = new QueueHandlerRegistry();
  registry.register(TASK_QUEUE_NAME, TASK_JOB_NAME, handleTaskExecute as any, 'handleTaskExecute');
  const workerTimeoutSeconds = Math.min(TASK_TIMEOUT_SECONDS, TASK_RETRY_AFTER_SECONDS - 1);
  const workers: QueueWorker[] = [];
  const runners: QueueWorkerRunner[] = [];

  for (let index = 0; index < TASK_CONCURRENCY; index += 1) {
    const client = await connectRedisQueueClient(REDIS_URL);
    const driver = new RedisQueueDriver(client, {
      retryAfterSeconds: TASK_RETRY_AFTER_SECONDS,
      keyPrefix: QUEUE_KEY_PREFIX,
    });
    const worker = new QueueWorker(
      {
        driver,
        handlerRegistry: registry,
        failedJobStore: new DbFailedJobStore(),
      },
      {
        queues: [TASK_QUEUE_NAME],
        blockForSeconds: 5,
        retryAfterSeconds: TASK_RETRY_AFTER_SECONDS,
        idleSleepMs: 1000,
        workerTimeoutSeconds,
        workerName: TASK_CONCURRENCY === 1 ? TASK_QUEUE_NAME : `${TASK_QUEUE_NAME}-${index + 1}`,
      },
    );
    workers.push(worker);
    runners.push(new QueueWorkerRunner(worker, { driver }));
  }

  logger.info(
    'starting queue workers queue=%s concurrency=%d retry_after=%d timeout=%d',
    TASK_QUEUE_NAME,
    TASK_CONCURRENCY,
    TASK_RETRY_AFTER_SECONDS,
    workerTimeoutSeconds,
  );

  try {
    const exitCodes = await Promise.all(runners.map(async (runner, index) => {
      const exitCode = await runner.run();
      if (exitCode !== 0) {
        for (const [workerIndex, worker] of workers.entries()) {
          if (workerIndex !== index) {
            worker.stop();
          }
        }
      }
      return exitCode;
    }));
    process.exitCode = exitCodes.find((code) => code !== 0) ?? 0;
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  logger.error('queue worker failed %s', error?.stack || error?.message || error);
  process.exitCode = 1;
});
