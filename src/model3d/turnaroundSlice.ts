import sharp from 'sharp';
import type { EntityKind, ViewSlot } from './threeViewPayload.js';
import {
  resolveModelSheetProfile,
  type ModelSheetProfile,
  type SheetLayout,
  type SliceResult,
} from './modelSheetFormat.js';

/**
 * Slice a turnaround reference *sheet* (one combined image with several views laid
 * out side by side in a single row) into individual per-view PNG buffers.
 *
 * storyboard-tool's `complete_entity_assets` generates the sheet with gpt-image-2
 * and does NOT draw explicit separator lines at known pixel coordinates (unlike the
 * 3x3 storyboard grid), so a naive equal-N cut misaligns whenever the figures are not
 * evenly centered. We therefore segment by a vertical whitespace projection profile:
 * a column is "content" if it has enough dark ink over a plain white background, and
 * the widest interior whitespace valleys are the cut points. Equal division is only a
 * fallback (e.g. dark chiaroscuro styles where the projection is uninformative).
 *
 * Layout per entity kind (from storyboard-tool 92e7de9):
 *   character 1536x1024 — one row of three views: front / side / back  → front/left/back
 *   prop      1024x1024 — one row of two views (not modeled; kept for completeness)
 */

/** Row layout of a sheet — defined in `modelSheetFormat.ts`, re-exported for existing importers. */
export type { SheetLayout };

/**
 * **Legacy styled-turnaround layout, keyed by entity kind.**
 *
 * Only for the old `asset_turnaround` path (project style sheets / manual uploads). The
 * modeling-input path keys its layout off `formatVersion` instead — see
 * `MODEL_SHEET_PROFILES`. Keep the two tables physically separate: keying
 * a modeling sheet by kind is what silently sliced 3-view prop sheets into 2.
 */
export const SHEET_LAYOUT: Record<EntityKind, SheetLayout> = {
  character: { count: 3, slots: ['front', 'left', 'back'] },
  // prop is not modeled on the legacy styled path (only characters got 3D there).
  prop: { count: 2, slots: ['front', 'left'] },
};

export interface SliceOptions {
  /** Luminance (0-255) at or below which a pixel counts as ink. Default 205. */
  inkThreshold?: number;
  /** Min fraction of a column that must be ink for the column to count as content. Default 0.02. */
  contentColumnRatio?: number;
  /** Horizontal padding (px) kept around each segment before whitespace trim. Default 8. */
  segmentPadding?: number;
  /** Sheet background colour, trimmed off each view. Default '#ffffff' (legacy styled sheets). */
  background?: string;
  /**
   * Skip whitespace projection and cut at exact equal divisions. Set when upstream already
   * guarantees the views sit in exact 1/N cells (`model_input_sheet` with `normalized:true`)
   * — measuring is strictly worse than knowing.
   */
  equalCut?: boolean;
}

/** Defined in `modelSheetFormat.ts` (a profile's `slice` returns it); re-exported for
 *  existing importers of this module. */
export type { SliceResult };

const DEFAULTS: Required<SliceOptions> = {
  // 205 separates ink from background on BOTH sheet flavours: white (255) and the modeling
  // sheet's #E6E6E6 (230) both read as background, while its gray mass #B8B8B8 (184) and
  // line art (#1F1F1F/#4A4A4A) read as ink.
  inkThreshold: 205,
  contentColumnRatio: 0.02,
  segmentPadding: 8,
  background: '#ffffff',
  equalCut: false,
};

/**
 * Slice a **legacy styled** turnaround sheet into per-view PNG buffers, keyed by entity kind.
 * Returns a map keyed by PAILang view slot (front/left/back...). Always yields exactly
 * `layout.count` views; throws only on unreadable input.
 *
 * For storyboard-tool `model_input_sheet` artifacts use `sliceModelInputSheet` instead —
 * that path keys its layout off `formatVersion` and normalises view sizes.
 */
export async function sliceTurnaround(
  sheet: Buffer,
  entityKind: EntityKind,
  options: SliceOptions = {},
): Promise<SliceResult> {
  const layout = SHEET_LAYOUT[entityKind];
  if (!layout) {
    throw new Error(`no turnaround layout for entity kind: ${entityKind}`);
  }
  return await sliceSheetWithLayout(sheet, layout, { ...DEFAULTS, ...options });
}

/** Shared slicing core: segment the row into `layout.count` ranges, extract and trim each. */
async function sliceSheetWithLayout(
  sheet: Buffer,
  layout: SheetLayout,
  opts: Required<SliceOptions>,
): Promise<SliceResult> {
  const image = sharp(sheet, { failOn: 'none' });
  const { data, info } = await image
    .clone()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width <= 0 || height <= 0) {
    throw new Error(`turnaround sheet has invalid dimensions ${width}x${height}`);
  }

  // equalCut: upstream already placed each view in an exact 1/N cell → cut there and skip the
  // projection guess entirely. Otherwise measure, and fall back to equal division.
  const boundaries = opts.equalCut
    ? null
    : computeSegmentBoundaries(data, width, height, channels, layout.count, opts);
  const segmented = opts.equalCut || boundaries !== null;
  const ranges = boundaries ?? equalRanges(width, layout.count);

  const views: Partial<Record<ViewSlot, Buffer>> = {};
  for (let i = 0; i < layout.count; i += 1) {
    const slot = layout.slots[i];
    const { left, widthPx } = ranges[i];
    // Extract and whitespace-trim in SEPARATE pipelines: sharp cannot reliably chain
    // extract → trim in one pipeline (operation order is ambiguous and throws
    // "bad extract area"). Round-trip through a PNG buffer between the two steps.
    const extracted = await sharp(sheet, { failOn: 'none' })
      .extract({ left, top: 0, width: widthPx, height })
      .png()
      .toBuffer();
    views[slot] = await trimBackground(extracted, opts.background, opts.inkThreshold);
  }

  return { views, segmented };
}

/** Luminance of a `#RRGGBB` background. Both sheet flavours are greyscale, so the channels
 *  agree; averaging keeps it honest for anything slightly off-gray. */
function luminanceOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return 255; // unknown format → assume white, matching the legacy default
  }
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 0xff) / 3 + ((n >> 8) & 0xff) / 3 + (n & 0xff) / 3;
}

/**
 * Trim background margins off a single view.
 *
 * The threshold is how far a pixel may sit from `background` and still count as background,
 * so it must be measured FROM THAT BACKGROUND — not from white. The old `255 - inkThreshold`
 * hard-coded a white sheet: on the modeling sheet's #E6E6E6 (230) it yields 50, which exceeds
 * the distance to the flat gray mass #B8B8B8 (|230-184| = 46) — the subject itself reads as
 * background and trim silently no-ops, leaving the full cell. Deriving it from the actual
 * background gives 230-205 = 25 here and the unchanged 255-205 = 50 for legacy white sheets.
 *
 * Falls back to the untrimmed buffer if the view is entirely background (sharp's trim throws
 * rather than returning empty).
 */
async function trimBackground(view: Buffer, background: string, inkThreshold: number): Promise<Buffer> {
  const threshold = Math.max(1, Math.round(luminanceOf(background) - inkThreshold));
  try {
    return await sharp(view, { failOn: 'none' })
      .trim({ background, threshold })
      .png()
      .toBuffer();
  } catch {
    return view;
  }
}

/**
 * Pad every view onto ONE shared square canvas so all views end up the same pixel size.
 *
 * Why this is load-bearing: downstream ComfyUI runs `ImageResize+ {518, 518, method:"pad"}`
 * per view, whose scale factor is `518 / that view's own longest side`. Trimming each view
 * to its own content bbox therefore gives each view a DIFFERENT scale factor, silently
 * destroying the inter-view scale relationship the sheet was generated to preserve
 * ("SAME scale, height and camera distance"). It only looks fine for tall subjects, where
 * height dominates all three views and the factors coincide; a wide subject (front 900x400
 * → x0.576, side 500x400 → x1.036) blows the side view up ~2x and the reconstruction warps.
 *
 * One shared square side (max over every view's width and height) → identical input sizes →
 * one identical scale factor → relative scale preserved. Square because 518x518 is the
 * target shape, so the downstream pad is a no-op and the subject fills the frame.
 *
 * Not solvable by "just don't trim": a 512x1024 cell holds a T-pose figure only ~512x512
 * (arm span ≈ height, capped by the cell width), so padding the raw cell to 518 would leave
 * the subject at ~259x259 — a quarter of the canvas.
 */
async function padViewsToCommonCanvas(
  views: Partial<Record<ViewSlot, Buffer>>,
  background: string,
): Promise<Partial<Record<ViewSlot, Buffer>>> {
  const entries = Object.entries(views) as Array<[ViewSlot, Buffer]>;
  const measured = await Promise.all(
    entries.map(async ([slot, buffer]) => {
      const { width = 0, height = 0 } = await sharp(buffer).metadata();
      return { slot, buffer, width, height };
    }),
  );
  const side = Math.max(...measured.flatMap((m) => [m.width, m.height]));
  if (!Number.isFinite(side) || side <= 0) {
    return views; // unreadable metadata → leave as-is rather than destroy the output
  }

  const padded: Partial<Record<ViewSlot, Buffer>> = {};
  for (const m of measured) {
    padded[m.slot] = await sharp({
      create: { width: side, height: side, channels: 3, background },
    })
      .composite([
        {
          input: m.buffer,
          left: Math.max(0, Math.round((side - m.width) / 2)),
          top: Math.max(0, Math.round((side - m.height) / 2)),
        },
      ])
      .png()
      .toBuffer();
  }
  return padded;
}

/**
 * The shared single-row slicer — the default strategy for any format that is "N views in one
 * row". A profile only needs its own `slice` when the layout is structurally different.
 */
async function sliceSingleRowSheet(
  sheet: Buffer,
  profile: ModelSheetProfile,
  normalized: boolean,
): Promise<SliceResult> {
  const { views, segmented } = await sliceSheetWithLayout(sheet, profile.layout, {
    ...DEFAULTS,
    background: profile.background,
    inkThreshold: profile.inkThreshold,
    equalCut: normalized,
  });
  return { views: await padViewsToCommonCanvas(views, profile.background), segmented };
}

/**
 * Slice a storyboard-tool `model_input_sheet` into per-view PNGs sized for Hunyuan3D-mv.
 *
 * Everything version-dependent comes from the format's profile (`MODEL_SHEET_PROFILES`), not
 * from constants here: layout, background, ink threshold, and — for a structurally different
 * format — the slicing strategy itself. An unknown version throws rather than being guessed
 * at. Old versions keep working forever because their profile is never edited; see
 * `modelSheetFormat.ts`.
 *
 * `normalized` reports whether upstream's equal-N normalisation actually succeeded:
 *   - true  → cut at exact equal divisions (upstream guarantees it; don't re-guess)
 *   - false → upstream fell back to the raw image, so measure with whitespace projection
 */
export async function sliceModelInputSheet(
  sheet: Buffer,
  input: { formatVersion: string; normalized: boolean },
): Promise<SliceResult> {
  const profile = resolveModelSheetProfile(input.formatVersion);
  const slice = profile.slice ?? sliceSingleRowSheet;
  return await slice(sheet, profile, input.normalized);
}

interface Range {
  left: number;
  widthPx: number;
}

/** Even left-to-right division of [0,width) into `count` ranges (fallback). */
function equalRanges(width: number, count: number): Range[] {
  const step = Math.floor(width / count);
  const ranges: Range[] = [];
  for (let i = 0; i < count; i += 1) {
    const left = i * step;
    const widthPx = i === count - 1 ? width - left : step;
    ranges.push({ left, widthPx });
  }
  return ranges;
}

/**
 * Segment the sheet into `count` horizontal ranges by whitespace projection.
 * Returns null (→ caller falls back to equal division) when the profile does not
 * yield `count - 1` clear interior whitespace valleys.
 */
function computeSegmentBoundaries(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  count: number,
  opts: Required<SliceOptions>,
): Range[] | null {
  // Per-column ink ratio: fraction of rows whose pixel is at/under the ink threshold.
  const ink = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      const lum = data[(y * width + x) * channels];
      if (lum <= opts.inkThreshold) {
        dark += 1;
      }
    }
    ink[x] = dark / height;
  }

  const isContent = (x: number): boolean => ink[x] >= opts.contentColumnRatio;

  // Trim outer whitespace to the content span.
  let contentStart = 0;
  while (contentStart < width && !isContent(contentStart)) contentStart += 1;
  let contentEnd = width - 1;
  while (contentEnd > contentStart && !isContent(contentEnd)) contentEnd -= 1;
  if (contentEnd - contentStart < count) {
    return null; // effectively no content (e.g. blank or all-dark) → fallback
  }

  // Find interior whitespace gaps (maximal runs of non-content columns) within the span.
  const gaps: Array<{ start: number; end: number; size: number }> = [];
  let runStart = -1;
  for (let x = contentStart + 1; x < contentEnd; x += 1) {
    if (!isContent(x)) {
      if (runStart < 0) runStart = x;
    } else if (runStart >= 0) {
      gaps.push({ start: runStart, end: x - 1, size: x - runStart });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    gaps.push({ start: runStart, end: contentEnd - 1, size: contentEnd - runStart });
  }

  if (gaps.length < count - 1) {
    return null; // not enough separating valleys → fallback to equal division
  }

  // The `count - 1` widest gaps are the separators; cut at each gap's midpoint.
  const separators = gaps
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, count - 1)
    .map((gap) => Math.floor((gap.start + gap.end) / 2))
    .sort((a, b) => a - b);

  // Build ranges: [contentStart, sep0], (sep0, sep1], ..., (sepLast, contentEnd].
  const cuts = [contentStart, ...separators, contentEnd + 1];
  const ranges: Range[] = [];
  for (let i = 0; i < count; i += 1) {
    const rawLeft = i === 0 ? cuts[i] : cuts[i] + 1;
    const left = Math.max(0, rawLeft - opts.segmentPadding);
    const rawRight = cuts[i + 1];
    const right = Math.min(width, rawRight + opts.segmentPadding);
    ranges.push({ left, widthPx: Math.max(1, right - left) });
  }
  return ranges;
}
