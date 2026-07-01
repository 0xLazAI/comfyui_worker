import { ValidationError } from '../infra/HttpError.js';
import { normalizeProjectRoot } from '../render/payload.js';
import { getBlenderWorkflowDefinition, getBlenderWorkflowForTaskType, isBlenderTaskType } from './workflowCatalog.js';
import type {
  BlenderAgent,
  BlenderPayloadContext,
  BlenderPace,
  BlenderReviewItem,
  BlenderRunnerTarget,
  BlenderWorkflowId,
  HydratedBlenderTaskPayload,
  JsonObject,
  JsonValue,
  PaceDocument,
  PaceDocumentScene,
} from './types.js';

interface UnknownMap {
  [key: string]: unknown;
}

const DEFAULT_AGENT: BlenderAgent = 'codex';
const DEFAULT_RUNNER_TARGET: BlenderRunnerTarget = 'gpu';
const DEFAULT_PACE_SCHEMA_VERSION = 'pai-blender-pace-draft-2026-06-09';
// `claude` remains a valid type, but the adapter is not implemented yet (see agent.ts), so we reject
// it here at payload validation instead of letting it submit a task that throws at runtime.
const VALID_AGENTS = new Set<BlenderAgent>(['codex']);
const VALID_RUNNER_TARGETS = new Set<BlenderRunnerTarget>(['gpu']);

export function hydrateBlenderTaskPayload(
  payload: Record<string, unknown>,
  context: BlenderPayloadContext,
): HydratedBlenderTaskPayload {
  // task_type is authoritative for which Blender workflow runs (each workflow is its own
  // task_type). Fall back to the legacy `payload.workflow` field only when no blender
  // task_type is supplied (transition compatibility / direct unit tests).
  const workflow = context.taskType && isBlenderTaskType(context.taskType)
    ? getBlenderWorkflowForTaskType(context.taskType)
    : getBlenderWorkflowDefinition(requireString(payload.workflow, 'payload.workflow'));
  const projectRoot = normalizeProjectRoot(context.projectRoot);
  const agent = normalizeAgent(payload.agent);
  const runnerTarget = normalizeRunnerTarget(payload.runner_target);
  const sourceImageAssetUri = normalizeSourceImageAssetUri(payload);
  const baseGlbAssetUri = normalizeBaseGlbAssetUri(payload);

  // blender-pace-review runs a batch of (scene, base GLB) pairs. Each scene's PACE
  // document is fetched from the Pai Platform at execution time, so the payload only
  // carries the scene ids + their GLBs (paired by index).
  if (workflow.id === 'blender-pace-review') {
    const reviewBatch = normalizeReviewBatch(payload);
    const sceneId = reviewBatch[0].sceneId;

    return {
      workflow,
      sceneId,
      shotId: sceneId,
      modelId: null,
      prompt: normalizeOptionalPrompt(payload.prompt),
      pace: createDefaultPace(workflow.id, sceneId, sceneId),
      paceDocument: null,
      reviewBatch,
      agent,
      runnerTarget,
      inputs: {
        sourceImageAssetUri,
        baseGlbAssetUri,
      },
      taskId: context.taskId,
      projectId: context.projectId,
      projectRoot,
    };
  }

  // blender-pace-review is the only blender workflow this worker runs.
  throw new ValidationError(`unsupported blender workflow: ${workflow.id}`);
}

/**
 * Validates a PACE 0.2 document (mirrors GET /api/{project_id}/previz): a
 * non-empty `scenes[]`, each scene a `pace-0.2` scene_doc with a unique
 * `scene_id`. Everything else — per-scene `_schema_version`, `physical_layout`,
 * `shots`, `narrative_meta`, `semantics`, and the doc-level `display_names` — is
 * preserved verbatim so the build/review agents read the full scene_doc.
 */
export function normalizePaceDocument(value: unknown, field: string): PaceDocument {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${field} is required`);
  }
  const normalized = requireJsonObject(value, field);
  const scenesValue = normalized.scenes;
  if (!Array.isArray(scenesValue) || scenesValue.length === 0) {
    throw new ValidationError(`${field}.scenes must be a non-empty array`);
  }

  const seenSceneIds = new Set<string>();
  const scenes: PaceDocumentScene[] = scenesValue.map((entry, index) => {
    const scene = requireJsonObject(entry, `${field}.scenes[${index}]`);
    const sceneId = requireString(scene.sceneId, `${field}.scenes[${index}].sceneId`);
    if (seenSceneIds.has(sceneId)) {
      throw new ValidationError(`${field}.scenes[${index}].sceneId "${sceneId}" is duplicated; scene ids must be unique`);
    }
    seenSceneIds.add(sceneId);
    return { ...scene, sceneId };
  });

  return {
    ...normalized,
    scenes,
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
      type: 'pace-review',
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

// Max shots reviewed per task. Each shot runs a multi-minute in-process codex turn, so a
// large batch holds the queue worker for the whole run and risks the task timeout. Kept at
// 1 for now — submit one task per shot. Raise this number here when chunked/async handling lands.
const MAX_PACE_REVIEW_SHOTS = 1;

function normalizeReviewBatch(payload: Record<string, unknown>): BlenderReviewItem[] {
  const shots = normalizeStringArray(payload.shots, 'payload.shots');
  if (!shots.length) {
    throw new ValidationError('payload.shots must be a non-empty array');
  }
  if (shots.length > MAX_PACE_REVIEW_SHOTS) {
    throw new ValidationError(
      `payload.shots may contain at most ${MAX_PACE_REVIEW_SHOTS} shot(s) per task (got ${shots.length}); submit one task per shot`,
    );
  }
  const seen = new Set<string>();
  return shots.map((shotId, index) => {
    if (seen.has(shotId)) {
      throw new ValidationError(`payload.shots[${index}] "${shotId}" is duplicated`);
    }
    seen.add(shotId);
    return { shotId, sceneId: sceneIdFromShotId(shotId, `payload.shots[${index}]`) };
  });
}

/** `hs001_sh001` → `s001`: strip the `h` prefix from the leading shot-id segment. */
function sceneIdFromShotId(shotId: string, field: string): string {
  const scenePart = shotId.split('_')[0] || '';
  const sceneId = scenePart.replace(/^h/, '');
  if (!/^s\d+/.test(sceneId)) {
    throw new ValidationError(`${field} "${shotId}" is not a valid shot id (expected e.g. hs001_sh001)`);
  }
  return sceneId;
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return value.map((entry, index) => requireString(entry, `${field}[${index}]`));
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

function normalizeBaseGlbAssetUri(payload: Record<string, unknown>): string | null {
  const inputs = payload.inputs;
  if (inputs !== undefined && inputs !== null && inputs !== '') {
    const normalizedInputs = requireObject(inputs, 'payload.inputs');
    const baseGlb = normalizedInputs.base_glb;
    if (baseGlb !== undefined && baseGlb !== null && baseGlb !== '') {
      const normalizedBaseGlb = requireObject(baseGlb, 'payload.inputs.base_glb');
      return requireAssetUri(normalizedBaseGlb.assetUri, 'payload.inputs.base_glb.assetUri');
    }
  }

  const legacyBaseGlb = optionalString(payload.base_glb);
  if (!legacyBaseGlb) {
    return null;
  }
  return requireAssetUri(legacyBaseGlb, 'payload.base_glb');
}

function normalizeAgent(value: unknown): BlenderAgent {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_AGENT;
  }
  const normalized = requireString(value, 'payload.agent') as BlenderAgent;
  if (!VALID_AGENTS.has(normalized)) {
    throw new ValidationError('payload.agent must be one of: codex');
  }
  return normalized;
}

function normalizeRunnerTarget(value: unknown): BlenderRunnerTarget {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_RUNNER_TARGET;
  }
  const normalized = requireString(value, 'payload.runner_target') as BlenderRunnerTarget;
  if (!VALID_RUNNER_TARGETS.has(normalized)) {
    throw new ValidationError('payload.runner_target must be one of: gpu');
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
