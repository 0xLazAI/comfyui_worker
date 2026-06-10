import 'reflect-metadata';
import { Pool, PoolClient } from 'pg';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import {
  DATABASE_CA,
  DATABASE_LOG_SQL,
  DATABASE_SSL,
  DATABASE_SYNC,
  DATABASE_URL,
} from './constants.js';
import { logger } from './logger.js';
import { WorkerTaskEntity } from '../models/WorkerTask.js';
import { WorkerTaskEventEntity } from '../models/WorkerTaskEvent.js';
import { WorkerTaskAttemptEntity } from '../models/WorkerTaskAttempt.js';
import { FailedJobEntity } from '../models/FailedJob.js';
import { TaskTypeDefinitionEntity } from '../models/TaskTypeDefinition.js';

let dataSource: DataSource | null = null;
let pool: Pool | null = null;
let initPromise: Promise<DataSource | null> | null = null;
const SCHEMA_INIT_ADVISORY_LOCK_KEYS = [28711, 20260608] as const;

export function isDatabaseEnabled(): boolean {
  return Boolean(String(DATABASE_URL || '').trim());
}

export function getDataSource(): DataSource {
  if (!isDatabaseEnabled()) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (dataSource) {
    return dataSource;
  }

  dataSource = new DataSource({
    type: 'postgres',
    url: buildDatabaseUrl(),
    ssl: buildSslOptions(),
    synchronize: false,
    logging: DATABASE_LOG_SQL === 'true',
    entities: [
      WorkerTaskEntity,
      WorkerTaskEventEntity,
      WorkerTaskAttemptEntity,
      FailedJobEntity,
      TaskTypeDefinitionEntity,
    ],
  });

  return dataSource;
}

export function getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
  return getDataSource().getRepository(entity);
}

export async function initializeDatabase(): Promise<DataSource | null> {
  if (!isDatabaseEnabled()) {
    logger.warn('DATABASE_URL is not configured, worker database is disabled');
    return null;
  }

  const ds = getDataSource();
  if (ds.isInitialized) {
    await ensureQueryPool();
    return ds;
  }

  if (!initPromise) {
    initPromise = ds.initialize()
      .then(async (initialized) => {
        const queryPool = await ensureQueryPool();
        await withSchemaInitializationLock(queryPool, async () => {
          if (DATABASE_SYNC === 'true') {
            await initialized.synchronize();
          }
        });
        logger.info('Worker database initialized');
        return initialized;
      })
      .catch((error) => {
        initPromise = null;
        dataSource = null;
        throw error;
      });
  }

  return initPromise;
}

export async function getDatabasePool(): Promise<Pool> {
  await initializeDatabase();
  return ensureQueryPool();
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }

  dataSource = null;
  initPromise = null;
}

async function ensureQueryPool(): Promise<Pool> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  if (pool) {
    return pool;
  }

  pool = new Pool({
    connectionString: buildDatabaseUrl(),
    ssl: buildSslOptions(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (error) => {
    logger.error('postgres pool error %s', error instanceof Error ? error.stack || error.message : String(error));
  });

  await pool.query('select 1');
  return pool;
}

async function withSchemaInitializationLock(
  pgPool: Pool,
  runner: () => Promise<void>,
): Promise<void> {
  const client = await pgPool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1, $2);', [...SCHEMA_INIT_ADVISORY_LOCK_KEYS]);
    await runner();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2);', [...SCHEMA_INIT_ADVISORY_LOCK_KEYS]).catch((error) => {
      logger.warn(
        'failed to release schema init advisory lock error=%s',
        error instanceof Error ? error.stack || error.message : String(error),
      );
    });
    releasePoolClient(client);
  }
}

function releasePoolClient(client: PoolClient): void {
  try {
    client.release();
  } catch (error) {
      logger.warn(
        'failed to release schema init client error=%s',
        error instanceof Error ? error.stack || error.message : String(error),
      );
  }
}

function buildSslOptions() {
  if (DATABASE_SSL !== 'true' && !DATABASE_CA) {
    const normalized = String(DATABASE_URL || '').trim();
    if (!normalized) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      const sslMode = String(parsed.searchParams.get('sslmode') || '').trim().toLowerCase();
      if (['require', 'prefer', 'allow', 'verify-ca', 'verify-full'].includes(sslMode)) {
        return {
          rejectUnauthorized: false,
          ca: undefined,
        };
      }
    } catch {
      return false;
    }
    return false;
  }

  return {
    rejectUnauthorized: Boolean(DATABASE_CA),
    ca: DATABASE_CA || undefined,
  };
}

function buildDatabaseUrl(): string {
  const normalized = String(DATABASE_URL || '').trim();
  if (!normalized) {
    return normalized;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return normalized;
  }

  for (const key of [
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'sslcrl',
    'uselibpqcompat',
  ]) {
    parsed.searchParams.delete(key);
  }

  return parsed.toString();
}
