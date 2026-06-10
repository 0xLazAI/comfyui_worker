import { EXIT_ERROR, QueueWorker, QueueWorkerExitError } from './QueueWorker.js';
import type { QueueDriver } from './QueueDriver.js';
import { logger } from '../infra/logger.js';

interface QueueWorkerRunnerOptions {
  driver?: QueueDriver;
  closeables?: Array<{ close?: () => Promise<void> } | undefined>;
  exitHandler?: (exitCode: number) => void | Promise<void>;
}

export class QueueWorkerRunner {
  constructor(
    private worker: QueueWorker,
    private options: QueueWorkerRunnerOptions = {},
  ) {}

  async run(): Promise<number> {
    const stop = () => {
      logger.info('queue worker received stop signal');
      this.worker.stop();
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    let exitCode = EXIT_ERROR;
    let hardExit = false;

    try {
      exitCode = await this.worker.runUntilStopped();
    } catch (error: any) {
      if (!(error instanceof QueueWorkerExitError)) {
        throw error;
      }
      exitCode = error.exitCode;
      hardExit = error.hard;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);

      if (this.options.driver?.close) {
        await this.options.driver.close();
      }
      if (this.options.closeables?.length) {
        for (const closeable of this.options.closeables) {
          if (!closeable?.close) {
            continue;
          }
          await closeable.close();
        }
      }
    }

    if (hardExit && this.options.exitHandler) {
      await this.options.exitHandler(exitCode);
    }

    return exitCode;
  }
}
