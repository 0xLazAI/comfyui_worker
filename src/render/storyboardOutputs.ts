import fs from 'fs/promises';
import path from 'path';
import { atomicWriteJson, ensureDirectory, readJsonFile } from '../infra/filesystem.js';
import type { NormalizedRenderPanelPayload } from './payload.js';

interface StoryboardOutputDocument {
  panel_id: string;
  scene_id: string;
  shot_id: string;
  outputs: StoryboardOutputRecord[];
}

export interface StoryboardOutputRecord {
  task_id: string;
  task_type: 'render_panel';
  workflow: string;
  render_uri: string;
  filename: string;
  seed: number | null;
  source_image_uri: string | null;
  extra_params: Record<string, string | number | boolean>;
  provider: {
    name: 'stephen_render';
    job_id: string;
    workflow: string;
  };
  created_at: string;
}

export async function writeStoryboardOutputSidecar(
  payload: NormalizedRenderPanelPayload,
  output: StoryboardOutputRecord,
): Promise<string> {
  const shotRoot = path.join(payload.projectRoot, 'scenes', payload.panel.sceneId, 'shots', payload.panel.shotId);
  const stat = await fs.stat(shotRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Shot storyboard directory is missing: ${shotRoot}`);
  }

  const storyboardDir = path.join(shotRoot, 'storyboard');
  await ensureDirectory(storyboardDir);
  const sidecarPath = path.join(storyboardDir, `${payload.panel.panelId}.outputs.json`);

  const existing = await readExistingSidecar(sidecarPath);
  const outputs = existing.outputs.filter((entry) => entry.task_id !== output.task_id);
  outputs.push(output);

  await atomicWriteJson(sidecarPath, {
    panel_id: payload.panel.panelId,
    scene_id: payload.panel.sceneId,
    shot_id: payload.panel.shotId,
    outputs,
  } satisfies StoryboardOutputDocument);

  return sidecarPath;
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
