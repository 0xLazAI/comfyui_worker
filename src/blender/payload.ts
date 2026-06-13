import { ValidationError } from '../infra/HttpError.js';
import { normalizeProjectRoot } from '../render/payload.js';
import { getBlenderWorkflowDefinition } from './workflowCatalog.js';
import type {
  BlenderAgent,
  BlenderPayloadContext,
  BlenderPace,
  BlenderRunnerTarget,
  BlenderWorkflowId,
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
    const pace = normalizeRequiredPace(payload.pace, workflow.id, sceneId, shotId);
    const prompt = normalizeOptionalPrompt(payload.prompt);
    if (!sourceImageAssetUri) {
      throw new ValidationError('payload.inputs.image.assetUri is required');
    }

    return {
      workflow,
      sceneId,
      shotId,
      modelId: null,
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

  const modelId = requireString(payload.model_id, 'payload.model_id');
  const prompt = requireString(payload.prompt, 'payload.prompt');
  const pace = normalizeOptionalPace(payload.pace, workflow.id, sceneId, shotId);

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

export function createDefaultPace(workflowId: BlenderWorkflowId, sceneId: string, shotId: string): BlenderPace {
  return {
    camera: {
      focal_length_mm: 35,
      look_at: [0, 0, 0.8],
      position: [4, -4, 2.6],
    },
    event: {
      trigger_frame: 1,
      type: workflowId === 'blender-update-3d' ? 'update-3d' : 'create-3d',
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

function normalizeRequiredPace(value: unknown, workflowId: BlenderWorkflowId, sceneId: string, shotId: string): BlenderPace {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('payload.pace is required');
  }
  return normalizePace(value, workflowId, sceneId, shotId);
}

function normalizeOptionalPace(value: unknown, workflowId: BlenderWorkflowId, sceneId: string, shotId: string): BlenderPace {
  if (value === undefined || value === null || value === '') {
    return createDefaultPace(workflowId, sceneId, shotId);
  }
  return normalizePace(value, workflowId, sceneId, shotId);
}

function normalizePace(value: unknown, workflowId: BlenderWorkflowId, sceneId: string, shotId: string): BlenderPace {
  const fallback = createDefaultPace(workflowId, sceneId, shotId);
  const normalized = requireJsonObject(value, 'payload.pace');
  const fallbackCamera = requireJsonObject(fallback.camera, 'payload.pace.camera');
  const fallbackEvent = requireJsonObject(fallback.event, 'payload.pace.event');
  const fallbackLighting = requireJsonObject(fallback.lighting, 'payload.pace.lighting');
  const fallbackStyle = requireJsonObject(fallback.style, 'payload.pace.style');
  const camera = normalizeOptionalSection(normalized.camera, 'payload.pace.camera');
  const event = normalizeOptionalSection(normalized.event, 'payload.pace.event');
  const lighting = normalizeOptionalSection(normalized.lighting, 'payload.pace.lighting');
  const sceneValue = normalized.scene;
  const scene = sceneValue === undefined ? {} : requireJsonObject(sceneValue, 'payload.pace.scene');
  const schemaVersionValue = normalized.schema_version;
  const schemaVersion = schemaVersionValue === undefined ? fallback.schema_version : requireString(schemaVersionValue, 'payload.pace.schema_version');
  const style = normalizeOptionalSection(normalized.style, 'payload.pace.style');

  const merged: BlenderPace = {
    ...fallback,
    ...normalized,
    ...(camera ? { camera: { ...fallbackCamera, ...camera } } : {}),
    ...(event ? { event: { ...fallbackEvent, ...event } } : {}),
    ...(lighting ? { lighting: { ...fallbackLighting, ...lighting } } : {}),
    schema_version: schemaVersion,
    scene: {
      ...fallback.scene,
      ...scene,
      scene_id: sceneId,
      shot_id: shotId,
    },
    ...(style ? { style: { ...fallbackStyle, ...style } } : {}),
  };

  assertPaceStructure(merged);
  return merged;
}

function assertPaceStructure(pace: BlenderPace): void {
  const camera = asJsonObjectOrNull(pace.camera);
  if (camera) {
    assertOptionalVector3(camera.position, 'payload.pace.camera.position');
    assertOptionalVector3(camera.look_at, 'payload.pace.camera.look_at');
    assertOptionalPositiveNumber(camera.focal_length_mm, 'payload.pace.camera.focal_length_mm');
  }

  const lighting = asJsonObjectOrNull(pace.lighting);
  if (lighting) {
    assertOptionalVector3(lighting.position, 'payload.pace.lighting.position');
    assertOptionalPositiveNumber(lighting.energy, 'payload.pace.lighting.energy');
    assertOptionalPositiveNumber(lighting.size, 'payload.pace.lighting.size');
  }

  const event = asJsonObjectOrNull(pace.event);
  if (event && event.trigger_frame !== undefined && event.trigger_frame !== null) {
    const triggerFrame = event.trigger_frame;
    if (typeof triggerFrame !== 'number' || !Number.isInteger(triggerFrame) || triggerFrame < 1) {
      throw new ValidationError('payload.pace.event.trigger_frame must be an integer >= 1');
    }
  }
}

function asJsonObjectOrNull(value: JsonValue | undefined): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

function assertOptionalVector3(value: JsonValue | undefined, field: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    throw new ValidationError(`${field} must be an array of 3 finite numbers`);
  }
}

function assertOptionalPositiveNumber(value: JsonValue | undefined, field: string): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive number`);
  }
}

function normalizeSourceImageAssetUri(payload: Record<string, unknown>): string | null {
  const inputs = payload.inputs;
  if (inputs !== undefined && inputs !== null && inputs !== '') {
    const normalizedInputs = requireObject(inputs, 'payload.inputs');
    const image = normalizedInputs.image;
    if (image !== undefined && image !== null && image !== '') {
      const normalizedImage = requireObject(image, 'payload.inputs.image');
      return requireAssetUri(normalizedImage.assetUri, 'payload.inputs.image.assetUri');
    }
  }

  const legacyImageAssetUri = optionalString(payload.image);
  if (!legacyImageAssetUri) {
    return null;
  }
  return requireAssetUri(legacyImageAssetUri, 'payload.image');
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

function normalizeOptionalPrompt(value: unknown): string | null {
  const normalized = optionalString(value);
  return normalized || null;
}

function requireAssetUri(value: unknown, field: string): string {
  const normalized = requireString(value, field);
  if (!normalized.startsWith('assets://')) {
    throw new ValidationError(`${field} must start with assets://`);
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

function normalizeOptionalSection(value: JsonValue | undefined, field: string): JsonObject | null {
  if (value === undefined) {
    return null;
  }
  return requireJsonObject(value, field);
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

  if (isPlainObject(value)) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
