import { expect, test } from 'vitest';

import {
  IMPORT_PREAMBLE_BEGIN_MARKER,
  IMPORT_PREAMBLE_END_MARKER,
  buildGlbImportPreamble,
  prependGlbImportPreamble,
} from './glbImportPreamble.js';

test('buildGlbImportPreamble wraps the base64 payload in markers and imports the GLB', () => {
  const preamble = buildGlbImportPreamble('QUJD');
  expect(preamble.startsWith(IMPORT_PREAMBLE_BEGIN_MARKER)).toBe(true);
  expect(preamble.endsWith(IMPORT_PREAMBLE_END_MARKER)).toBe(true);
  expect(preamble).toContain('_PAI_BASE_GLB_B64 = "QUJD"');
  expect(preamble).toContain('import_scene.gltf');
});

test('prependGlbImportPreamble places the preamble before the fix script', () => {
  const combined = prependGlbImportPreamble('bpy.data.objects["hero"].location.x = 1.0', 'QUJD');
  const preambleIndex = combined.indexOf(IMPORT_PREAMBLE_BEGIN_MARKER);
  const fixIndex = combined.indexOf('bpy.data.objects["hero"]');
  expect(preambleIndex).toBeGreaterThanOrEqual(0);
  expect(fixIndex).toBeGreaterThan(preambleIndex);
});
