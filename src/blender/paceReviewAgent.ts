/**
 * blender-pace-review audit agent.
 *
 * Input: a base GLB (parsed by the worker into a {@link GlbInventory}) plus the
 * PACE document it was supposedly generated from. The agent cross-references the
 * two, reports what is present vs missing/wrong, and returns a Blender Python
 * FIX script. At runtime the worker prepends a preamble that imports the base
 * GLB into the scene, so the fix script edits the already-imported objects and
 * the runner re-exports the corrected GLB.
 *
 * The agent is constrained by workflows/blender-pace-review/agent.md to be
 * methodical: inspect first, enumerate every issue, then fix — and to treat PACE
 * (never mesh shape) as the ground truth for positions.
 */
import {
  buildThreadOptions,
  collectBlenderScriptViolations,
  createCodexClient,
  loadBlenderAgentInstructions,
  runCodexTurn,
} from './agent.js';
import type { GenerateBlenderScriptContext } from './agent.js';
import type { GlbInventory } from './glbInspect.js';
import type { HydratedBlenderTaskPayload, PaceDocument } from './types.js';

export interface PaceReviewIssue {
  /** Stable category, e.g. "missing_camera", "position_off", "missing_trajectory". */
  category: string;
  /** PACE entity id this issue concerns, e.g. a subject/prop/camera id. */
  target: string;
  description: string;
  /** True when the returned fix script addresses this issue. */
  fixed: boolean;
  /** Reason an issue could not be fixed; null when fixed or not applicable. */
  unfixableReason: string | null;
}

export interface PaceReviewResult {
  /** Full Markdown review report (issues found, fixed, unfixable, before/after). */
  report: string;
  issues: PaceReviewIssue[];
  /** Blender Python that edits the already-imported base GLB to satisfy PACE. */
  script: string;
  summary: string;
  notes: string[];
  threadId?: string | null;
  agentInstructionsPath?: string;
}

export const paceReviewOutputSchema = {
  additionalProperties: false,
  properties: {
    report: {
      description: 'Full Markdown review report: total issues found, issues fixed, issues unfixable (with reasons), and a before/after comparison.',
      type: 'string',
    },
    issues: {
      type: 'array',
      items: {
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          target: { type: 'string' },
          description: { type: 'string' },
          fixed: { type: 'boolean' },
          unfixableReason: { type: ['string', 'null'] },
        },
        required: ['category', 'target', 'description', 'fixed', 'unfixableReason'],
        type: 'object',
      },
    },
    script: {
      description:
        'Blender Python that edits the ALREADY-IMPORTED base GLB scene to satisfy PACE. Do not re-create the whole scene; only add/move/fix what the report lists.',
      type: 'string',
    },
    summary: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['report', 'issues', 'script', 'summary', 'notes'],
  type: 'object',
} as const;

export type PaceReviewGenerator = (
  payload: HydratedBlenderTaskPayload,
  inventory: GlbInventory,
  context: GenerateBlenderScriptContext,
) => Promise<PaceReviewResult>;

let generatorOverride: PaceReviewGenerator | undefined;

export function setPaceReviewGeneratorForTests(generator: PaceReviewGenerator | undefined): void {
  generatorOverride = generator;
}

export function buildPaceReviewPrompt(
  payload: HydratedBlenderTaskPayload,
  inventory: GlbInventory,
  paceDocument: PaceDocument,
): string {
  const agentInstructions = loadBlenderAgentInstructions(payload.workflow.id);
  return [
    'You are auditing a base GLB against its PACE document for a blender-pace-review job.',
    'Return only JSON that conforms to the provided schema.',
    '',
    'Agent instructions from agent.md (authoritative for the inspect-then-fix method, PACE-as-ground-truth rule, and what counts as an issue):',
    agentInstructions.content,
    '',
    'Follow the method in agent.md exactly (inspect → match → report → fix → mark).',
    'Key rules:',
    '- Read POSITIONS from physicalLayout (subjects/props/focusPoints/cameraSetups); read camera OPTICS+MOTION from shots[].camera (focalLengthMm, trajectory); read LIGHTS from shots[].lighting.lights[] (aim/colorTempK/intensityLm/role).',
    '- Match entities by name first; fall back to worldTranslation proximity (≤0.5 m) using inventory.subjectGroups for subjects.',
    '- PACE position in glTF Y-up: (worldXy[0], z, -worldXy[1]).',
    '- NEVER add new geometry for an entity that already has a positional match — move/rename the existing node instead.',
    '- Only add new geometry for entities with NO match within 0.5 m.',
    '- Audit lighting too: inventory.lights[] vs PACE lights[]. Raw previs GLBs usually have no lights — create a Blender light per PACE light (aimed at its focus point, color from colorTempK, energy from intensityLm). setup/events pillars never change geometry.',
    '',
    'Runtime facts:',
    '- The base GLB is already imported into bpy.data when your script starts; operate on the existing objects.',
    '- The runner injects globals TASK_ID, SCENE_ID, SHOT_ID, OUTPUT_DIR; prefer them with safe fallbacks.',
    '- Do not save or export files; the runner re-exports the corrected GLB.',
    '',
    `Workflow: ${payload.workflow.id}`,
    `Task id: ${payload.taskId}`,
    `Base GLB asset: ${payload.inputs.baseGlbAssetUri ?? 'not available'}`,
    '',
    'BASE GLB INVENTORY (what is actually in the GLB):',
    JSON.stringify(inventory, null, 2),
    '',
    'PACE DOCUMENT (ground truth):',
    JSON.stringify(paceDocument, null, 2),
  ].join('\n');
}

export async function generatePaceReviewArtifacts(
  payload: HydratedBlenderTaskPayload,
  inventory: GlbInventory,
  context: GenerateBlenderScriptContext,
): Promise<PaceReviewResult> {
  if (generatorOverride) {
    return generatorOverride(payload, inventory, context);
  }
  if (payload.agent !== 'codex') {
    throw new Error('blender-pace-review is only available for the codex agent provider.');
  }
  if (!payload.paceDocument) {
    throw new Error('blender-pace-review requires a PACE document.');
  }

  const codex = createCodexClient();
  const thread = codex.startThread(buildThreadOptions(context.workingDirectory));
  const promptText = buildPaceReviewPrompt(payload, inventory, payload.paceDocument);
  const turn = await runCodexTurn(thread, promptText, { outputSchema: paceReviewOutputSchema });
  const result = parsePaceReviewResponse(turn.finalResponse);

  const violations = collectBlenderScriptViolations(result.script);
  if (violations.length) {
    throw new Error(`Review fix script violates the worker contract: ${violations.join(' | ')}`);
  }

  return {
    ...result,
    threadId: thread.id,
    agentInstructionsPath: loadBlenderAgentInstructions(payload.workflow.id).path,
  };
}

export function parsePaceReviewResponse(text: string): PaceReviewResult {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    : trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex returned invalid pace-review JSON.');
  }

  const typed = parsed as Record<string, unknown>;
  const report = requireNonEmptyString(typed.report, 'report');
  const script = requireNonEmptyString(typed.script, 'script');
  const summary = requireNonEmptyString(typed.summary, 'summary');
  const notes = Array.isArray(typed.notes)
    ? typed.notes.filter((note): note is string => typeof note === 'string')
    : [];
  const issues = Array.isArray(typed.issues)
    ? typed.issues
        .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === 'object')
        .map((issue) => ({
          category: String(issue.category ?? 'unknown'),
          target: String(issue.target ?? ''),
          description: String(issue.description ?? ''),
          fixed: issue.fixed === true,
          unfixableReason:
            typeof issue.unfixableReason === 'string' && issue.unfixableReason.trim()
              ? issue.unfixableReason
              : null,
        }))
    : [];

  return { report, issues, script, summary, notes };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Codex returned invalid pace-review ${field}.`);
  }
  return value;
}
