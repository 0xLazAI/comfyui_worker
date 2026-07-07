import { LORA_TRAINER_POLL_INTERVAL_SECONDS } from '../infra/constants.js';
import { ValidationError } from '../infra/HttpError.js';
import { finalizeLoraTrainerJob, getLoraTrainerStatus, submitLoraTrainerJob } from '../train/loraTrainerClient.js';
import {
  attachLoraTrainerRuntimeState,
  getLoraTrainerRuntimeState,
  mergeLoraTrainerRuntimeState,
} from '../train/loraTrainerRuntime.js';
import {
  hydrateTrainStyleLoraPayload,
  TRAIN_STYLE_LORA_CONSUMER_KEY,
} from '../train/loraTrainPayload.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { TaskRejectedError } from '../render/errors.js';
import { enqueueTaskRecord } from './taskScheduler.js';
import { taskStore } from './taskStore.js';
import { buildTaskFailureDetail, normalizeWorkerName } from './taskExecutionShared.js';
import { isTerminalWorkerTaskStatus, utcNow, type WorkerTaskRecord } from './types.js';

export { TRAIN_STYLE_LORA_CONSUMER_KEY };

const TERMINAL_SUCCESS = new Set(['done', 'succeeded', 'success', 'completed']);
const TERMINAL_FAILURE = new Set(['failed', 'error', 'rejected', 'cancelled', 'canceled']);

export async function handleTrainStyleLoraExecute(
  envelope: QueueJobEnvelope<{ taskId: string }>,
  context: QueueHandlerContext,
): Promise<void> {
  const taskId = String(envelope.body?.taskId || '').trim();
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const record = await taskStore.get(taskId);
  if (!record) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (isTerminalWorkerTaskStatus(record.status)) {
    return;
  }

  const startedAt = utcNow();
  const workerName = normalizeWorkerName();

  if (record.status === 'cancel_requested') {
    await markCancelled(record, startedAt, workerName, context.attempts);
    return;
  }

  try {
    const payload = hydrateTrainStyleLoraPayload(structuredClone(record.requestPayload), {
      taskId,
      projectId: record.projectId,
    });
    const runtime = getLoraTrainerRuntimeState(record.requestPayload);

    if (!runtime) {
      await submitTrainingJob(record, payload, {
        attemptNo: context.attempts,
        startedAt,
        workerName,
      });
      return;
    }

    await reconcileTrainingJob(record, runtime.jobId, {
      attemptNo: context.attempts,
      startedAt,
      workerName,
    });
  } catch (error: unknown) {
    await markRejectedOrFailed(taskId, error, {
      attemptNo: context.attempts,
      startedAt,
      workerName,
    });
  }
}

async function submitTrainingJob(
  record: WorkerTaskRecord,
  payload: ReturnType<typeof hydrateTrainStyleLoraPayload>,
  context: {
    attemptNo: number;
    startedAt: string;
    workerName: string;
  },
): Promise<void> {
  await taskStore.save({
    ...record,
    status: 'running',
    progress: 0,
    eta: null,
    message: 'submitting lora trainer job',
    errorCode: null,
    queuePublishError: null,
    currentAttempt: context.attemptNo,
    startedAt: record.startedAt || context.startedAt,
    nextRunAt: null,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'started',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: 'train_style_lora submission started',
  });

  const submitted = await submitLoraTrainerJob(payload);
  const submittedAt = utcNow();
  const runtime = mergeLoraTrainerRuntimeState(null, submitted, { submittedAt });
  const requestPayloadWithRuntime = attachLoraTrainerRuntimeState(record.requestPayload, runtime);
  const delaySeconds = LORA_TRAINER_POLL_INTERVAL_SECONDS;

  const submittedRecord: WorkerTaskRecord = {
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: progressFromTrainerStatus(submitted.status || 'submitted', {}),
    eta: delaySeconds,
    message: `trainer ${submitted.status || 'submitted'}`,
    errorCode: null,
    queuePublishError: null,
    currentAttempt: context.attemptNo,
    startedAt: record.startedAt || context.startedAt,
    nextRunAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    workerName: context.workerName,
    updatedAt: utcNow(),
  };

  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'trainer_submitted',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: 'lora trainer job submitted',
    detailJson: {
      jobId: runtime.jobId,
      runDir: runtime.runDir,
      statusPath: runtime.statusPath,
      logPath: runtime.logPath,
      outputDir: runtime.outputDir,
      baseProfile: payload.baseProfile,
      mode: payload.mode,
      datasetUri: payload.dataset.uri,
    },
  });

  await enqueueTaskRecord(submittedRecord, {
    stage: 'followup',
    eventMessage: 'task re-enqueued for lora trainer polling',
    delaySeconds,
  });
}

async function reconcileTrainingJob(
  record: WorkerTaskRecord,
  jobId: string,
  context: {
    attemptNo: number;
    startedAt: string;
    workerName: string;
  },
): Promise<void> {
  await taskStore.save({
    ...record,
    status: 'running',
    progress: record.progress ?? 0,
    eta: null,
    message: 'checking lora trainer status',
    errorCode: null,
    currentAttempt: context.attemptNo,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });

  const status = await getLoraTrainerStatus(jobId);
  const normalizedStatus = String(status.status || '').trim().toLowerCase();
  const existingRuntime = getLoraTrainerRuntimeState(record.requestPayload);
  const runtime = mergeLoraTrainerRuntimeState(existingRuntime, status);
  const requestPayloadWithRuntime = attachLoraTrainerRuntimeState(record.requestPayload, runtime);

  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'trainer_polled',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: `lora trainer status: ${normalizedStatus}`,
    detailJson: {
      jobId,
      status: normalizedStatus,
      phase: status.phase || null,
      currentStep: status.currentStep ?? null,
      totalSteps: status.totalSteps ?? null,
      progress: status.progress ?? null,
      message: status.message || null,
      logPath: status.logPath || runtime.logPath,
    },
  });

  if (TERMINAL_FAILURE.has(normalizedStatus)) {
    await markTrainerFailed(record, status, requestPayloadWithRuntime, context);
    return;
  }

  if (TERMINAL_SUCCESS.has(normalizedStatus)) {
    await finalizeTrainingJob(record, jobId, requestPayloadWithRuntime, status, context);
    return;
  }

  const delaySeconds = LORA_TRAINER_POLL_INTERVAL_SECONDS;
  const inProgressRecord: WorkerTaskRecord = {
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: progressFromTrainerStatus(normalizedStatus, status),
    eta: delaySeconds,
    message: status.message || `trainer ${normalizedStatus || 'running'}`,
    errorCode: null,
    currentAttempt: context.attemptNo,
    nextRunAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    workerName: context.workerName,
    updatedAt: utcNow(),
  };
  await enqueueTaskRecord(inProgressRecord, {
    stage: 'followup',
    eventMessage: 'task re-enqueued for lora trainer polling',
    delaySeconds,
  });
}

async function finalizeTrainingJob(
  record: WorkerTaskRecord,
  jobId: string,
  requestPayloadWithRuntime: Record<string, unknown>,
  status: Record<string, unknown>,
  context: {
    attemptNo: number;
    startedAt: string;
    workerName: string;
  },
): Promise<void> {
  await taskStore.save({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: 95,
    eta: null,
    message: 'finalizing lora trainer job',
    errorCode: null,
    currentAttempt: context.attemptNo,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });

  const finalized = await finalizeLoraTrainerJob(jobId);
  const result = {
    trainerJobId: jobId,
    publishMode: 'local',
    lora: finalized.lora || {},
    trainer: {
      status: status.status || 'done',
      phase: status.phase || null,
    },
  };

  await taskStore.save({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'succeeded',
    progress: 100,
    eta: 0,
    message: 'done',
    errorCode: null,
    resultPayload: result,
    currentAttempt: context.attemptNo,
    nextRunAt: null,
    finishedAt: utcNow(),
    workerName: context.workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'succeeded',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: 'train_style_lora execution succeeded',
    detailJson: {
      jobId,
      lora: finalized.lora || {},
    },
  });
  await taskStore.saveAttempt({
    taskId: record.taskId,
    attemptNo: context.attemptNo,
    status: 'succeeded',
    workerName: context.workerName,
    startedAt: context.startedAt,
    finishedAt: utcNow(),
    durationMs: Date.now() - new Date(context.startedAt).getTime(),
    resultPayload: result,
  });
}

async function markTrainerFailed(
  record: WorkerTaskRecord,
  status: {
    status: string;
    phase?: string | null;
    message?: string | null;
    error?: string | null;
    logPath?: string | null;
    lastLogLines?: string[] | null;
  },
  requestPayloadWithRuntime: Record<string, unknown>,
  context: {
    attemptNo: number;
    startedAt: string;
    workerName: string;
  },
): Promise<void> {
  const finishedAt = utcNow();
  const message = status.error || status.message || 'lora trainer failed';
  const detail = {
    errorName: 'LoraTrainerError',
    code: 'trainer_failed',
    message,
    phase: status.phase || null,
    trainerStatus: status.status,
    logPath: status.logPath || null,
    lastLogLines: status.lastLogLines || [],
  };

  await taskStore.save({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'failed',
    progress: null,
    eta: null,
    message,
    errorCode: 'trainer_failed',
    resultPayload: detail,
    currentAttempt: context.attemptNo,
    nextRunAt: null,
    finishedAt,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'failed',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: 'train_style_lora execution failed',
    detailJson: detail,
  });
  await taskStore.saveAttempt({
    taskId: record.taskId,
    attemptNo: context.attemptNo,
    status: 'failed',
    workerName: context.workerName,
    startedAt: context.startedAt,
    finishedAt,
    durationMs: Date.now() - new Date(context.startedAt).getTime(),
    resultPayload: detail,
    errorMessage: message,
  });
}

async function markRejectedOrFailed(
  taskId: string,
  error: unknown,
  context: {
    attemptNo: number;
    startedAt: string;
    workerName: string;
  },
): Promise<void> {
  const fresh = await taskStore.get(taskId);
  if (!fresh || isTerminalWorkerTaskStatus(fresh.status)) {
    return;
  }

  const isRejected = error instanceof TaskRejectedError || error instanceof ValidationError;
  const finishedAt = utcNow();
  const failureDetail = error instanceof TaskRejectedError
    ? buildTaskFailureDetail(error)
    : error instanceof ValidationError
      ? {
          errorName: 'ValidationError',
          code: 'invalid_lora_train_payload',
          message: error.message,
        }
      : {
          ...buildTaskFailureDetail(error),
          code: 'trainer_request_failed',
        };
  const status = isRejected ? 'rejected' : 'failed';
  const message = error instanceof Error ? error.message : String(error);

  await taskStore.save({
    ...fresh,
    status,
    progress: null,
    eta: null,
    message,
    errorCode: isRejected ? String(failureDetail.code || 'task_rejected') : 'trainer_request_failed',
    resultPayload: failureDetail,
    currentAttempt: context.attemptNo,
    nextRunAt: null,
    finishedAt,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId,
    eventType: status,
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: isRejected ? 'train_style_lora request rejected' : 'train_style_lora request failed',
    detailJson: {
      failure: failureDetail,
    },
  });
  await taskStore.saveAttempt({
    taskId,
    attemptNo: context.attemptNo,
    status,
    workerName: context.workerName,
    startedAt: context.startedAt,
    finishedAt,
    durationMs: Date.now() - new Date(context.startedAt).getTime(),
    resultPayload: failureDetail,
    errorMessage: message,
  });
}

async function markCancelled(
  record: WorkerTaskRecord,
  startedAt: string,
  workerName: string,
  attemptNo: number,
): Promise<void> {
  await taskStore.save({
    ...record,
    status: 'cancelled',
    finishedAt: startedAt,
    workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'cancelled',
    attemptNo,
    workerName,
    message: 'task cancelled before execution',
  });
}

function progressFromTrainerStatus(
  status: string,
  detail: {
    progress?: number | null;
    currentStep?: number | null;
    totalSteps?: number | null;
  },
): number {
  if (typeof detail.progress === 'number' && Number.isFinite(detail.progress)) {
    return Math.max(0, Math.min(95, detail.progress <= 1 ? detail.progress * 95 : detail.progress));
  }
  if (detail.currentStep && detail.totalSteps && detail.totalSteps > 0) {
    return Math.max(20, Math.min(95, 20 + (detail.currentStep / detail.totalSteps) * 70));
  }

  switch (status) {
    case 'submitted':
    case 'queued':
      return 10;
    case 'syncing_dataset':
    case 'validating_dataset':
      return 15;
    case 'cache_latents':
    case 'caching_latents':
      return 25;
    case 'cache_text_encoder':
    case 'caching_text_encoder':
      return 35;
    case 'training':
    case 'running':
      return 45;
    case 'finalizing':
      return 90;
    default:
      return 20;
  }
}
