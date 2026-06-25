import os from 'os';
import { PLATFORM_API_ENABLED, WORKER_NAME } from '../infra/constants.js';
import { TaskRejectedError } from '../render/errors.js';
import {
  loadStoryboardProjectContext,
  type RenderPanelProjectContext,
  type StoryboardPayloadBase,
} from '../render/storyboardOutputs.js';
import { taskStore } from './taskStore.js';
import { utcNow } from './types.js';

export function computeRetryDelaySeconds(backoffSeconds: number[], attemptNo: number): number {
  if (!backoffSeconds.length) {
    return 0;
  }
  const index = Math.max(0, attemptNo - 1);
  return backoffSeconds[index] ?? backoffSeconds[backoffSeconds.length - 1] ?? 0;
}

export async function expectTask(taskId: string) {
  const record = await taskStore.get(taskId);
  if (!record) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return record;
}

export function progressForProviderStatus(status: string): number {
  switch (status) {
    case 'submitted':
      return 20;
    case 'queued':
      return 25;
    case 'running':
      return 45;
    case 'staging':
    case 'unknown':
      return 30;
    case 'done':
      return 65;
    default:
      return 30;
  }
}

export function isProviderStatusPending(status: string): boolean {
  return (
    status === 'submitted'
    || status === 'queued'
    || status === 'running'
    || status === 'staging'
    || status === 'unknown'
    || status.startsWith('extracting_')
  );
}

export function normalizeWorkerName(): string {
  const normalized = String(WORKER_NAME || '').trim();
  return normalized || `${os.hostname()}:${process.pid}`;
}

export function buildTaskFailureDetail(error: unknown): Record<string, unknown> {
  if (error instanceof TaskRejectedError) {
    return {
      errorName: error.name,
      code: error.code,
      message: error.message,
    };
  }

  return {
    errorName: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function extractProjectRoot(requestPayload: Record<string, unknown>): string {
  const meta = requestPayload?._taskRuntime;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const projectRoot = String((meta as Record<string, unknown>).projectRoot || '').trim();
    if (projectRoot) {
      return projectRoot;
    }
  }

  const legacyProjectRoot = String(requestPayload.projectRoot || '').trim();
  if (legacyProjectRoot) {
    return legacyProjectRoot;
  }

  if (PLATFORM_API_ENABLED) {
    return '';
  }

  throw new Error('request payload is missing _taskRuntime.projectRoot');
}

export async function loadStoryboardProjectContextOrReject(
  payload: StoryboardPayloadBase,
): Promise<RenderPanelProjectContext> {
  try {
    return await loadStoryboardProjectContext(payload);
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.startsWith('Project manifest file is missing:')) {
        throw new TaskRejectedError(error.message, 'project_manifest_missing');
      }
      if (error.message.startsWith('Shot manifest file is missing:')) {
        throw new TaskRejectedError(error.message, 'shot_manifest_missing');
      }
      if (error.message.startsWith('Panel file is missing:')) {
        throw new TaskRejectedError(error.message, 'panel_file_missing');
      }
      if (error.message.startsWith('Project manifest project mismatch:')) {
        throw new TaskRejectedError(error.message, 'project_manifest_mismatch');
      }
      if (error.message.startsWith('Shot storyboard directory is missing:')) {
        throw new TaskRejectedError(error.message, 'storyboard_target_missing');
      }
    }
    throw error;
  }
}

export async function markTaskRunning(taskId: string, fields: {
  progress: number | null;
  message: string;
  attemptNo: number;
  workerName: string;
}): Promise<void> {
  await taskStore.save({
    ...(await expectTask(taskId)),
    status: 'running',
    progress: fields.progress,
    eta: null,
    message: fields.message,
    errorCode: null,
    currentAttempt: fields.attemptNo,
    workerName: fields.workerName,
    updatedAt: utcNow(),
  });
}
