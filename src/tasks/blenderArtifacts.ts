import { basename } from 'node:path';
import {
  downloadBlenderRunArtifact,
  type BlenderApiArtifactMetadata,
  type BlenderApiRunStatus,
} from '../blender/blenderApiClient.js';
import { ProviderRequestError } from '../render/errors.js';
import { uploadWorkerAsset } from '../render/assetStore.js';
import { taskStore } from './taskStore.js';

export const REQUIRED_ARTIFACT_KINDS = [
  'blend',
  'model_obj',
  'preview',
  'summary',
  'pace',
  'generated_script',
] as const;

export type RequiredArtifactKind = (typeof REQUIRED_ARTIFACT_KINDS)[number];

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
    const downloaded = await downloadBlenderRunArtifact(terminalStatus.run_id, artifact);
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

  if (artifactId === 'scene_blend' || filename === 'scene') {
    return 'blend';
  }
  if (artifactId === 'model_obj' || filename === 'model') {
    return 'model_obj';
  }
  if (artifactId === 'preview_png' || filename === 'preview') {
    return 'preview';
  }
  if (artifactId === 'summary_json' || filename === 'summary') {
    return 'summary';
  }
  if (artifactId === 'pace_json' || filename === 'pace') {
    return 'pace';
  }
  if (artifactId === 'generated_scene_py' || filename === 'generated_scene') {
    return 'generated_script';
  }
  return null;
}

export function findPreviewArtifact(
  status: BlenderApiRunStatus,
): BlenderApiArtifactMetadata | null {
  const artifacts = Array.isArray(status.artifacts) ? status.artifacts : [];
  return artifacts.find((artifact) => inferArtifactKind(artifact) === 'preview') ?? null;
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
