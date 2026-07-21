import {
  HUNYUAN3D_MODELING_MAX_DURATION_SECONDS,
  HUNYUAN3D_MODELING_POLL_INTERVAL_SECONDS,
  HUNYUAN3D_MODELING_WORKFLOW,
} from '../infra/constants.js';
import { ValidationError } from '../infra/HttpError.js';
import {
  downloadModelingGlb,
  getModelingStatus,
  submitModelingJob,
  uploadModelingView,
  type ModelingStatusResult,
} from '../model3d/hunyuan3dClient.js';
import { readEntityBboxM, registerEntityModel3d } from '../model3d/entityLedger.js';
import { sliceModelInputSheet, sliceTurnaround } from '../model3d/turnaroundSlice.js';
import {
  attachHunyuan3dRuntimeState,
  getHunyuan3dRuntimeState,
  mergeHunyuan3dRuntimeState,
} from '../model3d/hunyuan3dRuntime.js';
import {
  hydrateThreeView3dPayload,
  THREE_VIEW_3D_CONSUMER_KEY,
  type NormalizedThreeView3dPayload,
  type ViewSlot,
} from '../model3d/threeViewPayload.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { downloadAsset, uploadEntityModelAsset } from '../render/assetStore.js';
import { TaskRejectedError } from '../render/errors.js';
import { enqueueTaskRecord } from './taskScheduler.js';
import { taskStore } from './taskStore.js';
import { buildTaskFailureDetail, normalizeWorkerName } from './taskExecutionShared.js';
import { isTerminalWorkerTaskStatus, utcNow, type WorkerTaskRecord } from './types.js';

export { THREE_VIEW_3D_CONSUMER_KEY };

const TERMINAL_SUCCESS = new Set(['done', 'succeeded', 'success', 'completed']);
const TERMINAL_FAILURE = new Set(['failed', 'error', 'rejected', 'cancelled', 'canceled']);

interface ExecContext {
  attemptNo: number;
  startedAt: string;
  workerName: string;
}

export async function handleThreeView3dExecute(
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
  const execContext: ExecContext = { attemptNo: context.attempts, startedAt, workerName };

  if (record.status === 'cancel_requested') {
    await markCancelled(record, startedAt, workerName, context.attempts);
    return;
  }

  try {
    const payload = hydrateThreeView3dPayload(structuredClone(record.requestPayload), {
      taskId,
      projectId: record.projectId,
    });
    const runtime = getHunyuan3dRuntimeState(record.requestPayload);

    if (!runtime) {
      await submitModelingTask(record, payload, execContext);
      return;
    }
    await reconcileModelingTask(record, payload, runtime.jobId, execContext);
  } catch (error: unknown) {
    await markRejectedOrFailed(taskId, error, execContext);
  }
}

async function submitModelingTask(
  record: WorkerTaskRecord,
  payload: NormalizedThreeView3dPayload,
  context: ExecContext,
): Promise<void> {
  await taskStore.save({
    ...record,
    status: 'running',
    progress: 0,
    eta: null,
    message: 'staging views and submitting 3D modeling job',
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
    message: 'hunyuan3d_three_view submission started',
  });

  // Resolve per-view PNG buffers (Mode A: slice a turnaround sheet; Mode B: use the
  // pre-sliced assets://views), then stage each onto the studio via /api/modeling/upload.
  const viewImages = await resolveViewImages(payload);
  if (!viewImages.front) {
    throw new ValidationError('no front view could be resolved for modeling');
  }
  const viewPaths: Partial<Record<ViewSlot, string>> = {};
  for (const [slot, image] of Object.entries(viewImages) as Array<[ViewSlot, ViewImage]>) {
    viewPaths[slot] = await uploadModelingView(slot, image.filename, image.buffer, image.contentType);
  }

  // Forward the prop's real bboxM (meters) so the studio bakes true metric
  // scale into the GLB (S4). Absent → null → GLB stays normalized, previz fits.
  const bboxM = await readEntityBboxM({
    projectId: payload.projectId,
    entityKind: payload.target.entityKind,
    entityId: payload.target.entityId,
  });

  const submitted = await submitModelingJob({
    viewPaths,
    preset: payload.preset,
    seed: payload.seed,
    maxFaces: payload.maxFaces,
    bboxM,
  });
  const submittedAt = utcNow();
  const runtime = mergeHunyuan3dRuntimeState(null, {
    jobId: submitted.jobId,
    statusUrl: submitted.statusUrl,
    outputUrl: submitted.outputUrl,
    status: 'submitted',
  }, { submittedAt });
  const requestPayloadWithRuntime = attachHunyuan3dRuntimeState(record.requestPayload, runtime);
  const delaySeconds = HUNYUAN3D_MODELING_POLL_INTERVAL_SECONDS;

  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'model3d_submitted',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: 'hunyuan3d modeling job submitted',
    detailJson: {
      jobId: runtime.jobId,
      statusUrl: runtime.statusUrl,
      views: Object.keys(viewPaths),
      preset: payload.preset,
      target: payload.target,
      bboxM,
    },
  });

  await enqueueTaskRecord({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: 15,
    eta: delaySeconds,
    message: 'modeling submitted',
    errorCode: null,
    queuePublishError: null,
    currentAttempt: context.attemptNo,
    startedAt: record.startedAt || context.startedAt,
    nextRunAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    workerName: context.workerName,
    updatedAt: utcNow(),
  }, {
    stage: 'followup',
    eventMessage: 'task re-enqueued for modeling polling',
    delaySeconds,
  });
}

interface ViewImage {
  filename: string;
  buffer: Buffer;
  contentType: string;
}

/**
 * Resolve the per-view PNG images to feed the 3D backend, keyed by PAILang view slot.
 *
 * Mode A (turnaround sheet): download the sheet and slice it by whitespace projection into
 * per-view buffers. The slices are transient modeling inputs — not persisted as PACE assets.
 * Mode B (pre-sliced views): download each assets:// view image directly.
 */
async function resolveViewImages(
  payload: NormalizedThreeView3dPayload,
): Promise<Partial<Record<ViewSlot, ViewImage>>> {
  if (payload.turnaround) {
    const sheet = await downloadAsset(payload.projectId, payload.turnaround.assetUri);
    // formatVersion present → storyboard-tool model_input_sheet: layout by format (not entity
    // kind), and view sizes normalised so all three share one downstream scale factor.
    // Absent → legacy styled turnaround sheet, sliced by entity kind.
    const { views } = payload.turnaround.formatVersion
      ? await sliceModelInputSheet(sheet.buffer, {
          formatVersion: payload.turnaround.formatVersion,
          normalized: payload.turnaround.normalized,
        })
      : await sliceTurnaround(sheet.buffer, payload.target.entityKind);
    const images: Partial<Record<ViewSlot, ViewImage>> = {};
    for (const [slot, buffer] of Object.entries(views) as Array<[ViewSlot, Buffer]>) {
      images[slot] = {
        filename: `${payload.target.entityId}_${slot}.png`,
        buffer,
        contentType: 'image/png',
      };
    }
    return images;
  }

  const images: Partial<Record<ViewSlot, ViewImage>> = {};
  for (const [slot, view] of Object.entries(payload.views) as Array<[ViewSlot, { assetUri: string }]>) {
    const asset = await downloadAsset(payload.projectId, view.assetUri);
    images[slot] = { filename: asset.filename, buffer: asset.buffer, contentType: asset.contentType };
  }
  return images;
}

async function reconcileModelingTask(
  record: WorkerTaskRecord,
  payload: NormalizedThreeView3dPayload,
  jobId: string,
  context: ExecContext,
): Promise<void> {
  await taskStore.save({
    ...record,
    status: 'running',
    progress: record.progress ?? 15,
    eta: null,
    message: 'checking modeling status',
    errorCode: null,
    currentAttempt: context.attemptNo,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });

  const status = await getModelingStatus(jobId);
  const normalizedStatus = String(status.status || '').trim().toLowerCase();
  const existingRuntime = getHunyuan3dRuntimeState(record.requestPayload);
  const runtime = mergeHunyuan3dRuntimeState(existingRuntime, {
    jobId,
    outputUrl: status.outputUrl,
    status: normalizedStatus,
  });
  const requestPayloadWithRuntime = attachHunyuan3dRuntimeState(record.requestPayload, runtime);

  await taskStore.appendEvent({
    taskId: record.taskId,
    eventType: 'model3d_polled',
    attemptNo: context.attemptNo,
    workerName: context.workerName,
    message: `modeling status: ${normalizedStatus}`,
    detailJson: {
      jobId,
      status: normalizedStatus,
      faces: status.faces,
      verts: status.verts,
      error: status.error,
    },
  });

  if (TERMINAL_FAILURE.has(normalizedStatus)) {
    await markModelingFailed(record, status, requestPayloadWithRuntime, context);
    return;
  }
  if (TERMINAL_SUCCESS.has(normalizedStatus)) {
    await finalizeModelingTask(record, payload, jobId, requestPayloadWithRuntime, status, context);
    return;
  }

  // Deadline guard: stop re-enqueuing once the job has polled past the max duration,
  // otherwise a studio job stuck in a non-terminal state would loop forever.
  const submittedAtMs = runtime.submittedAt ? Date.parse(runtime.submittedAt) : NaN;
  if (Number.isFinite(submittedAtMs)) {
    const elapsedSeconds = Math.round((Date.now() - submittedAtMs) / 1000);
    if (elapsedSeconds > HUNYUAN3D_MODELING_MAX_DURATION_SECONDS) {
      await markModelingFailed(
        record,
        {
          ...status,
          status: 'failed',
          error: `modeling timed out after ${elapsedSeconds}s (limit ${HUNYUAN3D_MODELING_MAX_DURATION_SECONDS}s)`,
        },
        requestPayloadWithRuntime,
        context,
      );
      return;
    }
  }

  const delaySeconds = HUNYUAN3D_MODELING_POLL_INTERVAL_SECONDS;
  await enqueueTaskRecord({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: 45,
    eta: delaySeconds,
    message: `modeling ${normalizedStatus || 'running'}`,
    errorCode: null,
    currentAttempt: context.attemptNo,
    nextRunAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    workerName: context.workerName,
    updatedAt: utcNow(),
  }, {
    stage: 'followup',
    eventMessage: 'task re-enqueued for modeling polling',
    delaySeconds,
  });
}

async function finalizeModelingTask(
  record: WorkerTaskRecord,
  payload: NormalizedThreeView3dPayload,
  jobId: string,
  requestPayloadWithRuntime: Record<string, unknown>,
  status: ModelingStatusResult,
  context: ExecContext,
): Promise<void> {
  await taskStore.save({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'running',
    progress: 90,
    eta: null,
    message: 'downloading GLB and registering asset',
    errorCode: null,
    currentAttempt: context.attemptNo,
    workerName: context.workerName,
    updatedAt: utcNow(),
  });

  // Download the GLB, upload it to S3 as an ENTITY_MODEL_3D asset, then attach
  // its assets:// URI to the target entity's model3d slot in the ledger.
  const glb = await downloadModelingGlb(jobId);
  const uploaded = await uploadEntityModelAsset(payload.projectId, {
    buffer: glb,
    filenameHint: `${payload.target.entityId}.glb`,
  });
  const ledger = await registerEntityModel3d({
    projectId: payload.projectId,
    entityKind: payload.target.entityKind,
    entityId: payload.target.entityId,
    depictionIndex: payload.target.depictionIndex,
    assetUri: uploaded.assetUri,
    backend: `pailang:${HUNYUAN3D_MODELING_WORKFLOW}`,
    jobId,
  });

  const result = {
    modelingJobId: jobId,
    model3dUri: uploaded.assetUri,
    entityKind: payload.target.entityKind,
    entityId: payload.target.entityId,
    ledgerPath: ledger.path,
    ledgerPointer: ledger.pointer,
    faces: status.faces,
    verts: status.verts,
    dimensions: status.dimensions,
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
    message: 'hunyuan3d_three_view execution succeeded',
    detailJson: { jobId, model3dUri: uploaded.assetUri, ledgerPointer: ledger.pointer },
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

async function markModelingFailed(
  record: WorkerTaskRecord,
  status: ModelingStatusResult,
  requestPayloadWithRuntime: Record<string, unknown>,
  context: ExecContext,
): Promise<void> {
  const finishedAt = utcNow();
  const message = status.error || `modeling ${status.status || 'failed'}`;
  const detail = {
    errorName: 'ModelingError',
    code: 'modeling_failed',
    message,
    modelingStatus: status.status,
  };

  await taskStore.save({
    ...record,
    requestPayload: requestPayloadWithRuntime,
    status: 'failed',
    progress: null,
    eta: null,
    message,
    errorCode: 'modeling_failed',
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
    message: 'hunyuan3d_three_view execution failed',
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
  context: ExecContext,
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
          code: 'invalid_three_view_payload',
          message: error.message,
        }
      : {
          ...buildTaskFailureDetail(error),
          code: 'modeling_request_failed',
        };
  const status = isRejected ? 'rejected' : 'failed';
  const message = error instanceof Error ? error.message : String(error);

  await taskStore.save({
    ...fresh,
    status,
    progress: null,
    eta: null,
    message,
    errorCode: isRejected ? String(failureDetail.code || 'task_rejected') : 'modeling_request_failed',
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
    message: isRejected ? 'hunyuan3d_three_view request rejected' : 'hunyuan3d_three_view request failed',
    detailJson: { failure: failureDetail },
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
