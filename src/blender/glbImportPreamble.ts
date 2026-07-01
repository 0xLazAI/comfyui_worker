/**
 * GLB import preamble for the blender-pace-review fix script.
 *
 * The PAILang `script` runner has no mechanism to stage an input file for a
 * script job, so the base GLB bytes are embedded as base64 directly in the
 * submitted script. This preamble decodes them to a temp file and imports the
 * GLB into the scene BEFORE the agent's fix script runs — so the fix script
 * edits the already-imported objects, and the export epilogue re-exports the
 * corrected scene.
 *
 * Kept separate from exportEpilogue.ts: this is prepended (import), the epilogue
 * is appended (export). The two bracket the agent's fix script at submit time.
 */

export const IMPORT_PREAMBLE_BEGIN_MARKER =
  '# === PAI_GLB_IMPORT_PREAMBLE:BEGIN (auto-prepended by comfyui-worker; base GLB import for pace-review) ===';
export const IMPORT_PREAMBLE_END_MARKER = '# === PAI_GLB_IMPORT_PREAMBLE:END ===';

/**
 * Builds a preamble that decodes `base64Glb` to a temp .glb and imports it.
 * Clears the default startup scene first so only the base GLB is present.
 */
export function buildGlbImportPreamble(base64Glb: string): string {
  return [
    IMPORT_PREAMBLE_BEGIN_MARKER,
    'import bpy as _pai_bpy, base64 as _pai_b64, os as _pai_os, tempfile as _pai_tempfile',
    '',
    '# Start from an empty scene so only the base GLB contributes geometry.',
    'try:',
    '    _pai_bpy.ops.object.select_all(action="SELECT")',
    '    _pai_bpy.ops.object.delete(use_global=False)',
    'except Exception:',
    '    pass',
    '',
    `_PAI_BASE_GLB_B64 = "${base64Glb}"`,
    '_pai_glb_path = _pai_os.path.join(_pai_tempfile.gettempdir(), "pai_pace_review_base.glb")',
    'with open(_pai_glb_path, "wb") as _pai_fh:',
    '    _pai_fh.write(_pai_b64.b64decode(_PAI_BASE_GLB_B64))',
    '_pai_bpy.ops.import_scene.gltf(filepath=_pai_glb_path)',
    'print("PAI_GLB_IMPORT_OK", flush=True)',
    IMPORT_PREAMBLE_END_MARKER,
  ].join('\n');
}

/** Prepend the import preamble to a fix script. */
export function prependGlbImportPreamble(script: string, base64Glb: string): string {
  return `${buildGlbImportPreamble(base64Glb)}\n\n${script}`;
}
