export type BlenderWorkflowId =
  | 'blender-create-3d'
  | 'blender-update-3d'
  | 'blender-pace-3d'
  | 'blender-pace-review';

export type BlenderAgent = 'codex' | 'claude';

// Local execution was removed; all blender jobs run on the online GPU runner.
export type BlenderRunnerTarget = 'gpu';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface BlenderPaceScene extends JsonObject {
  scene_id: string;
  shot_id: string;
}

export interface BlenderPace extends JsonObject {
  schema_version: string;
  scene: BlenderPaceScene;
}

// ---------------------------------------------------------------------------
// PACE 0.2 document — the multi-scene director-intent format consumed by
// blender-pace-3d (build) and blender-pace-review (audit/fix). Fields are kept
// optional and loosely typed (extends JsonObject) so unknown PACE keys survive
// the round-trip; the build/review agents read whatever is present.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reference types describing the real PACE 0.2 shapes (mirrors the previz
// scene_doc / GET /api/{project_id}/previz payload). The build/review agents
// read these out of `physical_layout` (spatial ground truth) and `shots[]`
// (per-shot camera motion). These are standalone interfaces (NOT extending
// JsonObject) so they can carry optional fields; the document/scene wrappers
// below stay loose JsonObjects so the entire scene_doc rides through verbatim.
// ---------------------------------------------------------------------------

/** Ground-plane coordinate `[x, y]` in metres (height carried separately in `z`). */
export type PaceWorldXY = [number, number];

/** Bounding box `[width_x, depth_y, height_z]` in metres. */
export type PaceBBox = [number, number, number];

/**
 * A placed entity in `physical_layout.subjects[]` / `physical_layout.props[]`.
 * `ref` is `id@version` (the `@` is the asset version, not age_state).
 * `facing_deg`: 0 = East(+X), 90 = North(+Y), CCW (per the scene `_note`).
 */
export interface PacePlacedEntity {
  ref: string;
  world_xy: PaceWorldXY;
  z: number;
  facing_deg: number;
  scale?: number;
  bbox?: PaceBBox;
}

/** A named look-at target referenced by `camera_setups[].looking_at`. */
export interface PaceFocusPoint {
  id: string;
  world_xy: PaceWorldXY;
  z: number;
}

/**
 * A camera placement keyed by `shot_id`. `looking_at` references a
 * `focus_points[].id`; `lens_mm` is the focal length. The camera's MOTION is
 * NOT here — it lives in `shots[].camera.trajectory`, joined by `shot_id`.
 */
export interface PaceCameraSetup {
  shot_id: string;
  world_xy: PaceWorldXY;
  z: number;
  looking_at: string;
  lens_mm: number;
}

export interface PacePhysicalLayout {
  frame_of_reference?: string;
  units?: string;
  up_axis?: string;
  subjects: PacePlacedEntity[];
  props?: PacePlacedEntity[];
  focus_points?: PaceFocusPoint[];
  camera_setups?: PaceCameraSetup[];
}

/** Camera-motion verbs found under `shots[].camera.trajectory`. */
export type PaceMovement3d = 'push_in' | 'pull_out' | 'tracking';
export type PaceMovement2d = 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down';

export interface PaceShotTrajectory {
  static?: boolean;
  movement_3d?: PaceMovement3d[];
  movement_2d?: PaceMovement2d[];
  easing?: string;
  gear?: string;
}

// PACE document/scene wrappers stay loose: the full scene_doc (narrative_meta,
// shot_defaults, shots, semantics, display_names, …) rides through unchanged and
// the agents read it as JSON. Only the identifiers below are typed/validated.
export interface PaceDocumentScene extends JsonObject {
  sceneId: string;
}

export interface PaceDocument extends JsonObject {
  scenes: PaceDocumentScene[];
}

export interface BlenderWorkflowDefinition {
  id: BlenderWorkflowId;
  summary: string;
  requiredFields: string[];
  requiresSourceImage: boolean;
  artifactKinds: string[];
}

export interface BlenderPayloadContext {
  taskId: string;
  // Authoritative selector for the Blender workflow (each workflow is its own task_type).
  // Optional only as a transition fallback to the legacy `payload.workflow` field.
  taskType?: string;
  projectId: string;
  projectRoot: string;
}

/**
 * One shot to audit/fix in a blender-pace-review batch. The shot's PACE and its
 * `shot_glb` artifact are both resolved from the Pai Platform at execution time;
 * `sceneId` is derived from the shot id (`hs001_sh001` → `s001`).
 */
export interface BlenderReviewItem {
  shotId: string;
  sceneId: string;
}

export interface HydratedBlenderTaskPayload {
  workflow: BlenderWorkflowDefinition;
  sceneId: string;
  shotId: string;
  modelId: string | null;
  prompt: string | null;
  pace: BlenderPace;
  paceDocument: PaceDocument | null; // non-null for blender-pace-3d
  // Batch of (scene, GLB) pairs for blender-pace-review. Each scene's PACE document is
  // fetched from the Pai Platform at execution time, not carried in the payload.
  reviewBatch: BlenderReviewItem[] | null; // non-null for blender-pace-review
  agent: BlenderAgent;
  runnerTarget: BlenderRunnerTarget;
  inputs: {
    sourceImageAssetUri: string | null;
    baseGlbAssetUri: string | null;
  };
  taskId: string;
  projectId: string;
  projectRoot: string;
}
