import {
  QUEUE_KEY_PREFIX,
  REDIS_URL,
  TASK_RETRY_AFTER_SECONDS,
} from '../infra/constants.js';
import { RedisQueueDriver, connectRedisQueueClient } from '../queue/RedisQueueDriver.js';

let queueDriverPromise: Promise<RedisQueueDriver> | null = null;

export async function getTaskQueueDriver(): Promise<RedisQueueDriver> {
  if (!REDIS_URL) {
    throw new Error('REDIS_URL is required');
  }

  if (!queueDriverPromise) {
    queueDriverPromise = (async () => {
      const client = await connectRedisQueueClient(REDIS_URL);
      return new RedisQueueDriver(client, {
        retryAfterSeconds: TASK_RETRY_AFTER_SECONDS,
        keyPrefix: QUEUE_KEY_PREFIX,
      });
    })();
  }

  return queueDriverPromise;
}

export async function closeTaskQueueDriver(): Promise<void> {
  if (!queueDriverPromise) {
    return;
  }
  const driver = await queueDriverPromise;
  await driver.close();
  queueDriverPromise = null;
}
