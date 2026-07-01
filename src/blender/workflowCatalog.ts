import { ValidationError } from '../infra/HttpError.js';
import type { BlenderWorkflowDefinition, BlenderWorkflowId } from './types.js';

// Documents the artifact contract the runner actually enforces. Keep in sync with
// REQUIRED_ARTIFACT_KINDS in tasks/blenderArtifacts.ts (kept as a literal here to avoid pulling the
// heavy runner/asset-store dependencies into the lightweight payload-validation path).
const ARTIFACT_KINDS: string[] = ['blend', 'model_glb', 'preview', 'summary', 'generated_script'];

// Only blender-pace-review is supported on the blender side of this worker. The
// catalog is intentionally a single entry (Partial keeps the BlenderWorkflowId
// union wide for the shared agent module without forcing the other ids here).
const workflowCatalog: Partial<Record<BlenderWorkflowId, BlenderWorkflowDefinition>> = {
  'blender-pace-review': {
    id: 'blender-pace-review',
    summary:
      'Batch-audit GLBs against PACE: for each (scene, base GLB) pair, fetch the scene PACE from the platform, fix missing/incorrect elements (placement, cameras, focal length, trajectory animations), and emit a corrected GLB plus a Markdown review report per scene.',
    // scenes[] + glbs[] paired by index; each scene's PACE is fetched at execution time.
    requiredFields: ['scenes', 'glbs'],
    requiresSourceImage: false,
    artifactKinds: ['model_glb', 'review_report', 'generated_script'],
  },
};

// Platform-facing task_type ↔ internal workflow id. The dispatcher selects a Blender
// workflow by submitting one of these task_types (no separate `workflow` payload field);
// task_type is authoritative. task_types use snake_case to match render_panel /
// replace_prop_panel; the internal workflow.id stays kebab-case.
const TASK_TYPE_TO_WORKFLOW_ID: Record<string, BlenderWorkflowId> = {
  blender_pace_review: 'blender-pace-review',
};

export const BLENDER_TASK_TYPES: string[] = Object.keys(TASK_TYPE_TO_WORKFLOW_ID);

export function isBlenderTaskType(taskType: string): boolean {
  return Object.prototype.hasOwnProperty.call(TASK_TYPE_TO_WORKFLOW_ID, String(taskType || '').trim());
}

export function getBlenderWorkflowForTaskType(taskType: string): BlenderWorkflowDefinition {
  const workflowId = TASK_TYPE_TO_WORKFLOW_ID[String(taskType || '').trim()];
  if (!workflowId) {
    throw new ValidationError(`unsupported blender task_type: ${taskType || '(empty)'}`);
  }
  return getBlenderWorkflowDefinition(workflowId);
}

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
