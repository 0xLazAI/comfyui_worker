import os from 'os';
import type { GenerateBlenderScriptContext } from '../blender/agent.js';
import {
  pollBlenderBatchUntilTerminal,
  submitBlenderRunBatch,
  type BlenderApiRunStatus,
} from '../blender/blenderApiClient.js';
import { generatePaceReviewArtifacts } from '../blender/paceReviewAgent.js';
import { inspectGlb } from '../blender/glbInspect.js';
import { prependGlbImportPreamble } from '../blender/glbImportPreamble.js';
import { WORKER_NAME } from '../infra/constants.js';
import { logger } from '../infra/logger.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { downloadAsset } from '../render/assetStore.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import { hydrateBlenderTaskPayload } from '../blender/payload.js';
import type { BlenderReviewItem, HydratedBlenderTaskPayload } from '../blender/types.js';
import { uploadSceneGlbArtifact } from './blenderArtifacts.js';
import { computeRetryDelaySeconds } from './retryDelay.js';
import { taskStore } from './taskStore.js';
import { fetchShotReviewInput, writeShotGlbCheckedArtifact } from './scenePaceFetch.js';
import { isTerminalWorkerTaskStatus, utcNow } from './types.js';

export const BLENDER_CONSUMER_KEY = 'blender_consumer';

interface BlenderRunSession {
  attemptNo: number;
  modelId: string;
  payload: HydratedBlenderTaskPayload;
  taskId: string;
  workerName: string;
}

export async function handleBlenderExecute(
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

  const payload = hydrateBlenderTaskPayload(structuredClone(record.requestPayload), {
    taskId,
    taskType: record.taskType,
    projectId: record.projectId,
    projectRoot: extractProjectRoot(record.requestPayload),
  });

  await taskStore.save({
    ...record,
    status: 'running',
    progress: 0,
    eta: null,
    message: 'generating blender script',
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
    message: 'blender execution started',
  });

  try {
    const { result, artifactDetails } = await runBlenderWorkflow(payload, context, workerName);

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
      message: 'blender execution succeeded',
      detailJson: {
        runId: (result.run_id as string | null | undefined) ?? null,
        artifacts: artifactDetails.map((artifact) => ({
          artifact_id: artifact.artifact_id,
          asset_uri: artifact.asset_uri,
          kind: artifact.kind,
        })),
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
          message: 'blender execution rejected',
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
        message: error?.message || 'blender execution failed',
        errorCode: 'blender_failed',
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
          message: 'blender execution failed',
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
          errorMessage: error?.message || 'blender execution failed',
        });
      } else {
        await taskStore.appendEvent({
          taskId,
          eventType: 'retry_scheduled',
          attemptNo: context.attempts,
          workerName,
          message: 'blender task scheduled for retry',
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
          errorMessage: error?.message || 'blender execution failed',
        });
      }
    }
    throw error;
  }
}

interface BlenderWorkflowOutcome {
  result: Record<string, unknown> & { run_id?: string | null };
  artifactDetails: Array<Record<string, unknown>>;
}

// A rough/low-poly previs GLB is small; the base GLB is embedded as base64 into
// the review fix script (the script runner has no input-file staging), so cap it
// to keep the submitted script a sane size.
const MAX_BASE_GLB_BYTES = 16 * 1024 * 1024;

/**
 * Dispatches to the per-workflow runner. blender-pace-review is the only blender
 * workflow this worker runs.
 */
async function runBlenderWorkflow(
  payload: HydratedBlenderTaskPayload,
  context: QueueHandlerContext,
  workerName: string,
): Promise<BlenderWorkflowOutcome> {
  if (payload.workflow.id === 'blender-pace-review') {
    return runPaceReviewBatchWorkflow(payload, context, workerName);
  }
  throw new TaskRejectedError(`unsupported blender workflow: ${payload.workflow.id}`, 'unsupported_workflow');
}

/**
 * blender-pace-review batch (3 phases):
 *   1. Prepare (sequential, codex-bound): per scene fetch PACE → download GLB →
 *      inspect → run the review agent → build the fix script.
 *   2. GPU batch: submit every fix script as ONE PAILang batch and poll together.
 *   3. Finalize (sequential): per scene download the fixed GLB and upload artifacts.
 * A scene failing in any phase is recorded; the task fails outright only when every
 * scene fails.
 */
async function runPaceReviewBatchWorkflow(
  payload: HydratedBlenderTaskPayload,
  context: QueueHandlerContext,
  workerName: string,
): Promise<BlenderWorkflowOutcome> {
  const taskId = payload.taskId;
  const batch = payload.reviewBatch;
  if (!batch || !batch.length) {
    throw new TaskRejectedError('blender-pace-review requires a non-empty shots batch', 'review_batch_empty');
  }

  logger.info(
    'blender-pace-review batch started task=%s project=%s shots=%d shot_ids=%s',
    taskId,
    payload.projectId,
    batch.length,
    batch.map((item) => item.shotId).join(','),
  );
  const batchStartedAtMs = Date.now();
  const session: BlenderRunSession = {
    attemptNo: context.attempts,
    modelId: resolveModelId(taskId, payload.modelId),
    payload,
    taskId,
    workerName,
  };

  const shotResults: Array<Record<string, unknown>> = [];
  const allArtifacts: Array<Record<string, unknown>> = [];

  const recordShotFailure = async (item: BlenderReviewItem, label: string, error: any): Promise<void> => {
    const errorCode = error?.code || 'pace_review_shot_failed';
    const message = error?.message || String(error);
    logger.error('blender-pace-review %s failed task=%s error=%s', label, taskId, error?.stack || message);
    await taskStore.appendEvent({
      taskId,
      eventType: 'shot_failed',
      attemptNo: context.attempts,
      workerName,
      message: `${label} failed: ${message}`,
      detailJson: { shotId: item.shotId, sceneId: item.sceneId, errorCode },
    });
    shotResults.push({ shot_id: item.shotId, scene_id: item.sceneId, status: 'failed', error_code: errorCode, message });
  };

  // Phase 1 — prepare (sequential, codex): for each shot fetch its PACE + shot_glb,
  // download the GLB, and audit it into a fix script.
  type PreparedShot = {
    item: BlenderReviewItem;
    index: number;
    label: string;
    itemPayload: HydratedBlenderTaskPayload;
    review: Awaited<ReturnType<typeof generatePaceReviewArtifacts>>;
    fixScript: string;
  };
  const prepared: PreparedShot[] = [];
  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index];
    const label = `shot ${index + 1}/${batch.length} (${item.shotId})`;
    try {
      await saveRunningState(session, Math.round(5 + (index / batch.length) * 50), `${label}: fetching PACE + shot_glb, auditing`);
      const { paceDocument, glbAssetUri } = await fetchShotReviewInput(payload.projectId, item.sceneId, item.shotId);
      const itemPayload: HydratedBlenderTaskPayload = {
        ...payload,
        sceneId: item.sceneId,
        shotId: item.shotId,
        paceDocument,
        reviewBatch: null,
        inputs: { ...payload.inputs, baseGlbAssetUri: glbAssetUri },
      };
      const prep = await prepareSceneReview(itemPayload, context, workerName, label);
      prepared.push({ item, index, label, itemPayload, review: prep.review, fixScript: prep.fixScript });
    } catch (error: any) {
      await recordShotFailure(item, label, error);
    }
  }

  if (!prepared.length) {
    throw new TaskRejectedError(`blender-pace-review prepared none of the ${batch.length} shot(s)`, 'pace_review_all_failed');
  }

  // Phase 2 — submit every fix script as ONE GPU batch and poll together.
  await saveRunningState(session, 58, `submitting ${prepared.length} fix script(s) to the GPU batch`);
  const submitted = await submitBlenderRunBatch(
    prepared.map((prep) => ({ script: prep.fixScript, runner_target: payload.runnerTarget })),
  );
  await taskStore.appendEvent({
    taskId,
    eventType: 'provider_submitted',
    attemptNo: context.attempts,
    workerName,
    message: `submitted ${prepared.length} blender jobs as batch ${submitted.batch_id}`,
    detailJson: { batchId: submitted.batch_id, jobCount: prepared.length, runnerTarget: payload.runnerTarget },
  });
  const batchStatus = await pollBlenderBatchUntilTerminal(submitted.batch_id, submitted.pailang_base_url, async (status) => {
    const finished = status.jobs.filter((job) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'rejected').length;
    await saveRunningState(session, 60 + Math.round((finished / prepared.length) * 20), `GPU batch ${submitted.batch_id}: ${finished}/${prepared.length} done`);
  });

  // Phase 3 — finalize (sequential): download + upload per scene, in submit order.
  let succeededCount = 0;
  for (let i = 0; i < prepared.length; i += 1) {
    const prep = prepared[i];
    const job = submitted.jobs[i];
    const jobStatus = batchStatus.jobs.find((entry) => entry.run_id === job.run_id);
    try {
      if (!jobStatus || jobStatus.status !== 'succeeded') {
        throw new ProviderRequestError(
          jobStatus?.error || `GPU job did not succeed (status=${jobStatus?.status || 'unknown'})`,
          502,
          'provider_run_failed',
        );
      }
      await saveRunningState(session, 80 + Math.round(((i + 1) / prepared.length) * 15), `${prep.label}: uploading fixed GLB + report`);
      const fin = await finalizeSceneReview(prep.itemPayload, prep.review, job.run_id, submitted.pailang_base_url, context, workerName);
      shotResults.push({ shot_id: prep.item.shotId, scene_id: prep.item.sceneId, status: 'succeeded', ...fin.result });
      allArtifacts.push(...fin.artifactDetails);
      succeededCount += 1;
    } catch (error: any) {
      await recordShotFailure(prep.item, prep.label, error);
    }
  }

  if (succeededCount === 0) {
    throw new TaskRejectedError(`blender-pace-review failed for all ${batch.length} shot(s)`, 'pace_review_all_failed');
  }

  const result = {
    workflow: payload.workflow.id,
    batch_id: submitted.batch_id,
    shot_count: batch.length,
    succeeded_count: succeededCount,
    failed_count: batch.length - succeededCount,
    shots: shotResults,
    artifacts: collectGlbArtifactUriMap(allArtifacts),
    artifact_details: allArtifacts,
  };

  logger.info(
    'blender-pace-review batch complete task=%s batch=%s succeeded=%d/%d elapsed_ms=%d',
    taskId,
    submitted.batch_id,
    succeededCount,
    batch.length,
    Date.now() - batchStartedAtMs,
  );

  return { result, artifactDetails: allArtifacts };
}

/** Phase 1: download + inspect the base GLB, run the review agent, build the fix script. */
async function prepareSceneReview(
  payload: HydratedBlenderTaskPayload,
  context: QueueHandlerContext,
  workerName: string,
  label: string,
): Promise<{ review: Awaited<ReturnType<typeof generatePaceReviewArtifacts>>; fixScript: string }> {
  const taskId = payload.taskId;
  const sceneId = payload.sceneId;
  const baseGlbAssetUri = payload.inputs.baseGlbAssetUri;
  if (!baseGlbAssetUri) {
    throw new TaskRejectedError('pace review scene requires a base GLB', 'base_glb_missing');
  }
  if (!payload.paceDocument) {
    throw new TaskRejectedError(`PACE document missing for scene ${sceneId}`, 'pace_document_missing');
  }

  const downloaded = await downloadBaseGlb(payload.projectId, baseGlbAssetUri);
  if (downloaded.buffer.byteLength > MAX_BASE_GLB_BYTES) {
    throw new TaskRejectedError(
      `base GLB is too large for review (${downloaded.buffer.byteLength} bytes > ${MAX_BASE_GLB_BYTES})`,
      'base_glb_too_large',
    );
  }

  let inventory;
  try {
    inventory = inspectGlb(downloaded.buffer);
  } catch (error: any) {
    throw new TaskRejectedError(`base GLB could not be parsed: ${error?.message || error}`, 'base_glb_invalid');
  }

  const agentContext: GenerateBlenderScriptContext = {
    workingDirectory: payload.projectRoot,
    sourceImagePath: null,
  };
  const review = await generatePaceReviewArtifacts(payload, inventory, agentContext);
  const issuesFixed = review.issues.filter((issue) => issue.fixed).length;
  const issuesUnfixable = review.issues.filter((issue) => !issue.fixed).length;
  await taskStore.appendEvent({
    taskId,
    eventType: 'agent_generated',
    attemptNo: context.attempts,
    workerName,
    message: `${label}: pace review generated`,
    detailJson: {
      sceneId,
      agentInstructionsPath: review.agentInstructionsPath || null,
      summary: review.summary,
      issuesTotal: review.issues.length,
      issuesFixed,
      issuesUnfixable,
      threadId: review.threadId || null,
    },
  });
  logger.info(
    'blender-pace-review %s audit complete issues_total=%d issues_fixed=%d issues_unfixable=%d',
    label,
    review.issues.length,
    issuesFixed,
    issuesUnfixable,
  );

  const fixScript = prependGlbImportPreamble(review.script, downloaded.buffer.toString('base64'));
  return { review, fixScript };
}

/** Phase 3: download the GPU-fixed GLB for one scene and upload its artifacts. */
async function finalizeSceneReview(
  payload: HydratedBlenderTaskPayload,
  review: Awaited<ReturnType<typeof generatePaceReviewArtifacts>>,
  jobRunId: string,
  pailangBaseUrl: string,
  context: QueueHandlerContext,
  workerName: string,
): Promise<BlenderWorkflowOutcome> {
  const taskId = payload.taskId;
  const sceneId = payload.sceneId;
  const shotId = payload.shotId;
  const issuesFixed = review.issues.filter((issue) => issue.fixed).length;
  const issuesUnfixable = review.issues.filter((issue) => !issue.fixed).length;

  // Synthetic terminal status so the GLB upload helper downloads by job id.
  const terminalStatus: BlenderApiRunStatus = {
    run_id: jobRunId,
    status: 'succeeded',
    artifacts: [{ artifact_id: 'model_glb', filename: 'model.glb', content_type: 'model/gltf-binary' }],
    error: null,
    pailang_base_url: pailangBaseUrl,
  };

  // Only the optimized GLB is uploaded + written back. The review report/fix script
  // stay inline in the task result (not uploaded as separate platform artifacts).
  const optimizedGlb = await uploadSceneGlbArtifact(taskId, payload.projectId, terminalStatus, `${shotId}_op`, context.attempts, workerName);

  // Append the optimized GLB to the shot manifest as a `3d_storyboard_op` artifact so
  // the platform can discover it; failure here must NOT lose the produced GLB.
  let writtenBack = false;
  try {
    await writeShotGlbCheckedArtifact({
      projectId: payload.projectId,
      sceneId,
      shotId,
      assetUri: String(optimizedGlb.asset_uri),
      filename: `${shotId}_op.glb`,
      sourceGlbUri: payload.inputs.baseGlbAssetUri,
    });
    writtenBack = true;
    await taskStore.appendEvent({
      taskId,
      eventType: 'pace_written',
      attemptNo: context.attempts,
      workerName,
      message: `wrote 3d_storyboard_op artifact for shot ${shotId}`,
      detailJson: { shotId, sceneId, assetUri: optimizedGlb.asset_uri },
    });
  } catch (error: any) {
    logger.error('blender-pace-review 3d_storyboard_op writeback failed shot=%s error=%s', shotId, error?.message || error);
  }

  logger.info(
    'blender-pace-review shot %s complete optimized_glb=%s written_back=%s run_id=%s issues_fixed=%d/%d',
    shotId,
    optimizedGlb.asset_uri,
    writtenBack,
    jobRunId,
    issuesFixed,
    review.issues.length,
  );

  const artifactDetails = [optimizedGlb];
  const result = {
    run_id: jobRunId,
    issues_total: review.issues.length,
    issues_fixed: issuesFixed,
    issues_unfixable: issuesUnfixable,
    issues: review.issues,
    optimized_glb_uri: optimizedGlb.asset_uri,
    written_back: writtenBack,
    report: review.report,
    artifacts: collectGlbArtifactUriMap(artifactDetails),
  };
  return { result, artifactDetails };
}

async function downloadBaseGlb(projectId: string, assetUri: string) {
  try {
    return await downloadAsset(projectId, assetUri);
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error?.name === 'NoSuchKey' || message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      throw new TaskRejectedError(`base GLB asset does not exist: ${assetUri}`, 'base_glb_missing');
    }
    throw error;
  }
}

/**
 * Builds a kind→uri map keyed by artifact id for multi-GLB / mixed-artifact
 * results, preserving every artifact under its id.
 */
function collectGlbArtifactUriMap(
  artifacts: Array<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const artifact of artifacts) {
    const artifactId = String(artifact.artifact_id || '');
    if (artifactId) {
      result[artifactId] = String(artifact.asset_uri || '');
    }
  }
  return result;
}

async function saveRunningState(
  session: BlenderRunSession,
  progress: number,
  message: string,
): Promise<void> {
  await taskStore.save({
    ...(await expectTask(session.taskId)),
    status: 'running',
    progress,
    eta: null,
    message,
    errorCode: null,
    currentAttempt: session.attemptNo,
    workerName: session.workerName,
    updatedAt: utcNow(),
  });
}

async function expectTask(taskId: string) {
  const record = await taskStore.get(taskId);
  if (!record) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return record;
}

function resolveModelId(taskId: string, payloadModelId: string | null): string {
  if (payloadModelId) {
    return payloadModelId;
  }
  const sanitizedTaskId = String(taskId || '').trim().replace(/[^a-z0-9_-]+/gi, '_');
  return `model_${sanitizedTaskId || 'blender_task'}`;
}

function normalizeWorkerName(): string {
  const normalized = String(WORKER_NAME || '').trim();
  return normalized || `${os.hostname()}:${process.pid}`;
}

/**
 * Resolves the directory used as the codex thread's working dir (`--cd`).
 *
 * pace-review pulls PACE + assets from the platform and reads its instructions
 * from `<cwd>/workflows/blender-pace-review/agent.md`, so it needs a valid local
 * directory but NOT the project's files. In platform mode the task carries no
 * project root (nothing is mounted locally), so fall back to the worker's cwd —
 * otherwise the codex thread would fail on a missing `--cd` before the agent runs.
 */
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

  return process.cwd();
}

function buildTaskFailureDetail(error: unknown): Record<string, unknown> {
  if (error instanceof TaskRejectedError) {
    return {
      errorName: error.name,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ProviderRequestError) {
    return {
      errorName: error.name,
      code: error.code,
      statusCode: error.statusCode,
      detail: error.detail || null,
      message: error.message,
    };
  }

  return {
    errorName: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}
