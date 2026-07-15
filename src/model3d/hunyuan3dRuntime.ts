import { TASK_RUNTIME_META_KEY } from '../taskDefinitions/types.js';
import { getTaskRuntimeState } from '../tasks/taskRuntime.js';

export interface Hunyuan3dRuntimeState {
  provider: 'hunyuan3d_modeling';
  jobId: string;
  statusUrl: string | null;
  outputUrl: string | null;
  lastStatus: string | null;
  submittedAt: string | null;
}

export function getHunyuan3dRuntimeState(
  payload: Record<string, unknown>,
): Hunyuan3dRuntimeState | null {
  const raw = getTaskRuntimeState(payload).hunyuan3dModeling;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const state = raw as Record<string, unknown>;
  const provider = String(state.provider || '').trim();
  const jobId = String(state.jobId || '').trim();
  if (provider !== 'hunyuan3d_modeling' || !jobId) {
    return null;
  }
  return {
    provider: 'hunyuan3d_modeling',
    jobId,
    statusUrl: optionalString(state.statusUrl),
    outputUrl: optionalString(state.outputUrl),
    lastStatus: optionalString(state.lastStatus),
    submittedAt: optionalString(state.submittedAt),
  };
}

export function attachHunyuan3dRuntimeState(
  payload: Record<string, unknown>,
  state: Hunyuan3dRuntimeState,
): Record<string, unknown> {
  const nextPayload = structuredClone(payload);
  const runtime = getTaskRuntimeState(nextPayload);
  runtime.hunyuan3dModeling = structuredClone(state);
  nextPayload[TASK_RUNTIME_META_KEY] = runtime;
  return nextPayload;
}

export function mergeHunyuan3dRuntimeState(
  existing: Hunyuan3dRuntimeState | null,
  status: {
    jobId?: string | null;
    statusUrl?: string | null;
    outputUrl?: string | null;
    status?: string | null;
  },
  options: {
    submittedAt?: string | null;
  } = {},
): Hunyuan3dRuntimeState {
  return {
    provider: 'hunyuan3d_modeling',
    jobId: optionalString(status.jobId) || existing?.jobId || '',
    statusUrl: optionalString(status.statusUrl) || existing?.statusUrl || null,
    outputUrl: optionalString(status.outputUrl) || existing?.outputUrl || null,
    lastStatus: optionalString(status.status) || existing?.lastStatus || null,
    submittedAt: options.submittedAt ?? existing?.submittedAt ?? null,
  };
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}
