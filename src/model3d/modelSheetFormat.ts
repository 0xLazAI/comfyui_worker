/**
 * The `model_input_sheet` format contract with storyboard-tool — one **profile per
 * `formatVersion`**.
 *
 * storyboard-tool's `complete_entity_assets` writes a `model_input_sheet` artifact carrying
 * `formatVersion` / `views` / `normalized` (see its `docs/design/model-input-sheet.md`).
 * `formatVersion` is bumped ONLY on breaking format changes — 3-view → 4-view, a different
 * row layout, a different background, a different cut rule. Non-breaking prompt tuning does
 * not bump it.
 *
 * ## Why a profile, and why versions coexist forever
 *
 * Versions are NOT a migration. Upstream's skip-existing check is version-agnostic (it asks
 * "does this entity have a current model_input_sheet?", not "which version?"), so once an
 * entity owns a v1 sheet it keeps it — a v2 bump does not regenerate it. Old sheets are
 * immutable artifact takes that stay in the project and still have to be modelled. So v1 and
 * v2 will be in flight **at the same time, in the same project**, indefinitely.
 *
 * That makes the registry below append-only in the strongest sense:
 *
 *   **Adding a version = adding one entry. NEVER edit an existing entry.**
 *
 * Editing v1's profile silently changes how every already-generated v1 sheet gets sliced —
 * a wrong mesh, from an artifact nobody touched. `modelSheetFormat.test.ts` freezes v1 for
 * exactly this reason; if you are here to add v2 and that test goes red, you edited the
 * wrong line.
 *
 * ## What belongs in a profile
 *
 * Everything the slicer needs that could differ between formats. The first bug this path hit
 * in production was a *parameter* one, not a structural one: the trim threshold assumed a
 * white sheet, so pointing it at v1's #E6E6E6 made trim silently no-op. Parameters travel
 * with the format, not with the code.
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

/** Per-view PNG buffers plus whether segmentation measured the sheet or fell back. */
export interface SliceResult {
  /** Per-slot PNG buffers, in the order given by the layout. */
  views: Partial<Record<ViewSlot, Buffer>>;
  /** True when segmentation used the whitespace projection or a guaranteed equal cut. */
  segmented: boolean;
}

/**
 * Everything about one sheet format that slicing depends on.
 *
 * Note what is deliberately NOT here: the sheet's pixel size. The slicer reads the real
 * image dimensions and cuts by fraction, so a version that only changes 1536x1024 →
 * something else needs no entry at all — and would not warrant a bump.
 */
export interface ModelSheetProfile {
  /** How many views and which slot each maps to, left to right. */
  layout: SheetLayout;
  /**
   * Sheet background — the colour trim measures against. v1 is #E6E6E6: the Hunyuan3D /
   * 3DGS input spec forbids pure white and transparency, so nothing on this path may assume
   * white (the legacy styled path does, which is why it stays separate).
   */
  background: string;
  /**
   * Luminance at or below which a pixel counts as ink. Pairs with `background` — the two
   * are one decision, not two: trim's tolerance is derived from their distance, so tuning
   * either alone is what makes trim silently swallow the subject.
   */
  inkThreshold: number;
  /**
   * Escape hatch for a version whose layout is structurally different (a 2x2 grid, say),
   * not merely differently parameterised. Omitted = the shared single-row slicer, which
   * cuts into `layout.count` equal columns (or measures them when `normalized` is false).
   *
   * A structural v2 supplies its own function here and v1 keeps running the shared path
   * untouched — that is the whole point of putting the strategy in the profile rather than
   * branching on the version inside the slicer.
   */
  slice?: (sheet: Buffer, profile: ModelSheetProfile, normalized: boolean) => Promise<SliceResult>;
}

/**
 * **Append-only.** Add a version = add an entry. Never edit one that is already here — see
 * the module header.
 */
export const MODEL_SHEET_PROFILES: Record<string, ModelSheetProfile> = {
  v1: {
    layout: { count: 3, slots: ['front', 'left', 'back'] },
    background: '#E6E6E6',
    // 205 separates ink from v1's #E6E6E6 (230) background while keeping its flat gray
    // mass #B8B8B8 (184) and line art (#1F1F1F/#4A4A4A) as content.
    inkThreshold: 205,
  },
};

/** Known `formatVersion` values, for error messages. */
export function knownModelSheetFormatVersions(): string[] {
  return Object.keys(MODEL_SHEET_PROFILES);
}

/**
 * Profile for a `formatVersion`. Throws on an unknown version rather than falling back to
 * the newest (or to v1): a format this worker has never seen, sliced by guesswork, yields a
 * silently wrong mesh. A failed task is strictly better — and being able to fail here is the
 * entire reason the field exists.
 */
export function resolveModelSheetProfile(formatVersion: string): ModelSheetProfile {
  const profile = MODEL_SHEET_PROFILES[formatVersion];
  if (!profile) {
    throw new Error(
      `unsupported model_input_sheet formatVersion: ${formatVersion} ` +
        `(known: ${knownModelSheetFormatVersions().join(', ')})`,
    );
  }
  return profile;
}
