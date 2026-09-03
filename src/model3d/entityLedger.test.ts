import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/paiPlatformClient.js', () => ({
  paiPlatformClient: {
    readPaceFile: vi.fn(),
    writePaceFiles: vi.fn(),
  },
}));

import { logger } from '../infra/logger.js';
import { paiPlatformClient } from '../platform/paiPlatformClient.js';
import { readEntityBboxM, registerEntityModel3d } from './entityLedger.js';

const mockRead = paiPlatformClient.readPaceFile as unknown as ReturnType<typeof vi.fn>;
const mockWrite = paiPlatformClient.writePaceFiles as unknown as ReturnType<typeof vi.fn>;
const MODEL_HASH = 'a'.repeat(64);

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
      contentHash: MODEL_HASH,
      physicalInputHash: 'f'.repeat(64),
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
      contentHash: MODEL_HASH,
      physicalInputHash: 'f'.repeat(64),
      source: 'worker_generated',
      selectionAuthority: 'automatic',
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
          contentHash: MODEL_HASH,
          format: 'glb',
          filename: 'new.glb',
        },
      },
    ]);
  });

  it('updates previzModel when generated model3d is the selected source', async () => {
    setup(
      { artifacts: [] },
      [
        {
          id: 'char_yan',
          previzModel: {
            source: 'model3d',
            uri: 'assets://old.glb',
            format: 'glb',
            filename: 'old.glb',
            selectedAt: '2026-08-01T00:00:00Z',
            selectionAuthority: 'human',
          },
        },
      ],
    );

    await registerEntityModel3d({
      projectId: 'proj_1',
      entityKind: 'character',
      entityId: 'char_yan',
      depictionIndex: null,
      assetUri: 'assets://entity-models/new.glb',
      contentHash: MODEL_HASH,
      now: '2026-08-29T00:00:00Z',
    });

    const [, batch] = mockWrite.mock.calls[0];
    const ledgerPatch = batch.patches.find(
      (patch: { path: string }) => patch.path === 'entities/characters.json',
    );
    expect(ledgerPatch.operations).toContainEqual({
      op: 'add',
      path: '/0/previzModel',
      value: {
        source: 'model3d',
        uri: 'assets://entity-models/new.glb',
        format: 'glb',
        filename: 'new.glb',
        selectedAt: '2026-08-29T00:00:00Z',
        selectionAuthority: 'human',
      },
    });
  });

  it('leaves a preset-selected previzModel unchanged', async () => {
    setup(
      { artifacts: [] },
      [{ id: 'char_yan', previzModel: { source: 'presetModel' } }],
    );

    await registerEntityModel3d({
      projectId: 'proj_1',
      entityKind: 'character',
      entityId: 'char_yan',
      depictionIndex: null,
      assetUri: 'assets://entity-models/new.glb',
      contentHash: MODEL_HASH,
    });

    const [, batch] = mockWrite.mock.calls[0];
    const ledgerPatch = batch.patches.find(
      (patch: { path: string }) => patch.path === 'entities/characters.json',
    );
    expect(ledgerPatch.operations.map((operation: { path: string }) => operation.path)).toEqual([
      '/0/model3d',
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
      contentHash: MODEL_HASH,
    });

    expect(result.versionId).toBe('asset_take_1');
    const [, batch] = mockWrite.mock.calls[0];
    const ops = batch.patches[0].operations;
    // artifacts array initialized before the append
    expect(ops[0]).toEqual({ op: 'add', path: '/artifacts', value: [] });
    const appendOp = ops.find((o: { path: string }) => o.path === '/artifacts/-');
    expect(appendOp.value.supersedesId).toBeNull();
  });

  it('writes a location model3d back to entities/locations.json', async () => {
    mockRead.mockImplementation(async (_project: string, path: string) => {
      if (path === 'manifest.json') return { value: { artifacts: [] } };
      if (path === 'entities/locations.json') return { value: [{ id: 'loc_alley' }] };
      throw new Error(`unexpected read: ${path}`);
    });
    mockWrite.mockResolvedValue({ validation: { ok: true, issues: [] } });

    const result = await registerEntityModel3d({
      projectId: 'proj_1',
      entityKind: 'location',
      entityId: 'loc_alley',
      depictionIndex: null,
      assetUri: 'assets://scene.glb',
      contentHash: MODEL_HASH,
    });

    expect(result.pointer).toBe('/0/model3d');
    const [, batch] = mockWrite.mock.calls[0];
    const ledgerPatch = batch.patches.find(
      (p: { path: string }) => p.path === 'entities/locations.json',
    );
    expect(ledgerPatch).toBeDefined();
    expect(ledgerPatch.operations[0].value).toMatchObject({
      status: 'ready',
      uri: 'assets://scene.glb',
      group: 'asset_model3d:loc_alley',
      contentHash: MODEL_HASH,
    });
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
        contentHash: MODEL_HASH,
      }),
    ).rejects.toThrow(/char_missing not found/);
  });

  it('refuses to replace an uploaded current model during bbox sync', async () => {
    setup(
      {
        artifacts: [{
          kind: 'asset_model3d', ref: 'char_yan', versionId: 'manual-v1',
          contentHash: 'b'.repeat(64), current: true, uri: 'assets://manual.glb',
          source: 'uploaded', selectionAuthority: 'human',
        }],
      },
      [{
        id: 'char_yan',
        model3d: { status: 'ready', uri: 'assets://manual.glb', source: 'uploaded', versionId: 'manual-v1' },
      }],
    );

    await expect(
      registerEntityModel3d({
        projectId: 'proj_1', entityKind: 'character', entityId: 'char_yan',
        depictionIndex: null, assetUri: 'assets://late-worker.glb', contentHash: MODEL_HASH,
        protectGeneratedCurrent: true,
      }),
    ).rejects.toThrow(/no longer machine-generated/);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('readEntityBboxM', () => {
  beforeEach(() => mockRead.mockReset());

  it('returns the prop bboxM [w,d,h] verbatim, reading the ledger once', async () => {
    mockRead.mockResolvedValue({
      value: [{ id: 'prop_drum', physicalAttributes: { bboxM: [0.5, 0.5, 0.6] } }],
    });
    const bbox = await readEntityBboxM({
      projectId: 'proj_1', entityKind: 'prop', entityId: 'prop_drum',
    });
    expect(bbox).toEqual([0.5, 0.5, 0.6]);
    expect(mockRead).toHaveBeenCalledWith('proj_1', 'entities/props.json');
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('reads a CHARACTER bboxM so articulated modeling can scale by height and verify width/depth', async () => {
    mockRead.mockResolvedValue({
      value: [{ id: 'char_yan', physicalAttributes: { bboxM: [0.5, 0.3, 1.8], heightM: 1.8 } }],
    });
    const bbox = await readEntityBboxM({
      projectId: 'proj_1', entityKind: 'character', entityId: 'char_yan',
    });
    expect(bbox).toEqual([0.5, 0.3, 1.8]);
    expect(mockRead).toHaveBeenCalledWith('proj_1', 'entities/characters.json');
  });

  it('returns null when the prop has no bboxM, or it is malformed / non-positive', async () => {
    mockRead.mockResolvedValue({
      value: [
        { id: 'prop_none', physicalAttributes: { heightM: 1 } },       // no bboxM
        { id: 'prop_a', physicalAttributes: { bboxM: [1, 2] } },       // wrong length
        { id: 'prop_b', physicalAttributes: { bboxM: [1, 0, 2] } },    // non-positive
        { id: 'prop_c', physicalAttributes: { bboxM: [1, 'x', 2] } },  // non-numeric
      ],
    });
    for (const id of ['prop_missing', 'prop_none', 'prop_a', 'prop_b', 'prop_c']) {
      expect(
        await readEntityBboxM({ projectId: 'proj_1', entityKind: 'prop', entityId: id }),
      ).toBeNull();
    }
  });

  it('returns null and logs when the ledger read fails (distinct from absent)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    // Inject the rejection via a PLAIN function (not the vi.fn) so vitest v4's
    // mock error tracker — which flags any throw/rejection inside a vi.fn even
    // when the caller catches it — stays out of the way; readEntityBboxM's
    // try/catch handles the rejection.
    const client = paiPlatformClient as { readPaceFile: unknown };
    const original = client.readPaceFile;
    client.readPaceFile = () => Promise.reject(new Error('boom 500'));
    try {
      const bbox = await readEntityBboxM({
        projectId: 'proj_1', entityKind: 'prop', entityId: 'prop_x',
      });
      expect(bbox).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      client.readPaceFile = original;
      warn.mockRestore();
    }
  });
});
