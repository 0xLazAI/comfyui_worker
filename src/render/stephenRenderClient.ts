import { PROVIDER_POLL_INTERVAL_SECONDS, STEPHEN_RENDER_BASE_URL } from '../infra/constants.js';
import { ProviderRequestError, TaskRejectedError } from './errors.js';
import type { NormalizedRenderPanelPayload } from './payload.js';
import type { WorkflowDefinition } from './workflowCatalog.js';

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
  payload: NormalizedRenderPanelPayload,
  workflow: WorkflowDefinition,
  sourceImageBase64: string,
): Promise<StephenRenderStatus> {
  ensureBaseUrl();
  const submitUrl = new URL(
    `/api/project/${encodeURIComponent(payload.projectId)}/scene/${encodeURIComponent(payload.panel.sceneId)}/shot/${encodeURIComponent(payload.panel.shotId)}/panel/${encodeURIComponent(payload.panel.panelNumber)}/render`,
    STEPHEN_RENDER_BASE_URL,
  );

  const body = buildSubmitBody(payload, workflow, sourceImageBase64);
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
  payload: NormalizedRenderPanelPayload,
  submitted: StephenRenderStatus,
  onUpdate?: (status: StephenRenderStatus) => Promise<void> | void,
): Promise<StephenRenderStatus> {
  ensureBaseUrl();
  const statusUrl = new URL(
    submitted.status_url || `/api/project/${encodeURIComponent(payload.projectId)}/render/${encodeURIComponent(String(submitted.job_id || '').trim())}`,
    STEPHEN_RENDER_BASE_URL,
  );

  while (true) {
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

function buildSubmitBody(
  payload: NormalizedRenderPanelPayload,
  workflow: WorkflowDefinition,
  sourceImageBase64: string,
): Record<string, unknown> {
  return {
    project: payload.projectId,
    workflow: workflow.providerWorkflowId,
    backend: workflow.backend,
    base_model: workflow.baseModel,
    positive: payload.prompt.text,
    negative: payload.prompt.negativeText,
    seed: payload.seed,
    inpaint: {
      init_b64: sourceImageBase64,
      denoise: payload.extraParams.denoise,
      grow_mask: payload.extraParams.growMask,
    },
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
