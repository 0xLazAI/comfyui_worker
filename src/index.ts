import { createServer } from 'http';
import { createApp } from './app.js';
import { HOST, PORT } from './infra/constants.js';
import { closeDatabase } from './infra/database.js';
import { logger } from './infra/logger.js';
import { WorkerRegistryPublisher } from './registry/WorkerRegistryPublisher.js';
import { taskTypeDefinitionStore } from './taskDefinitions/taskTypeDefinitionStore.js';
import { closeTaskQueueDriver } from './tasks/taskQueue.js';
import { taskStore } from './tasks/taskStore.js';

async function main(): Promise<void> {
  await taskStore.ensureReady();
  await taskTypeDefinitionStore.ensureReady();
  const registry = new WorkerRegistryPublisher();
  await registry.start();

  const app = createApp();
  const server = createServer(app);

  const shutdown = async () => {
    logger.info('server shutdown requested');
    server.close(() => {
      logger.info('http server closed');
    });
    await registry.stop();
    await closeTaskQueueDriver();
    await closeDatabase();
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  server.listen(PORT, HOST, () => {
    logger.info('comfyui worker server listening host=%s port=%d', HOST, PORT);
  });
}

main().catch((error) => {
  logger.error('server failed %s', error?.stack || error?.message || error);
  process.exitCode = 1;
});
