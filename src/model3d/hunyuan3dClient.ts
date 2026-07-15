import {
  HUNYUAN3D_MODELING_WORKFLOW,
  STEPHEN_RENDER_BASE_URL,
} from '../infra/constants.js';
import type { ViewSlot } from './threeViewPayload.js';

export interface ModelingSubmitResult {
  jobId: string;
  statusUrl: string | null;
  outputUrl: string | null;
}

export interface ModelingStatusResult {
  status: string;
  faces: number | null;
  verts: number | null;
  dimensions: Record<string, unknown> | null;
  outputUrl: string | null;
  error: string | null;
  [key: string]: unknown;
}

/** POST /api/modeling/upload — stage one view image on the studio host, returns
 *  the absolute image_path the modeling params reference. */
export async function uploadModelingView(
  slot: ViewSlot,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);
  form.append('slot', slot);

  const response = await fetch(buildUrl('/api/modeling/upload'), { method: 'POST', body: form });
  const data = await readJson(response, `upload view ${slot}`);
  const imagePath = String((data.image_path as string) || '').trim();
  if (!imagePath) {
    throw new Error(`modeling upload for ${slot} did not return image_path`);
  }
  return imagePath;
}

/** POST /api/modeling — submit a hunyuan3d_mv job. `viewPaths` maps each staged
 *  slot to its studio image_path. */
export async function submitModelingJob(input: {
  viewPaths: Partial<Record<ViewSlot, string>>;
  preset: string;
  seed: number | null;
  maxFaces: number | null;
}): Promise<ModelingSubmitResult> {
  const views: Record<string, { image_path: string }> = {};
  for (const [slot, imagePath] of Object.entries(input.viewPaths)) {
    if (imagePath) {
      views[slot] = { image_path: imagePath };
    }
  }
  const params: Record<string, unknown> = { views, preset: input.preset };
  if (input.seed !== null) {
    params.seed = input.seed;
  }
  if (input.maxFaces !== null) {
    params.max_faces = input.maxFaces;
  }

  const response = await fetch(buildUrl('/api/modeling'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflow: HUNYUAN3D_MODELING_WORKFLOW, params }),
  });
  const data = await readJson(response, 'submit modeling job');
  const jobId = String((data.job_id as string) || '').trim();
  if (!jobId) {
    throw new Error('modeling submit did not return job_id');
  }
  return {
    jobId,
    statusUrl: optionalString(data.status_url),
    outputUrl: optionalString(data.output_url),
  };
}

/** GET /api/modeling/{jobId} — poll job status + result summary. */
export async function getModelingStatus(jobId: string): Promise<ModelingStatusResult> {
  const response = await fetch(buildUrl(`/api/modeling/${encodeURIComponent(jobId)}`), { method: 'GET' });
  const data = await readJson(response, `modeling status ${jobId}`);
  const status = String((data.status as string) || '').trim();
  if (!status) {
    throw new Error(`modeling status for ${jobId} did not return status`);
  }
  return {
    ...data,
    status,
    faces: optionalNumber(data.faces),
    verts: optionalNumber(data.verts),
    dimensions: isObject(data.dimensions) ? (data.dimensions as Record<string, unknown>) : null,
    outputUrl: optionalString(data.output_url),
    error: optionalString(data.error),
  };
}

/** GET /api/modeling/{jobId}/model.glb — download the produced GLB bytes. */
export async function downloadModelingGlb(jobId: string): Promise<Buffer> {
  const response = await fetch(buildUrl(`/api/modeling/${encodeURIComponent(jobId)}/model.glb`), { method: 'GET' });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`modeling GLB download failed with HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  return Buffer.from(new Uint8Array(await response.arrayBuffer()));
}

function buildUrl(path: string): string {
  return `${String(STEPHEN_RENDER_BASE_URL || '').replace(/\/+$/, '')}${path}`;
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text.slice(0, 240)}`);
  }
}

function optionalString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function isObject(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
