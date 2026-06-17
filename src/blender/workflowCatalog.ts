import { ValidationError } from '../infra/HttpError.js';
import type { BlenderWorkflowDefinition, BlenderWorkflowId } from './types.js';

// Documents the artifact contract the runner actually enforces. Keep in sync with
// REQUIRED_ARTIFACT_KINDS in tasks/blenderArtifacts.ts (kept as a literal here to avoid pulling the
// heavy runner/asset-store dependencies into the lightweight payload-validation path).
const ARTIFACT_KINDS: string[] = ['blend', 'model_glb', 'preview', 'summary', 'generated_script'];

const workflowCatalog: Record<BlenderWorkflowId, BlenderWorkflowDefinition> = {
  'blender-create-3d': {
    id: 'blender-create-3d',
    summary: 'Create a new Blender previs scene from a source image and pace document.',
    requiredFields: ['scene_id', 'shot_id', 'pace', 'inputs.image.assetUri'],
    requiresSourceImage: true,
    artifactKinds: ARTIFACT_KINDS,
  },
  'blender-update-3d': {
    id: 'blender-update-3d',
    summary: 'Update an existing Blender model using prompt-driven scene direction.',
    requiredFields: ['scene_id', 'shot_id', 'model_id', 'prompt'],
    requiresSourceImage: false,
    artifactKinds: ARTIFACT_KINDS,
  },
};

export function getSupportedBlenderWorkflows(): BlenderWorkflowDefinition[] {
  return Object.values(workflowCatalog).map((workflow) => ({
    ...workflow,
    requiredFields: [...workflow.requiredFields],
    artifactKinds: [...workflow.artifactKinds],
  }));
}

export function getBlenderWorkflowDefinition(workflowId: string): BlenderWorkflowDefinition {
  const normalized = String(workflowId || '').trim() as BlenderWorkflowId;
  const workflow = workflowCatalog[normalized];
  if (!workflow) {
    throw new ValidationError('payload.workflow is unsupported');
  }
  return {
    ...workflow,
    requiredFields: [...workflow.requiredFields],
    artifactKinds: [...workflow.artifactKinds],
  };
}
