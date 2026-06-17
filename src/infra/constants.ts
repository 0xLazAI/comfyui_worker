import dotenv from 'dotenv';

dotenv.config();

function pick(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function integer(value: string, fallback: number, minimum = 0): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    return fallback;
  }
  return Math.floor(normalized);
}

function integerList(value: string, fallback: number[]): number[] {
  const source = String(value || '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.floor(entry));

  return source.length ? source : fallback;
}

export const NODE_ENV = pick(process.env.NODE_ENV, 'development');
export const PORT = integer(pick(process.env.COMFYUI_WORKER_PORT, process.env.DEMO_WORKER_PORT, '8091'), 8091, 1);
export const HOST = pick(process.env.COMFYUI_WORKER_HOST, process.env.DEMO_WORKER_HOST, '0.0.0.0');
export const WORKER_NAME = pick(process.env.COMFYUI_WORKER_NAME, process.env.DEMO_WORKER_NAME, 'demo-worker');
export const BASE_URL = pick(process.env.COMFYUI_WORKER_BASE_URL, process.env.DEMO_WORKER_BASE_URL, `http://127.0.0.1:${PORT}`);
export const WORKER_TOKEN = pick(process.env.COMFYUI_WORKER_TOKEN, process.env.DEMO_WORKER_TOKEN, 'demo-worker-token');
export const WORKER_NODE_TYPE = pick(process.env.COMFYUI_WORKER_NODE_TYPE, 'comfyui');
export const WORKER_VERSION = pick(process.env.COMFYUI_WORKER_VERSION, '1.0.0');
export const CONTRACT_VERSION = pick(process.env.COMFYUI_WORKER_CONTRACT_VERSION, '2026-06-01');
export const PROJECTS_ROOT = pick(
  process.env.PAI_PROJECTS_MOUNT_ROOT,
  process.env.COMFYUI_WORKER_PROJECTS_ROOT,
  process.env.DEMO_WORKER_PROJECTS_ROOT,
  '/data/pai-projects',
);
export const REGISTRY_ROOT = pick(process.env.COMFYUI_WORKER_REGISTRY_ROOT, process.env.DEMO_WORKER_REGISTRY_ROOT, '/data/pai-projects/.pai-workers');
export const PROJECTS_MOUNT_MODE = pick(process.env.PAI_PROJECTS_MOUNT_MODE, 'rw');
export const PROJECTS_EXPECT_SHARED_FS = pick(process.env.PAI_PROJECTS_EXPECT_SHARED_FS, 'true');
export const CACHE_DIR = pick(process.env.PAI_CACHE_DIR, '/var/cache/pai');
export const TMP_DIR = pick(process.env.PAI_TMP_DIR, '/var/tmp/pai');
export const LOG_DIR = pick(process.env.PAI_LOG_DIR, '/var/log/pai');
export const HEARTBEAT_INTERVAL_SECONDS = integer(
  pick(process.env.COMFYUI_WORKER_HEARTBEAT_INTERVAL_SECONDS, process.env.DEMO_WORKER_HEARTBEAT_INTERVAL_SECONDS, '15'),
  15,
  1,
);
export const DATABASE_URL = pick(process.env.COMFYUI_WORKER_DATABASE_URL, process.env.DATABASE_URL);
export const DATABASE_SYNC = pick(process.env.COMFYUI_WORKER_DATABASE_SYNC, 'true');
export const DATABASE_LOG_SQL = pick(process.env.COMFYUI_WORKER_DATABASE_LOG_SQL, 'false');
export const DATABASE_SSL = pick(process.env.DATABASE_SSL, '');
export const DATABASE_CA = pick(process.env.DATABASE_CA);
export const REDIS_URL = pick(process.env.REDIS_URL);
export const QUEUE_KEY_PREFIX = pick(process.env.QUEUE_KEY_PREFIX);
export const TASK_QUEUE_NAME = pick(process.env.COMFYUI_WORKER_QUEUE_NAME, 'demo-worker');
export const TASK_JOB_NAME = pick(process.env.COMFYUI_WORKER_JOB_NAME, 'render-panel.execute');
export const TASK_MAX_ATTEMPTS = integer(pick(process.env.COMFYUI_WORKER_MAX_ATTEMPTS, '3'), 3, 1);
export const TASK_BACKOFF_SECONDS = integerList(pick(process.env.COMFYUI_WORKER_BACKOFF_SECONDS, '15,60,180'), [15, 60, 180]);
export const TASK_TIMEOUT_SECONDS = integer(pick(process.env.COMFYUI_WORKER_TIMEOUT_SECONDS, '300'), 300, 1);
export const TASK_RETRY_AFTER_SECONDS = integer(pick(process.env.COMFYUI_WORKER_RETRY_AFTER_SECONDS, '900'), 900, 1);
export const PROVIDER_POLL_INTERVAL_SECONDS = integer(
  pick(process.env.COMFYUI_WORKER_PROVIDER_POLL_INTERVAL_SECONDS, '3'),
  3,
  1,
);
export const STEPHEN_RENDER_BASE_URL = pick(process.env.STEPHEN_RENDER_BASE_URL);
// Online PAILang blender runner (defaults to the Stephen render host, port 8911).
export const PAI_BLENDER_ONLINE_BASE_URL = pick(process.env.PAI_BLENDER_ONLINE_BASE_URL, process.env.STEPHEN_RENDER_BASE_URL);
// Local PAILang-compatible blender runner — the pai-blender-console mock.
// Used when a task's runner_target is `local`.
export const PAI_BLENDER_LOCAL_BASE_URL = pick(process.env.PAI_BLENDER_LOCAL_BASE_URL, 'http://127.0.0.1:3002');
// Per-job Blender wall-clock timeout sent to the runner. PAILang caps this at 600s.
export const PAI_BLENDER_JOB_TIMEOUT_SECONDS = integer(pick(process.env.PAI_BLENDER_JOB_TIMEOUT_SECONDS, '600'), 600, 5);
// Polling cadence/timeout against the PAILang job status endpoint.
export const PAI_BLENDER_POLL_INTERVAL_SECONDS = integer(pick(process.env.PAI_BLENDER_POLL_INTERVAL_SECONDS, '3'), 3, 1);
export const PAI_BLENDER_POLL_TIMEOUT_SECONDS = integer(pick(process.env.PAI_BLENDER_POLL_TIMEOUT_SECONDS, '900'), 900, 1);
export const PAI_ASSET_ENDPOINT = pick(process.env.PAI_ASSET_ENDPOINT);
export const PAI_ASSET_BUCKET = pick(process.env.PAI_ASSET_BUCKET);
export const PAI_ASSET_REGION = pick(process.env.PAI_ASSET_REGION, 'us-east-1');
export const PAI_ASSET_ACCESS_KEY_ID = pick(process.env.PAI_ASSET_ACCESS_KEY_ID);
export const PAI_ASSET_SECRET_ACCESS_KEY = pick(process.env.PAI_ASSET_SECRET_ACCESS_KEY);
export const PAI_ASSET_PREFIX_TEMPLATE = pick(process.env.PAI_ASSET_PREFIX_TEMPLATE);
export const PAI_ASSET_URL_EXPIRES_SECONDS = integer(pick(process.env.PAI_ASSET_URL_EXPIRES_SECONDS, '432000'), 432000, 1);
