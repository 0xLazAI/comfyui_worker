import { STEPHEN_RENDER_PROJECT_ID } from '../infra/constants.js';
import type { NormalizedRenderPanelPayload } from './payload.js';
import type { NormalizedReplacePropPanelPayload } from './replacePropPayload.js';

export function buildRenderPanelStephenSubmitBody(
  payload: NormalizedRenderPanelPayload,
  sourceImageBase64: string,
): Record<string, unknown> {
  return {
    project: STEPHEN_RENDER_PROJECT_ID,
    workflow: payload.workflow.providerWorkflowId,
    backend: payload.workflow.backend,
    base_model: payload.workflow.baseModel,
    positive: payload.prompt.text,
    negative: payload.prompt.negativeText,
    seed: payload.seed,
    inpaint: {
      init_b64: sourceImageBase64,
      denoise: payload.extraParams.denoise,
      grow_mask: payload.extraParams.growMask,
    },
  };
}

export function buildReplacePropStephenSubmitBody(
  payload: NormalizedReplacePropPanelPayload,
  sourceImageBase64: string,
): Record<string, unknown> {
  return {
    project: STEPHEN_RENDER_PROJECT_ID,
    workflow: payload.workflow.providerWorkflowId,
    backend: payload.workflow.backend,
    base_model: payload.workflow.baseModel,
    positive: payload.replace.instruction,
    negative: payload.prompt.negativeText,
    inpaint_instruction: payload.replace.instruction,
    source_prop: payload.replace.sourceProp,
    guidance: payload.params.guidance,
    steps: payload.params.steps,
    cfg: payload.params.cfg,
    ground_confidence: payload.params.groundConfidence,
    ground_text_threshold: payload.params.groundTextThreshold,
    mask_mode: payload.params.maskMode,
    seed: payload.seed,
    inpaint: {
      init_b64: sourceImageBase64,
      denoise: payload.params.denoise,
      grow_mask: payload.params.growMask,
    },
  };
}
