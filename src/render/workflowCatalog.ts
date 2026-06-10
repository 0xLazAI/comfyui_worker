import { ValidationError } from '../infra/HttpError.js';

export interface WorkflowExtraParamDefinition {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  minimum?: number;
  maximum?: number;
}

export interface WorkflowDefinition {
  id: string;
  summary: string;
  provider: 'stephen_render';
  providerWorkflowId: string;
  backend: string;
  baseModel: string;
  requiresSourceImage: boolean;
  requiresPromptText: boolean;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  allowedExtraParams: Record<string, WorkflowExtraParamDefinition>;
}

export const RENDER_PANEL_TASK_TYPE = 'render_panel';

const workflowCatalog: Record<string, WorkflowDefinition> = {
  bg_retouch_preserve_subject_v1: {
    id: 'bg_retouch_preserve_subject_v1',
    summary: '保留原图人物，只重绘背景细节的精修工作流。',
    provider: 'stephen_render',
    providerWorkflowId: 'flux_bg_inpaint_soft_edges',
    backend: 'flux_comfyui',
    baseModel: 'flux2_dev_fp8mixed.safetensors',
    requiresSourceImage: true,
    requiresPromptText: true,
    inputSchemaVersion: '2026-06-01',
    outputSchemaVersion: '2026-06-01',
    allowedExtraParams: {
      denoise: {
        type: 'number',
        description: '背景重绘强度。',
        required: true,
        minimum: 0,
        maximum: 1,
        defaultValue: 0.76,
      },
      growMask: {
        type: 'integer',
        description: '自动主体 mask 外扩像素。',
        required: true,
        minimum: 0,
        maximum: 128,
        defaultValue: 5,
      },
    },
  },
};

export function getSupportedWorkflows(): WorkflowDefinition[] {
  return Object.values(workflowCatalog).map((workflow) => ({ ...workflow }));
}

export function getWorkflowDefinition(workflowId: string): WorkflowDefinition {
  const normalized = String(workflowId || '').trim();
  const definition = workflowCatalog[normalized];
  if (!definition) {
    throw new ValidationError(`payload.workflow is not supported: ${normalized || '(empty)'}`);
  }
  return definition;
}
