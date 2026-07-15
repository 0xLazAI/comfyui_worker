import sharp from 'sharp';
import type { EntityKind, ViewSlot } from './threeViewPayload.js';

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

/** Row layout of a turnaround sheet: how many views and which PAILang slot each maps to. */
export interface SheetLayout {
  /** Number of views laid out left-to-right in the sheet. */
  count: number;
  /** PAILang view slot for each segment, in left-to-right order. */
  slots: ViewSlot[];
}

/** front / side profile / back  →  PAILang front / left / back (side maps to left). */
export const SHEET_LAYOUT: Record<EntityKind, SheetLayout> = {
  character: { count: 3, slots: ['front', 'left', 'back'] },
  // prop is not modeled (only characters get 3D); defined so the table stays exhaustive.
  prop: { count: 2, slots: ['front', 'left'] },
};

export interface SliceOptions {
  /** Luminance (0-255) at or below which a pixel counts as ink. Default 205. */
  inkThreshold?: number;
  /** Min fraction of a column that must be ink for the column to count as content. Default 0.02. */
  contentColumnRatio?: number;
  /** Horizontal padding (px) kept around each segment before whitespace trim. Default 8. */
  segmentPadding?: number;
}

export interface SliceResult {
  /** Per-slot PNG buffers, in the order given by the layout. */
  views: Partial<Record<ViewSlot, Buffer>>;
  /** True when segmentation used the whitespace projection; false when it fell back to equal division. */
  segmented: boolean;
}

const DEFAULTS: Required<SliceOptions> = {
  inkThreshold: 205,
  contentColumnRatio: 0.02,
  segmentPadding: 8,
};

/**
 * Slice a turnaround sheet buffer into per-view PNG buffers for the given entity kind.
 * Returns a map keyed by PAILang view slot (front/left/back...). Always yields exactly
 * `layout.count` views; throws only on unreadable input.
 */
export async function sliceTurnaround(
  sheet: Buffer,
  entityKind: EntityKind,
  options: SliceOptions = {},
): Promise<SliceResult> {
  const opts = { ...DEFAULTS, ...options };
  const layout = SHEET_LAYOUT[entityKind];
  if (!layout) {
    throw new Error(`no turnaround layout for entity kind: ${entityKind}`);
  }

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

  const boundaries = computeSegmentBoundaries(data, width, height, channels, layout.count, opts);
  const segmented = boundaries !== null;
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
    views[slot] = await trimWhitespace(extracted, opts.inkThreshold);
  }

  return { views, segmented };
}

/** Trim white margins off a single view. Falls back to the untrimmed buffer if the
 *  view is entirely background (sharp's trim throws rather than returning empty). */
async function trimWhitespace(view: Buffer, inkThreshold: number): Promise<Buffer> {
  try {
    return await sharp(view, { failOn: 'none' })
      .trim({ background: '#ffffff', threshold: 255 - inkThreshold })
      .png()
      .toBuffer();
  } catch {
    return view;
  }
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
