import { existsSync } from 'node:fs';
import { Codex, type Input } from '@openai/codex-sdk';

import type { BlenderAgent, HydratedBlenderTaskPayload } from './types.js';

const DEFAULT_CODEX_CLI_PATH = '/Applications/Codex.app/Contents/Resources/codex';

const generatedBlenderScriptOutputSchema = {
  additionalProperties: false,
  properties: {
    notes: {
      items: { type: 'string' },
      type: 'array',
    },
    script: {
      description: 'Complete executable Blender Python script.',
      type: 'string',
    },
    summary: {
      description: 'Short human-readable summary of the script.',
      type: 'string',
    },
  },
  required: ['script', 'summary', 'notes'],
  type: 'object',
} as const;

export interface GeneratedBlenderScriptBody {
  notes: string[];
  script: string;
  summary: string;
}

export interface GeneratedBlenderScript extends GeneratedBlenderScriptBody {
  provider: BlenderAgent;
  threadId?: string | null;
}

export interface GenerateBlenderScriptContext {
  sourceImagePath?: string | null;
  workingDirectory: string;
}

type BlenderScriptGenerator = (
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
) => Promise<GeneratedBlenderScript>;

let generatorOverride: BlenderScriptGenerator | undefined;

export function setBlenderScriptGeneratorForTests(
  generator: BlenderScriptGenerator | undefined,
): void {
  generatorOverride = generator;
}

export function buildBlenderScriptPrompt(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
): string {
  const modelId = payload.modelId || 'new model';
  const referenceImagePath = context.sourceImagePath || 'not available';
  const updatePrompt = payload.prompt || 'not provided';
  const taskText =
    payload.workflow.id === 'blender-create-3d'
      ? 'Create a new previs 3D scene from the provided source image and PACE.'
      : `Update model "${modelId}" with the requested scene change.`;

  return [
    'You are generating Blender Python for a comfyui-worker Blender job.',
    'Return only JSON that conforms to the provided schema.',
    '',
    'Hard requirements:',
    '- The script must be self-contained and executable in Blender background mode.',
    '- Use Python and bpy only; do not require UI operators, paid addons, internet, or external assets.',
    '- Use globals if present: PACE, TASK_ID, MODEL_ID, SCENE_ID, SHOT_ID, OUTPUT_DIR.',
    '- Clear the scene, create visible geometry, set camera and lights, and set a 1..120 frame range.',
    '- Always create at least one mesh named with MODEL_ID.',
    '- Target Blender 5.x compatibility.',
    '- For materials, set mat.diffuse_color first; if using nodes, search for a node with type BSDF_PRINCIPLED instead of assuming a node name.',
    '- Avoid version-specific render properties unless guarded with hasattr or try/except.',
    '- Insert keyframes directly and do not inspect or edit animation_data.action.fcurves/keyframe_points; Blender 5 action slots can make that API version-specific.',
    '- For create-3d, infer a clean proxy asset from the source image and PACE.',
    '- For update-3d, express the requested modification as visible geometry, material, lighting, or keyframe changes.',
    '- For dynamic PACE events, prefer readable previs: combine real rigid-body or keyframe movement with clear visual markers.',
    '- Keep physics stable: avoid excessive velocities, clamp visuals inside camera view, and bake or keyframe transforms when possible.',
    '- Do not save files; the worker wrapper saves .blend, OBJ, preview PNG, PACE, and summary.',
    '',
    'Blender implementation guardrails from prior agent:',
    '- PACE is director intent, not raw Blender internals.',
    '- Static placement maps to location, dimensions, yaw, and material role.',
    '- Collision and chase scenes should drive main actors with keyframes; physics should handle impact results only.',
    '- Collapse scenes need trigger-frame control so fragments do not fall apart at frame 1.',
    '- Explosion scenes are most readable when radial force or kinematic impact is paired with visible wavefront rings.',
    '- A bomb shockwave needs two layers: real object motion plus visual pressure rings.',
    '- Vehicles should not be fully left to physics; path control keeps them in frame.',
    '- For rigid bodies, use stable masses, substeps, solver iterations, and bounded displacements.',
    '- Delivery should not depend on live rigid body cache. Bake or keyframe transforms when possible.',
    '- Camera readability matters as much as physical plausibility for previs.',
    '- Avoid UI-only operators, internet access, paid plugins, or unavailable addons.',
    '- Do not require PRB unless a verified installable API is provided.',
    '- If using fracture, remove the original unfractured mesh after creating shards.',
    '- Filter degenerate fragments before assigning convex hull rigid bodies.',
    '- Keep objects inside camera view; clamp over-strong explosions for reviewability.',
    '- Always create or preserve a camera and at least one light.',
    '',
    `Workflow: ${payload.workflow.id}`,
    `Task: ${taskText}`,
    `Task id: ${payload.taskId}`,
    `Scene id: ${payload.sceneId}`,
    `Shot id: ${payload.shotId}`,
    `Model id: ${modelId}`,
    `Update prompt: ${updatePrompt}`,
    `Agent provider: ${payload.agent}`,
    `Runner target: ${payload.runnerTarget}`,
    `Source image asset URI: ${payload.inputs.sourceImageAssetUri || 'not available'}`,
    `Reference image path: ${referenceImagePath}`,
    '',
    'PACE JSON:',
    JSON.stringify(payload.pace, null, 2),
  ].join('\n');
}

export function parseGeneratedBlenderScriptResponse(text: string): GeneratedBlenderScriptBody {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    : trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  return validateGeneratedBlenderScriptResponse(parsed);
}

function validateGeneratedBlenderScriptResponse(value: unknown): GeneratedBlenderScriptBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex returned invalid blender script JSON.');
  }

  const typed = value as Record<string, unknown>;
  const notes = validateNotes(typed.notes);
  const script = requireNonEmptyString(typed.script, 'script');
  const summary = requireNonEmptyString(typed.summary, 'summary');

  if (!isValidBlenderScript(script)) {
    throw new Error('Codex returned a script that does not import or use bpy.');
  }

  return { notes, script, summary };
}

function validateNotes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Codex returned invalid blender script JSON.');
  }

  return value.map((note) => requireNonEmptyString(note, 'notes'));
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Codex returned invalid ${field}.`);
  }
  return value;
}

function isValidBlenderScript(script: string): boolean {
  const normalized = stripPythonCommentsAndStrings(script);
  const hasBpyImport =
    /(?:^|\n)\s*(?:import\s+bpy\b(?:\s+as\s+[A-Za-z_]\w*)?|from\s+bpy(?:\.[A-Za-z_]\w*)*\s+import\b)/m.test(
      normalized,
    );
  const hasBpyAccess = /\bbpy\.[A-Za-z_]\w*/.test(normalized);

  return hasBpyImport && hasBpyAccess;
}

function stripPythonCommentsAndStrings(script: string): string {
  let output = '';
  let index = 0;

  while (index < script.length) {
    const char = script[index];
    const next3 = script.slice(index, index + 3);

    if (next3 === "'''" || next3 === '"""') {
      const endIndex = findTripleQuotedStringEnd(script, index + 3, next3);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    if (char === '\'' || char === '"') {
      const endIndex = findQuotedStringEnd(script, index + 1, char);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    if (char === '#') {
      const endIndex = findCommentEnd(script, index + 1);
      output += maskScriptSegment(script.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function findTripleQuotedStringEnd(script: string, startIndex: number, quote: string): number {
  let index = startIndex;

  while (index < script.length) {
    if (script[index] === '\\') {
      index += 2;
      continue;
    }

    if (script.slice(index, index + 3) === quote) {
      return index + 3;
    }

    index += 1;
  }

  return script.length;
}

function findQuotedStringEnd(script: string, startIndex: number, quote: string): number {
  let index = startIndex;

  while (index < script.length) {
    const char = script[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }

  return script.length;
}

function findCommentEnd(script: string, startIndex: number): number {
  const newlineIndex = script.indexOf('\n', startIndex);
  return newlineIndex === -1 ? script.length : newlineIndex;
}

function maskScriptSegment(segment: string): string {
  return segment.replace(/[^\n]/g, ' ');
}

async function generateWithCodex(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
): Promise<GeneratedBlenderScript> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
  const codexPathOverride = process.env.CODEX_CLI_PATH || DEFAULT_CODEX_CLI_PATH;
  const codex = new Codex({
    ...(apiKey ? { apiKey } : {}),
    ...(existsSync(codexPathOverride) ? { codexPathOverride } : {}),
  });
  const thread = codex.startThread({
    approvalPolicy: 'never',
    model: process.env.OPENAI_CODEX_MODEL || undefined,
    modelReasoningEffort: 'low',
    networkAccessEnabled: false,
    sandboxMode: 'workspace-write',
    skipGitRepoCheck: true,
    webSearchMode: 'disabled',
    workingDirectory: context.workingDirectory,
  });

  const prompt = buildBlenderScriptPrompt(payload, context);
  const input: Input = context.sourceImagePath
    ? [
        { text: prompt, type: 'text' },
        { path: context.sourceImagePath, type: 'local_image' },
      ]
    : prompt;
  const turn = await thread.run(input, {
    outputSchema: generatedBlenderScriptOutputSchema,
  });
  const generated = parseGeneratedBlenderScriptResponse(turn.finalResponse);

  return {
    ...generated,
    provider: 'codex',
    threadId: thread.id,
  };
}

async function generateWithClaude(): Promise<GeneratedBlenderScript> {
  throw new Error(
    'Claude agent provider is not configured yet. Use agent=codex until a Claude adapter is implemented.',
  );
}

export async function generateBlenderScript(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
): Promise<GeneratedBlenderScript> {
  if (generatorOverride) {
    return generatorOverride(payload, context);
  }

  if (payload.agent === 'codex') {
    return generateWithCodex(payload, context);
  }

  return generateWithClaude();
}
