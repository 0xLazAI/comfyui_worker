import { ValidationError } from '../infra/HttpError.js';
import { normalizeProjectRoot } from '../render/payload.js';
import { getBlenderWorkflowDefinition } from './workflowCatalog.js';
import type {
  BlenderAgent,
  BlenderPayloadContext,
  BlenderPace,
  BlenderRunnerTarget,
  HydratedBlenderTaskPayload,
  JsonObject,
  JsonValue,
} from './types.js';

interface UnknownMap {
  [key: string]: unknown;
}

const DEFAULT_AGENT: BlenderAgent = 'codex';
const DEFAULT_RUNNER_TARGET: BlenderRunnerTarget = 'gpu';
const DEFAULT_PACE_SCHEMA_VERSION = 'pai-blender-pace-draft-2026-06-09';
const VALID_AGENTS = new Set<BlenderAgent>(['codex', 'claude']);
const VALID_RUNNER_TARGETS = new Set<BlenderRunnerTarget>(['local', 'gpu']);

export function hydrateBlenderTaskPayload(
  payload: Record<string, unknown>,
  context: BlenderPayloadContext,
): HydratedBlenderTaskPayload {
  const workflow = getBlenderWorkflowDefinition(requireString(payload.workflow, 'payload.workflow'));
  const sceneId = requireString(payload.scene_id, 'payload.scene_id');
  const shotId = requireString(payload.shot_id, 'payload.shot_id');
  const projectRoot = normalizeProjectRoot(context.projectRoot);
  const agent = normalizeAgent(payload.agent);
  const runnerTarget = normalizeRunnerTarget(payload.runner_target);
  const sourceImageAssetUri = normalizeSourceImageAssetUri(payload);

  if (workflow.id === 'blender-create-3d') {
    const pace = normalizeRequiredPace(payload.pace, sceneId, shotId);
    if (!sourceImageAssetUri) {
      throw new ValidationError('payload.inputs.image.assetUri is required');
    }

    return {
      workflow,
      sceneId,
      shotId,
      modelId: null,
      prompt: null,
      pace,
      agent,
      runnerTarget,
      inputs: {
        sourceImageAssetUri,
      },
      taskId: context.taskId,
      projectId: context.projectId,
      projectRoot,
    };
  }

  const modelId = requireString(payload.model_id, 'payload.model_id');
  const prompt = requireString(payload.prompt, 'payload.prompt');
  const pace = normalizeOptionalPace(payload.pace, sceneId, shotId);

  return {
    workflow,
    sceneId,
    shotId,
    modelId,
    prompt,
    pace,
    agent,
    runnerTarget,
    inputs: {
      sourceImageAssetUri,
    },
    taskId: context.taskId,
    projectId: context.projectId,
    projectRoot,
  };
}

export function createDefaultPace(sceneId: string, shotId: string): BlenderPace {
  return {
    camera: {
      focal_length_mm: 35,
      look_at: [0, 0, 0.8],
      position: [4, -4, 2.6],
    },
    event: {
      trigger_frame: 1,
      type: 'create-3d',
    },
    lighting: {
      energy: 850,
      position: [-3.4, -4, 4.8],
      size: 4,
    },
    scene: {
      scene_id: sceneId,
      shot_id: shotId,
      unit: 'metric',
    },
    schema_version: DEFAULT_PACE_SCHEMA_VERSION,
    style: {
      material: 'neutral clay',
      preview_level: 'previs',
    },
  };
}

function normalizeRequiredPace(value: unknown, sceneId: string, shotId: string): BlenderPace {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('payload.pace is required');
  }
  return normalizePace(value, sceneId, shotId);
}

function normalizeOptionalPace(value: unknown, sceneId: string, shotId: string): BlenderPace {
  if (value === undefined || value === null || value === '') {
    return createDefaultPace(sceneId, shotId);
  }
  return normalizePace(value, sceneId, shotId);
}

function normalizePace(value: unknown, sceneId: string, shotId: string): BlenderPace {
  const fallback = createDefaultPace(sceneId, shotId);
  const normalized = requireJsonObject(value, 'payload.pace');
  const sceneValue = normalized.scene;
  const scene = sceneValue === undefined ? {} : requireJsonObject(sceneValue, 'payload.pace.scene');
  const schemaVersionValue = normalized.schema_version;
  const schemaVersion = schemaVersionValue === undefined ? fallback.schema_version : requireString(schemaVersionValue, 'payload.pace.schema_version');

  return {
    ...fallback,
    ...normalized,
    schema_version: schemaVersion,
    scene: {
      ...fallback.scene,
      ...scene,
      scene_id: sceneId,
      shot_id: shotId,
    },
  };
}

function normalizeSourceImageAssetUri(payload: Record<string, unknown>): string | null {
  const inputs = payload.inputs;
  if (inputs !== undefined && inputs !== null && inputs !== '') {
    const normalizedInputs = requireObject(inputs, 'payload.inputs');
    const image = normalizedInputs.image;
    if (image !== undefined && image !== null && image !== '') {
      const normalizedImage = requireObject(image, 'payload.inputs.image');
      return requireString(normalizedImage.assetUri, 'payload.inputs.image.assetUri');
    }
  }

  const legacyImageAssetUri = optionalString(payload.image);
  return legacyImageAssetUri || null;
}

function normalizeAgent(value: unknown): BlenderAgent {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_AGENT;
  }
  const normalized = requireString(value, 'payload.agent') as BlenderAgent;
  if (!VALID_AGENTS.has(normalized)) {
    throw new ValidationError('payload.agent must be one of: codex, claude');
  }
  return normalized;
}

function normalizeRunnerTarget(value: unknown): BlenderRunnerTarget {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_RUNNER_TARGET;
  }
  const normalized = requireString(value, 'payload.runner_target') as BlenderRunnerTarget;
  if (!VALID_RUNNER_TARGETS.has(normalized)) {
    throw new ValidationError('payload.runner_target must be one of: local, gpu');
  }
  return normalized;
}

function requireObject(value: unknown, field: string): UnknownMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as UnknownMap;
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return String(value || '').trim();
}

function requireJsonObject(value: unknown, field: string): JsonObject {
  const normalized = cloneJsonValue(value, field);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return normalized;
}

function cloneJsonValue(value: unknown, field: string): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${field} must be JSON-compatible`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${field}[${index}]`));
  }

  if (value && typeof value === 'object') {
    const output: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        throw new ValidationError(`${field}.${key} must be JSON-compatible`);
      }
      output[key] = cloneJsonValue(entry, `${field}.${key}`);
    }
    return output;
  }

  throw new ValidationError(`${field} must be JSON-compatible`);
}
