import { TASK_RUNTIME_META_KEY } from '../taskDefinitions/types.js';
import { getTaskRuntimeState } from '../tasks/taskRuntime.js';

export interface LoraTrainerRuntimeState {
  provider: 'lora_trainer';
  jobId: string;
  runDir: string | null;
  statusPath: string | null;
  logPath: string | null;
  outputDir: string | null;
  lastStatus: string | null;
  phase: string | null;
  submittedAt: string | null;
}

export function getLoraTrainerRuntimeState(
  payload: Record<string, unknown>,
): LoraTrainerRuntimeState | null {
  const raw = getTaskRuntimeState(payload).loraTrainer;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const state = raw as Record<string, unknown>;
  const provider = String(state.provider || '').trim();
  const jobId = String(state.jobId || '').trim();
  if (provider !== 'lora_trainer' || !jobId) {
    return null;
  }
  return {
    provider: 'lora_trainer',
    jobId,
    runDir: optionalString(state.runDir),
    statusPath: optionalString(state.statusPath),
    logPath: optionalString(state.logPath),
    outputDir: optionalString(state.outputDir),
    lastStatus: optionalString(state.lastStatus),
    phase: optionalString(state.phase),
    submittedAt: optionalString(state.submittedAt),
  };
}

export function attachLoraTrainerRuntimeState(
  payload: Record<string, unknown>,
  state: LoraTrainerRuntimeState,
): Record<string, unknown> {
  const nextPayload = structuredClone(payload);
  const runtime = getTaskRuntimeState(nextPayload);
  runtime.loraTrainer = structuredClone(state);
  nextPayload[TASK_RUNTIME_META_KEY] = runtime;
  return nextPayload;
}

export function mergeLoraTrainerRuntimeState(
  existing: LoraTrainerRuntimeState | null,
  status: {
    jobId?: string | null;
    job_id?: string | null;
    runDir?: string | null;
    run_dir?: string | null;
    statusPath?: string | null;
    status_path?: string | null;
    logPath?: string | null;
    log_path?: string | null;
    outputDir?: string | null;
    output_dir?: string | null;
    status?: string | null;
    phase?: string | null;
  },
  options: {
    submittedAt?: string | null;
  } = {},
): LoraTrainerRuntimeState {
  return {
    provider: 'lora_trainer',
    jobId: optionalString(status.jobId) || optionalString(status.job_id) || existing?.jobId || '',
    runDir: optionalString(status.runDir) || optionalString(status.run_dir) || existing?.runDir || null,
    statusPath: optionalString(status.statusPath) || optionalString(status.status_path) || existing?.statusPath || null,
    logPath: optionalString(status.logPath) || optionalString(status.log_path) || existing?.logPath || null,
    outputDir: optionalString(status.outputDir) || optionalString(status.output_dir) || existing?.outputDir || null,
    lastStatus: optionalString(status.status) || existing?.lastStatus || null,
    phase: optionalString(status.phase) || existing?.phase || null,
    submittedAt: options.submittedAt ?? existing?.submittedAt ?? null,
  };
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}
