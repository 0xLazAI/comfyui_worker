import { basename } from 'node:path';
import {
  downloadBlenderRunArtifact,
  downloadBlenderRunBlend,
  type BlenderApiArtifactMetadata,
  type BlenderApiRunStatus,
} from '../blender/blenderApiClient.js';
import { ProviderRequestError } from '../render/errors.js';
import { uploadWorkerAsset } from '../render/assetStore.js';
import { taskStore } from './taskStore.js';

// PAILang produces a single output per job (the GLB). `generated_script` is
// uploaded worker-side from the in-memory script, so it is not required from
// the runner. blend/preview/summary/pace are intentionally dropped for now.
export const REQUIRED_ARTIFACT_KINDS = ['model_glb'] as const;

export type RequiredArtifactKind = (typeof REQUIRED_ARTIFACT_KINDS)[number];

const GENERATED_SCRIPT_KIND = 'generated_script';

export async function uploadArtifacts(
  taskId: string,
  projectId: string,
  terminalStatus: BlenderApiRunStatus,
  attemptNo: number,
  workerName: string,
): Promise<Array<Record<string, unknown>>> {
  const artifacts = normalizeRequiredArtifacts(terminalStatus);
  const uploadedArtifacts: Array<Record<string, unknown>> = [];

  for (const artifact of artifacts) {
    const downloaded = await downloadBlenderRunArtifact(terminalStatus.run_id, artifact, {
      baseUrl: terminalStatus.pailang_base_url,
    });
    if (!downloaded.buffer.byteLength) {
      throw new ProviderRequestError(
        `Blender API returned an empty artifact: ${artifact.kind}`,
        502,
        'provider_empty_artifact',
        {
          artifact_id: artifact.artifact_id,
          filename: artifact.filename || null,
          kind: artifact.kind,
          run_id: terminalStatus.run_id,
        },
      );
    }
    const uploaded = await uploadWorkerAsset(projectId, 'blender', {
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      filenameHint: downloaded.filename,
    });
    const detail = buildUploadedArtifactDetail(artifact, uploaded);
    uploadedArtifacts.push(detail);

    await taskStore.appendEvent({
      taskId,
      eventType: 'asset_uploaded',
      attemptNo,
      workerName,
      message: `uploaded blender artifact ${artifact.artifact_id}`,
      detailJson: detail,
    });
  }

  return uploadedArtifacts;
}

/**
 * Uploads the agent-generated Blender script as a `generated_script` artifact.
 * The runner does not return it (PAILang yields only the GLB), so it is taken
 * from the worker's in-memory copy — the pristine script, before the GLB export
 * epilogue is appended at submit time.
 */
export async function uploadGeneratedScriptArtifact(
  taskId: string,
  projectId: string,
  script: string,
  attemptNo: number,
  workerName: string,
  options?: { artifactId?: string; filenameHint?: string },
): Promise<Record<string, unknown>> {
  const artifactId = options?.artifactId || 'generated_scene_py';
  const filenameHint = options?.filenameHint || 'generated_scene.py';
  const uploaded = await uploadWorkerAsset(projectId, 'blender', {
    buffer: Buffer.from(script, 'utf-8'),
    contentType: 'text/x-python',
    filenameHint,
  });
  const detail: Record<string, unknown> = {
    artifact_id: artifactId,
    kind: GENERATED_SCRIPT_KIND,
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };

  await taskStore.appendEvent({
    taskId,
    eventType: 'asset_uploaded',
    attemptNo,
    workerName,
    message: `uploaded blender artifact ${artifactId}`,
    detailJson: detail,
  });

  return detail;
}

/**
 * Downloads the single GLB a PACE-scene run produced and uploads it under a
 * scene-scoped artifact id/filename (e.g. `s001` / `s001.glb`). blender-pace-3d
 * fans out one run per scene, so the result carries one such `model_glb`
 * artifact per scene — the console grid renders each.
 */
export async function uploadSceneGlbArtifact(
  taskId: string,
  projectId: string,
  terminalStatus: BlenderApiRunStatus,
  sceneId: string,
  attemptNo: number,
  workerName: string,
): Promise<Record<string, unknown>> {
  const artifacts = Array.isArray(terminalStatus.artifacts) ? terminalStatus.artifacts : [];
  const glb = artifacts.find((artifact) => inferArtifactKind(artifact) === 'model_glb');
  if (!glb) {
    throw new ProviderRequestError(
      `Blender API run for scene ${sceneId} completed without a model_glb artifact`,
      502,
      'provider_missing_artifact',
      { run_id: terminalStatus.run_id, scene_id: sceneId },
    );
  }

  const safeSceneId = sanitizeArtifactId(sceneId);
  const downloaded = await downloadBlenderRunArtifact(terminalStatus.run_id, glb, {
    baseUrl: terminalStatus.pailang_base_url,
  });
  if (!downloaded.buffer.byteLength) {
    throw new ProviderRequestError(
      `Blender API returned an empty GLB for scene ${sceneId}`,
      502,
      'provider_empty_artifact',
      { run_id: terminalStatus.run_id, scene_id: sceneId },
    );
  }

  const uploaded = await uploadWorkerAsset(projectId, 'blender', {
    buffer: downloaded.buffer,
    contentType: downloaded.contentType || 'model/gltf-binary',
    filenameHint: `${safeSceneId}.glb`,
  });
  const detail: Record<string, unknown> = {
    artifact_id: safeSceneId,
    scene_id: sceneId,
    kind: 'model_glb',
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };

  await taskStore.appendEvent({
    taskId,
    eventType: 'asset_uploaded',
    attemptNo,
    workerName,
    message: `uploaded blender scene GLB ${safeSceneId}`,
    detailJson: detail,
  });

  return detail;
}

/**
 * Best-effort upload of the run's sibling previz `.blend` (camera markers bound)
 * as a `scene_blend` artifact. Returns null when the runner produced no .blend
 * (e.g. the online PAILang runner, or a scene with no animated cameras), so the
 * pace-review result simply omits it rather than failing.
 */
export async function uploadSceneBlendArtifact(
  taskId: string,
  projectId: string,
  terminalStatus: BlenderApiRunStatus,
  sceneId: string,
  attemptNo: number,
  workerName: string,
): Promise<Record<string, unknown> | null> {
  if (!terminalStatus.run_id) return null;
  const blend = await downloadBlenderRunBlend(terminalStatus.run_id, {
    baseUrl: terminalStatus.pailang_base_url,
  });
  if (!blend) return null;

  const safeSceneId = sanitizeArtifactId(sceneId);
  const uploaded = await uploadWorkerAsset(projectId, 'blender', {
    buffer: blend.buffer,
    contentType: blend.contentType || 'application/x-blender',
    filenameHint: `${safeSceneId}.blend`,
  });
  const detail: Record<string, unknown> = {
    artifact_id: `${safeSceneId}_blend`,
    scene_id: sceneId,
    kind: 'scene_blend',
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };

  await taskStore.appendEvent({
    taskId,
    eventType: 'asset_uploaded',
    attemptNo,
    workerName,
    message: `uploaded blender previz blend ${safeSceneId}`,
    detailJson: detail,
  });

  return detail;
}

/** Uploads the blender-pace-review Markdown report as a `review_report` artifact. */
export async function uploadReviewReportArtifact(
  taskId: string,
  projectId: string,
  reportMarkdown: string,
  attemptNo: number,
  workerName: string,
  options: { artifactId?: string; filenameHint?: string } = {},
): Promise<Record<string, unknown>> {
  const artifactId = options.artifactId || 'pace_review_report';
  const uploaded = await uploadWorkerAsset(projectId, 'blender', {
    buffer: Buffer.from(reportMarkdown, 'utf-8'),
    contentType: 'text/markdown',
    filenameHint: options.filenameHint || 'pace_review_report.md',
  });
  const detail: Record<string, unknown> = {
    artifact_id: artifactId,
    kind: 'review_report',
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };

  await taskStore.appendEvent({
    taskId,
    eventType: 'asset_uploaded',
    attemptNo,
    workerName,
    message: `uploaded blender artifact ${artifactId}`,
    detailJson: detail,
  });

  return detail;
}

function sanitizeArtifactId(value: string): string {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'scene'
  );
}

function buildUploadedArtifactDetail(
  artifact: BlenderApiArtifactMetadata & { kind: RequiredArtifactKind },
  uploaded: Awaited<ReturnType<typeof uploadWorkerAsset>>,
): Record<string, unknown> {
  return {
    artifact_id: artifact.artifact_id,
    kind: artifact.kind,
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };
}

function normalizeRequiredArtifacts(
  terminalStatus: BlenderApiRunStatus,
): Array<BlenderApiArtifactMetadata & { kind: RequiredArtifactKind }> {
  const artifacts = Array.isArray(terminalStatus.artifacts) ? terminalStatus.artifacts : [];
  const artifactByKind = new Map<RequiredArtifactKind, BlenderApiArtifactMetadata & { kind: RequiredArtifactKind }>();

  for (const artifact of artifacts) {
    const kind = inferArtifactKind(artifact);
    if (kind && !artifactByKind.has(kind)) {
      artifactByKind.set(kind, { ...artifact, kind });
    }
  }

  const missingKinds = REQUIRED_ARTIFACT_KINDS.filter((kind) => !artifactByKind.has(kind));
  if (missingKinds.length) {
    throw new ProviderRequestError(
      `Blender API run completed without required artifacts: ${missingKinds.join(', ')}`,
      502,
      'provider_missing_artifact',
      {
        missing_kinds: missingKinds,
        run_id: terminalStatus.run_id,
      },
    );
  }

  return REQUIRED_ARTIFACT_KINDS.map((kind) => artifactByKind.get(kind) as BlenderApiArtifactMetadata & { kind: RequiredArtifactKind });
}

export function inferArtifactKind(
  artifact: Pick<BlenderApiArtifactMetadata, 'artifact_id' | 'filename'>,
): RequiredArtifactKind | null {
  const artifactId = normalizeArtifactToken(artifact.artifact_id);
  const filename = normalizeArtifactFilename(artifact.filename);

  if (artifactId === 'model_glb' || artifactId === 'model_obj' || filename === 'model') {
    return 'model_glb';
  }
  return null;
}

export function buildArtifactUriMap(
  artifacts: Array<Record<string, unknown>>,
): Record<RequiredArtifactKind, string> {
  const result = {} as Record<RequiredArtifactKind, string>;
  for (const artifact of artifacts) {
    const kind = artifact.kind as RequiredArtifactKind;
    result[kind] = String(artifact.asset_uri || '');
  }
  return result;
}

function normalizeArtifactToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeArtifactFilename(value: unknown): string {
  return basename(String(value || '').trim() || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
