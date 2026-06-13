import {
  BLENDER_API_BASE_URL,
  BLENDER_API_POLL_INTERVAL_SECONDS,
  BLENDER_API_TIMEOUT_SECONDS,
  BLENDER_API_TOKEN,
} from '../infra/constants.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';

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
  pace: Record<string, unknown>;
  script: string;
  reference_image?: BlenderApiReferenceImage;
}

export interface BlenderApiRunLogEntry {
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface BlenderApiRunSubmitted {
  run_id: string;
  status: BlenderApiRunStatusValue;
  status_url?: string;
  [key: string]: unknown;
}

export interface BlenderApiRunStatus {
  run_id: string;
  status: BlenderApiRunStatusValue;
  task_id?: string;
  workflow?: string;
  project_id?: string;
  scene_id?: string;
  shot_id?: string;
  model_id?: string | null;
  artifacts?: BlenderApiArtifactMetadata[];
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  status_url?: string;
  [key: string]: unknown;
}

interface BlenderApiClientTestOverrides {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_FAILED_STATUS_CODE = 502;

let testOverrides: BlenderApiClientTestOverrides | undefined;

export async function submitBlenderRun(request: BlenderApiRunRequest): Promise<BlenderApiRunSubmitted> {
  const submitUrl = buildUrl('/runs');
  const response = await getFetch()(submitUrl, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(request),
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new TaskRejectedError(extractMessage(data, `Blender API rejected the request (${response.status})`), 'provider_rejected');
    }
    throw new ProviderRequestError(
      extractMessage(data, `Blender API submit failed with HTTP ${response.status}`),
      response.status,
      'provider_submit_failed',
      data,
    );
  }

  return data as BlenderApiRunSubmitted;
}

export async function pollBlenderRunUntilTerminal(
  submittedOrRunId: string | Pick<BlenderApiRunSubmitted, 'run_id' | 'status_url'>,
  onUpdate?: (status: BlenderApiRunStatus) => Promise<void> | void,
): Promise<BlenderApiRunStatus> {
  const statusUrl = resolveStatusUrl(submittedOrRunId);
  const startedAt = getNow()();

  while (true) {
    const response = await getFetch()(statusUrl, {
      method: 'GET',
      headers: buildAuthHeaders(),
    });
    const data = await parseJsonResponse(response);

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new TaskRejectedError(extractMessage(data, `Blender API status request rejected (${response.status})`), 'provider_status_rejected');
      }
      throw new ProviderRequestError(
        extractMessage(data, `Blender API status request failed with HTTP ${response.status}`),
        response.status,
        'provider_status_failed',
        data,
      );
    }

    const status = data as BlenderApiRunStatus;
    if (status.status_url === undefined) {
      status.status_url = statusUrl.pathname;
    }
    await onUpdate?.(status);

    if (status.status === 'succeeded') {
      return status;
    }
    if (status.status === 'failed') {
      throw new ProviderRequestError(
        extractMessage(status, 'Blender API run failed'),
        DEFAULT_FAILED_STATUS_CODE,
        'provider_run_failed',
        status,
      );
    }
    if (status.status === 'rejected') {
      throw new TaskRejectedError(extractMessage(status, 'Blender API run rejected'), 'provider_rejected');
    }

    const elapsedMs = getNow()() - startedAt;
    if (elapsedMs >= BLENDER_API_TIMEOUT_SECONDS * 1000) {
      throw new ProviderRequestError(
        `Blender API polling timed out after ${BLENDER_API_TIMEOUT_SECONDS} seconds`,
        504,
        'provider_poll_timeout',
        { run_id: status.run_id, status: status.status },
      );
    }

    await getSleep()(BLENDER_API_POLL_INTERVAL_SECONDS * 1000);
  }
}

export async function fetchBlenderRunLogs(runId: string): Promise<BlenderApiRunLogEntry[]> {
  const logsUrl = buildUrl(`/runs/${encodeURIComponent(runId)}/logs`);
  const response = await getFetch()(logsUrl, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    throw new ProviderRequestError(
      extractMessage(data, `Blender API logs request failed with HTTP ${response.status}`),
      response.status,
      'provider_logs_failed',
      data,
    );
  }

  const logs = Array.isArray(data.logs) ? data.logs : [];
  return logs
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      stream: normalizeLogStream(entry.stream),
      message: String(entry.message ?? ''),
    }))
    .filter((entry) => entry.message.trim().length > 0);
}

function normalizeLogStream(value: unknown): BlenderApiRunLogEntry['stream'] {
  return value === 'stderr' || value === 'system' ? value : 'stdout';
}

export async function downloadBlenderRunArtifact(
  runId: string,
  artifact: Pick<BlenderApiArtifactMetadata, 'artifact_id' | 'filename' | 'content_type'>,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const artifactUrl = buildUrl(`/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.artifact_id)}`);
  const response = await getFetch()(artifactUrl, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    throw new ProviderRequestError(
      `Failed to download Blender API artifact: HTTP ${response.status}`,
      response.status,
      'provider_download_failed',
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || artifact.content_type || DEFAULT_DOWNLOAD_CONTENT_TYPE,
    filename: artifact.filename || extractFilenameFromContentDisposition(response.headers.get('content-disposition')) || artifact.artifact_id,
  };
}

export function setBlenderApiClientTestOverridesForTests(overrides?: BlenderApiClientTestOverrides): void {
  testOverrides = overrides;
}

function buildUrl(pathname: string): URL {
  return new URL(pathname, ensureBaseUrl());
}

function resolveStatusUrl(submittedOrRunId: string | Pick<BlenderApiRunSubmitted, 'run_id' | 'status_url'>): URL {
  if (typeof submittedOrRunId === 'string') {
    return buildUrl(`/runs/${encodeURIComponent(submittedOrRunId)}`);
  }

  const statusUrl = String(submittedOrRunId.status_url || '').trim();
  if (statusUrl) {
    const baseUrl = new URL(ensureBaseUrl());
    const resolved = new URL(statusUrl, baseUrl);
    if (resolved.origin !== baseUrl.origin) {
      throw new ProviderRequestError(
        'Blender API returned a status_url outside the configured origin',
        502,
        'provider_status_url_rejected',
        {
          run_id: submittedOrRunId.run_id,
          status_url: statusUrl,
        },
      );
    }
    return resolved;
  }
  return buildUrl(`/runs/${encodeURIComponent(submittedOrRunId.run_id)}`);
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

function ensureBaseUrl(): string {
  if (!BLENDER_API_BASE_URL) {
    throw new Error('BLENDER_API_BASE_URL is required');
  }
  return BLENDER_API_BASE_URL;
}

function buildJsonHeaders(): Headers {
  const headers = buildAuthHeaders();
  headers.set('content-type', 'application/json');
  return headers;
}

function buildAuthHeaders(): Headers {
  const headers = new Headers();
  if (BLENDER_API_TOKEN) {
    headers.set('authorization', `Bearer ${BLENDER_API_TOKEN}`);
  }
  return headers;
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
