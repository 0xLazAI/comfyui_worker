import { createManagedRedisClient } from '../infra/redisClient.js';
import type { QueueDriver, QueueSize } from './QueueDriver.js';
import type { QueueJobEnvelope, QueueMetricSink, ReservedJob } from './types.js';
import { normalizeUnixSeconds } from './types.js';
import { pushLua } from './lua/push.js';
import { laterLua } from './lua/later.js';
import { popLua } from './lua/pop.js';
import { releaseLua } from './lua/release.js';
import { migrateExpiredLua } from './lua/migrateExpired.js';
import { clearLua } from './lua/clear.js';

type RedisEvalResult = string | number | null | false;

export interface RedisQueueClient {
  scriptLoad(script: string): Promise<string>;
  evalSha(sha: string, keys: string[], args: string[]): Promise<RedisEvalResult>;
  zRem(key: string, member: string): Promise<number>;
  lLen(key: string): Promise<number>;
  zCard(key: string): Promise<number>;
  blPop(key: string, timeoutSeconds: number): Promise<{ key: string; element: string } | null>;
  quit?(): Promise<void>;
}

export interface RedisQueueDriverOptions {
  retryAfterSeconds: number;
  migrateBatchSize?: number;
  keyPrefix?: string;
  now?: () => number;
  metrics?: QueueMetricSink;
}

interface QueueRedisKeys {
  ready: string;
  delayed: string;
  reserved: string;
  notify: string;
}

const LUA_SCRIPTS = {
  push: pushLua,
  later: laterLua,
  pop: popLua,
  release: releaseLua,
  migrateExpired: migrateExpiredLua,
  clear: clearLua,
} as const;

type LuaScriptName = keyof typeof LUA_SCRIPTS;

export class RedisQueueDriver implements QueueDriver {
  private scriptShas = new Map<LuaScriptName, string>();
  private retryAfterSeconds: number;
  private migrateBatchSize: number;
  private keyPrefix: string;
  private now: () => number;
  private metrics?: QueueMetricSink;

  constructor(
    private client: RedisQueueClient,
    options: RedisQueueDriverOptions,
  ) {
    this.retryAfterSeconds = normalizePositiveInteger(options.retryAfterSeconds, 'retryAfterSeconds');
    this.migrateBatchSize = normalizePositiveInteger(options.migrateBatchSize ?? 100, 'migrateBatchSize');
    this.keyPrefix = String(options.keyPrefix || '');
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.metrics = options.metrics;
  }

  async enqueue(queue: string, payload: QueueJobEnvelope, delaySeconds = 0): Promise<void> {
    const normalizedDelay = normalizeNonNegativeInteger(delaySeconds, 'delaySeconds');
    const now = normalizeUnixSeconds(this.now());
    const envelope = {
      ...payload,
      queue,
      availableAt: now + normalizedDelay,
    };
    const serialized = JSON.stringify(envelope);
    const keys = this.getQueueKeys(queue);

    if (normalizedDelay > 0) {
      await this.evalScript('later', [keys.delayed], [String(envelope.availableAt), serialized]);
    } else {
      await this.evalScript('push', [keys.ready, keys.notify], [serialized]);
    }

    this.emitMetric('queue.enqueued', 1, {
      queue,
      job_name: envelope.name,
      delayed: normalizedDelay > 0,
    });
  }

  async reserve(queue: string): Promise<ReservedJob | null> {
    const keys = this.getQueueKeys(queue);
    const result = await this.evalScript('pop', [keys.ready, keys.reserved, keys.notify], [
      String(normalizeUnixSeconds(this.now())),
      String(this.retryAfterSeconds),
    ]);

    if (!result) {
      return null;
    }

    const reservedPayload = String(result);
    const parsed = safeParseEnvelope(reservedPayload);
    if (!parsed) {
      this.emitMetric('queue.reserved', 1, {
        queue,
        job_name: 'malformed',
      });
      return {
        queue,
        reservedPayload,
        envelope: null,
        parseError: 'Failed to parse reserved payload as JSON',
      };
    }

    this.emitMetric('queue.reserved', 1, {
      queue,
      job_name: parsed.name,
    });

    return {
      queue,
      reservedPayload,
      envelope: parsed,
    };
  }

  async ack(queue: string, reservedPayload: string): Promise<void> {
    const keys = this.getQueueKeys(queue);
    await this.client.zRem(keys.reserved, reservedPayload);
  }

  async release(
    queue: string,
    reservedPayload: string,
    payload: QueueJobEnvelope,
    delaySeconds: number,
  ): Promise<void> {
    const normalizedDelay = normalizeNonNegativeInteger(delaySeconds, 'delaySeconds');
    const availableAt = normalizeUnixSeconds(this.now()) + normalizedDelay;
    const keys = this.getQueueKeys(queue);
    const updatedPayload = JSON.stringify({
      ...payload,
      queue,
      availableAt,
    });

    await this.evalScript('release', [keys.reserved, keys.delayed], [
      reservedPayload,
      String(availableAt),
      updatedPayload,
    ]);

    this.emitMetric('queue.released', 1, {
      queue,
      job_name: payload.name,
    });
  }

  async migrate(queue: string): Promise<void> {
    const keys = this.getQueueKeys(queue);
    await this.migrateSource(keys.delayed, keys.ready, keys.notify);
    await this.migrateSource(keys.reserved, keys.ready, keys.notify);
  }

  async clear(queue: string): Promise<void> {
    const keys = this.getQueueKeys(queue);
    await this.evalScript('clear', [keys.ready, keys.delayed, keys.reserved, keys.notify], []);
  }

  async size(queue: string): Promise<QueueSize> {
    const keys = this.getQueueKeys(queue);
    const [ready, delayed, reserved] = await Promise.all([
      this.client.lLen(keys.ready),
      this.client.zCard(keys.delayed),
      this.client.zCard(keys.reserved),
    ]);

    return { ready, delayed, reserved };
  }

  async waitForNotify(queue: string, blockForSeconds: number): Promise<boolean> {
    const normalizedBlock = normalizeNonNegativeInteger(blockForSeconds, 'blockForSeconds');
    const keys = this.getQueueKeys(queue);
    const result = await this.client.blPop(keys.notify, normalizedBlock);
    return Boolean(result);
  }

  async close(): Promise<void> {
    if (this.client.quit) {
      await this.client.quit();
    }
  }

  private async migrateSource(source: string, ready: string, notify: string): Promise<void> {
    while (true) {
      const moved = Number(await this.evalScript('migrateExpired', [source, ready, notify], [
        String(normalizeUnixSeconds(this.now())),
        String(this.migrateBatchSize),
      ]));

      if (!moved || moved < this.migrateBatchSize) {
        return;
      }
    }
  }

  private getQueueKeys(queue: string): QueueRedisKeys {
    const base = `${this.keyPrefix}queue:{${String(queue || '').trim()}}`;
    return {
      ready: base,
      delayed: `${base}:delayed`,
      reserved: `${base}:reserved`,
      notify: `${base}:notify`,
    };
  }

  private async evalScript(name: LuaScriptName, keys: string[], args: string[]): Promise<RedisEvalResult> {
    const sha = await this.getScriptSha(name);
    try {
      return await this.client.evalSha(sha, keys, args);
    } catch (error: any) {
      if (!String(error?.message || '').includes('NOSCRIPT')) {
        throw error;
      }
      this.scriptShas.delete(name);
      const reloadedSha = await this.getScriptSha(name);
      return this.client.evalSha(reloadedSha, keys, args);
    }
  }

  private async getScriptSha(name: LuaScriptName): Promise<string> {
    const cached = this.scriptShas.get(name);
    if (cached) {
      return cached;
    }
    const sha = await this.client.scriptLoad(LUA_SCRIPTS[name]);
    this.scriptShas.set(name, sha);
    return sha;
  }

  private emitMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
    if (!this.metrics) {
      return;
    }
    this.metrics({ name, value, tags });
  }
}

let redisQueueClientPromise: Promise<RedisQueueClient> | null = null;

export async function connectRedisQueueClient(redisUrl: string): Promise<RedisQueueClient> {
  if (!redisQueueClientPromise) {
    redisQueueClientPromise = (async () => {
      const client = createManagedRedisClient({
        url: redisUrl,
        label: 'queue',
      });
      await client.connect();
      const adapter: RedisQueueClient = {
        scriptLoad: (script) => client.scriptLoad(script),
        evalSha: (sha, keys, args) => client.evalSha(sha, {
          keys,
          arguments: args,
        }) as Promise<RedisEvalResult>,
        zRem: (key, member) => client.zRem(key, member),
        lLen: (key) => client.lLen(key),
        zCard: (key) => client.zCard(key),
        blPop: (key, timeoutSeconds) => client.blPop(key, timeoutSeconds),
        quit: async () => {
          await client.quit();
        },
      };
      return adapter;
    })();
  }
  return await redisQueueClientPromise;
}

function safeParseEnvelope(payload: string): QueueJobEnvelope | null {
  try {
    return JSON.parse(payload) as QueueJobEnvelope;
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value: number, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Math.floor(normalized);
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return Math.floor(normalized);
}
