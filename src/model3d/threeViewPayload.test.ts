import { describe, expect, it } from 'vitest';
import { hydrateThreeView3dPayload } from './threeViewPayload.js';

const ctx = { taskId: 'task_1', projectId: 'proj_1' };
const target = { entityKind: 'character', entityId: 'char_yan', depictionIndex: null };

describe('hydrateThreeView3dPayload', () => {
  it('accepts Mode A: a turnaround sheet, with no views', () => {
    const p = hydrateThreeView3dPayload(
      { turnaround: { assetUri: 'assets://x/sheet.png' }, target },
      ctx,
    );
    // No formatVersion → legacy styled sheet (sliced by entity kind), and an unknown
    // provenance is never treated as normalised.
    expect(p.turnaround).toEqual({
      assetUri: 'assets://x/sheet.png',
      formatVersion: null,
      normalized: false,
    });
    expect(p.views.front).toBeUndefined();
  });

  it('accepts a model_input_sheet: known formatVersion + normalized passthrough', () => {
    const p = hydrateThreeView3dPayload(
      {
        turnaround: { assetUri: 'assets://x/sheet.png', formatVersion: 'v1', normalized: true },
        target,
      },
      ctx,
    );
    expect(p.turnaround).toEqual({
      assetUri: 'assets://x/sheet.png',
      formatVersion: 'v1',
      normalized: true,
    });
  });

  it('parses an explicit bboxM [w,d,h] from target.bboxM verbatim', () => {
    const p = hydrateThreeView3dPayload(
      { turnaround: { assetUri: 'assets://x/sheet.png' }, target: { ...target, bboxM: [6, 6, 1] } },
      ctx,
    );
    expect(p.bboxM).toEqual([6, 6, 1]);
  });

  it('defaults bboxM to null when absent, malformed, or non-positive', () => {
    const sheet = { assetUri: 'assets://x/sheet.png' };
    for (const bboxM of [undefined, [6, 6], [6, 6, 1, 1], [6, 0, 1], [6, 'x', 1]]) {
      const p = hydrateThreeView3dPayload(
        { turnaround: sheet, target: { ...target, ...(bboxM ? { bboxM } : {}) } },
        ctx,
      );
      expect(p.bboxM).toBeNull();
    }
  });

  it('rejects an unknown formatVersion rather than guessing at the layout', () => {
    // A future 4-view v2 cut as 3 views would yield a silently wrong model — the whole
    // point of the version field is to fail loudly here.
    expect(() =>
      hydrateThreeView3dPayload(
        { turnaround: { assetUri: 'assets://x/sheet.png', formatVersion: 'v2' }, target },
        ctx,
      ),
    ).toThrow(/formatVersion v2 is not supported/);
  });

  describe('views cross-check', () => {
    const withViews = (views: unknown) => () =>
      hydrateThreeView3dPayload(
        { turnaround: { assetUri: 'assets://x/s.png', formatVersion: 'v1', views }, target },
        ctx,
      );

    it('accepts views that match what this worker means by the version', () => {
      expect(withViews(['front', 'left', 'back'])).not.toThrow();
    });

    it('catches upstream changing the layout WITHOUT bumping the version', () => {
      // The one failure `formatVersion` alone cannot catch: the version is a promise, `views`
      // is the sheet saying what it actually is. Disagreement means the sheet is not what we
      // think it is — slicing it anyway maps views onto the wrong slots and yields a
      // plausible-looking mesh built from a back view labelled "left".
      expect(withViews(['front', 'left', 'back', 'right'])).toThrow(/does not match/);
    });

    it('rejects a reordered layout — order IS the layout, not just membership', () => {
      // Same set, different left-to-right order = a different sheet. A set-only check would
      // pass this and silently slice back-as-left.
      expect(withViews(['front', 'back', 'left'])).toThrow(/does not match/);
    });

    it('names both sides so the mismatch is actionable', () => {
      expect(withViews(['front', 'back', 'left'])).toThrow(/front, back, left/);
      expect(withViews(['front', 'back', 'left'])).toThrow(/front, left, back/);
    });

    it('stays optional — an artifact without views still slices', () => {
      // Older artifacts may predate the field; absence is not evidence of a mismatch.
      expect(withViews(undefined)).not.toThrow();
      expect(withViews(null)).not.toThrow();
    });

    it('rejects a malformed views value instead of ignoring it', () => {
      expect(withViews('front,left,back')).toThrow(/must be an array of strings/);
      expect(withViews([1, 2, 3])).toThrow(/must be an array of strings/);
    });
  });

  it('treats absent/null normalized as false (unknown provenance is not a guarantee)', () => {
    for (const spec of [
      { assetUri: 'assets://x/s.png', formatVersion: 'v1' },
      { assetUri: 'assets://x/s.png', formatVersion: 'v1', normalized: null },
      { assetUri: 'assets://x/s.png', formatVersion: 'v1', normalized: 'yes' },
    ]) {
      const p = hydrateThreeView3dPayload({ turnaround: spec, target }, ctx);
      expect(p.turnaround?.normalized).toBe(false);
    }
  });

  it('accepts Mode B: pre-sliced views, with no turnaround', () => {
    const p = hydrateThreeView3dPayload(
      { views: { front: { assetUri: 'assets://x/front.png' }, back: { assetUri: 'assets://x/back.png' } }, target },
      ctx,
    );
    expect(p.turnaround).toBeNull();
    expect(p.views.front).toEqual({ assetUri: 'assets://x/front.png' });
    expect(p.views.back).toEqual({ assetUri: 'assets://x/back.png' });
  });

  it('prefers views over turnaround when both are given (sheet ignored)', () => {
    const p = hydrateThreeView3dPayload(
      {
        turnaround: { assetUri: 'assets://x/sheet.png' },
        views: { front: { assetUri: 'assets://x/front.png' } },
        target,
      },
      ctx,
    );
    expect(p.turnaround).toBeNull();
    expect(p.views.front).toEqual({ assetUri: 'assets://x/front.png' });
  });

  it('rejects when neither turnaround nor views.front is provided', () => {
    expect(() => hydrateThreeView3dPayload({ target }, ctx)).toThrow(/turnaround.*or views.front/i);
  });

  it('rejects a non-assets:// turnaround uri', () => {
    expect(() =>
      hydrateThreeView3dPayload({ turnaround: { assetUri: 'https://x/sheet.png' }, target }, ctx),
    ).toThrow(/must start with assets:\/\//);
  });
});
