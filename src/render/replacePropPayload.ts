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
  params: Record<string, string | number | boolean>;
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
  const params = normalizeExtraParams(payload.params, workflow, 'payload.params');
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
