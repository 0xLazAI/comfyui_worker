/**
 * The `model_input_sheet` version registry — the rules that make old sheets keep working.
 *
 * Encodes the WHY: versions are not a migration. Upstream's skip-existing check is
 * version-agnostic, so an entity that already owns a v1 sheet never gets a v2 one — old
 * takes are immutable, stay in the project, and still have to be modelled. v1 and v2 will be
 * live at the same time, in the same project, indefinitely.
 *
 * Which makes ONE rule load-bearing: **adding a version must never change an existing one.**
 * A注释 can't enforce that; these tests can.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MODEL_SHEET_PROFILES,
  knownModelSheetFormatVersions,
  resolveModelSheetProfile,
} from './modelSheetFormat.js';
import { sliceModelInputSheet } from './turnaroundSlice.js';

describe('MODEL_SHEET_PROFILES registry', () => {
  it('v1 is FROZEN — every already-generated v1 sheet must slice identically forever', () => {
    // If you are adding v2 and this went red: you edited v1 instead of appending. Every v1
    // artifact in every project is immutable and still gets sliced by this profile; changing
    // it silently re-slices them into a different (wrong) mesh, from files nobody touched.
    expect(MODEL_SHEET_PROFILES.v1).toEqual({
      layout: { count: 3, slots: ['front', 'left', 'back'] },
      background: '#E6E6E6',
      inkThreshold: 205,
    });
  });

  it('rejects an unknown version instead of falling back to the newest or to v1', () => {
    // Guessing at an unseen format yields a silently wrong mesh; a failed task is strictly
    // better, and being able to fail here is the entire reason the field exists.
    expect(() => resolveModelSheetProfile('v2')).toThrow(/unsupported .* formatVersion: v2/);
    expect(() => resolveModelSheetProfile('')).toThrow(/unsupported/);
    expect(() => resolveModelSheetProfile('V1')).toThrow(/unsupported/); // exact match only
  });

  it('names the versions it does know, so a rejection is actionable', () => {
    expect(knownModelSheetFormatVersions()).toContain('v1');
    expect(() => resolveModelSheetProfile('v9')).toThrow(/known: .*v1/);
  });

  it('every profile pairs its background with a workable ink threshold', () => {
    // background and inkThreshold are ONE decision: trim's tolerance is their distance.
    // Setting them independently is what made trim silently swallow the whole subject
    // (`255 - inkThreshold` assumed white; on #E6E6E6 it classified the gray mass as
    // background). A profile whose ink threshold sits at/above its own background can never
    // find content at all.
    for (const [version, profile] of Object.entries(MODEL_SHEET_PROFILES)) {
      const bgLuma = parseInt(profile.background.slice(1, 3), 16);
      expect(profile.inkThreshold, `${version}: ink threshold must sit below its background`)
        .toBeLessThan(bgLuma);
      expect(profile.layout.slots).toHaveLength(profile.layout.count);
      expect(new Set(profile.layout.slots).size, `${version}: slots must be distinct`)
        .toBe(profile.layout.count);
    }
  });
});

describe('profile-driven slicing', () => {
  /** A v1 sheet: three gray blocks on v1's own background, in exact thirds. */
  async function v1Sheet(): Promise<Buffer> {
    const block = { width: 200, height: 600, channels: 4 as const, background: '#B8B8B8' };
    return sharp({
      create: { width: 1536, height: 1024, channels: 4, background: '#E6E6E6' },
    })
      .composite([156, 668, 1180].map((left) => ({ input: { create: block }, left, top: 212 })))
      .png()
      .toBuffer();
  }

  it('drives layout/background/threshold off the profile, not module constants', async () => {
    const { views } = await sliceModelInputSheet(await v1Sheet(), {
      formatVersion: 'v1',
      normalized: true,
    });
    expect(Object.keys(views).sort()).toEqual(['back', 'front', 'left']);
    // The shared canvas is a square of the largest trimmed dimension: blocks trim to
    // 200x600 → 600x600. Trim can only have run if its threshold came from v1's #E6E6E6
    // rather than white; had it no-op'd, each view would still be the raw 512x1024 cell
    // and pad to 1024x1024. So this single number proves the profile drove the threshold.
    const meta = await sharp(views.front!).metadata();
    expect({ w: meta.width, h: meta.height }).toEqual({ w: 600, h: 600 });
  });

  it('a structurally different version can bring its own slicer, leaving v1 untouched', async () => {
    // The headroom this design exists for: a v2 laid out as a grid (not a row) supplies its
    // own `slice` and never touches the shared path v1 runs on. Proven with a temporary
    // registration so the real registry stays append-only.
    const sentinel = Buffer.from('grid-sliced');
    MODEL_SHEET_PROFILES.vTest = {
      layout: { count: 1, slots: ['front'] },
      background: '#000000',
      inkThreshold: 1,
      slice: async () => ({ views: { front: sentinel }, segmented: true }),
    };
    try {
      const { views } = await sliceModelInputSheet(await v1Sheet(), {
        formatVersion: 'vTest',
        normalized: true,
      });
      expect(views.front).toBe(sentinel); // its own strategy ran, not the row slicer

      // ...and v1 still slices through the shared path, unaffected.
      const v1 = await sliceModelInputSheet(await v1Sheet(), {
        formatVersion: 'v1',
        normalized: true,
      });
      expect(Object.keys(v1.views).sort()).toEqual(['back', 'front', 'left']);
    } finally {
      delete MODEL_SHEET_PROFILES.vTest;
    }
  });
});
