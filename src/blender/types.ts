export type BlenderWorkflowId = 'blender-create-3d' | 'blender-update-3d';

export type BlenderAgent = 'codex' | 'claude';

export type BlenderRunnerTarget = 'local' | 'gpu';

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

export interface BlenderWorkflowDefinition {
  id: BlenderWorkflowId;
  summary: string;
  requiredFields: string[];
  requiresSourceImage: boolean;
  artifactKinds: string[];
}

export interface BlenderPayloadContext {
  taskId: string;
  projectId: string;
  projectRoot: string;
}

export interface HydratedBlenderTaskPayload {
  workflow: BlenderWorkflowDefinition;
  sceneId: string;
  shotId: string;
  modelId: string | null;
  prompt: string | null;
  pace: BlenderPace;
  agent: BlenderAgent;
  runnerTarget: BlenderRunnerTarget;
  inputs: {
    sourceImageAssetUri: string | null;
  };
  taskId: string;
  projectId: string;
  projectRoot: string;
}
