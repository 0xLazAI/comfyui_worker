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
export const REPLACE_PROP_PANEL_TASK_TYPE = 'replace_prop_panel';

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
  prop_replace_general_flux2_v1: {
    id: 'prop_replace_general_flux2_v1',
    summary: '定位并替换单个道具，保留周围人物和原始画风的一般物品替换工作流。',
    provider: 'stephen_render',
    providerWorkflowId: 'prop_replace_general_flux2',
    backend: 'flux_comfyui',
    baseModel: 'flux2_dev_fp8mixed.safetensors',
    requiresSourceImage: true,
    requiresPromptText: false,
    inputSchemaVersion: '2026-06-25',
    outputSchemaVersion: '2026-06-25',
    allowedExtraParams: {
      denoise: {
        type: 'number',
        description: '局部重绘强度。',
        required: true,
        minimum: 0,
        maximum: 1,
        defaultValue: 0.56,
      },
      growMask: {
        type: 'integer',
        description: '替换区域 mask 外扩像素。',
        required: true,
        minimum: 0,
        maximum: 128,
        defaultValue: 6,
      },
      guidance: {
        type: 'number',
        description: 'Flux guidance 参数。',
        required: true,
        minimum: 0,
        defaultValue: 3.4,
      },
      steps: {
        type: 'integer',
        description: '采样步数。',
        required: true,
        minimum: 1,
        maximum: 128,
        defaultValue: 24,
      },
      cfg: {
        type: 'number',
        description: '采样 CFG 参数。',
        required: true,
        minimum: 0,
        defaultValue: 2.0,
      },
      groundConfidence: {
        type: 'number',
        description: 'Grounding 检测 confidence threshold。',
        required: true,
        minimum: 0,
        maximum: 1,
        defaultValue: 0.05,
      },
      groundTextThreshold: {
        type: 'number',
        description: 'Grounding 检测 text threshold。',
        required: true,
        minimum: 0,
        maximum: 1,
        defaultValue: 0.10,
      },
      maskMode: {
        type: 'string',
        description: '自动 mask 模式：auto 自动判断是否使用长条 corridor，precise 强制使用 SAM2 精确 mask。',
        required: false,
        defaultValue: 'auto',
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
