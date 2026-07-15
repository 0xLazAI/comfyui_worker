import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/paiPlatformClient.js', () => ({
  paiPlatformClient: {
    readPaceFile: vi.fn(),
    writePaceFiles: vi.fn(),
  },
}));

import { paiPlatformClient } from '../platform/paiPlatformClient.js';
import { registerEntityModel3d } from './entityLedger.js';

const mockRead = paiPlatformClient.readPaceFile as unknown as ReturnType<typeof vi.fn>;
const mockWrite = paiPlatformClient.writePaceFiles as unknown as ReturnType<typeof vi.fn>;

function setup(manifest: unknown, entities: unknown) {
  mockRead.mockImplementation(async (_project: string, path: string) => {
    if (path === 'manifest.json') return { value: manifest };
    if (path === 'entities/characters.json') return { value: entities };
    throw new Error(`unexpected read: ${path}`);
  });
  mockWrite.mockResolvedValue({ validation: { ok: true, issues: [] } });
}

describe('registerEntityModel3d', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockWrite.mockReset();
  });

  it('appends an asset_model3d take (current), unsets the prior current, and mirrors the slot atomically', async () => {
    setup(
      { artifacts: [{ kind: 'asset_model3d', ref: 'char_yan', versionId: 'asset_take_1', current: true, uri: 'assets://old.glb' }] },
      [{ id: 'char_a' }, { id: 'char_yan' }],
    );

    const result = await registerEntityModel3d({
      projectId: 'proj_1',
      entityKind: 'character',
      entityId: 'char_yan',
      depictionIndex: null,
      assetUri: 'assets://new.glb',
      jobId: 'job_abcdef123',
    });

    expect(result.versionId).toBe('asset_take_2_job_ab');
    expect(result.pointer).toBe('/1/model3d');

    // One atomic writePaceFiles call carrying BOTH the manifest patch and the ledger patch.
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [, batch] = mockWrite.mock.calls[0];
    expect(batch.patches).toHaveLength(2);

    const manifestPatch = batch.patches.find((p: { path: string }) => p.path === 'manifest.json');
    const ops = manifestPatch.operations;
    // prior current take (index 0) unset
    expect(ops).toContainEqual({ op: 'add', path: '/artifacts/0/current', value: false });
    // new take appended
    const appendOp = ops.find((o: { path: string }) => o.path === '/artifacts/-');
    expect(appendOp.value).toMatchObject({
      kind: 'asset_model3d',
      ref: 'char_yan',
      uri: 'assets://new.glb',
      current: true,
      supersedesId: 'asset_take_1',
      versionId: 'asset_take_2_job_ab',
      source: 'worker_generated',
      status: 'ready',
      mediaType: 'model/gltf-binary',
    });

    // slot mirror on the ledger, using `add` and the same versionId
    const ledgerPatch = batch.patches.find((p: { path: string }) => p.path === 'entities/characters.json');
    expect(ledgerPatch.operations).toEqual([
      {
        op: 'add',
        path: '/1/model3d',
        value: {
          status: 'ready',
          uri: 'assets://new.glb',
          source: 'generated',
          group: 'asset_model3d:char_yan',
          versionId: 'asset_take_2_job_ab',
        },
      },
    ]);
  });

  it('starts lineage at take_1 with null supersedesId and initializes a missing artifacts array', async () => {
    setup({}, [{ id: 'char_yan' }]);

    const result = await registerEntityModel3d({
      projectId: 'proj_1',
      entityKind: 'character',
      entityId: 'char_yan',
      depictionIndex: null,
      assetUri: 'assets://first.glb',
    });

    expect(result.versionId).toBe('asset_take_1');
    const [, batch] = mockWrite.mock.calls[0];
    const ops = batch.patches[0].operations;
    // artifacts array initialized before the append
    expect(ops[0]).toEqual({ op: 'add', path: '/artifacts', value: [] });
    const appendOp = ops.find((o: { path: string }) => o.path === '/artifacts/-');
    expect(appendOp.value.supersedesId).toBeNull();
  });

  it('throws when the target entity is absent from the ledger', async () => {
    setup({ artifacts: [] }, [{ id: 'char_other' }]);
    await expect(
      registerEntityModel3d({
        projectId: 'proj_1',
        entityKind: 'character',
        entityId: 'char_missing',
        depictionIndex: null,
        assetUri: 'assets://x.glb',
      }),
    ).rejects.toThrow(/char_missing not found/);
  });
});
