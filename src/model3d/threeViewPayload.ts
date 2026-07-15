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
  /**
   * Mode A input: a turnaround *sheet* (one image with several views in a row) that the
   * worker slices into per-view images. Null when the caller supplies pre-sliced `views`.
   */
  turnaround: { assetUri: string } | null;
  /**
   * Mode B input: pre-sliced per-view images. Empty when the caller supplies a `turnaround`
   * sheet instead (the worker fills this in after slicing).
   */
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
  const turnaround = normalizeTurnaround(payload.turnaround);
  const views = normalizeViews(payload.views);
  // Mode A (turnaround sheet) OR Mode B (pre-sliced views) — at least one is required.
  // When both are given, pre-sliced views win and the sheet is ignored.
  if (!turnaround && !views.front) {
    throw new ValidationError(
      'payload requires either turnaround.assetUri (a sheet to slice) or views.front (a pre-sliced view)',
    );
  }
  const target = normalizeTarget(payload.target);
  const preset = normalizePreset(payload.preset);
  const seed = optionalInteger(payload.seed, 'payload.seed', 0);
  const maxFaces = optionalInteger(payload.maxFaces, 'payload.maxFaces', 1000);

  return {
    taskId: context.taskId,
    projectId: context.projectId,
    turnaround: views.front ? null : turnaround,
    views,
    target,
    preset,
    seed,
    maxFaces,
  };
}

function normalizeTurnaround(value: unknown): { assetUri: string } | null {
  if (value === undefined || value === null) {
    return null;
  }
  const spec = requireObject(value, 'payload.turnaround');
  const assetUri = requireString(spec.assetUri, 'payload.turnaround.assetUri');
  if (!assetUri.startsWith('assets://')) {
    throw new ValidationError('payload.turnaround.assetUri must start with assets://');
  }
  return { assetUri };
}

function normalizeViews(value: unknown): NormalizedThreeView3dPayload['views'] {
  const views: NormalizedThreeView3dPayload['views'] = {};
  if (value === undefined || value === null) {
    return views; // views omitted → caller must supply a turnaround sheet
  }
  const source = requireObject(value, 'payload.views');
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
