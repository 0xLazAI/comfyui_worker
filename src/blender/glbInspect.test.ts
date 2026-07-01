import { expect, test } from 'vitest';

import { focalLengthFromYfov, inspectGlb, parseGlbJson } from './glbInspect.js';

const JSON_CHUNK_TYPE = 0x4e4f534a;

/** Builds a minimal valid GLB buffer wrapping a glTF JSON document. */
function buildGlb(gltf: Record<string, unknown>): Buffer {
  const jsonText = JSON.stringify(gltf);
  const padded = jsonText + ' '.repeat((4 - (jsonText.length % 4)) % 4);
  const jsonBytes = Buffer.from(padded, 'utf8');

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(12 + 8 + jsonBytes.byteLength, 8); // total length

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonBytes.byteLength, 0);
  chunkHeader.writeUInt32LE(JSON_CHUNK_TYPE, 4);

  return Buffer.concat([header, chunkHeader, jsonBytes]);
}

test('parseGlbJson extracts the glTF document', () => {
  const glb = buildGlb({ asset: { version: '2.0' }, nodes: [] });
  expect(parseGlbJson(glb)).toMatchObject({ asset: { version: '2.0' } });
});

test('parseGlbJson rejects a non-GLB buffer', () => {
  expect(() => parseGlbJson(Buffer.from('not a glb at all'))).toThrow(/magic/);
});

test('inspectGlb reports nodes, cameras, and animations', () => {
  const glb = buildGlb({
    asset: { version: '2.0' },
    nodes: [
      { name: 'hero', translation: [1, 2, 0], mesh: 0 },
      { name: 'cam_main', camera: 0, translation: [0, -4, 1.6] },
    ],
    meshes: [{ name: 'hero_mesh' }],
    cameras: [{ name: 'cam_main', type: 'perspective', perspective: { yfov: 0.6911, aspectRatio: 1.777 } }],
    animations: [
      { name: 'push_in', channels: [{ target: { node: 1, path: 'translation' } }] },
    ],
  });

  const inventory = inspectGlb(glb);
  expect(inventory.nodeCount).toBe(2);
  expect(inventory.cameraCount).toBe(1);
  expect(inventory.animationCount).toBe(1);
  expect(inventory.nodes[0]).toMatchObject({ name: 'hero', translation: [1, 2, 0], hasMesh: true, isCamera: false });
  expect(inventory.nodes[1]).toMatchObject({ name: 'cam_main', isCamera: true });
  expect(inventory.cameras[0].focalLengthMm).toBeGreaterThan(20);
  expect(inventory.animations[0].targetPaths).toEqual(['translation']);
});

test('focalLengthFromYfov maps ~50mm-equivalent yfov', () => {
  // yfov for a 50mm lens on a 36mm sensor ≈ 2*atan(18/50) ≈ 0.6911 rad.
  expect(focalLengthFromYfov(0.6911)).toBeCloseTo(50, 0);
});
