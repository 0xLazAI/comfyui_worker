import { expect, test } from 'vitest';

import {
  EXPORT_EPILOGUE_BEGIN_MARKER,
  EXPORT_EPILOGUE_END_MARKER,
  appendExportEpilogue,
  stripExportEpilogue,
} from './exportEpilogue.js';

const AGENT_SCRIPT = 'import bpy\nbpy.ops.mesh.primitive_cube_add()\n';

test('appendExportEpilogue adds a marked GLB export block', () => {
  const withEpilogue = appendExportEpilogue(AGENT_SCRIPT);

  expect(withEpilogue.startsWith(AGENT_SCRIPT)).toBe(true);
  expect(withEpilogue).toContain(EXPORT_EPILOGUE_BEGIN_MARKER);
  expect(withEpilogue).toContain(EXPORT_EPILOGUE_END_MARKER);
  expect(withEpilogue).toContain('export_scene.gltf');
  expect(withEpilogue).toContain('PAI_OUTPUT_FILE');
});

test('stripExportEpilogue restores the pristine script', () => {
  const withEpilogue = appendExportEpilogue(AGENT_SCRIPT);
  const stripped = stripExportEpilogue(withEpilogue);

  expect(stripped).toBe(`${AGENT_SCRIPT.replace(/\s+$/, '')}\n`);
  expect(stripped).not.toContain(EXPORT_EPILOGUE_BEGIN_MARKER);
  expect(stripped).not.toContain('export_scene.gltf');
});

test('stripExportEpilogue is a no-op when no epilogue is present', () => {
  expect(stripExportEpilogue(AGENT_SCRIPT)).toBe(AGENT_SCRIPT);
});
