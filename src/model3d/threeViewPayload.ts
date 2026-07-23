import { ValidationError } from '../infra/HttpError.js';
import {
  MODEL_SHEET_PROFILES,
  knownModelSheetFormatVersions,
} from './modelSheetFormat.js';

export const THREE_VIEW_3D_TASK_TYPE = 'hunyuan3d_three_view';
export const THREE_VIEW_3D_CONSUMER_KEY = 'hunyuan3d_three_view_consumer';

export type ModelingPreset = 'fast' | 'standard';
export type EntityKind = 'prop' | 'character' | 'location';

const VIEW_SLOTS = ['front', 'left', 'right', 'back'] as const;
export type ViewSlot = (typeof VIEW_SLOTS)[number];

/** Mode A input: a sheet the worker slices. `formatVersion` distinguishes the two flavours. */
export interface TurnaroundInput {
  assetUri: string;
  /**
   * storyboard-tool `model_input_sheet` format version (`v1` = one row of front/left/back,
   * every entity kind). Null = a legacy styled turnaround sheet, sliced by entity kind.
   * An unknown version is rejected at hydration, never guessed at.
   */
  formatVersion: string | null;
  /**
   * Whether upstream's equal-thirds normalisation succeeded. True → the views sit in exact
   * 1/N cells and we cut there. False (incl. absent) → upstream fell back to the raw image,
   * so the sheet must be measured, not equal-cut.
   */
  normalized: boolean;
}

export interface NormalizedThreeView3dPayload {
  taskId: string;
  projectId: string;
  /**
   * Mode A input: a turnaround *sheet* (one image with several views in a row) that the
   * worker slices into per-view images. Null when the caller supplies pre-sliced `views`.
   */
  turnaround: TurnaroundInput | null;
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
  /**
   * The prop's real `physicalAttributes.bboxM` = `[width, depth, height]` meters (PACE
   * std-2b axis order), passed EXPLICITLY by the caller (on the wire under `target.bboxM`)
   * so the studio can bake true metric scale into the GLB. Null when the caller omits it —
   * the task execution then falls back to reading the entity ledger, and if that too is
   * absent the GLB stays normalized. Forwarded verbatim (no axis remap): its correctness is
   * the caller's responsibility.
   */
  bboxM: [number, number, number] | null;
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
  // bboxM rides under `target` (the task definition allows arbitrary `target.*`
  // via its object umbrella; a bare top-level array field can't be declared).
  const targetObj = (payload.target ?? {}) as Record<string, unknown>;
  const bboxM = normalizeBboxM(targetObj.bboxM);
  const preset = normalizePreset(payload.preset);
  const seed = optionalInteger(payload.seed, 'payload.seed', 0);
  const maxFaces = optionalInteger(payload.maxFaces, 'payload.maxFaces', 1000);

  return {
    taskId: context.taskId,
    projectId: context.projectId,
    turnaround: views.front ? null : turnaround,
    views,
    target,
    bboxM,
    preset,
    seed,
    maxFaces,
  };
}

/** Parse an optional `bboxM` = `[width, depth, height]` meters. Absent/malformed/
 *  non-positive → null (metric bake is opt-in; a bad value silently degrades to a
 *  normalized GLB rather than failing the job). Never remapped — forwarded as given. */
function normalizeBboxM(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const dims = value.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : NaN));
  if (!dims.every((n) => n > 0)) return null;
  return [dims[0], dims[1], dims[2]] as [number, number, number];
}

function normalizeTurnaround(value: unknown): TurnaroundInput | null {
  if (value === undefined || value === null) {
    return null;
  }
  const spec = requireObject(value, 'payload.turnaround');
  const assetUri = requireString(spec.assetUri, 'payload.turnaround.assetUri');
  if (!assetUri.startsWith('assets://')) {
    throw new ValidationError('payload.turnaround.assetUri must start with assets://');
  }

  // No formatVersion → a legacy styled turnaround sheet (project style / manual upload),
  // sliced by entity kind. Present → a storyboard-tool model_input_sheet, sliced by format.
  if (spec.formatVersion === undefined || spec.formatVersion === null) {
    return { assetUri, formatVersion: null, normalized: false };
  }
  const formatVersion = requireString(spec.formatVersion, 'payload.turnaround.formatVersion');
  if (!(formatVersion in MODEL_SHEET_PROFILES)) {
    // Reject rather than guess: a future 4-view sheet cut as 3 views yields a silently wrong
    // model. Failing loudly is the whole point of the version field.
    throw new ValidationError(
      `payload.turnaround.formatVersion ${formatVersion} is not supported by this worker ` +
        `(known: ${knownModelSheetFormatVersions().join(', ')})`,
    );
  }
  assertViewsMatchProfile(spec.views, formatVersion);
  // Upstream sets normalized:false when its equal-thirds normalisation fell back to the raw
  // image. Absent/null counts as false — an unknown provenance is not a guarantee.
  return { assetUri, formatVersion, normalized: spec.normalized === true };
}

/**
 * Cross-check the artifact's own `views` against what this worker believes `formatVersion`
 * means. Optional — absent skips the check (an older artifact may not carry it).
 *
 * This catches the one failure `formatVersion` alone cannot: upstream changing the sheet's
 * layout **without bumping the version**. The version is a promise; `views` is the sheet
 * saying what it actually is. When they disagree, the sheet is not what we think it is, and
 * slicing it by our profile would map views onto the wrong slots — a plausible-looking mesh
 * built from a back view labelled "left". Rejecting turns a silent corruption into a task
 * failure that names the discipline slip.
 *
 * Order matters as much as membership: `views` is the left-to-right layout, so
 * front/back/left is a different sheet from front/left/back even though the sets match.
 */
function assertViewsMatchProfile(value: unknown, formatVersion: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ValidationError('payload.turnaround.views must be an array of strings');
  }
  const expected = MODEL_SHEET_PROFILES[formatVersion]!.layout.slots;
  const matches = value.length === expected.length && value.every((v, i) => v === expected[i]);
  if (!matches) {
    throw new ValidationError(
      `payload.turnaround.views [${value.join(', ')}] does not match what this worker means by ` +
        `formatVersion ${formatVersion} ([${expected.join(', ')}]). The sheet's layout and its ` +
        `version disagree — upstream changed the layout without bumping the version, or the ` +
        `wrong version was passed. Refusing to slice rather than map views onto wrong slots.`,
    );
  }
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
  if (entityKind !== 'prop' && entityKind !== 'character' && entityKind !== 'location') {
    throw new ValidationError('payload.target.entityKind must be one of: prop, character, location');
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
