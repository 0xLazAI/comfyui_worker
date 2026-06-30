import { afterEach, describe, expect, test, vi } from 'vitest';

const readPaceFile = vi.fn();
const writePaceFiles = vi.fn();

vi.mock('../platform/paiPlatformClient.js', () => ({
  paiPlatformClient: {
    readPaceFile: (...args: unknown[]) => readPaceFile(...args),
    writePaceFiles: (...args: unknown[]) => writePaceFiles(...args),
  },
}));

import { fetchShotReviewInput, writeShotGlbCheckedArtifact } from './scenePaceFetch.js';

afterEach(() => {
  readPaceFile.mockReset();
  writePaceFiles.mockReset();
});

describe('fetchShotReviewInput', () => {
  test('assembles the shot PACE document and resolves the shot_glb artifact uri', async () => {
    readPaceFile.mockImplementation(async (_projectId: string, path: string) => {
      if (path === 'scenes/s001/manifest.json') {
        return { path, value: { sceneId: 's001', physicalLayout: { subjects: [{ ref: 'hero@v1' }] } } };
      }
      if (path === 'scenes/s001/shots/hs001_sh001/manifest.json') {
        return {
          path,
          value: {
            shotId: 'hs001_sh001',
            pace: { camera: { trajectory: { static: true } } },
            artifacts: [
              { kind: 'v1_storyboard', uri: 'assets://renders/x.png' },
              { kind: '3d_storyboard', uri: 'assets://blender/base.glb' },
            ],
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const { paceDocument, glbAssetUri } = await fetchShotReviewInput('proj_1', 's001', 'hs001_sh001');

    expect(glbAssetUri).toBe('assets://blender/base.glb');
    expect(paceDocument.scenes).toHaveLength(1);
    const scene = paceDocument.scenes[0] as any;
    expect(scene.sceneId).toBe('s001');
    expect(scene.physicalLayout.subjects[0].ref).toBe('hero@v1');
    expect(scene.shots).toHaveLength(1);
    expect(scene.shots[0].shotId).toBe('hs001_sh001');
  });

  test('prefers the most recently appended shot_glb artifact', async () => {
    readPaceFile.mockImplementation(async (_projectId: string, path: string) => {
      if (path.endsWith('/manifest.json') && path.includes('/shots/')) {
        return {
          path,
          value: {
            artifacts: [
              { kind: '3d_storyboard', uri: 'assets://blender/old.glb' },
              { kind: '3d_storyboard', uri: 'assets://blender/new.glb' },
            ],
          },
        };
      }
      return { path, value: { sceneId: 's001' } };
    });

    const { glbAssetUri } = await fetchShotReviewInput('proj_1', 's001', 'hs001_sh001');
    expect(glbAssetUri).toBe('assets://blender/new.glb');
  });

  test('rejects when the shot has no 3d_storyboard artifact', async () => {
    readPaceFile.mockImplementation(async (_projectId: string, path: string) => {
      if (path.includes('/shots/')) {
        return { path, value: { artifacts: [{ kind: 'v1_storyboard', uri: 'assets://renders/x.png' }] } };
      }
      return { path, value: { sceneId: 's001' } };
    });

    await expect(fetchShotReviewInput('proj_1', 's001', 'hs001_sh001')).rejects.toThrow(/3d_storyboard/);
  });
});

describe('writeShotGlbCheckedArtifact', () => {
  test('appends a glb_checked artifact to the shot manifest via a JSON-Patch add', async () => {
    writePaceFiles.mockResolvedValue({ changed: [], validation: { ok: true, issues: [] } });

    await writeShotGlbCheckedArtifact({
      projectId: 'proj_1',
      sceneId: 's001',
      shotId: 'hs001_sh001',
      assetUri: 'assets://blender/op.glb',
    });

    expect(writePaceFiles).toHaveBeenCalledTimes(1);
    const [projectId, input] = writePaceFiles.mock.calls[0] as [string, any];
    expect(projectId).toBe('proj_1');
    const patch = input.patches[0];
    expect(patch.path).toBe('scenes/s001/shots/hs001_sh001/manifest.json');
    const op = patch.operations[0];
    expect(op.op).toBe('add');
    expect(op.path).toBe('/artifacts/-');
    expect(op.value).toMatchObject({
      kind: '3d_storyboard_op',
      uri: 'assets://blender/op.glb',
      source: 'worker_generated',
      status: 'ready',
      mediaType: 'model/gltf-binary',
    });
  });
});
