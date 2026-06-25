import fs from 'fs/promises';
import path from 'path';
import { PLATFORM_API_ENABLED } from '../infra/constants.js';
import { atomicWriteJson, ensureDirectory, readJsonFile } from '../infra/filesystem.js';
import { PaiPlatformApiError, paiPlatformClient } from '../platform/paiPlatformClient.js';
import type { ParsedPanelId } from './panelId.js';

interface StoryboardOutputDocument {
  panel_id: string;
  scene_id: string;
  shot_id: string;
  outputs: StoryboardOutputRecord[];
}

export interface RenderPanelProjectContext {
  manifestPath: string;
  shotManifestPath: string;
  panelPath: string;
  manifest: Record<string, unknown> | null;
  shotManifest: Record<string, unknown> | null;
  panel: Record<string, unknown> | null;
}

export interface StoryboardOutputRecord {
  task_id: string;
  task_type: string;
  workflow: string;
  render_uri: string;
  filename: string;
  seed: number | null;
  source_image_uri: string | null;
  extra_params: Record<string, string | number | boolean>;
  note?: string | null;
  provider: {
    name: 'stephen_render';
    job_id: string;
    workflow: string;
  };
  created_at: string;
}

export interface StoryboardPayloadBase {
  panel: ParsedPanelId;
  projectId: string;
  projectRoot: string;
  workflow: {
    backend: string;
  };
  prompt?: {
    text?: string;
    [key: string]: unknown;
  };
}

export async function writeStoryboardOutputSidecar(
  payload: StoryboardPayloadBase,
  output: StoryboardOutputRecord,
  context?: RenderPanelProjectContext,
): Promise<string> {
  if (PLATFORM_API_ENABLED) {
    const resolvedContext = context || await loadStoryboardProjectContext(payload);
    return appendPaceArtifactReference(payload, output, resolvedContext);
  }

  const shotRoot = legacyShotRootPath(payload);
  const stat = await fs.stat(shotRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Shot storyboard directory is missing: ${shotRoot}`);
  }

  const storyboardDir = path.join(shotRoot, 'storyboard');
  await ensureDirectory(storyboardDir);
  const sidecarPath = path.join(storyboardDir, `${payload.panel.providerPanelId}.outputs.json`);

  const existing = await readExistingSidecar(sidecarPath);
  const outputs = existing.outputs.filter((entry) => entry.task_id !== output.task_id);
  outputs.push(output);

  await atomicWriteJson(sidecarPath, {
    panel_id: payload.panel.providerPanelId,
    scene_id: payload.panel.providerSceneId,
    shot_id: payload.panel.providerShotId,
    outputs,
  } satisfies StoryboardOutputDocument);

  return sidecarPath;
}

export async function loadStoryboardProjectContext(
  payload: StoryboardPayloadBase,
): Promise<RenderPanelProjectContext> {
  const manifestPath = 'manifest.yaml';
  const shotManifestPath = paceShotManifestPath(payload);
  const panelPath = pacePanelPath(payload);

  if (PLATFORM_API_ENABLED) {
    const shotManifest = await readRequiredPaceObject(payload.projectId, shotManifestPath, 'Shot manifest file');
    const panel = await readRequiredPaceObject(payload.projectId, panelPath, 'Panel file');

    return {
      manifestPath,
      shotManifestPath,
      panelPath,
      manifest: null,
      shotManifest,
      panel,
    };
  }

  const shotRoot = legacyShotRootPath(payload);
  const stat = await fs.stat(shotRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Shot storyboard directory is missing: ${shotRoot}`);
  }

  return {
    manifestPath,
    shotManifestPath,
    panelPath,
    manifest: null,
    shotManifest: null,
    panel: null,
  };
}

async function readExistingSidecar(sidecarPath: string): Promise<StoryboardOutputDocument> {
  try {
    const existing = await readJsonFile<StoryboardOutputDocument>(sidecarPath);
    if (Array.isArray(existing.outputs)) {
      return existing;
    }
  } catch {
    // ignore missing or malformed file and rewrite from scratch
  }

  const filename = path.basename(sidecarPath, '.outputs.json');
  const matched = /^(scene_[^_]+)_(shot_[^_]+)_panel_([^_]+)$/.exec(filename);
  return {
    panel_id: filename,
    scene_id: matched?.[1] || '',
    shot_id: matched?.[2] || '',
    outputs: [],
  };
}

async function appendPaceArtifactReference(
  payload: StoryboardPayloadBase,
  output: StoryboardOutputRecord,
  context: RenderPanelProjectContext,
): Promise<string> {
  const shotManifestPath = context.shotManifestPath || paceShotManifestPath(payload);
  const artifact = buildPaceArtifactReference(payload, output);
  const response = await paiPlatformClient.writePaceFiles(payload.projectId, {
    patches: [{
      path: shotManifestPath,
      operations: [{
        op: 'ADD',
        path: '/artifacts/-',
        value: artifact,
      }],
    }],
  });
  if (!response.validation.ok) {
    throw new Error(formatPaceValidationIssues(response.validation.issues));
  }

  return shotManifestPath;
}

function buildPaceArtifactReference(
  payload: StoryboardPayloadBase,
  output: StoryboardOutputRecord,
): Record<string, unknown> {
  return {
    kind: 'v1_storyboard',
    panelId: payload.panel.panelId,
    uri: output.render_uri,
    mediaType: 'image/png',
    source: 'worker_generated',
    status: 'ready',
  };
}

function formatPaceValidationIssues(issues: Array<Record<string, unknown>>): string {
  if (!issues.length) {
    return 'PACE validation failed.';
  }

  const messages = issues
    .map((issue) => {
      const path = String(issue.path || issue.field || '').trim();
      const message = String(issue.message || issue.detail || issue.code || '').trim();
      if (path && message) {
        return `${path}: ${message}`;
      }
      return path || message;
    })
    .filter(Boolean);

  return messages.length
    ? `PACE validation failed: ${messages.join('; ')}`
    : 'PACE validation failed.';
}

async function readRequiredPaceObject(
  projectId: string,
  pacePath: string,
  label: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await paiPlatformClient.readPaceFile(projectId, pacePath);
    return cloneObject(response.value, pacePath, label);
  } catch (error: unknown) {
    if (error instanceof PaiPlatformApiError && error.statusCode === 404) {
      throw new Error(`${label} is missing: ${pacePath}`);
    }
    throw error;
  }
}

function cloneObject(value: unknown, pacePath: string, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object: ${pacePath}`);
  }
  return structuredClone(value as Record<string, unknown>);
}

function paceShotManifestPath(payload: StoryboardPayloadBase): string {
  return `scenes/${payload.panel.sceneId}/shots/${payload.panel.shotId}/manifest.json`;
}

function pacePanelPath(payload: StoryboardPayloadBase): string {
  return `scenes/${payload.panel.sceneId}/shots/${payload.panel.shotId}/panels/${payload.panel.panelId}/manifest.json`;
}

function legacyShotRootPath(payload: StoryboardPayloadBase): string {
  return path.join(payload.projectRoot, 'scenes', payload.panel.providerSceneId, 'shots', payload.panel.providerShotId);
}

function optionalString(value: unknown): string {
  return String(value || '').trim();
}
