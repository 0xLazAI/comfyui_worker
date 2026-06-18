import path from 'path';
import { PLATFORM_API_ENABLED, PROJECTS_ROOT } from '../infra/constants.js';
import { ValidationError } from '../infra/HttpError.js';
import { parsePanelId, type ParsedPanelId } from './panelId.js';
import { getWorkflowDefinition, type WorkflowDefinition } from './workflowCatalog.js';

export interface StringMap {
  [key: string]: unknown;
}

export interface NormalizedRenderPanelPayload {
  workflow: WorkflowDefinition;
  panel: ParsedPanelId;
  prompt: {
    text: string;
    negativeText: string;
  };
  inputs: {
    imageAssetUri: string | null;
  };
  seed: number | null;
  extraParams: Record<string, string | number | boolean>;
  projectId: string;
  projectRoot: string;
  taskId: string;
}

export function hydrateRenderPanelPayload(
  payload: Record<string, unknown>,
  context: {
    taskId: string;
    projectId: string;
    projectRoot: string;
  },
): NormalizedRenderPanelPayload {
  const workflowId = extractWorkflowId(payload.workflow);
  const workflow = getWorkflowDefinition(workflowId);
  const panel = extractPanel(payload);
  const prompt = normalizePrompt(payload.prompt, workflow);
  const inputs = normalizeInputs(payload.inputs, workflow);
  const seed = normalizeOptionalInteger(payload.seed, 'payload.seed');
  const extraParams = normalizeExtraParams(payload.extraParams, workflow);
  const projectRoot = normalizeProjectRoot(context.projectRoot);

  return {
    workflow,
    panel,
    prompt,
    inputs,
    seed,
    extraParams,
    projectId: context.projectId,
    projectRoot,
    taskId: context.taskId,
  };
}

function normalizePrompt(value: unknown, workflow: WorkflowDefinition): {
  text: string;
  negativeText: string;
} {
  const prompt = requireObject(value, 'payload.prompt');
  const text = requireString(prompt.text, 'payload.prompt.text');
  const negativeText = optionalString(prompt.negativeText) || '';

  if (workflow.requiresPromptText && !text) {
    throw new ValidationError('payload.prompt.text is required');
  }

  return { text, negativeText };
}

export function normalizeInputs(value: unknown, workflow: WorkflowDefinition): {
  imageAssetUri: string | null;
} {
  const inputs = requireObject(value, 'payload.inputs');
  const legacyAssetUri = optionalString(inputs.imageAssetUri);
  const image = inputs.image === undefined ? null : requireObject(inputs.image, 'payload.inputs.image');
  const imageAssetUri = legacyAssetUri || (image ? requireString(image.assetUri, 'payload.inputs.image.assetUri') : null);

  if (workflow.requiresSourceImage && !imageAssetUri) {
    throw new ValidationError('payload.inputs.image.assetUri is required');
  }

  return { imageAssetUri };
}

export function extractWorkflowId(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return requireString((value as Record<string, unknown>).id, 'payload.workflow.id');
  }
  return requireString(value, 'payload.workflow');
}

export function extractPanel(payload: Record<string, unknown>): ParsedPanelId {
  const panelId = optionalString(payload.panelId);
  if (panelId) {
    return parsePanelId(panelId);
  }

  const legacyPanel = payload.panel;
  if (legacyPanel && typeof legacyPanel === 'object' && !Array.isArray(legacyPanel)) {
    const panel = legacyPanel as Record<string, unknown>;
    const panelPanelId = optionalString(panel.panelId);
    if (panelPanelId) {
      return parsePanelId(panelPanelId);
    }

    const sceneId = requireString(panel.sceneId, 'payload.panel.sceneId');
    const shotId = requireString(panel.shotId, 'payload.panel.shotId');
    const panelNumber = requireString(panel.panelNumber, 'payload.panel.panelNumber');
    return parsePanelId(`${sceneId}_${shotId}_panel_${panelNumber}`);
  }

  throw new ValidationError('payload.panelId is required');
}

export function normalizeExtraParams(
  value: unknown,
  workflow: WorkflowDefinition,
  field = 'payload.extraParams',
): Record<string, string | number | boolean> {
  const raw = value === undefined ? {} : requireObject(value, field);
  const output: Record<string, string | number | boolean> = {};

  for (const [key, definition] of Object.entries(workflow.allowedExtraParams)) {
    const rawValue = raw[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      if (definition.required && definition.defaultValue === undefined) {
        throw new ValidationError(`${field}.${key} is required`);
      }
      if (definition.defaultValue !== undefined) {
        output[key] = definition.defaultValue;
      }
      continue;
    }

    output[key] = normalizeTypedValue(rawValue, `${field}.${key}`, definition);
  }

  const unknownKeys = Object.keys(raw).filter((key) => !workflow.allowedExtraParams[key]);
  if (unknownKeys.length) {
    throw new ValidationError(`${field} contains unsupported keys: ${unknownKeys.join(', ')}`);
  }

  return output;
}

function normalizeTypedValue(
  value: unknown,
  field: string,
  definition: WorkflowDefinition['allowedExtraParams'][string],
): string | number | boolean {
  if (definition.type === 'string') {
    return requireString(value, field);
  }

  if (definition.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    throw new ValidationError(`${field} must be a boolean`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new ValidationError(`${field} must be a ${definition.type}`);
  }

  const normalized = definition.type === 'integer' ? Math.floor(numeric) : numeric;
  if (definition.minimum !== undefined && normalized < definition.minimum) {
    throw new ValidationError(`${field} must be >= ${definition.minimum}`);
  }
  if (definition.maximum !== undefined && normalized > definition.maximum) {
    throw new ValidationError(`${field} must be <= ${definition.maximum}`);
  }
  return normalized;
}

export function normalizeProjectRoot(projectRoot: string): string {
  const normalized = requireString(projectRoot, 'project_root');
  if (PLATFORM_API_ENABLED) {
    return normalized;
  }
  const resolvedRoot = path.resolve(normalized);
  const resolvedProjectsRoot = path.resolve(PROJECTS_ROOT);
  if (!resolvedRoot.startsWith(`${resolvedProjectsRoot}${path.sep}`) && resolvedRoot !== resolvedProjectsRoot) {
    throw new ValidationError(`project_root must be under ${resolvedProjectsRoot}`);
  }
  return resolvedRoot;
}

export function requireObject(value: unknown, field: string): StringMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as StringMap;
}

export function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

export function optionalString(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  return Math.floor(normalized);
}
