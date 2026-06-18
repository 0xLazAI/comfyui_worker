import { TASK_RUNTIME_META_KEY } from '../taskDefinitions/types.js';
import type { StephenRenderStatus } from '../render/stephenRenderClient.js';

export interface StephenProviderRuntimeState {
  provider: 'stephen_render';
  jobId: string;
  statusUrl: string | null;
  promptId: string | null;
  workerName: string | null;
  workerUrl: string | null;
  workflow: string | null;
  lastStatus: string | null;
  submittedAt: string | null;
}

interface TaskRuntimeState {
  projectRoot?: string;
  provider?: StephenProviderRuntimeState;
  [key: string]: unknown;
}

export function getTaskRuntimeState(payload: Record<string, unknown>): TaskRuntimeState {
  const runtime = payload?.[TASK_RUNTIME_META_KEY];
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    return {};
  }
  return structuredClone(runtime as TaskRuntimeState);
}

export function getStephenProviderRuntimeState(
  payload: Record<string, unknown>,
): StephenProviderRuntimeState | null {
  const provider = asObject(getTaskRuntimeState(payload).provider);
  if (!provider) {
    return null;
  }

  const providerName = String(provider.provider || '').trim();
  const jobId = String(provider.jobId || '').trim();
  if (providerName !== 'stephen_render' || !jobId) {
    return null;
  }

  return {
    provider: 'stephen_render',
    jobId,
    statusUrl: normalizeOptionalString(provider.statusUrl),
    promptId: normalizeOptionalString(provider.promptId),
    workerName: normalizeOptionalString(provider.workerName),
    workerUrl: normalizeOptionalString(provider.workerUrl),
    workflow: normalizeOptionalString(provider.workflow),
    lastStatus: normalizeOptionalString(provider.lastStatus),
    submittedAt: normalizeOptionalString(provider.submittedAt),
  };
}

export function attachStephenProviderRuntimeState(
  payload: Record<string, unknown>,
  state: StephenProviderRuntimeState,
): Record<string, unknown> {
  const nextPayload = structuredClone(payload);
  const runtime = getTaskRuntimeState(nextPayload);
  runtime.provider = structuredClone(state);
  nextPayload[TASK_RUNTIME_META_KEY] = runtime;
  return nextPayload;
}

export function mergeStephenProviderRuntimeState(
  existing: StephenProviderRuntimeState | null,
  status: StephenRenderStatus,
  options: {
    submittedAt?: string | null;
  } = {},
): StephenProviderRuntimeState {
  const worker = asObject(status.worker);
  return {
    provider: 'stephen_render',
    jobId: String(status.job_id || existing?.jobId || '').trim(),
    statusUrl: normalizeOptionalString(status.status_url) || existing?.statusUrl || null,
    promptId: normalizeOptionalString(status.prompt_id) || existing?.promptId || null,
    workerName: normalizeOptionalString(worker?.name) || existing?.workerName || null,
    workerUrl: normalizeOptionalString(worker?.url) || existing?.workerUrl || null,
    workflow: normalizeOptionalString(status.workflow_requested || status.workflow) || existing?.workflow || null,
    lastStatus: normalizeOptionalString(status.status) || existing?.lastStatus || null,
    submittedAt: options.submittedAt ?? existing?.submittedAt ?? null,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}
