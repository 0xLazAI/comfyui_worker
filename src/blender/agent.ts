import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Codex,
  type Input,
  type ModelReasoningEffort,
  type RunResult,
  type Thread,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';

import { logger } from '../infra/logger.js';
import type { BlenderAgent, HydratedBlenderTaskPayload } from './types.js';

const DEFAULT_CODEX_CLI_PATH = '/Applications/Codex.app/Contents/Resources/codex';
const DEFAULT_AGENT_INSTRUCTIONS_PATHS = ['agent.md', 'Agent.md', 'AGENT.md'] as const;
const DEFAULT_CODEX_REASONING_EFFORT: ModelReasoningEffort = 'medium';
// A single codex turn must finish well inside the queue job timeout. If it overruns we abort it,
// which makes node SIGTERM the spawned `codex exec` child instead of leaking it as an orphan that
// keeps holding the shared Codex app-server and starves every later turn.
const DEFAULT_CODEX_TURN_TIMEOUT_MS = 15 * 60 * 1000;
const SUPPORTED_CODEX_REASONING_EFFORTS = new Set<ModelReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const referenceImageAnalysisOutputSchema = {
  additionalProperties: false,
  properties: {
    blockingNotes: {
      description:
        'Scene-specific actionable blocking for this exact reference image: pose anchors with approximate positions, camera corridor and occluders, focus-object placement, depth/scale cues.',
      items: { type: 'string' },
      type: 'array',
    },
    cameraBrief: {
      description: 'Concise camera and composition description from the source image.',
      type: 'string',
    },
    environment: {
      items: { type: 'string' },
      type: 'array',
    },
    generationPrompt: {
      description: 'Concise prompt-ready scene description for Blender generation.',
      type: 'string',
    },
    primarySubjects: {
      items: { type: 'string' },
      type: 'array',
    },
    sceneBrief: {
      description: 'Concise description of the reference image scene.',
      type: 'string',
    },
  },
  required: [
    'sceneBrief',
    'cameraBrief',
    'primarySubjects',
    'environment',
    'blockingNotes',
    'generationPrompt',
  ],
  type: 'object',
} as const;

const generatedBlenderScriptOutputSchema = {
  additionalProperties: false,
  properties: {
    notes: {
      items: { type: 'string' },
      type: 'array',
    },
    referenceAnalysis: {
      ...referenceImageAnalysisOutputSchema,
      description: 'Structured reference-image scene analysis used to generate the Blender script.',
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
  required: ['script', 'summary', 'notes', 'referenceAnalysis'],
  type: 'object',
} as const;

const previewReviewOutputSchema = {
  additionalProperties: false,
  properties: {
    approved: {
      description: 'True when the rendered preview matches the reference, PACE, and quality rules.',
      type: 'boolean',
    },
    issues: {
      description: 'Concrete mismatches found; empty when approved.',
      items: { type: 'string' },
      type: 'array',
    },
    script: {
      description:
        'Full corrected Blender Python script when not approved; null when no correction is needed.',
      type: ['string', 'null'],
    },
  },
  required: ['approved', 'issues', 'script'],
  type: 'object',
} as const;

export interface GeneratedBlenderScriptBody {
  notes: string[];
  referenceAnalysis?: ReferenceImageAnalysis | null;
  script: string;
  summary: string;
}

export interface ReferenceImageAnalysis {
  blockingNotes: string[];
  cameraBrief: string;
  environment: string[];
  generationPrompt: string;
  primarySubjects: string[];
  sceneBrief: string;
}

export interface GeneratedBlenderScript extends GeneratedBlenderScriptBody {
  agentInstructionsPath?: string;
  provider: BlenderAgent;
  referenceAnalysis?: ReferenceImageAnalysis | null;
  threadId?: string | null;
}

export interface GenerateBlenderScriptContext {
  sourceImagePath?: string | null;
  workingDirectory: string;
}

export interface BlenderScriptFailure {
  errorMessage: string;
  logsTail: string[];
  runId?: string | null;
}

export interface BlenderPreviewReview {
  approved: boolean;
  issues: string[];
  script: string | null;
}

export interface BlenderPreviewReviewOptions {
  turnTimeoutMs?: number;
}

type BlenderScriptGenerator = (
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
) => Promise<GeneratedBlenderScript>;

type BlenderScriptRepairer = (
  previous: GeneratedBlenderScript,
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  failure: BlenderScriptFailure,
) => Promise<GeneratedBlenderScript>;

type BlenderPreviewReviewer = (
  generated: GeneratedBlenderScript,
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  previewImagePath: string,
  options?: BlenderPreviewReviewOptions,
) => Promise<BlenderPreviewReview | null>;

interface LoadedBlenderAgentInstructions {
  content: string;
  path: string;
}

interface BlenderScriptPrompt {
  agentInstructionsPath: string;
  text: string;
}

interface RegenerationFailureContext extends BlenderScriptFailure {
  previousScript?: string;
}

let generatorOverride: BlenderScriptGenerator | undefined;
let repairerOverride: BlenderScriptRepairer | undefined;
let reviewerOverride: BlenderPreviewReviewer | undefined;

export function setBlenderScriptGeneratorForTests(
  generator: BlenderScriptGenerator | undefined,
): void {
  generatorOverride = generator;
}

export function setBlenderScriptRepairerForTests(repairer: BlenderScriptRepairer | undefined): void {
  repairerOverride = repairer;
}

export function setBlenderPreviewReviewerForTests(
  reviewer: BlenderPreviewReviewer | undefined,
): void {
  reviewerOverride = reviewer;
}

export function buildBlenderScriptPrompt(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
): string {
  return buildBlenderScriptPromptWithMetadata(payload, context).text;
}

function buildBlenderScriptPromptWithMetadata(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  regenerationFailure?: RegenerationFailureContext,
): BlenderScriptPrompt {
  const modelId = payload.modelId || 'new model';
  const referenceImagePath = context.sourceImagePath || 'not available';
  const userPrompt = payload.prompt || 'not provided';
  const updatePrompt = payload.workflow.id === 'blender-update-3d' ? userPrompt : 'not provided';
  const agentInstructions = loadBlenderAgentInstructions();
  const taskText =
    payload.workflow.id === 'blender-create-3d'
      ? 'Create a new previs 3D scene from the provided source image and PACE.'
      : `Update model "${modelId}" with the requested scene change.`;

  const text = [
    'You are generating Blender Python for a comfyui-worker Blender job.',
    'Return only JSON that conforms to the provided schema.',
    '',
    'Agent instructions from agent.md (authoritative for scene style, reference analysis, PACE interpretation, scene rules, pose quality, and Blender guardrails):',
    agentInstructions.content,
    '',
    'Output contract:',
    '- Populate `referenceAnalysis` first: analyze the source image (when provided) before writing any Blender Python, then make the script follow that analysis.',
    '- If no source image is available, fill `referenceAnalysis` with concise "not available" strings and empty arrays.',
    '- `blockingNotes` must be scene-specific and actionable for THIS reference image and PACE; never return generic advice that could apply to any image.',
    '- `script` must be one self-contained Blender Python script that follows the agent.md contract above.',
    '- For create-3d, apply the user prompt as primary creative direction alongside the reference image and PACE.',
    '',
    'Human anatomy continuity guardrail:',
    '- If a human or humanoid actor is present, the torso, pelvis, head, arms, hands, legs, and feet must read as one continuous connected body.',
    '- Never create floating, detached, or separated limbs; every arm must connect through shoulder/upper arm/elbow/forearm/hand and every leg through hip/thigh/knee/shin/foot.',
    '- A spaced stance or separated feet means pose spacing only; feet and legs remain connected to pelvis and torso through visible joints or overlapping proxy geometry.',
    '- Prefer joined proxy meshes, overlapping cylinders/capsules, parented primitives, or simple joint spheres for characters so limbs cannot read as independent islands.',
    '',
    'Runtime facts:',
    '- The runner injects these globals: PACE, TASK_ID, SCENE_ID, SHOT_ID, OUTPUT_DIR; prefer them with safe fallbacks.',
    '- Name the hero mesh with the Model id below.',
    '- Do not save or export files; the runner saves all artifacts.',
    '',
    `Workflow: ${payload.workflow.id}`,
    `Task: ${taskText}`,
    `Task id: ${payload.taskId}`,
    `Scene id: ${payload.sceneId}`,
    `Shot id: ${payload.shotId}`,
    `Model id: ${modelId}`,
    `User prompt: ${userPrompt}`,
    `Update prompt: ${updatePrompt}`,
    `Agent provider: ${payload.agent}`,
    `Runner target: ${payload.runnerTarget}`,
    `Source image asset URI: ${payload.inputs.sourceImageAssetUri || 'not available'}`,
    `Reference image path: ${referenceImagePath}`,
    ...formatRegenerationFailureForPrompt(regenerationFailure),
    '',
    'PACE JSON:',
    JSON.stringify(payload.pace, null, 2),
  ].join('\n');

  return {
    agentInstructionsPath: agentInstructions.path,
    text,
  };
}

function formatRegenerationFailureForPrompt(failure?: RegenerationFailureContext): string[] {
  if (!failure) {
    return [];
  }

  return [
    '',
    'A previous attempt at this job failed in the Blender runner.',
    `Runner error: ${failure.errorMessage}`,
    failure.logsTail.length ? 'Blender log tail:' : 'Blender log tail: not available',
    ...failure.logsTail,
    ...(failure.previousScript ? ['Previous script:', failure.previousScript] : []),
    'Generate a corrected script that fixes the root cause of this failure.',
  ];
}

function buildRunFailureRepairPrompt(failure: BlenderScriptFailure): string {
  return [
    'The Blender runner failed to execute your previous script for this job.',
    `Runner error: ${failure.errorMessage}`,
    failure.logsTail.length ? 'Blender log tail:' : 'Blender log tail: not available',
    ...failure.logsTail,
    '',
    'Fix the root cause and return the full corrected JSON (same schema as before).',
    'Keep the same scene intent and referenceAnalysis, follow agent.md, and return the complete corrected script.',
  ].join('\n');
}

function buildViolationRepairPrompt(violations: string[]): string {
  return [
    'Your previous script violates the worker contract:',
    ...violations.map((violation) => `- ${violation}`),
    '',
    'Return the full corrected JSON (same schema as before) with a complete script that resolves every violation while keeping the same scene intent.',
  ].join('\n');
}

function buildPreviewReviewPrompt(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
): string {
  const hasReference = Boolean(context.sourceImagePath);
  return [
    'You previously generated the Blender script for this job; the runner has now rendered it.',
    `Review the rendered preview (first attached image) against the reference image ${
      hasReference ? '(second attached image)' : '(not available)'
    }, the PACE, and the agent.md rules from earlier in this thread.`,
    'Check at minimum:',
    '- Camera angle, framing, and composition match the reference and PACE intent.',
    '- Hero poses read from silhouette; the focus object is visible and explicit.',
    '- Human or humanoid actors have continuous connected torsos, pelvises, heads, arms, hands, legs, and feet; no floating, detached, or separated limbs.',
    '- The preview is bright enough to inspect; materials and colors do not collapse into one gray value.',
    '- No readable text labels; no occluders blocking the camera corridor.',
    'Return only JSON conforming to the schema.',
    'When the preview passes, return approved=true, issues=[], script=null.',
    'Otherwise return approved=false, concrete issues, and the FULL corrected Blender Python script in `script` (same contract as before).',
  ].join('\n');
}

function loadBlenderAgentInstructions(): LoadedBlenderAgentInstructions {
  const configuredPath = process.env.BLENDER_AGENT_INSTRUCTIONS_PATH?.trim();
  const candidatePaths = configuredPath
    ? [configuredPath]
    : DEFAULT_AGENT_INSTRUCTIONS_PATHS.map((filename) => join(process.cwd(), filename));
  const instructionPath = candidatePaths.find((candidatePath) => existsSync(candidatePath));

  if (!instructionPath) {
    throw new Error(`Blender agent instructions file not found: ${candidatePaths.join(', ')}`);
  }

  return {
    content: readFileSync(instructionPath, 'utf8').trim(),
    path: instructionPath,
  };
}

export function parseGeneratedBlenderScriptResponse(text: string): GeneratedBlenderScriptBody {
  const parsed = parseJsonResponseText(text);
  return validateGeneratedBlenderScriptResponse(parsed);
}

export function parseReferenceImageAnalysisResponse(text: string): ReferenceImageAnalysis {
  const parsed = parseJsonResponseText(text);
  return validateReferenceImageAnalysisResponse(parsed);
}

export function parsePreviewReviewResponse(text: string): BlenderPreviewReview {
  const parsed = parseJsonResponseText(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex returned invalid preview review JSON.');
  }

  const typed = parsed as Record<string, unknown>;
  if (typeof typed.approved !== 'boolean') {
    throw new Error('Codex returned invalid preview review approved flag.');
  }
  const issues = validateStringArray(typed.issues, 'issues');
  const script =
    typed.script === undefined || typed.script === null
      ? null
      : requireNonEmptyString(typed.script, 'script');

  return { approved: typed.approved, issues, script };
}

function parseJsonResponseText(text: string): unknown {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    : trimmed;
  return JSON.parse(jsonText) as unknown;
}

function validateReferenceImageAnalysisResponse(value: unknown): ReferenceImageAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex returned invalid reference image analysis JSON.');
  }

  const typed = value as Record<string, unknown>;
  return {
    blockingNotes: validateStringArray(typed.blockingNotes, 'blockingNotes'),
    cameraBrief: requireNonEmptyString(typed.cameraBrief, 'cameraBrief'),
    environment: validateStringArray(typed.environment, 'environment'),
    generationPrompt: requireNonEmptyString(typed.generationPrompt, 'generationPrompt'),
    primarySubjects: validateStringArray(typed.primarySubjects, 'primarySubjects'),
    sceneBrief: requireNonEmptyString(typed.sceneBrief, 'sceneBrief'),
  };
}

function validateGeneratedBlenderScriptResponse(value: unknown): GeneratedBlenderScriptBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex returned invalid blender script JSON.');
  }

  const typed = value as Record<string, unknown>;
  const notes = validateNotes(typed.notes);
  const referenceAnalysis =
    typed.referenceAnalysis === undefined || typed.referenceAnalysis === null
      ? null
      : validateReferenceImageAnalysisResponse(typed.referenceAnalysis);
  const script = requireNonEmptyString(typed.script, 'script');
  const summary = requireNonEmptyString(typed.summary, 'summary');

  return { notes, referenceAnalysis, script, summary };
}

function validateNotes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Codex returned invalid blender script JSON.');
  }

  return value.map((note) => requireNonEmptyString(note, 'notes'));
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Codex returned invalid ${field}.`);
  }

  return value.map((item) => requireNonEmptyString(item, field));
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Codex returned invalid ${field}.`);
  }
  return value;
}

export function collectBlenderScriptViolations(script: string): string[] {
  const violations: string[] = [];
  const normalized = stripPythonCommentsAndStrings(script);
  const hasBpyImport = /(?:^|\n)\s*import\s+bpy\s*(?:\n|$)/m.test(normalized);
  const hasBpyAccess = /\bbpy\.[A-Za-z_]\w*/.test(normalized);

  if (!hasBpyImport || !hasBpyAccess) {
    violations.push('The script must use exactly `import bpy` and direct `bpy.` access; do not alias bpy or use `from bpy import ...`.');
  }
  if (script.includes('BLENDER_EEVEE_NEXT')) {
    violations.push('Do not use `BLENDER_EEVEE_NEXT`; prefer `BLENDER_EEVEE`, `BLENDER_WORKBENCH`, or `CYCLES`, and only set render.engine after checking the enum is available.');
  }
  if (/\bbpy\.mathutils\./.test(normalized)) {
    violations.push('Use `import mathutils` for vectors and quaternions; `bpy.mathutils` does not exist.');
  }
  if (/\bbpy\.ops\.object\.text_add\s*\(/.test(normalized) || /type\s*=\s*['"]FONT['"]/.test(script)) {
    violations.push('Do not add readable on-screen text objects; use object names, non-text markers, color blocks, and simple geometry instead, unless the user explicitly asked for on-screen text.');
  }

  return violations;
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

function getCodexModel(): string | undefined {
  return process.env.OPENAI_CODEX_MODEL?.trim() || undefined;
}

function getCodexReasoningEffort(): ModelReasoningEffort {
  const configured = process.env.OPENAI_CODEX_REASONING_EFFORT?.trim();

  if (!configured) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }

  if (SUPPORTED_CODEX_REASONING_EFFORTS.has(configured as ModelReasoningEffort)) {
    return configured as ModelReasoningEffort;
  }

  throw new Error(
    `Invalid OPENAI_CODEX_REASONING_EFFORT "${configured}". Expected one of: ${Array.from(
      SUPPORTED_CODEX_REASONING_EFFORTS,
    ).join(', ')}.`,
  );
}

function createCodexClient(): Codex {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
  const codexPathOverride = process.env.CODEX_CLI_PATH || DEFAULT_CODEX_CLI_PATH;
  return new Codex({
    ...(apiKey ? { apiKey } : {}),
    ...(existsSync(codexPathOverride) ? { codexPathOverride } : {}),
  });
}

function getCodexTurnTimeoutMs(timeoutOverrideMs?: number): number {
  if (timeoutOverrideMs !== undefined) {
    if (!Number.isFinite(timeoutOverrideMs) || timeoutOverrideMs <= 0) {
      throw new Error(
        `Invalid Codex turn timeout override "${timeoutOverrideMs}". Expected a positive number of milliseconds.`,
      );
    }
    return Math.floor(timeoutOverrideMs);
  }

  const configured = process.env.OPENAI_CODEX_TURN_TIMEOUT_MS?.trim();
  if (!configured) {
    return DEFAULT_CODEX_TURN_TIMEOUT_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid OPENAI_CODEX_TURN_TIMEOUT_MS "${configured}". Expected a positive number of milliseconds.`,
    );
  }
  return Math.floor(parsed);
}

/**
 * Runs one codex turn with a hard wall-clock bound. On timeout we abort the turn so the underlying
 * `codex exec` child is terminated (node SIGTERMs it via the spawn signal), preventing orphaned
 * codex processes from wedging the shared app-server.
 */
async function runCodexTurn(
  thread: Thread,
  input: Input,
  turnOptions: Omit<TurnOptions, 'signal'>,
  options?: { timeoutMs?: number },
): Promise<RunResult> {
  const timeoutMs = getCodexTurnTimeoutMs(options?.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await thread.run(input, { ...turnOptions, signal: controller.signal });
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw new Error(
        `Codex turn timed out after ${timeoutMs}ms and was aborted to release the codex process.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildThreadOptions(workingDirectory: string): ThreadOptions {
  return {
    approvalPolicy: 'never',
    model: getCodexModel(),
    modelReasoningEffort: getCodexReasoningEffort(),
    networkAccessEnabled: false,
    sandboxMode: 'workspace-write',
    skipGitRepoCheck: true,
    webSearchMode: 'disabled',
    workingDirectory,
  };
}

async function repairScriptViolationsIfNeeded(
  thread: Thread,
  generated: GeneratedBlenderScriptBody,
): Promise<GeneratedBlenderScriptBody> {
  const violations = collectBlenderScriptViolations(generated.script);
  if (!violations.length) {
    return generated;
  }

  const turn = await runCodexTurn(thread, buildViolationRepairPrompt(violations), {
    outputSchema: generatedBlenderScriptOutputSchema,
  });
  const repaired = parseGeneratedBlenderScriptResponse(turn.finalResponse);
  const remaining = collectBlenderScriptViolations(repaired.script);
  if (remaining.length) {
    throw new Error(
      `Codex returned a Blender script with unresolved violations: ${remaining.join(' | ')}`,
    );
  }
  return repaired;
}

async function generateWithCodex(
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  regenerationFailure?: RegenerationFailureContext,
): Promise<GeneratedBlenderScript> {
  const codex = createCodexClient();
  const thread = codex.startThread(buildThreadOptions(context.workingDirectory));

  const prompt = buildBlenderScriptPromptWithMetadata(payload, context, regenerationFailure);
  const input: Input = context.sourceImagePath
    ? [
        { text: prompt.text, type: 'text' },
        { path: context.sourceImagePath, type: 'local_image' },
      ]
    : prompt.text;
  const turn = await runCodexTurn(thread, input, {
    outputSchema: generatedBlenderScriptOutputSchema,
  });
  let generated = parseGeneratedBlenderScriptResponse(turn.finalResponse);
  generated = await repairScriptViolationsIfNeeded(thread, generated);

  return {
    ...generated,
    agentInstructionsPath: prompt.agentInstructionsPath,
    provider: 'codex',
    referenceAnalysis: generated.referenceAnalysis ?? null,
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

export async function repairBlenderScript(
  previous: GeneratedBlenderScript,
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  failure: BlenderScriptFailure,
): Promise<GeneratedBlenderScript> {
  if (repairerOverride) {
    return repairerOverride(previous, payload, context, failure);
  }

  if (payload.agent !== 'codex') {
    throw new Error('Blender script repair is only available for the codex agent provider.');
  }

  if (previous.threadId) {
    try {
      const codex = createCodexClient();
      const thread = codex.resumeThread(previous.threadId, buildThreadOptions(context.workingDirectory));
      const turn = await runCodexTurn(thread, buildRunFailureRepairPrompt(failure), {
        outputSchema: generatedBlenderScriptOutputSchema,
      });
      let generated = parseGeneratedBlenderScriptResponse(turn.finalResponse);
      generated = await repairScriptViolationsIfNeeded(thread, generated);

      return {
        ...generated,
        agentInstructionsPath: previous.agentInstructionsPath,
        provider: 'codex',
        referenceAnalysis: generated.referenceAnalysis ?? previous.referenceAnalysis ?? null,
        threadId: thread.id ?? previous.threadId,
      };
    } catch (error: any) {
      logger.warn(
        'blender script repair on resumed thread failed; regenerating from scratch thread_id=%s error=%s',
        previous.threadId,
        error?.message || error,
      );
    }
  }

  return generateWithCodex(payload, context, {
    ...failure,
    previousScript: previous.script,
  });
}

export async function reviewBlenderPreview(
  generated: GeneratedBlenderScript,
  payload: HydratedBlenderTaskPayload,
  context: GenerateBlenderScriptContext,
  previewImagePath: string,
  options?: BlenderPreviewReviewOptions,
): Promise<BlenderPreviewReview | null> {
  if (reviewerOverride) {
    return reviewerOverride(generated, payload, context, previewImagePath, options);
  }

  if (payload.agent !== 'codex' || !generated.threadId) {
    return null;
  }

  const codex = createCodexClient();
  const thread = codex.resumeThread(generated.threadId, buildThreadOptions(context.workingDirectory));
  const input: Input = [
    { text: buildPreviewReviewPrompt(payload, context), type: 'text' },
    { path: previewImagePath, type: 'local_image' },
    ...(context.sourceImagePath
      ? [{ path: context.sourceImagePath, type: 'local_image' as const }]
      : []),
  ];
  const turn = await runCodexTurn(
    thread,
    input,
    { outputSchema: previewReviewOutputSchema },
    { timeoutMs: options?.turnTimeoutMs },
  );
  const review = parsePreviewReviewResponse(turn.finalResponse);

  if (!review.approved && review.script && collectBlenderScriptViolations(review.script).length) {
    return { ...review, script: null };
  }

  return review;
}
