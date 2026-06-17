/**
 * GLB export epilogue appended to an agent-generated Blender script before it is
 * submitted to the PAILang `script` runner.
 *
 * Why this exists: PAILang's `input_format=script` job runs the script verbatim
 * (`blender --background --python run.py`) and only checks that the file at
 * `$PAI_OUTPUT_FILE` exists afterwards — it does NOT export anything itself
 * (that auto-export only happens for the file-conversion input formats). The
 * agent is also instructed not to save/export. So the runner side must add the
 * `export_scene.gltf` call.
 *
 * The epilogue is wrapped in stable BEGIN/END markers so a local runner can
 * strip it back off and re-run the pristine agent script. The markers are a
 * cross-repo contract — the pai-blender-console mock strips by the same
 * strings. Keep them in sync.
 */

export const EXPORT_EPILOGUE_BEGIN_MARKER =
  '# === PAI_GLB_EXPORT_EPILOGUE:BEGIN (auto-appended by comfyui-worker; strip to re-run the pristine script) ===';
export const EXPORT_EPILOGUE_END_MARKER = '# === PAI_GLB_EXPORT_EPILOGUE:END ===';

/**
 * The export body. Ensures a camera + light exist (a scene with neither cannot
 * produce a usable previs export) and writes GLB to `$PAI_OUTPUT_FILE`.
 */
const EXPORT_EPILOGUE_BODY = [
  'import bpy as _pai_bpy, os as _pai_os',
  '',
  'if _pai_bpy.context.scene.camera is None:',
  '    _pai_bpy.ops.object.camera_add()',
  '    _pai_bpy.context.scene.camera = _pai_bpy.context.object',
  'if not any(_pai_obj.type == "LIGHT" for _pai_obj in _pai_bpy.data.objects):',
  '    _pai_bpy.ops.object.light_add(type="SUN")',
  '',
  '_pai_out = _pai_os.environ["PAI_OUTPUT_FILE"]',
  '_pai_bpy.ops.export_scene.gltf(filepath=_pai_out, export_format="GLB")',
  'print("PAI_GLB_EXPORT_OK", flush=True)',
].join('\n');

export function buildExportEpilogue(): string {
  return [EXPORT_EPILOGUE_BEGIN_MARKER, EXPORT_EPILOGUE_BODY, EXPORT_EPILOGUE_END_MARKER].join('\n');
}

/** Append the export epilogue to a pristine agent script. */
export function appendExportEpilogue(script: string): string {
  const base = script.endsWith('\n') ? script : `${script}\n`;
  return `${base}\n${buildExportEpilogue()}\n`;
}

/**
 * Remove a previously appended export epilogue, returning the pristine script.
 * Idempotent: a script without the marker is returned unchanged (trailing
 * whitespace trimmed to a single newline).
 */
export function stripExportEpilogue(script: string): string {
  const beginIndex = script.indexOf(EXPORT_EPILOGUE_BEGIN_MARKER);
  if (beginIndex === -1) {
    return script;
  }
  return `${script.slice(0, beginIndex).replace(/\s+$/, '')}\n`;
}
