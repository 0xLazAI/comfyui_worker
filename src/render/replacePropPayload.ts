import { ValidationError } from '../infra/HttpError.js';
import type { ParsedPanelId } from './panelId.js';
import {
  extractPanel,
  extractWorkflowId,
  normalizeExtraParams,
  normalizeInputs,
  normalizeOptionalInteger,
  normalizeProjectRoot,
  optionalString,
  requireObject,
  requireString,
} from './payload.js';
import { getWorkflowDefinition, type WorkflowDefinition } from './workflowCatalog.js';

export type ReplacePropMaskMode = 'auto' | 'precise';

export interface NormalizedReplacePropPanelPayload {
  workflow: WorkflowDefinition;
  panel: ParsedPanelId;
  replace: {
    sourceProp: string;
    instruction: string;
  };
  prompt: {
    negativeText: string;
  };
  inputs: {
    imageAssetUri: string | null;
  };
  seed: number | null;
  params: Record<string, string | number | boolean> & {
    maskMode: ReplacePropMaskMode;
  };
  projectId: string;
  projectRoot: string;
  taskId: string;
}

export function hydrateReplacePropPanelPayload(
  payload: Record<string, unknown>,
  context: {
    taskId: string;
    projectId: string;
    projectRoot: string;
  },
): NormalizedReplacePropPanelPayload {
  const workflowId = extractWorkflowId(payload.workflow);
  const workflow = getWorkflowDefinition(workflowId);
  const panel = extractPanel(payload);
  const replace = normalizeReplace(payload.replace);
  const prompt = normalizePrompt(payload.prompt);
  const inputs = normalizeInputs(payload.inputs, workflow);
  const seed = normalizeOptionalInteger(payload.seed, 'payload.seed');
  const params = normalizeReplacePropParams(normalizeExtraParams(payload.params, workflow, 'payload.params'));
  const projectRoot = normalizeProjectRoot(context.projectRoot);

  return {
    workflow,
    panel,
    replace,
    prompt,
    inputs,
    seed,
    params,
    projectId: context.projectId,
    projectRoot,
    taskId: context.taskId,
  };
}

function normalizeReplacePropParams(
  params: Record<string, string | number | boolean>,
): NormalizedReplacePropPanelPayload['params'] {
  return {
    ...params,
    maskMode: normalizeMaskMode(params.maskMode),
  };
}

function normalizeMaskMode(value: unknown): ReplacePropMaskMode {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'precise') {
    return normalized;
  }
  throw new ValidationError('payload.params.maskMode must be one of: auto, precise');
}

function normalizeReplace(value: unknown): {
  sourceProp: string;
  instruction: string;
} {
  const replace = requireObject(value, 'payload.replace');
  return {
    sourceProp: requireString(replace.sourceProp, 'payload.replace.sourceProp'),
    instruction: requireString(replace.instruction, 'payload.replace.instruction'),
  };
}

function normalizePrompt(value: unknown): {
  negativeText: string;
} {
  const prompt = value === undefined ? {} : requireObject(value, 'payload.prompt');
  return {
    negativeText: optionalString(prompt.negativeText) || '',
  };
}
