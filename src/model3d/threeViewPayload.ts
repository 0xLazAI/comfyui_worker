import { ValidationError } from '../infra/HttpError.js';

export const THREE_VIEW_3D_TASK_TYPE = 'hunyuan3d_three_view';
export const THREE_VIEW_3D_CONSUMER_KEY = 'hunyuan3d_three_view_consumer';

export type ModelingPreset = 'fast' | 'standard';
export type EntityKind = 'prop' | 'character';

const VIEW_SLOTS = ['front', 'left', 'right', 'back'] as const;
export type ViewSlot = (typeof VIEW_SLOTS)[number];

export interface NormalizedThreeView3dPayload {
  taskId: string;
  projectId: string;
  views: Partial<Record<ViewSlot, { assetUri: string }>>;
  target: {
    entityKind: EntityKind;
    entityId: string;
    depictionIndex: number | null;
  };
  preset: ModelingPreset;
  seed: number | null;
  maxFaces: number | null;
}

export function hydrateThreeView3dPayload(
  payload: Record<string, unknown>,
  context: {
    taskId: string;
    projectId: string;
  },
): NormalizedThreeView3dPayload {
  const views = normalizeViews(payload.views);
  const target = normalizeTarget(payload.target);
  const preset = normalizePreset(payload.preset);
  const seed = optionalInteger(payload.seed, 'payload.seed', 0);
  const maxFaces = optionalInteger(payload.maxFaces, 'payload.maxFaces', 1000);

  return {
    taskId: context.taskId,
    projectId: context.projectId,
    views,
    target,
    preset,
    seed,
    maxFaces,
  };
}

function normalizeViews(value: unknown): NormalizedThreeView3dPayload['views'] {
  const source = requireObject(value, 'payload.views');
  const views: NormalizedThreeView3dPayload['views'] = {};
  for (const slot of VIEW_SLOTS) {
    const spec = source[slot];
    if (spec === undefined || spec === null) {
      continue;
    }
    const view = requireObject(spec, `payload.views.${slot}`);
    const assetUri = requireString(view.assetUri, `payload.views.${slot}.assetUri`);
    if (!assetUri.startsWith('assets://')) {
      throw new ValidationError(`payload.views.${slot}.assetUri must start with assets://`);
    }
    views[slot] = { assetUri };
  }
  if (!views.front) {
    throw new ValidationError('payload.views.front is required');
  }
  return views;
}

function normalizeTarget(value: unknown): NormalizedThreeView3dPayload['target'] {
  const target = requireObject(value, 'payload.target');
  const entityKind = requireString(target.entityKind, 'payload.target.entityKind');
  if (entityKind !== 'prop' && entityKind !== 'character') {
    throw new ValidationError('payload.target.entityKind must be one of: prop, character');
  }
  const entityId = requireString(target.entityId, 'payload.target.entityId');
  return {
    entityKind,
    entityId,
    depictionIndex: optionalInteger(target.depictionIndex, 'payload.target.depictionIndex', 0),
  };
}

function normalizePreset(value: unknown): ModelingPreset {
  const preset = optionalString(value) || 'standard';
  if (preset !== 'fast' && preset !== 'standard') {
    throw new ValidationError('payload.preset must be one of: fast, standard');
  }
  return preset;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalInteger(value: unknown, field: string, minimum: number): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new ValidationError(`${field} must be an integer >= ${minimum}`);
  }
  return Math.floor(normalized);
}
