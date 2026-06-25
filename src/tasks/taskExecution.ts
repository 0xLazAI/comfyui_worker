import { PLATFORM_API_ENABLED, PROVIDER_POLL_INTERVAL_SECONDS } from '../infra/constants.js';
import { TaskRejectedError } from '../render/errors.js';
import { hydrateRenderPanelPayload } from '../render/payload.js';
import { finalizeStephenImageWorkflow } from '../render/stephenWorkflowExecution.js';
import { getStephenRenderStatus } from '../render/stephenRenderClient.js';
import { writeStoryboardOutputSidecar } from '../render/storyboardOutputs.js';
import { REPLACE_PROP_PANEL_TASK_TYPE, RENDER_PANEL_TASK_TYPE } from '../render/workflowCatalog.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { readTaskDefinitionBinding } from '../taskDefinitions/definitionSchema.js';
import { handleReplacePropPanelExecute, REPLACE_PROP_PANEL_CONSUMER_KEY } from './replacePropTaskExecution.js';
import { enqueueTaskRecord } from './taskScheduler.js';
import { taskStore } from './taskStore.js';
import {
  buildTaskFailureDetail,
  computeRetryDelaySeconds,
  expectTask,
  extractProjectRoot,
  isProviderStatusPending,
  loadStoryboardProjectContextOrReject,
  normalizeWorkerName,
  progressForProviderStatus,
} from './taskExecutionShared.js';
import {
  attachStephenProviderRuntimeState,
  getStephenProviderRuntimeState,
  mergeStephenProviderRuntimeState,
} from './taskRuntime.js';
import { isTerminalWorkerTaskStatus, utcNow } from './types.js';

export const RENDER_PANEL_CONSUMER_KEY = 'render_panel_consumer';

type ConsumerHandler = (
  envelope: QueueJobEnvelope<{ taskId: string }>,
  context: QueueHandlerContext,
) => Promise<void>;

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
    message: 'checking provider status',
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
    message: 'render_panel reconciliation started',
  });

  try {
    const providerState = getStephenProviderRuntimeState(record.requestPayload);
    if (!providerState) {
      throw new TaskRejectedError('provider job metadata is missing for render_panel task', 'provider_job_missing');
    }

    const status = await getStephenRenderStatus(payload.projectId, {
      job_id: providerState.jobId,
      status_url: providerState.statusUrl || undefined,
    });
    const normalizedStatus = String(status.status || '').trim() || providerState.lastStatus || 'submitted';
    const mergedProviderState = mergeStephenProviderRuntimeState(providerState, status);
    const requestPayloadWithProvider = attachStephenProviderRuntimeState(record.requestPayload, mergedProviderState);
    const providerChanged =
      normalizedStatus !== providerState.lastStatus
      || mergedProviderState.promptId !== providerState.promptId
      || mergedProviderState.workerName !== providerState.workerName
      || mergedProviderState.workerUrl !== providerState.workerUrl;

    if (providerChanged) {
      await taskStore.appendEvent({
        taskId,
        eventType: 'provider_polled',
        attemptNo: context.attempts,
        workerName,
        message: `Stephen render status changed to ${normalizedStatus}`,
        detailJson: {
          providerJobId: status.job_id,
          status: normalizedStatus,
          promptId: mergedProviderState.promptId,
          workerName: mergedProviderState.workerName,
          workerUrl: mergedProviderState.workerUrl,
          renderUrl: status.render_url || null,
          filename: status.filename || null,
        },
      });
    }

    if (isProviderStatusPending(normalizedStatus)) {
      const delaySeconds = PROVIDER_POLL_INTERVAL_SECONDS;
      const inProgressRecord = {
        ...record,
        requestPayload: requestPayloadWithProvider,
        status: 'running' as const,
        progress: progressForProviderStatus(normalizedStatus),
        eta: delaySeconds,
        message: `provider ${normalizedStatus}`,
        errorCode: null,
        currentAttempt: context.attempts,
        nextRunAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        workerName,
        updatedAt: utcNow(),
      };
      await enqueueTaskRecord(inProgressRecord, {
        stage: 'followup',
        eventMessage: 'task re-enqueued for provider reconciliation',
        delaySeconds,
      });
      return;
    }

    if (normalizedStatus === 'rejected') {
      const finishedAt = utcNow();
      const detail = buildTaskFailureDetail(new TaskRejectedError(String(status.error || 'Stephen render rejected'), 'provider_rejected'));
      await taskStore.save({
        ...record,
        requestPayload: requestPayloadWithProvider,
        status: 'rejected',
        progress: null,
        eta: null,
        message: String(status.error || 'Stephen render rejected'),
        errorCode: 'provider_rejected',
        resultPayload: detail,
        currentAttempt: context.attempts,
        nextRunAt: null,
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
          failure: detail,
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
        resultPayload: detail,
        errorMessage: String(status.error || 'Stephen render rejected'),
      });
      return;
    }

    if (normalizedStatus === 'failed') {
      const finishedAt = utcNow();
      const detail = buildTaskFailureDetail(new Error(String(status.error || 'Stephen render failed')));
      await taskStore.save({
        ...record,
        requestPayload: requestPayloadWithProvider,
        status: 'failed',
        progress: null,
        eta: null,
        message: String(status.error || 'Stephen render failed'),
        errorCode: 'provider_render_failed',
        resultPayload: detail,
        currentAttempt: context.attempts,
        nextRunAt: null,
        finishedAt,
        workerName,
        updatedAt: utcNow(),
      });
      await taskStore.appendEvent({
        taskId,
        eventType: 'failed',
        attemptNo: context.attempts,
        workerName,
        message: 'render_panel execution failed',
        detailJson: {
          failure: detail,
          providerJobId: status.job_id,
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
        resultPayload: detail,
        errorMessage: String(status.error || 'Stephen render failed'),
      });
      return;
    }

    if (normalizedStatus !== 'done') {
      const finishedAt = utcNow();
      const message = `Stephen render returned unexpected status: ${normalizedStatus}`;
      const detail = buildTaskFailureDetail(new Error(message));
      await taskStore.save({
        ...record,
        requestPayload: requestPayloadWithProvider,
        status: 'failed',
        progress: null,
        eta: null,
        message,
        errorCode: 'provider_unexpected_status',
        resultPayload: detail,
        currentAttempt: context.attempts,
        nextRunAt: null,
        finishedAt,
        workerName,
        updatedAt: utcNow(),
      });
      await taskStore.appendEvent({
        taskId,
        eventType: 'failed',
        attemptNo: context.attempts,
        workerName,
        message: 'render_panel execution failed',
        detailJson: {
          failure: detail,
          providerJobId: status.job_id,
          providerStatus: normalizedStatus,
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
        resultPayload: detail,
        errorMessage: message,
      });
      return;
    }

    await taskStore.save({
      ...record,
      requestPayload: requestPayloadWithProvider,
      status: 'running',
      progress: 70,
      eta: null,
      message: 'downloading provider result',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });

    const uploadedAsset = await finalizeStephenImageWorkflow(payload.projectId, status);
    const projectContext = await loadStoryboardProjectContextOrReject(payload);

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
      requestPayload: requestPayloadWithProvider,
      status: 'running',
      progress: 90,
      eta: null,
      message: 'writing storyboard metadata',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });

    const metadataPath = await writeStoryboardOutputSidecar(payload, {
      task_id: taskId,
      task_type: 'render_panel',
      workflow: payload.workflow.id,
      render_uri: uploadedAsset.assetUri,
      filename: uploadedAsset.filename,
      seed: payload.seed,
      source_image_uri: payload.inputs.imageAssetUri,
      extra_params: payload.extraParams,
      note: payload.prompt.text,
      provider: {
        name: 'stephen_render',
        job_id: String(status.job_id || ''),
        workflow: payload.workflow.providerWorkflowId,
      },
      created_at: utcNow(),
    }, projectContext);

    await taskStore.appendEvent({
      taskId,
      eventType: 'metadata_written',
      attemptNo: context.attempts,
      workerName,
      message: PLATFORM_API_ENABLED ? 'PACE artifact metadata written' : 'storyboard outputs metadata written',
      detailJson: {
        panelId: payload.panel.panelId,
        sceneId: payload.panel.sceneId,
        shotId: payload.panel.shotId,
        metadataPath,
      },
    });

    const result = {
      panelId: payload.panel.panelId,
      project: payload.projectId,
      workflow: payload.workflow.id,
      backend: payload.workflow.backend,
      filename: uploadedAsset.filename,
      renderUri: uploadedAsset.assetUri,
      seed: payload.seed,
      meta: {
        providerJobId: status.job_id,
        providerWorkflow: payload.workflow.providerWorkflowId,
        resolvedBaseModel: payload.workflow.baseModel,
        metadataPath,
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
      nextRunAt: null,
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
        providerJobId: status.job_id,
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
          nextRunAt: null,
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

export function supportsConsumerKey(consumerKey: string): boolean {
  return Boolean(CONSUMER_HANDLERS[String(consumerKey || '').trim()]);
}

function getConsumerHandler(consumerKey: string): ConsumerHandler {
  const normalized = String(consumerKey || '').trim();
  const handler = CONSUMER_HANDLERS[normalized];
  if (!handler) {
    throw new Error(`Unsupported consumer_key: ${normalized || '(empty)'}`);
  }
  return handler;
}

function defaultConsumerKeyForTaskType(taskType: string): string {
  const normalized = String(taskType || '').trim();
  if (normalized === RENDER_PANEL_TASK_TYPE) {
    return RENDER_PANEL_CONSUMER_KEY;
  }
  if (normalized === REPLACE_PROP_PANEL_TASK_TYPE) {
    return REPLACE_PROP_PANEL_CONSUMER_KEY;
  }
  return '';
}

const CONSUMER_HANDLERS: Record<string, ConsumerHandler> = {
  [RENDER_PANEL_CONSUMER_KEY]: handleRenderPanelExecute,
  [REPLACE_PROP_PANEL_CONSUMER_KEY]: handleReplacePropPanelExecute,
};
