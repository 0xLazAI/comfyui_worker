import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sliceTurnaround } from './turnaroundSlice.js';

/**
 * Build a synthetic character turnaround sheet: three dark filled rectangles on a
 * white background, deliberately NOT evenly centered (varying widths and gaps), so a
 * naive equal-thirds cut would clip figures but the whitespace projection should not.
 */
async function buildSheet(
  width: number,
  height: number,
  figures: Array<{ left: number; width: number }>,
): Promise<Buffer> {
  const overlays = figures.map((f) => ({
    input: {
      create: {
        width: f.width,
        height: Math.floor(height * 0.8),
        channels: 4 as const,
        background: { r: 20, g: 20, b: 20, alpha: 1 },
      },
    },
    left: f.left,
    top: Math.floor(height * 0.1),
  }));
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

async function dims(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe('sliceTurnaround', () => {
  it('segments a 3-view character sheet into front/left/back via whitespace projection', async () => {
    // 1536x1024 sheet, three unevenly placed figures (front wide, side narrow, back medium).
    const sheet = await buildSheet(1536, 1024, [
      { left: 40, width: 360 },
      { left: 620, width: 180 },
      { left: 1050, width: 300 },
    ]);

    const result = await sliceTurnaround(sheet, 'character');

    expect(result.segmented).toBe(true);
    expect(Object.keys(result.views).sort()).toEqual(['back', 'front', 'left']);

    // Each slice should be non-empty and narrower than the full sheet (a real cut happened).
    for (const slot of ['front', 'left', 'back'] as const) {
      const view = result.views[slot];
      expect(view).toBeInstanceOf(Buffer);
      const { width } = await dims(view!);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThan(1536);
    }

    // The narrow side figure should yield a narrower slice than the wide front figure.
    const frontW = (await dims(result.views.front!)).width;
    const sideW = (await dims(result.views.left!)).width;
    expect(sideW).toBeLessThan(frontW);
  });

  it('slices a location sheet as 3 views, same layout as a character', async () => {
    // A scene's legacy styled sheet, if it ever reaches this path, must cut into
    // front/left/back like a character (the modeling path uses formatVersion instead).
    const sheet = await buildSheet(1536, 1024, [
      { left: 40, width: 360 },
      { left: 620, width: 180 },
      { left: 1050, width: 300 },
    ]);

    const result = await sliceTurnaround(sheet, 'location');

    expect(result.segmented).toBe(true);
    expect(Object.keys(result.views).sort()).toEqual(['back', 'front', 'left']);
  });

  it('falls back to equal division when the sheet has no whitespace valleys', async () => {
    // One solid dark block spanning the whole width → no interior whitespace gaps.
    const sheet = await sharp({
      create: { width: 900, height: 600, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await sliceTurnaround(sheet, 'character');
    expect(result.segmented).toBe(false);
    expect(Object.keys(result.views).length).toBe(3);
  });
});
