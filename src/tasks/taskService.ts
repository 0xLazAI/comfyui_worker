import {
  PROVIDER_POLL_INTERVAL_SECONDS,
  PROJECTS_ROOT,
  PLATFORM_API_ENABLED,
  TASK_BACKOFF_SECONDS,
  TASK_MAX_ATTEMPTS,
  TASK_TIMEOUT_SECONDS,
} from '../infra/constants.js';
import { ValidationError } from '../infra/HttpError.js';
import { currentRequestId } from '../infra/logger.js';
import { uploadSourceImageAsset } from '../render/assetStore.js';
import { buildRenderPanelStephenSubmitBody, buildReplacePropStephenSubmitBody } from '../render/stephenWorkflowBodies.js';
import { submitStephenImageWorkflow } from '../render/stephenWorkflowExecution.js';
import { normalizeProjectRoot, hydrateRenderPanelPayload } from '../render/payload.js';
import { hydrateReplacePropPanelPayload } from '../render/replacePropPayload.js';
import { extractProjectRoot, progressForProviderStatus } from './taskExecutionShared.js';
import { attachStephenProviderRuntimeState, mergeStephenProviderRuntimeState } from './taskRuntime.js';
import {
  attachTaskDefinitionBinding,
  normalizePayloadWithDefinition,
} from '../taskDefinitions/definitionSchema.js';
import { taskTypeDefinitionStore } from '../taskDefinitions/taskTypeDefinitionStore.js';
import { isHiddenTaskType } from '../taskDefinitions/hiddenTaskTypes.js';
import { TASK_RUNTIME_META_KEY } from '../taskDefinitions/types.js';
import { enqueueTaskRecord } from './taskScheduler.js';
import { taskStore } from './taskStore.js';
import { supportsConsumerKey } from './taskExecution.js';
import type { PublicTaskResponse, SubmitTaskInput, WorkerTaskRecord } from './types.js';
import { mapWorkerTaskStatusToPublicStatus, toPublicTaskResponse, utcNow } from './types.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import { REPLACE_PROP_PANEL_TASK_TYPE, RENDER_PANEL_TASK_TYPE } from '../render/workflowCatalog.js';

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

  // 隐藏的 task_type 既不出现在 /capabilities，也不接受提交——否则「声明没有能力却还能跑」更歧义。
  const definition = isHiddenTaskType(input.taskType)
    ? null
    : await taskTypeDefinitionStore.getEnabledByTaskType(input.taskType);
  if (!definition) {
    throw new ValidationError(`unsupported task_type: ${input.taskType}`);
  }

  const consumerKey = definition.definitionJson.consumer_key;
  if (!supportsConsumerKey(consumerKey)) {
    throw new ValidationError(`unsupported consumer_key for task_type ${input.taskType}: ${consumerKey}`);
  }

  const normalizedProjectRoot = PLATFORM_API_ENABLED
    ? ''
    : normalizeProjectRoot(`${PROJECTS_ROOT.replace(/\/+$/, '')}/${input.projectId}`);
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
    maxAttempts: TASK_MAX_ATTEMPTS,
    backoffSeconds: [...TASK_BACKOFF_SECONDS],
    timeoutSeconds: TASK_TIMEOUT_SECONDS,
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

  if (!requiresStephenSubmission(record.taskType)) {
    try {
      await enqueueTaskRecord(
        {
          ...record,
          status: 'queued',
          progress: 0,
          eta: null,
          message: 'queued',
          errorCode: null,
          finishedAt: null,
          nextRunAt: null,
        },
        {
          stage: 'enqueue',
          eventMessage: 'task enqueued',
        },
      );
    } catch (error: any) {
      const failedRecord = await markSubmitStageFailure(record, error, {
        stage: 'initial_enqueue',
        message: 'initial task enqueue failed',
      });
      return {
        accepted: true,
        task_id: input.taskId,
        status: mapWorkerTaskStatusToPublicStatus(failedRecord.status),
        status_url: `/tasks/${input.taskId}`,
      };
    }
    return {
      accepted: true,
      task_id: input.taskId,
      status: 'queued',
      status_url: `/tasks/${input.taskId}`,
    };
  }

  const submitOutcome = await submitProviderJob(record);
  if (submitOutcome.kind === 'rejected' || submitOutcome.kind === 'failed') {
    return {
      accepted: true,
      task_id: input.taskId,
      status: mapWorkerTaskStatusToPublicStatus(submitOutcome.record.status),
      status_url: `/tasks/${input.taskId}`,
    };
  }

  try {
    await enqueueTaskRecord(submitOutcome.record, {
      stage: 'enqueue',
      eventMessage: 'task enqueued for provider reconciliation',
      delaySeconds: PROVIDER_POLL_INTERVAL_SECONDS,
    });
  } catch (error: any) {
    const failedRecord = await markSubmitStageFailure(submitOutcome.record, error, {
      stage: 'provider_followup_enqueue',
      message: 'provider submitted but reconciliation enqueue failed',
    });
    return {
      accepted: true,
      task_id: input.taskId,
      status: mapWorkerTaskStatusToPublicStatus(failedRecord.status),
      status_url: `/tasks/${input.taskId}`,
    };
  }

  return {
    accepted: true,
    task_id: input.taskId,
    status: mapWorkerTaskStatusToPublicStatus(submitOutcome.record.status),
    status_url: `/tasks/${input.taskId}`,
  };
}

function attachRuntimeMetadata(payload: Record<string, unknown>, projectRoot: string): Record<string, unknown> {
  const normalized = structuredClone(payload);
  normalized[TASK_RUNTIME_META_KEY] = projectRoot ? { projectRoot } : {};
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

async function markSubmitStageFailure(
  record: WorkerTaskRecord,
  error: unknown,
  options: {
    stage: 'initial_enqueue' | 'provider_followup_enqueue';
    message: string;
  },
): Promise<WorkerTaskRecord> {
  const normalizedError = normalizeSubmitStageError(error);
  const providerState =
    options.stage === 'provider_followup_enqueue'
      ? extractProviderState(record.requestPayload)
      : null;

  const failedRecord: WorkerTaskRecord = {
    ...record,
    status: 'failed',
    queuePublishStatus: 'publish_failed',
    queuePublishError: normalizedError.message,
    progress: null,
    eta: null,
    message: options.message,
    errorCode: 'queue_publish_failed',
    resultPayload: {
      errorName: normalizedError.name,
      message: normalizedError.message,
      stage: options.stage,
      ...(providerState ? {
        providerJobId: providerState.jobId,
        providerPromptId: providerState.promptId || null,
        providerStatusUrl: providerState.statusUrl || null,
      } : {}),
    },
    nextRunAt: null,
    finishedAt: utcNow(),
    updatedAt: utcNow(),
  };

  await taskStore.save(failedRecord);
  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'failed',
    message: options.message,
    detailJson: {
      stage: options.stage,
      errorName: normalizedError.name,
      message: normalizedError.message,
      ...(providerState ? {
        providerJobId: providerState.jobId,
        providerPromptId: providerState.promptId || null,
        providerStatusUrl: providerState.statusUrl || null,
      } : {}),
    },
  });
  return failedRecord;
}

function normalizeSubmitStageError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'unknown error',
    };
  }
  return {
    name: 'Error',
    message: String(error || 'unknown error'),
  };
}

function extractProviderState(payload: Record<string, unknown>): {
  jobId: string;
  promptId?: string | null;
  statusUrl?: string | null;
} | null {
  const runtimeMeta = payload[TASK_RUNTIME_META_KEY];
  if (!runtimeMeta || typeof runtimeMeta !== 'object' || Array.isArray(runtimeMeta)) {
    return null;
  }
  const provider = (runtimeMeta as Record<string, unknown>).provider;
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    return null;
  }
  const providerMap = provider as Record<string, unknown>;
  const jobId = String(providerMap.jobId || '').trim();
  if (!jobId) {
    return null;
  }
  const promptId = String(providerMap.promptId || '').trim() || null;
  const statusUrl = String(providerMap.statusUrl || '').trim() || null;
  return {
    jobId,
    promptId,
    statusUrl,
  };
}

export async function getTaskResponse(taskId: string): Promise<PublicTaskResponse | null> {
  const task = await taskStore.get(taskId);
  return task ? toPublicTaskResponse(task) : null;
}

function requiresStephenSubmission(taskType: string): boolean {
  return taskType === RENDER_PANEL_TASK_TYPE || taskType === REPLACE_PROP_PANEL_TASK_TYPE;
}

async function submitProviderJob(
  record: WorkerTaskRecord,
): Promise<
  | { kind: 'submitted'; record: WorkerTaskRecord }
  | { kind: 'rejected'; record: WorkerTaskRecord }
  | { kind: 'failed'; record: WorkerTaskRecord }
> {
  try {
    const submittedAt = utcNow();
    const projectRoot = extractProjectRoot(record.requestPayload);
    const submitted = await submitStephenTask(record, projectRoot);
    const provider = mergeStephenProviderRuntimeState(null, submitted, { submittedAt });
    const status = provider.lastStatus || 'submitted';
    const nextRunAt = new Date(Date.now() + PROVIDER_POLL_INTERVAL_SECONDS * 1000).toISOString();
    const updatedRecord: WorkerTaskRecord = {
      ...record,
      requestPayload: attachStephenProviderRuntimeState(record.requestPayload, provider),
      status: 'running',
      progress: progressForProviderStatus(status),
      eta: PROVIDER_POLL_INTERVAL_SECONDS,
      message: `provider ${status}`,
      errorCode: null,
      nextRunAt,
      updatedAt: utcNow(),
    };

    await taskStore.save(updatedRecord);
    await taskStore.appendEvent({
      taskId: record.taskId,
      eventType: 'provider_submitted',
      message: 'provider job submitted',
      detailJson: {
        providerJobId: provider.jobId,
        status,
        statusUrl: provider.statusUrl,
        promptId: provider.promptId,
        workerName: provider.workerName,
        workerUrl: provider.workerUrl,
        workflow: provider.workflow,
      },
    });

    return {
      kind: 'submitted',
      record: updatedRecord,
    };
  } catch (error: any) {
    if (error instanceof TaskRejectedError) {
      const rejectedRecord: WorkerTaskRecord = {
        ...record,
        status: 'rejected',
        progress: null,
        eta: null,
        message: error.message,
        errorCode: error.code,
        resultPayload: {
          errorName: error.name,
          code: error.code,
          message: error.message,
        },
        finishedAt: utcNow(),
        updatedAt: utcNow(),
      };
      await taskStore.save(rejectedRecord);
      await taskStore.appendEvent({
        taskId: record.taskId,
        eventType: 'rejected',
        message: 'provider submit rejected',
        detailJson: {
          code: error.code,
          message: error.message,
        },
      });
      return {
        kind: 'rejected',
        record: rejectedRecord,
      };
    }

    const failedRecord: WorkerTaskRecord = {
      ...record,
      status: 'failed',
      progress: null,
      eta: null,
      message: error?.message || 'provider submit failed',
      errorCode: error instanceof ProviderRequestError ? error.code : 'provider_submit_failed',
      resultPayload: {
        errorName: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
      finishedAt: utcNow(),
      updatedAt: utcNow(),
    };
    await taskStore.save(failedRecord);
    await taskStore.appendEvent({
      taskId: record.taskId,
      eventType: 'failed',
      message: 'provider submit failed',
      detailJson: {
        message: error?.message || 'provider submit failed',
      },
    });
    return {
      kind: 'failed',
      record: failedRecord,
    };
  }
}

async function submitStephenTask(record: WorkerTaskRecord, projectRoot: string) {
  if (record.taskType === RENDER_PANEL_TASK_TYPE) {
    const payload = hydrateRenderPanelPayload(structuredClone(record.requestPayload), {
      taskId: record.taskId,
      projectId: record.projectId,
      projectRoot,
    });
    const submission = await submitStephenImageWorkflow({
      target: {
        projectId: payload.projectId,
        panel: payload.panel,
      },
      sourceImageAssetUri: payload.inputs.imageAssetUri || '',
      buildSubmitBody: (sourceImageBase64) => buildRenderPanelStephenSubmitBody(payload, sourceImageBase64),
    });
    return submission.submitted;
  }

  if (record.taskType === REPLACE_PROP_PANEL_TASK_TYPE) {
    const payload = hydrateReplacePropPanelPayload(structuredClone(record.requestPayload), {
      taskId: record.taskId,
      projectId: record.projectId,
      projectRoot,
    });
    const submission = await submitStephenImageWorkflow({
      target: {
        projectId: payload.projectId,
        panel: payload.panel,
      },
      sourceImageAssetUri: payload.inputs.imageAssetUri || '',
      buildSubmitBody: (sourceImageBase64) => buildReplacePropStephenSubmitBody(payload, sourceImageBase64),
    });
    return submission.submitted;
  }

  throw new ValidationError(`provider submit is not supported for task_type: ${record.taskType}`);
}
