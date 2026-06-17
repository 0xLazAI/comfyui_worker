import os from 'os';
import { BLENDER_CONSUMER_KEY, handleBlenderExecute } from './blenderTaskExecution.js';
import { logger } from '../infra/logger.js';
import { downloadAsset, uploadRenderAsset } from '../render/assetStore.js';
import { TaskRejectedError } from '../render/errors.js';
import { hydrateRenderPanelPayload, type NormalizedRenderPanelPayload } from '../render/payload.js';
import {
  downloadStephenRenderImage,
  pollStephenRenderUntilTerminal,
  submitStephenRender,
  type StephenRenderStatus,
} from '../render/stephenRenderClient.js';
import { writeStoryboardOutputSidecar } from '../render/storyboardOutputs.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { readTaskDefinitionBinding } from '../taskDefinitions/definitionSchema.js';
import { computeRetryDelaySeconds } from './retryDelay.js';
import { taskStore } from './taskStore.js';
import { isTerminalWorkerTaskStatus, utcNow } from './types.js';
import { WORKER_NAME } from '../infra/constants.js';

const RENDER_PANEL_CONSUMER_KEY = 'render_panel_consumer';

export async function handleRenderPanelExecute(
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
    await taskStore.save({
      ...record,
      status: 'cancelled',
      finishedAt: startedAt,
      workerName,
      updatedAt: utcNow(),
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'cancelled',
      attemptNo: context.attempts,
      workerName,
      message: 'task cancelled before execution',
    });
    return;
  }

  const payload = hydrateRenderPanelPayload(structuredClone(record.requestPayload), {
    taskId,
    projectId: record.projectId,
    projectRoot: extractProjectRoot(record.requestPayload),
  });
  await taskStore.save({
    ...record,
    status: 'running',
    progress: 0,
    eta: null,
    message: 'resolving source image',
    errorCode: null,
    queuePublishError: null,
    currentAttempt: context.attempts,
    startedAt: record.startedAt || startedAt,
    nextRunAt: null,
    workerName,
    updatedAt: utcNow(),
  });
  await taskStore.appendEvent({
    taskId,
    eventType: 'started',
    attemptNo: context.attempts,
    workerName,
    message: 'render_panel execution started',
  });

  try {
    const sourceImage = await downloadSourceImage(payload);
    logger.info('task=%s source asset downloaded uri=%s bytes=%d', taskId, sourceImage.assetUri, sourceImage.buffer.byteLength);

    const submitted = await submitStephenRender(
      payload,
      payload.workflow,
      sourceImage.buffer.toString('base64'),
    );
    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 15,
      eta: null,
      message: 'provider submitted',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'provider_submitted',
      attemptNo: context.attempts,
      workerName,
      message: 'Stephen render submitted',
      detailJson: {
        providerJobId: submitted.job_id,
        status: submitted.status,
        statusUrl: submitted.status_url,
        workflow: payload.workflow.providerWorkflowId,
      },
    });

    let lastProviderStatus = String(submitted.status || '').trim();
    const terminalStatus = await pollStephenRenderUntilTerminal(payload, submitted, async (status) => {
      const normalizedStatus = String(status.status || '').trim();
      if (!normalizedStatus || normalizedStatus === lastProviderStatus) {
        return;
      }
      lastProviderStatus = normalizedStatus;

      await taskStore.save({
        ...(await expectTask(taskId)),
        status: normalizedStatus === 'done' ? 'running' : 'running',
        progress: progressForProviderStatus(normalizedStatus),
        eta: null,
        message: `provider ${normalizedStatus}`,
        errorCode: null,
        currentAttempt: context.attempts,
        workerName,
        updatedAt: utcNow(),
      });
      await taskStore.appendEvent({
        taskId,
        eventType: 'provider_polled',
        attemptNo: context.attempts,
        workerName,
        message: `Stephen render status changed to ${normalizedStatus}`,
        detailJson: {
          providerJobId: status.job_id,
          status: normalizedStatus,
          renderUrl: status.render_url || null,
          filename: status.filename || null,
        },
      });
    });

    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 70,
      eta: null,
      message: 'downloading provider result',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });

    const renderedImage = await downloadStephenRenderImage(terminalStatus);
    const uploadedAsset = await uploadRenderAsset(payload.projectId, {
      buffer: renderedImage.buffer,
      contentType: renderedImage.contentType,
      filenameHint: renderedImage.filename,
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'asset_uploaded',
      attemptNo: context.attempts,
      workerName,
      message: 'render asset uploaded',
      detailJson: {
        assetUri: uploadedAsset.assetUri,
        filename: uploadedAsset.filename,
        bytes: uploadedAsset.bytes,
      },
    });

    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 90,
      eta: null,
      message: 'writing storyboard metadata',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });

    await writeStoryboardOutputSidecar(payload, {
      task_id: taskId,
      task_type: 'render_panel',
      workflow: payload.workflow.id,
      render_uri: uploadedAsset.assetUri,
      filename: uploadedAsset.filename,
      seed: payload.seed,
      source_image_uri: payload.inputs.imageAssetUri,
      extra_params: payload.extraParams,
      provider: {
        name: 'stephen_render',
        job_id: String(terminalStatus.job_id || ''),
        workflow: payload.workflow.providerWorkflowId,
      },
      created_at: utcNow(),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('Shot storyboard directory is missing')) {
        throw new TaskRejectedError(error.message, 'storyboard_target_missing');
      }
      throw error;
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'metadata_written',
      attemptNo: context.attempts,
      workerName,
      message: 'storyboard outputs metadata written',
      detailJson: {
        panelId: payload.panel.panelId,
        sceneId: payload.panel.sceneId,
        shotId: payload.panel.shotId,
      },
    });

    const result = {
      panel_id: payload.panel.panelId,
      project: payload.projectId,
      workflow: payload.workflow.id,
      backend: payload.workflow.backend,
      filename: uploadedAsset.filename,
      render_uri: uploadedAsset.assetUri,
      seed: payload.seed,
      meta: {
        providerJobId: terminalStatus.job_id,
        providerWorkflow: payload.workflow.providerWorkflowId,
        resolvedBaseModel: payload.workflow.baseModel,
      },
    };

    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'succeeded',
      progress: 100,
      eta: 0,
      message: 'done',
      errorCode: null,
      resultPayload: result,
      currentAttempt: context.attempts,
      finishedAt: utcNow(),
      workerName,
      updatedAt: utcNow(),
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'succeeded',
      attemptNo: context.attempts,
      workerName,
      message: 'render_panel execution succeeded',
      detailJson: {
        providerJobId: terminalStatus.job_id,
        renderUri: uploadedAsset.assetUri,
      },
    });
    await taskStore.saveAttempt({
      taskId,
      attemptNo: context.attempts,
      status: 'succeeded',
      workerName,
      startedAt,
      finishedAt: utcNow(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      resultPayload: result,
    });
  } catch (error: any) {
    if (error instanceof TaskRejectedError) {
      const finishedAt = utcNow();
      const failureDetail = buildTaskFailureDetail(error);
      const fresh = await taskStore.get(taskId);
      if (fresh) {
        await taskStore.save({
          ...fresh,
          status: 'rejected',
          progress: null,
          eta: null,
          message: error.message,
          errorCode: error.code,
          resultPayload: failureDetail,
          currentAttempt: context.attempts,
          finishedAt,
          workerName,
          updatedAt: utcNow(),
        });
        await taskStore.appendEvent({
          taskId,
          eventType: 'rejected',
          attemptNo: context.attempts,
          workerName,
          message: 'render_panel execution rejected',
          detailJson: {
            failure: failureDetail,
          },
        });
        await taskStore.saveAttempt({
          taskId,
          attemptNo: context.attempts,
          status: 'rejected',
          workerName,
          startedAt,
          finishedAt,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          resultPayload: failureDetail,
          errorMessage: error.message,
        });
      }
      return;
    }

    const fresh = await taskStore.get(taskId);
    if (fresh) {
      const terminalFailure = context.attempts >= context.maxAttempts;
      const finishedAt = utcNow();
      const retryDelaySeconds = computeRetryDelaySeconds(fresh.backoffSeconds, context.attempts);
      const failureDetail = buildTaskFailureDetail(error);

      await taskStore.save({
        ...fresh,
        status: terminalFailure ? 'failed' : 'retry_waiting',
        progress: terminalFailure ? null : 0,
        eta: terminalFailure ? null : retryDelaySeconds,
        message: error?.message || 'render_panel execution failed',
        errorCode: 'render_panel_failed',
        resultPayload: failureDetail,
        currentAttempt: context.attempts,
        nextRunAt: terminalFailure ? null : new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
        finishedAt: terminalFailure ? finishedAt : null,
        workerName,
        updatedAt: utcNow(),
      });
      if (terminalFailure) {
        await taskStore.appendEvent({
          taskId,
          eventType: 'failed',
          attemptNo: context.attempts,
          workerName,
          message: 'render_panel execution failed',
          detailJson: {
            failure: failureDetail,
          },
        });
        await taskStore.saveAttempt({
          taskId,
          attemptNo: context.attempts,
          status: 'failed',
          workerName,
          startedAt,
          finishedAt,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          resultPayload: failureDetail,
          errorMessage: error?.message || 'render_panel execution failed',
        });
      } else {
        await taskStore.appendEvent({
          taskId,
          eventType: 'retry_scheduled',
          attemptNo: context.attempts,
          workerName,
          message: 'render_panel scheduled for retry',
          detailJson: {
            retryDelaySeconds,
            failure: failureDetail,
          },
        });
        await taskStore.saveAttempt({
          taskId,
          attemptNo: context.attempts,
          status: 'released',
          workerName,
          startedAt,
          finishedAt,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          resultPayload: failureDetail,
          errorMessage: error?.message || 'render_panel execution failed',
        });
      }
    }
    throw error;
  }
}

export async function handleTaskExecute(
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

  const binding = readTaskDefinitionBinding(record.requestPayload);
  const consumerKey = binding?.consumerKey || defaultConsumerKeyForTaskType(record.taskType);
  const handler = getConsumerHandler(consumerKey);
  await handler(envelope, context);
}

async function downloadSourceImage(payload: NormalizedRenderPanelPayload) {
  try {
    return await downloadAsset(payload.projectId, payload.inputs.imageAssetUri || '');
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error?.name === 'NoSuchKey' || message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      throw new TaskRejectedError(`source image asset does not exist: ${payload.inputs.imageAssetUri}`, 'source_asset_missing');
    }
    throw error;
  }
}

async function expectTask(taskId: string) {
  const record = await taskStore.get(taskId);
  if (!record) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return record;
}

function progressForProviderStatus(status: string): number {
  switch (status) {
    case 'submitted':
      return 20;
    case 'queued':
      return 25;
    case 'running':
      return 45;
    case 'done':
      return 65;
    default:
      return 30;
  }
}

function normalizeWorkerName(): string {
  const normalized = String(WORKER_NAME || '').trim();
  return normalized || `${os.hostname()}:${process.pid}`;
}

function buildTaskFailureDetail(error: unknown): Record<string, unknown> {
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

export function supportsConsumerKey(consumerKey: string): boolean {
  return Boolean(CONSUMER_HANDLERS[String(consumerKey || '').trim()]);
}

function getConsumerHandler(consumerKey: string): typeof handleRenderPanelExecute {
  const normalized = String(consumerKey || '').trim();
  const handler = CONSUMER_HANDLERS[normalized];
  if (!handler) {
    throw new Error(`Unsupported consumer_key: ${normalized || '(empty)'}`);
  }
  return handler;
}

function defaultConsumerKeyForTaskType(taskType: string): string {
  const normalized = String(taskType || '').trim();
  if (normalized === 'render_panel') {
    return RENDER_PANEL_CONSUMER_KEY;
  }
  if (normalized === 'blender') {
    return BLENDER_CONSUMER_KEY;
  }
  return '';
}

function extractProjectRoot(requestPayload: Record<string, unknown>): string {
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

  throw new Error('request payload is missing _taskRuntime.projectRoot');
}

const CONSUMER_HANDLERS: Record<string, typeof handleRenderPanelExecute> = {
  [BLENDER_CONSUMER_KEY]: handleBlenderExecute,
  [RENDER_PANEL_CONSUMER_KEY]: handleRenderPanelExecute,
};
