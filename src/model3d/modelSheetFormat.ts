/**
 * The `model_input_sheet` format contract with storyboard-tool.
 *
 * storyboard-tool's `complete_entity_assets` writes a `model_input_sheet` artifact carrying
 * `formatVersion` / `views` / `normalized` (see its `docs/design/model-input-sheet.md`).
 * `formatVersion` is bumped ONLY on breaking format changes — 3-view → 4-view, a different
 * row layout, a different cut rule. Non-breaking prompt tuning does not bump it.
 *
 * This module is the single source of truth for what this worker can consume. It is kept
 * separate from `turnaroundSlice.ts` (which slices) and `threeViewPayload.ts` (which
 * validates) because both need it, and importing between those two would form a cycle.
 */
import type { ViewSlot } from './threeViewPayload.js';

/** Row layout of a sheet: how many views and which PAILang slot each maps to. */
export interface SheetLayout {
  /** Number of views laid out left-to-right in the sheet. */
  count: number;
  /** PAILang view slot for each segment, in left-to-right order. */
  slots: ViewSlot[];
}

/**
 * Modeling-input sheet layout **keyed by `formatVersion`**.
 *
 * Layout is a property of the *sheet format*, NOT of the entity kind: v1 is one row of three
 * views for character / prop / location alike. Keying this by entity kind is precisely the
 * bug that sliced 3-view prop sheets into 2.
 *
 * Adding v2 (e.g. four views incl. `right`) = add an entry here; unknown versions are
 * rejected until then.
 */
export const MODEL_SHEET_LAYOUT_BY_FORMAT_VERSION: Record<string, SheetLayout> = {
  v1: { count: 3, slots: ['front', 'left', 'back'] },
};

/**
 * Background of a modeling-input sheet. storyboard-tool writes #E6E6E6 and the Hunyuan3D /
 * 3DGS input spec forbids pure white and transparency — so nothing on this path may assume
 * a white background (the legacy styled path does, and stays separate for that reason).
 */
export const MODEL_SHEET_BACKGROUND = '#E6E6E6';

/** Known `formatVersion` values, for error messages. */
export function knownModelSheetFormatVersions(): string[] {
  return Object.keys(MODEL_SHEET_LAYOUT_BY_FORMAT_VERSION);
}

/**
 * Layout for a modeling sheet `formatVersion`. Throws on an unknown version rather than
 * falling back to v1: a future 4-view sheet cut as 3 views yields a silently wrong model,
 * which is worse than a failed task.
 */
export function resolveModelSheetLayout(formatVersion: string): SheetLayout {
  const layout = MODEL_SHEET_LAYOUT_BY_FORMAT_VERSION[formatVersion];
  if (!layout) {
    throw new Error(
      `unsupported model_input_sheet formatVersion: ${formatVersion} ` +
        `(known: ${knownModelSheetFormatVersions().join(', ')})`,
    );
  }
  return layout;
}
