import { createClient } from 'redis';
import { logger } from './logger.js';

export interface ManagedRedisClientOptions {
  url: string;
  label: string;
}

export function createManagedRedisClient(options: ManagedRedisClientOptions): ReturnType<typeof createClient> {
  const label = String(options.label || 'redis').trim() || 'redis';
  const client = createClient({
    url: options.url,
    socket: {
      keepAlive: 5_000,
      connectTimeout: 10_000,
      reconnectStrategy: (retries, cause) => {
        const delayMs = Math.min(250 * (2 ** Math.min(retries, 4)), 5_000);
        logger.warn(
          'redis client reconnect scheduled label=%s retries=%d delay_ms=%d cause=%s',
          label,
          retries,
          delayMs,
          cause instanceof Error ? cause.message : String(cause || ''),
        );
        return delayMs;
      },
    },
  });

  client.on('error', (error) => {
    logger.error(
      'redis client error label=%s error=%s',
      label,
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
  client.on('ready', () => {
    logger.info('redis client ready label=%s', label);
  });
  client.on('reconnecting', () => {
    logger.warn('redis client reconnecting label=%s', label);
  });
  client.on('end', () => {
    logger.warn('redis client ended label=%s', label);
  });

  return client;
}
