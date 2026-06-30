/**
 * PAILang blender-runner adapter.
 *
 * Talks to PAILang's scene-agnostic async job API
 * (`POST /api/blender/jobs/export`, `GET /api/blender/jobs/{id}`,
 * `GET /api/blender/jobs/{id}/output`) while preserving the function surface the
 * rest of the worker was built against (submit / poll / logs / download). The
 * old pai-blender-api `/runs` multi-artifact contract is no longer used.
 *
 * Key differences from pai-blender-api, deliberately accepted:
 *  - One output file per job (the GLB). Other artifacts (blend/preview/summary/
 *    pace) are not produced; `generated_script` is uploaded worker-side instead.
 *  - No logs endpoint — `fetchBlenderRunLogs` returns []; failure context comes
 *    from the job `error` string surfaced on the thrown ProviderRequestError.
 *  - `script` mode runs the script verbatim with no wrapper, so the GLB export
 *    epilogue is appended to the script before submit (see exportEpilogue.ts).
 *
 * All jobs run on the online PAILang runner (PAI_BLENDER_ONLINE_BASE_URL).
 */
import { readFileSync } from 'node:fs';
import { Agent } from 'undici';
import {
  PAI_BLENDER_JOB_TIMEOUT_SECONDS,
  PAI_BLENDER_ONLINE_BASE_URL,
  PAI_BLENDER_POLL_INTERVAL_SECONDS,
  PAI_BLENDER_POLL_TIMEOUT_SECONDS,
  PAI_BLENDER_RUNNER_CA,
  PAI_BLENDER_RUNNER_INSECURE_TLS,
} from '../infra/constants.js';
import { logger } from '../infra/logger.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import { appendExportEpilogue } from './exportEpilogue.js';
import type { BlenderRunnerTarget } from './types.js';

export type BlenderApiRunTerminalStatus = 'succeeded' | 'failed' | 'rejected';
export type BlenderApiRunStatusValue = 'queued' | 'running' | BlenderApiRunTerminalStatus | (string & {});

export interface BlenderApiReferenceImage {
  filename: string;
  content_type: string;
  base64: string;
}

export interface BlenderApiArtifactMetadata {
  artifact_id: string;
  filename?: string;
  content_type?: string;
  [key: string]: unknown;
}

export interface BlenderApiRunRequest {
  task_id: string;
  workflow: string;
  project_id: string;
  scene_id: string;
  shot_id: string;
  model_id?: string;
  script: string;
  reference_image?: BlenderApiReferenceImage;
  /** Always `gpu` (online PAILang); kept for request-shape compatibility. */
  runner_target?: BlenderRunnerTarget;
}

export interface BlenderApiRunLogEntry {
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface BlenderApiRunSubmitted {
  run_id: string;
  status: BlenderApiRunStatusValue;
  status_url?: string;
  /** Resolved runner base URL — carried so poll/download hit the same host. */
  pailang_base_url?: string;
  [key: string]: unknown;
}

export interface BlenderApiRunStatus {
  run_id: string;
  status: BlenderApiRunStatusValue;
  task_id?: string;
  artifacts?: BlenderApiArtifactMetadata[];
  error?: string | null;
  status_url?: string;
  pailang_base_url?: string;
  [key: string]: unknown;
}

interface BlenderApiClientTestOverrides {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_FAILED_STATUS_CODE = 502;
const GLB_CONTENT_TYPE = 'model/gltf-binary';

// The single artifact a PAILang export job yields, synthesized so the rest of
// the pipeline can keep treating runs as artifact-bearing.
const GLB_ARTIFACT: BlenderApiArtifactMetadata = {
  artifact_id: 'model_glb',
  filename: 'model.glb',
  content_type: GLB_CONTENT_TYPE,
};

let testOverrides: BlenderApiClientTestOverrides | undefined;

export async function submitBlenderRun(request: BlenderApiRunRequest): Promise<BlenderApiRunSubmitted> {
  const baseUrl = resolveBaseUrl(request.runner_target);
  const scriptWithExport = appendExportEpilogue(request.script);
  const body = {
    input_format: 'script',
    output_format: 'glb',
    script_b64: Buffer.from(scriptWithExport, 'utf-8').toString('base64'),
    timeout: PAI_BLENDER_JOB_TIMEOUT_SECONDS,
  };

  const response = await runnerFetch(buildUrl(baseUrl, '/api/blender/jobs/export'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new TaskRejectedError(extractMessage(data, `PAILang rejected the export job (${response.status})`), 'provider_rejected');
    }
    throw new ProviderRequestError(
      extractMessage(data, `PAILang export submit failed with HTTP ${response.status}`),
      response.status,
      'provider_submit_failed',
      data,
    );
  }

  const jobId = String(data.job_id || '').trim();
  if (!jobId) {
    throw new ProviderRequestError('PAILang export did not return a job_id', DEFAULT_FAILED_STATUS_CODE, 'provider_submit_failed', data);
  }

  return {
    run_id: jobId,
    status: mapStatus(data.status) || 'queued',
    status_url: `/api/blender/jobs/${encodeURIComponent(jobId)}`,
    pailang_base_url: baseUrl,
  };
}

export async function pollBlenderRunUntilTerminal(
  submittedOrRunId: string | Pick<BlenderApiRunSubmitted, 'run_id' | 'status_url' | 'pailang_base_url'>,
  onUpdate?: (status: BlenderApiRunStatus) => Promise<void> | void,
): Promise<BlenderApiRunStatus> {
  const jobId = typeof submittedOrRunId === 'string' ? submittedOrRunId : submittedOrRunId.run_id;
  const baseUrl =
    typeof submittedOrRunId === 'string' ? resolveBaseUrl() : submittedOrRunId.pailang_base_url || resolveBaseUrl();
  const statusUrl = buildUrl(baseUrl, `/api/blender/jobs/${encodeURIComponent(jobId)}`);
  const startedAt = getNow()();

  while (true) {
    const response = await runnerFetch(statusUrl, { method: 'GET', headers: authHeaders() });
    const data = await parseJsonResponse(response);

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new TaskRejectedError(extractMessage(data, `PAILang status request rejected (${response.status})`), 'provider_status_rejected');
      }
      throw new ProviderRequestError(
        extractMessage(data, `PAILang status request failed with HTTP ${response.status}`),
        response.status,
        'provider_status_failed',
        data,
      );
    }

    const mapped = mapStatus(data.status);
    const status: BlenderApiRunStatus = {
      ...data,
      run_id: jobId,
      status: mapped || String(data.status || ''),
      artifacts: mapped === 'succeeded' ? [GLB_ARTIFACT] : [],
      error: (data.error as string | null | undefined) ?? null,
      status_url: statusUrl.pathname,
      pailang_base_url: baseUrl,
    };
    await onUpdate?.(status);

    if (status.status === 'succeeded') {
      return status;
    }
    if (status.status === 'failed') {
      throw new ProviderRequestError(
        extractMessage(status, 'PAILang export job failed'),
        DEFAULT_FAILED_STATUS_CODE,
        'provider_run_failed',
        status,
      );
    }
    if (status.status === 'rejected') {
      throw new TaskRejectedError(extractMessage(status, 'PAILang export job rejected'), 'provider_rejected');
    }

    const elapsedMs = getNow()() - startedAt;
    if (elapsedMs >= PAI_BLENDER_POLL_TIMEOUT_SECONDS * 1000) {
      throw new ProviderRequestError(
        `PAILang job polling timed out after ${PAI_BLENDER_POLL_TIMEOUT_SECONDS} seconds`,
        504,
        'provider_poll_timeout',
        { run_id: jobId, status: status.status },
      );
    }

    await getSleep()(PAI_BLENDER_POLL_INTERVAL_SECONDS * 1000);
  }
}

export interface BlenderApiBatchJobSubmitted {
  /** PAILang job_id (kept as run_id so download/poll helpers stay uniform). */
  run_id: string;
  status_url: string;
  output_url: string;
}

export interface BlenderApiBatchSubmitted {
  batch_id: string;
  jobs: BlenderApiBatchJobSubmitted[];
  pailang_base_url: string;
}

export interface BlenderApiBatchJobStatus {
  run_id: string;
  status: BlenderApiRunStatusValue;
  error: string | null;
}

export interface BlenderApiBatchStatus {
  batch_id: string;
  /** Aggregate: done (all succeeded) | partial (mixed) | running. */
  status: string;
  jobs: BlenderApiBatchJobStatus[];
  pailang_base_url: string;
}

/** Max jobs per PAILang batch (`POST /api/blender/jobs/export/batch`). */
export const BLENDER_BATCH_MAX_JOBS = 32;

/**
 * Submits N blender fix scripts as ONE PAILang batch so the GPU machine runs them
 * together. All jobs share the same runner target. Each job's script gets the GLB
 * export epilogue appended, exactly like the single-job path.
 */
export async function submitBlenderRunBatch(
  requests: Array<Pick<BlenderApiRunRequest, 'script' | 'runner_target'>>,
): Promise<BlenderApiBatchSubmitted> {
  if (!requests.length) {
    throw new Error('submitBlenderRunBatch requires at least one job');
  }
  if (requests.length > BLENDER_BATCH_MAX_JOBS) {
    throw new Error(`PAILang batch accepts at most ${BLENDER_BATCH_MAX_JOBS} jobs (got ${requests.length})`);
  }
  const baseUrl = resolveBaseUrl(requests[0].runner_target);
  const jobs = requests.map((request) => ({
    input_format: 'script',
    output_format: 'glb',
    script_b64: Buffer.from(appendExportEpilogue(request.script), 'utf-8').toString('base64'),
    timeout: PAI_BLENDER_JOB_TIMEOUT_SECONDS,
  }));

  const response = await runnerFetch(buildUrl(baseUrl, '/api/blender/jobs/export/batch'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ jobs }),
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new TaskRejectedError(extractMessage(data, `PAILang rejected the batch (${response.status})`), 'provider_rejected');
    }
    throw new ProviderRequestError(
      extractMessage(data, `PAILang batch submit failed with HTTP ${response.status}`),
      response.status,
      'provider_submit_failed',
      data,
    );
  }

  const batchId = String(data.batch_id || '').trim();
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
  if (!batchId || rawJobs.length !== requests.length) {
    throw new ProviderRequestError('PAILang batch did not return a batch_id and one job per request', DEFAULT_FAILED_STATUS_CODE, 'provider_submit_failed', data);
  }

  return {
    batch_id: batchId,
    pailang_base_url: baseUrl,
    jobs: rawJobs.map((entry) => {
      const job = entry as Record<string, unknown>;
      const jobId = String(job.job_id || '').trim();
      return {
        run_id: jobId,
        status_url: `/api/blender/jobs/${encodeURIComponent(jobId)}`,
        output_url: `/api/blender/jobs/${encodeURIComponent(jobId)}/output`,
      };
    }),
  };
}

/**
 * Polls a PAILang batch until every job is terminal (done or failed). Returns the
 * final per-job statuses; the caller decides per scene (download succeeded jobs,
 * record failed ones). Does NOT throw on partial failure — partial is expected.
 */
export async function pollBlenderBatchUntilTerminal(
  batchId: string,
  baseUrl: string,
  onUpdate?: (status: BlenderApiBatchStatus) => Promise<void> | void,
): Promise<BlenderApiBatchStatus> {
  const statusUrl = buildUrl(baseUrl, `/api/blender/jobs/batch/${encodeURIComponent(batchId)}`);
  const startedAt = getNow()();

  while (true) {
    const response = await runnerFetch(statusUrl, { method: 'GET', headers: authHeaders() });
    const data = await parseJsonResponse(response);

    if (!response.ok) {
      throw new ProviderRequestError(
        extractMessage(data, `PAILang batch status failed with HTTP ${response.status}`),
        response.status,
        'provider_status_failed',
        data,
      );
    }

    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
    const jobs: BlenderApiBatchJobStatus[] = rawJobs.map((entry) => {
      const job = entry as Record<string, unknown>;
      return {
        run_id: String(job.job_id || '').trim(),
        status: mapStatus(job.status) || String(job.status || ''),
        error: (job.error as string | null | undefined) ?? null,
      };
    });
    const status: BlenderApiBatchStatus = {
      batch_id: batchId,
      status: String(data.status || ''),
      jobs,
      pailang_base_url: baseUrl,
    };
    await onUpdate?.(status);

    const stillRunning = jobs.some((job) => job.status === 'running' || job.status === 'queued');
    if (!stillRunning) {
      return status;
    }

    if (getNow()() - startedAt >= PAI_BLENDER_POLL_TIMEOUT_SECONDS * 1000) {
      throw new ProviderRequestError(
        `PAILang batch polling timed out after ${PAI_BLENDER_POLL_TIMEOUT_SECONDS} seconds`,
        504,
        'provider_poll_timeout',
        { batch_id: batchId },
      );
    }

    await getSleep()(PAI_BLENDER_POLL_INTERVAL_SECONDS * 1000);
  }
}

/**
 * PAILang exposes no logs endpoint (run.log stays on the runner host). Failure
 * context is carried on the thrown ProviderRequestError instead, so this is a
 * no-op kept for call-site compatibility.
 */
export async function fetchBlenderRunLogs(_runId: string): Promise<BlenderApiRunLogEntry[]> {
  return [];
}

export async function downloadBlenderRunArtifact(
  runId: string,
  artifact: Pick<BlenderApiArtifactMetadata, 'artifact_id' | 'filename' | 'content_type'>,
  options?: { baseUrl?: string },
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  // A PAILang job has exactly one downloadable output — the GLB — regardless of
  // the requested artifact id.
  const baseUrl = options?.baseUrl || resolveBaseUrl();
  const response = await runnerFetch(buildUrl(baseUrl, `/api/blender/jobs/${encodeURIComponent(runId)}/output`), {
    method: 'GET',
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new ProviderRequestError(
      `Failed to download PAILang job output: HTTP ${response.status}`,
      response.status,
      'provider_download_failed',
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || artifact.content_type || DEFAULT_DOWNLOAD_CONTENT_TYPE,
    filename: artifact.filename || extractFilenameFromContentDisposition(response.headers.get('content-disposition')) || `${artifact.artifact_id}.glb`,
  };
}

/**
 * Best-effort download of a run's sibling previz `.blend` (camera markers bound).
 * Only the local runner produces one; returns null on any non-200 (e.g. the
 * online PAILang runner, or a scene with no animated cameras) so callers can
 * treat the .blend as an optional artifact.
 */
export async function downloadBlenderRunBlend(
  runId: string,
  options?: { baseUrl?: string },
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const baseUrl = options?.baseUrl || resolveBaseUrl();
  const url = buildUrl(baseUrl, `/api/blender/jobs/${encodeURIComponent(runId)}/output`);
  url.searchParams.set('artifact', 'blend');
  try {
    const response = await runnerFetch(url, { method: 'GET', headers: authHeaders() });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.byteLength) return null;
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/x-blender',
    };
  } catch {
    return null;
  }
}

export function setBlenderApiClientTestOverridesForTests(overrides?: BlenderApiClientTestOverrides): void {
  testOverrides = overrides;
}

function resolveBaseUrl(_runnerTarget?: BlenderRunnerTarget): string {
  const baseUrl = PAI_BLENDER_ONLINE_BASE_URL;
  if (!baseUrl) {
    throw new Error('PAI_BLENDER_ONLINE_BASE_URL / STEPHEN_RENDER_BASE_URL is required for the gpu runner');
  }
  return baseUrl;
}

function mapStatus(value: unknown): BlenderApiRunStatusValue | '' {
  switch (String(value || '').trim()) {
    case 'done':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'submitted':
    case 'queued':
      return 'queued';
    default:
      return '';
  }
}

function buildUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractMessage(source: Record<string, unknown>, fallback: string): string {
  const direct = String(source.message || source.error || source.detail || '').trim();
  return direct || fallback;
}

function jsonHeaders(): Headers {
  const headers = authHeaders();
  headers.set('content-type', 'application/json');
  return headers;
}

function authHeaders(): Headers {
  // PAILang studio at the configured host is reached without a bearer token,
  // matching the existing Stephen render client.
  return new Headers();
}

function getFetch(): typeof fetch {
  return testOverrides?.fetch || fetch;
}

// Scoped TLS for the runner connection only (NOT a process-wide NODE_TLS bypass).
// Built once: a CA bundle (secure, preferred) or rejectUnauthorized:false (insecure,
// explicit dev opt-in). undefined → Node's default verification against the system store.
let runnerDispatcher: Agent | null | undefined;
function getRunnerDispatcher(): Agent | undefined {
  if (runnerDispatcher !== undefined) {
    return runnerDispatcher ?? undefined;
  }
  if (PAI_BLENDER_RUNNER_CA) {
    runnerDispatcher = new Agent({ connect: { ca: readFileSync(PAI_BLENDER_RUNNER_CA, 'utf8') } });
  } else if (PAI_BLENDER_RUNNER_INSECURE_TLS) {
    logger.warn('blender runner TLS verification disabled (PAI_BLENDER_RUNNER_INSECURE_TLS=true) — dev/self-signed only');
    runnerDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  } else {
    runnerDispatcher = null;
  }
  return runnerDispatcher ?? undefined;
}

/** fetch to the runner, injecting the scoped TLS dispatcher when configured. */
function runnerFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}): ReturnType<typeof fetch> {
  const dispatcher = getRunnerDispatcher();
  // `dispatcher` is an undici-specific RequestInit extension not in the DOM types.
  // Test overrides supply their own fetch and ignore it.
  return getFetch()(input, dispatcher ? ({ ...init, dispatcher } as RequestInit) : init);
}

function getNow(): () => number {
  return testOverrides?.now || Date.now;
}

function getSleep(): (ms: number) => Promise<void> {
  return testOverrides?.sleep || sleep;
}

function extractFilenameFromContentDisposition(headerValue: string | null): string | null {
  const match = /filename="?([^";]+)"?/i.exec(String(headerValue || ''));
  return match?.[1]?.trim() || null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
