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
 * Runner target switch: `runner_target=local` routes to the console mock
 * (PAI_BLENDER_LOCAL_BASE_URL); anything else routes to the online PAILang
 * (PAI_BLENDER_ONLINE_BASE_URL).
 */
import {
  PAI_BLENDER_JOB_TIMEOUT_SECONDS,
  PAI_BLENDER_LOCAL_BASE_URL,
  PAI_BLENDER_ONLINE_BASE_URL,
  PAI_BLENDER_POLL_INTERVAL_SECONDS,
  PAI_BLENDER_POLL_TIMEOUT_SECONDS,
} from '../infra/constants.js';
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
  /** Routes to the local console mock when `local`, otherwise online PAILang. */
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

  const response = await getFetch()(buildUrl(baseUrl, '/api/blender/jobs/export'), {
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
    const response = await getFetch()(statusUrl, { method: 'GET', headers: authHeaders() });
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
  const response = await getFetch()(buildUrl(baseUrl, `/api/blender/jobs/${encodeURIComponent(runId)}/output`), {
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

export function setBlenderApiClientTestOverridesForTests(overrides?: BlenderApiClientTestOverrides): void {
  testOverrides = overrides;
}

function resolveBaseUrl(runnerTarget?: BlenderRunnerTarget): string {
  const baseUrl = runnerTarget === 'local' ? PAI_BLENDER_LOCAL_BASE_URL : PAI_BLENDER_ONLINE_BASE_URL;
  if (!baseUrl) {
    const envName = runnerTarget === 'local' ? 'PAI_BLENDER_LOCAL_BASE_URL' : 'PAI_BLENDER_ONLINE_BASE_URL / STEPHEN_RENDER_BASE_URL';
    throw new Error(`${envName} is required for runner_target=${runnerTarget || 'gpu'}`);
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
