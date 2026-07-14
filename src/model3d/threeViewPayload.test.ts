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
    expect(p.turnaround).toEqual({ assetUri: 'assets://x/sheet.png' });
    expect(p.views.front).toBeUndefined();
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
