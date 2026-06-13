import {
  TASK_BACKOFF_SECONDS,
  TASK_JOB_NAME,
  TASK_MAX_ATTEMPTS,
  TASK_QUEUE_NAME,
  TASK_TIMEOUT_SECONDS,
} from '../infra/constants.js';
import { ValidationError } from '../infra/HttpError.js';
import { currentRequestId } from '../infra/logger.js';
import { createQueueJobEnvelope } from '../queue/types.js';
import { uploadSourceImageAsset } from '../render/assetStore.js';
import { normalizeProjectRoot } from '../render/payload.js';
import {
  attachTaskDefinitionBinding,
  normalizePayloadWithDefinition,
} from '../taskDefinitions/definitionSchema.js';
import { taskTypeDefinitionStore } from '../taskDefinitions/taskTypeDefinitionStore.js';
import { TASK_RUNTIME_META_KEY } from '../taskDefinitions/types.js';
import { taskStore } from './taskStore.js';
import { supportsConsumerKey } from './taskExecution.js';
import { getTaskQueueDriver } from './taskQueue.js';
import type {
  PublicTaskResponse,
  SubmitTaskInput,
  TaskEventResponse,
  TaskObservationResponse,
  WorkerTaskRecord,
} from './types.js';
import {
  mapWorkerTaskStatusToPublicStatus,
  toPublicTaskResponse,
  toTaskEventResponse,
  toTaskObservationResponse,
  utcNow,
} from './types.js';

export async function submitTask(input: SubmitTaskInput): Promise<{
  accepted: boolean;
  task_id: string;
  status: string;
  status_url: string;
}> {
  const existing = await taskStore.get(input.taskId);
  if (existing) {
    return {
      accepted: true,
      task_id: existing.taskId,
      status: mapWorkerTaskStatusToPublicStatus(existing.status),
      status_url: `/tasks/${existing.taskId}`,
    };
  }

  const definition = await taskTypeDefinitionStore.getEnabledByTaskType(input.taskType);
  if (!definition) {
    throw new ValidationError(`unsupported task_type: ${input.taskType}`);
  }

  const consumerKey = definition.definitionJson.consumer_key;
  if (!supportsConsumerKey(consumerKey)) {
    throw new ValidationError(`unsupported consumer_key for task_type ${input.taskType}: ${consumerKey}`);
  }

  const normalizedProjectRoot = normalizeProjectRoot(input.projectRoot);
  const payloadWithSourceImage = await attachUploadedSourceImage(input.projectId, input.payload, input.sourceImageUpload);
  const payload = attachRuntimeMetadata(
    attachTaskDefinitionBinding(
      normalizePayloadWithDefinition(structuredClone(payloadWithSourceImage), definition.definitionJson),
      {
        definitionId: definition.id,
        version: definition.version,
        consumerKey,
        taskType: definition.taskType,
      },
    ),
    normalizedProjectRoot,
  );

  const now = utcNow();
  const record: WorkerTaskRecord = {
    taskId: input.taskId,
    taskType: input.taskType,
    projectId: input.projectId,
    requestPayload: payload,
    status: 'accepted',
    queuePublishStatus: 'pending',
    queuePublishedAt: null,
    queuePublishError: null,
    progress: 0,
    eta: null,
    message: 'accepted',
    errorCode: null,
    resultPayload: null,
    createdAt: now,
    updatedAt: now,
    currentAttempt: 0,
    maxAttempts: definition.definitionJson.execution?.max_attempts ?? TASK_MAX_ATTEMPTS,
    backoffSeconds: definition.definitionJson.execution?.backoff_seconds
      ? [...definition.definitionJson.execution.backoff_seconds]
      : [...TASK_BACKOFF_SECONDS],
    timeoutSeconds: definition.definitionJson.execution?.timeout_seconds ?? TASK_TIMEOUT_SECONDS,
    requestId: input.requestId ?? currentRequestId() ?? null,
    dedupeKey: input.dedupeKey ?? null,
    nextRunAt: null,
    startedAt: null,
    finishedAt: null,
    workerName: null,
  };

  const created = await taskStore.create(record);
  if (!created) {
    const concurrent = await taskStore.get(input.taskId);
    return {
      accepted: true,
      task_id: concurrent?.taskId || input.taskId,
      status: concurrent ? mapWorkerTaskStatusToPublicStatus(concurrent.status) : 'queued',
      status_url: `/tasks/${input.taskId}`,
    };
  }

  await publishTaskToQueue(record, {
    stage: 'enqueue',
    eventMessage: 'task enqueued',
    failureMessage: 'task enqueue failed',
  });

  return {
    accepted: true,
    task_id: input.taskId,
    status: 'queued',
    status_url: `/tasks/${input.taskId}`,
  };
}

function attachRuntimeMetadata(payload: Record<string, unknown>, projectRoot: string): Record<string, unknown> {
  const normalized = structuredClone(payload);
  normalized[TASK_RUNTIME_META_KEY] = {
    projectRoot,
  };
  return normalized;
}

async function attachUploadedSourceImage(
  projectId: string,
  payload: Record<string, unknown>,
  sourceImageUpload: SubmitTaskInput['sourceImageUpload'],
): Promise<Record<string, unknown>> {
  if (!sourceImageUpload) {
    return payload;
  }

  const normalized = structuredClone(payload || {});
  const existingAssetUri = readExistingInputAssetUri(normalized);
  if (existingAssetUri) {
    throw new ValidationError('payload.inputs.image.assetUri cannot be provided together with source_image upload');
  }

  const uploaded = await uploadSourceImageAsset(projectId, {
    buffer: sourceImageUpload.buffer,
    contentType: sourceImageUpload.contentType || undefined,
    filenameHint: sourceImageUpload.filename || undefined,
  });

  const inputs = ensureObjectField(normalized, 'inputs');
  const image = ensureObjectField(inputs, 'image');
  image.assetUri = uploaded.assetUri;

  return normalized;
}

function readExistingInputAssetUri(payload: Record<string, unknown>): string {
  const inputs = payload.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return '';
  }
  const inputMap = inputs as Record<string, unknown>;
  const imageAssetUri = String(inputMap.imageAssetUri || '').trim();
  if (imageAssetUri) {
    return imageAssetUri;
  }
  const image = inputMap.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    return '';
  }
  return String((image as Record<string, unknown>).assetUri || '').trim();
}

function ensureObjectField(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = target[key];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    target[key] = {};
  }
  return target[key] as Record<string, unknown>;
}

export async function getTaskResponse(taskId: string): Promise<PublicTaskResponse | null> {
  const task = await taskStore.get(taskId);
  return task ? toPublicTaskResponse(task) : null;
}

export async function listTaskObservations(filters?: {
  limit?: number;
  taskType?: string;
}): Promise<TaskObservationResponse[]> {
  const tasks = await taskStore.list({
    limit: filters?.limit,
    taskType: filters?.taskType,
  });
  return tasks.map(toTaskObservationResponse);
}

export async function listTaskEvents(taskId: string): Promise<TaskEventResponse[] | null> {
  const task = await taskStore.get(taskId);
  if (!task) {
    return null;
  }
  const events = await taskStore.listEvents(taskId);
  return events.map(toTaskEventResponse);
}

async function publishTaskToQueue(
  record: WorkerTaskRecord,
  options: {
    stage: 'enqueue' | 'republish';
    eventMessage: string;
    failureMessage: string;
  },
): Promise<void> {
  const driver = await getTaskQueueDriver();

  try {
    await driver.enqueue(
      TASK_QUEUE_NAME,
      createQueueJobEnvelope(
        TASK_QUEUE_NAME,
        TASK_JOB_NAME,
        { taskId: record.taskId },
        {
          id: `job_${record.taskId}`,
          maxAttempts: record.maxAttempts,
          backoff: record.backoffSeconds,
          timeout: record.timeoutSeconds,
        },
      ),
    );
    await taskStore.save({
      ...record,
      status: 'queued',
      queuePublishStatus: 'published',
      queuePublishedAt: utcNow(),
      queuePublishError: null,
      progress: 0,
      eta: null,
      message: 'queued',
      errorCode: null,
      finishedAt: null,
      nextRunAt: null,
      updatedAt: utcNow(),
    });
    await taskStore.appendEvent({
      taskId: record.taskId,
      eventType: 'enqueued',
      message: options.eventMessage,
      detailJson: {
        queueName: TASK_QUEUE_NAME,
        stage: options.stage,
      },
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to enqueue worker task';
    await taskStore.save({
      ...record,
      status: 'failed',
      queuePublishStatus: 'publish_failed',
      queuePublishError: errorMessage,
      progress: null,
      eta: null,
      message: errorMessage,
      errorCode: 'queue_publish_failed',
      finishedAt: utcNow(),
      updatedAt: utcNow(),
    }).catch(() => undefined);
    await taskStore.appendEvent({
      taskId: record.taskId,
      eventType: 'failed',
      message: options.failureMessage,
      detailJson: {
        stage: options.stage,
      },
    }).catch(() => undefined);
    throw error;
  }
}
