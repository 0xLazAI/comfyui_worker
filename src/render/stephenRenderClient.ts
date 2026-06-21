import { PROVIDER_POLL_INTERVAL_SECONDS, STEPHEN_RENDER_BASE_URL, STEPHEN_RENDER_PROJECT_ID } from '../infra/constants.js';
import { ProviderRequestError, TaskRejectedError } from './errors.js';
import type { ParsedPanelId } from './panelId.js';

export interface StephenRenderTarget {
  projectId: string;
  panel: ParsedPanelId;
}

export interface StephenRenderStatus {
  job_id: string;
  status: string;
  project?: string;
  panel_id?: string;
  backend?: string;
  base_model?: string;
  seed?: number;
  workflow?: string | null;
  workflow_requested?: string | null;
  filename?: string | null;
  render_url?: string | null;
  error?: string | null;
  status_url?: string | null;
  [key: string]: unknown;
}

export async function submitStephenRender(
  target: StephenRenderTarget,
  body: Record<string, unknown>,
): Promise<StephenRenderStatus> {
  ensureBaseUrl();
  const projectId = effectiveStephenProjectId(target.projectId);
  const submitUrl = new URL(
    `/api/project/${encodeURIComponent(projectId)}/scene/${encodeURIComponent(target.panel.providerSceneId)}/shot/${encodeURIComponent(target.panel.providerShotId)}/panel/${encodeURIComponent(target.panel.panelNumber)}/render`,
    STEPHEN_RENDER_BASE_URL,
  );
  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new TaskRejectedError(extractMessage(data, `Stephen provider rejected the request (${response.status})`), 'provider_rejected');
    }
    throw new ProviderRequestError(
      extractMessage(data, `Stephen submit failed with HTTP ${response.status}`),
      response.status,
      'provider_submit_failed',
      data,
    );
  }

  return data as StephenRenderStatus;
}

export async function pollStephenRenderUntilTerminal(
  projectId: string,
  submitted: StephenRenderStatus,
  onUpdate?: (status: StephenRenderStatus) => Promise<void> | void,
): Promise<StephenRenderStatus> {
  while (true) {
    const status = await getStephenRenderStatus(projectId, submitted);
    await onUpdate?.(status);

    if (status.status === 'done') {
      return status;
    }
    if (status.status === 'failed') {
      throw new ProviderRequestError(extractMessage(status, 'Stephen render failed'), 502, 'provider_render_failed', status);
    }
    if (status.status === 'rejected') {
      throw new TaskRejectedError(extractMessage(status, 'Stephen render rejected'), 'provider_rejected');
    }

    await sleep(PROVIDER_POLL_INTERVAL_SECONDS * 1000);
  }
}

export async function getStephenRenderStatus(
  projectId: string,
  reference: Pick<StephenRenderStatus, 'job_id' | 'status_url'>,
): Promise<StephenRenderStatus> {
  ensureBaseUrl();
  const effectiveProjectId = effectiveStephenProjectId(projectId);
  const statusUrl = new URL(
    reference.status_url || `/api/project/${encodeURIComponent(effectiveProjectId)}/render/${encodeURIComponent(String(reference.job_id || '').trim())}`,
    STEPHEN_RENDER_BASE_URL,
  );
  const response = await fetch(statusUrl, { method: 'GET' });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new TaskRejectedError(extractMessage(data, `Stephen status request rejected (${response.status})`), 'provider_status_rejected');
    }
    throw new ProviderRequestError(
      extractMessage(data, `Stephen status request failed with HTTP ${response.status}`),
      response.status,
      'provider_status_failed',
      data,
    );
  }

  const status = data as StephenRenderStatus;
  if (status.status_url === undefined) {
    status.status_url = statusUrl.pathname;
  }
  return status;
}

export async function downloadStephenRenderImage(status: StephenRenderStatus): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string;
}> {
  ensureBaseUrl();
  const renderUrl = String(status.render_url || '').trim();
  if (!renderUrl) {
    throw new ProviderRequestError('Stephen render completed without render_url', 502, 'provider_missing_render_url', status);
  }

  const absolute = new URL(renderUrl, STEPHEN_RENDER_BASE_URL);
  const response = await fetch(absolute, { method: 'GET' });
  if (!response.ok) {
    throw new ProviderRequestError(`Failed to download Stephen render output: HTTP ${response.status}`, response.status, 'provider_download_failed');
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'image/png',
    filename: String(status.filename || absolute.pathname.split('/').pop() || 'render.png'),
  };
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

function ensureBaseUrl(): void {
  if (!STEPHEN_RENDER_BASE_URL) {
    throw new Error('STEPHEN_RENDER_BASE_URL is required');
  }
}

function effectiveStephenProjectId(projectId: string): string {
  return STEPHEN_RENDER_PROJECT_ID || String(projectId || '').trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
