import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sliceModelInputSheet } from './turnaroundSlice.js';
import { MODEL_SHEET_BACKGROUND, resolveModelSheetLayout } from './modelSheetFormat.js';

/**
 * Build a synthetic `model_input_sheet`: gray blocks on the spec's #E6E6E6 background
 * (NOT white — the modeling path must never assume white). `figures` gives each view's
 * content box, so a test can model a tall subject (heights dominate) or a wide one.
 */
async function buildModelSheet(
  width: number,
  height: number,
  figures: Array<{ left: number; width: number; height: number }>,
): Promise<Buffer> {
  const overlays = figures.map((f) => ({
    // #B8B8B8 = the spec's flat gray mass; reads as ink against the #E6E6E6 background.
    input: {
      create: {
        width: f.width,
        height: f.height,
        channels: 4 as const,
        background: { r: 184, g: 184, b: 184, alpha: 1 },
      },
    },
    left: f.left,
    top: Math.floor((height - f.height) / 2),
  }));
  return sharp({ create: { width, height, channels: 4, background: MODEL_SHEET_BACKGROUND } })
    .composite(overlays)
    .png()
    .toBuffer();
}

async function dims(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe('model_input_sheet format contract', () => {
  it('v1 is three views regardless of entity kind (prop is NOT two)', () => {
    expect(resolveModelSheetLayout('v1')).toEqual({ count: 3, slots: ['front', 'left', 'back'] });
  });

  it('rejects an unknown formatVersion instead of falling back to v1', () => {
    expect(() => resolveModelSheetLayout('v2')).toThrow(/unsupported .* formatVersion: v2/);
  });
});

describe('sliceModelInputSheet', () => {
  it('slices a v1 sheet into three views for a PROP (the old by-kind table said two)', async () => {
    // 1536x1024 sheet, three views in exact 512-wide thirds — what storyboard-tool emits.
    const sheet = await buildModelSheet(1536, 1024, [
      { left: 160, width: 200, height: 800 },
      { left: 672, width: 200, height: 800 },
      { left: 1184, width: 200, height: 800 },
    ]);
    const { views } = await sliceModelInputSheet(sheet, { formatVersion: 'v1', normalized: true });
    expect(Object.keys(views).sort()).toEqual(['back', 'front', 'left']);
  });

  it('gives all three views ONE identical size for a WIDE subject — the case that warped', async () => {
    // The regression this guards: ComfyUI runs ImageResize+ {518,518,method:"pad"} per view,
    // scaling by 518 / that view's own longest side. With per-view trimming and no shared
    // canvas, a wide front (400x180) and a narrow side (200x180) get different factors
    // (518/400=1.30 vs 518/200=2.59) and the side view is blown up ~2x → warped mesh.
    const sheet = await buildModelSheet(1536, 1024, [
      { left: 56, width: 400, height: 180 },
      { left: 668, width: 200, height: 180 },
      { left: 1080, width: 400, height: 180 },
    ]);
    const { views } = await sliceModelInputSheet(sheet, { formatVersion: 'v1', normalized: true });

    const sizes = await Promise.all(
      (['front', 'left', 'back'] as const).map((s) => dims(views[s]!)),
    );
    const [first] = sizes;
    for (const size of sizes) {
      expect(size).toEqual(first); // identical dims → one shared downstream scale factor
      expect(size.width).toBe(size.height); // square → the 518 pad is a no-op
    }

    // Canvas side == the widest view's trimmed width (400), NOT the raw 512x1024 cell.
    // Without this the "identical + square" assertions above pass vacuously when trim
    // no-ops: every view stays a 512x1024 cell and pads to a uniform 1024x1024.
    expect(first.width).toBe(400);
  });

  it('preserves relative scale: a narrower view stays narrower inside the shared canvas', async () => {
    // Padding must not "normalise away" the real width difference — only the canvas is
    // shared; the subject keeps its own size within it.
    const sheet = await buildModelSheet(1536, 1024, [
      { left: 56, width: 400, height: 600 },
      { left: 668, width: 200, height: 600 },
      { left: 1080, width: 400, height: 600 },
    ]);
    const { views } = await sliceModelInputSheet(sheet, { formatVersion: 'v1', normalized: true });

    const inkWidth = async (buf: Buffer): Promise<number> => {
      const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
      let min = info.width;
      let max = -1;
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (data[y * info.width + x] <= 205) {
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
      }
      return max < 0 ? 0 : max - min + 1;
    };
    const front = await inkWidth(views.front!);
    const left = await inkWidth(views.left!);
    expect(left).toBeLessThan(front * 0.75); // ~200 vs ~400, scale relationship intact
  });

  it('pads with the spec background (#E6E6E6), never white or transparent', async () => {
    const sheet = await buildModelSheet(1536, 1024, [
      { left: 56, width: 400, height: 180 },
      { left: 668, width: 200, height: 180 },
      { left: 1080, width: 400, height: 180 },
    ]);
    const { views } = await sliceModelInputSheet(sheet, { formatVersion: 'v1', normalized: true });
    // Top-left corner is pad area for the wide/short subject → must be #E6E6E6 (230).
    const { data } = await sharp(views.front!).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([230, 230, 230]);
  });

  it('normalized:false still yields three usable views (measured, not equal-cut)', async () => {
    // Upstream's normalisation fell back → views are NOT in exact thirds. Equal-cutting
    // would slice through them; the projection path must find them anyway.
    const sheet = await buildModelSheet(1536, 1024, [
      { left: 40, width: 300, height: 700 },
      { left: 500, width: 300, height: 700 },
      { left: 900, width: 300, height: 700 },
    ]);
    const { views } = await sliceModelInputSheet(sheet, { formatVersion: 'v1', normalized: false });
    expect(Object.keys(views).sort()).toEqual(['back', 'front', 'left']);
    const sizes = await Promise.all(
      (['front', 'left', 'back'] as const).map((s) => dims(views[s]!)),
    );
    for (const size of sizes) {
      expect(size).toEqual(sizes[0]); // shared canvas applies on this path too
    }
  });

  it('throws on an unknown formatVersion before touching the image', async () => {
    const sheet = await buildModelSheet(1536, 1024, [{ left: 600, width: 300, height: 700 }]);
    await expect(
      sliceModelInputSheet(sheet, { formatVersion: 'v99', normalized: true }),
    ).rejects.toThrow(/unsupported .* formatVersion: v99/);
  });
});
