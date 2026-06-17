import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import os from 'os';
import {
  generateBlenderScript,
  repairBlenderScript,
  type BlenderScriptFailure,
  type GeneratedBlenderScript,
  type GenerateBlenderScriptContext,
} from '../blender/agent.js';
import {
  fetchBlenderRunLogs,
  pollBlenderRunUntilTerminal,
  submitBlenderRun,
  type BlenderApiRunStatus,
  type BlenderApiRunSubmitted,
} from '../blender/blenderApiClient.js';
import { WORKER_NAME } from '../infra/constants.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { downloadAsset } from '../render/assetStore.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import { hydrateBlenderTaskPayload } from '../blender/payload.js';
import type { HydratedBlenderTaskPayload } from '../blender/types.js';
import { buildArtifactUriMap, uploadArtifacts, uploadGeneratedScriptArtifact } from './blenderArtifacts.js';
import { computeRetryDelaySeconds } from './retryDelay.js';
import { taskStore } from './taskStore.js';
import { isTerminalWorkerTaskStatus, utcNow } from './types.js';

export const BLENDER_CONSUMER_KEY = 'blender_consumer';

const DEFAULT_SCRIPT_REPAIR_ATTEMPTS = 2;
const RUN_LOG_TAIL_LIMIT = 40;

interface BlenderRunSession {
  attemptNo: number;
  modelId: string;
  payload: HydratedBlenderTaskPayload;
  referenceImage?: { filename: string; content_type: string; base64: string };
  taskId: string;
  workerName: string;
}

interface BlenderRunOutcome {
  repairAttempts: number;
  script: GeneratedBlenderScript;
  terminalStatus: BlenderApiRunStatus;
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
    const stagedReferenceImage = await stageReferenceImage(payload.projectId, payload.inputs.sourceImageAssetUri);
    try {
      const agentContext: GenerateBlenderScriptContext = {
        workingDirectory: payload.projectRoot,
        sourceImagePath: stagedReferenceImage?.sourceImagePath || null,
      };
      const generatedScript = await generateBlenderScript(payload, agentContext);
      const session: BlenderRunSession = {
        attemptNo: context.attempts,
        modelId: resolveModelId(payload.taskId, payload.modelId),
        payload,
        referenceImage: stagedReferenceImage?.referenceImage,
        taskId,
        workerName,
      };

      await saveRunningState(session, 20, 'submitting blender run');
      await taskStore.appendEvent({
        taskId,
        eventType: 'agent_generated',
        attemptNo: context.attempts,
        workerName,
        message: 'blender script generated',
        detailJson: {
          agentInstructionsPath: generatedScript.agentInstructionsPath || null,
          provider: generatedScript.provider,
          referenceAnalysis: generatedScript.referenceAnalysis || null,
          summary: generatedScript.summary,
          threadId: generatedScript.threadId || null,
        },
      });

      const runOutcome = await executeRunWithRepair(session, generatedScript, agentContext);
      const terminalStatus = runOutcome.terminalStatus;

      await saveRunningState(session, 75, 'uploading blender artifacts');

      const artifactDetails = await uploadArtifacts(taskId, payload.projectId, terminalStatus, context.attempts, workerName);
      // PAILang returns only the GLB; upload the pristine agent script worker-side.
      artifactDetails.push(
        await uploadGeneratedScriptArtifact(taskId, payload.projectId, runOutcome.script.script, context.attempts, workerName),
      );
      const result = {
        workflow: payload.workflow.id,
        model_id: session.modelId,
        run_id: terminalStatus.run_id,
        runner_status: terminalStatus.status,
        script_repair_attempts: runOutcome.repairAttempts,
        preview_reviews: [],
        artifacts: buildArtifactUriMap(artifactDetails),
        artifact_details: artifactDetails,
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
        message: 'blender execution succeeded',
        detailJson: {
          runId: terminalStatus.run_id,
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
    } finally {
      await stagedReferenceImage?.cleanup();
    }
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

async function executeRunWithRepair(
  session: BlenderRunSession,
  initialScript: GeneratedBlenderScript,
  agentContext: GenerateBlenderScriptContext,
): Promise<BlenderRunOutcome> {
  const maxRepairAttempts = readNonNegativeIntEnv(
    'BLENDER_SCRIPT_REPAIR_ATTEMPTS',
    DEFAULT_SCRIPT_REPAIR_ATTEMPTS,
  );
  let script = initialScript;
  let repairAttempts = 0;

  while (true) {
    const submitted = await submitRun(session, script);
    try {
      const terminalStatus = await pollRunUntilTerminal(session, submitted);
      return { repairAttempts, script, terminalStatus };
    } catch (error) {
      if (!isRepairableRunFailure(error) || repairAttempts >= maxRepairAttempts) {
        throw error;
      }

      repairAttempts += 1;
      const failure = await buildScriptFailure(error as ProviderRequestError, submitted.run_id);
      await saveRunningState(session, 30, `repairing blender script (attempt ${repairAttempts})`);
      await taskStore.appendEvent({
        taskId: session.taskId,
        eventType: 'script_repair_started',
        attemptNo: session.attemptNo,
        workerName: session.workerName,
        message: `blender run failed; repairing script (attempt ${repairAttempts})`,
        detailJson: {
          attempt: repairAttempts,
          error: failure.errorMessage,
          runId: failure.runId || null,
        },
      });

      script = await repairBlenderScript(script, session.payload, agentContext, failure);

      await taskStore.appendEvent({
        taskId: session.taskId,
        eventType: 'script_repaired',
        attemptNo: session.attemptNo,
        workerName: session.workerName,
        message: `blender script repaired (attempt ${repairAttempts})`,
        detailJson: {
          attempt: repairAttempts,
          summary: script.summary,
          threadId: script.threadId || null,
        },
      });
    }
  }
}

async function submitRun(
  session: BlenderRunSession,
  script: GeneratedBlenderScript,
): Promise<BlenderApiRunSubmitted> {
  const isUpdateWorkflow = session.payload.workflow.id === 'blender-update-3d';
  const submitted = await submitBlenderRun({
    task_id: session.payload.taskId,
    workflow: session.payload.workflow.id,
    project_id: session.payload.projectId,
    scene_id: session.payload.sceneId,
    shot_id: session.payload.shotId,
    ...(isUpdateWorkflow && session.payload.modelId ? { model_id: session.payload.modelId } : {}),
    script: script.script,
    runner_target: session.payload.runnerTarget,
    ...(session.referenceImage ? { reference_image: session.referenceImage } : {}),
  });

  await saveRunningState(session, 35, 'provider submitted');
  await taskStore.appendEvent({
    taskId: session.taskId,
    eventType: 'provider_submitted',
    attemptNo: session.attemptNo,
    workerName: session.workerName,
    message: 'blender run submitted',
    detailJson: {
      runId: submitted.run_id,
      status: submitted.status,
      statusUrl: submitted.status_url || null,
      workflow: session.payload.workflow.id,
      modelId: session.modelId,
    },
  });

  return submitted;
}

async function pollRunUntilTerminal(
  session: BlenderRunSession,
  submitted: BlenderApiRunSubmitted,
): Promise<BlenderApiRunStatus> {
  let lastProviderStatus = String(submitted.status || '').trim();

  return pollBlenderRunUntilTerminal(submitted, async (status) => {
    const normalizedStatus = String(status.status || '').trim();
    if (!normalizedStatus || normalizedStatus === lastProviderStatus) {
      return;
    }
    lastProviderStatus = normalizedStatus;

    await saveRunningState(session, progressForProviderStatus(normalizedStatus), `provider ${normalizedStatus}`);
    await taskStore.appendEvent({
      taskId: session.taskId,
      eventType: 'provider_polled',
      attemptNo: session.attemptNo,
      workerName: session.workerName,
      message: `blender run status changed to ${normalizedStatus}`,
      detailJson: {
        runId: status.run_id,
        status: normalizedStatus,
      },
    });
  });
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

function isRepairableRunFailure(error: unknown): boolean {
  return error instanceof ProviderRequestError && error.code === 'provider_run_failed';
}

async function buildScriptFailure(
  error: ProviderRequestError,
  runId: string,
): Promise<BlenderScriptFailure> {
  const logs = await fetchBlenderRunLogs(runId).catch(() => []);
  const logsTail = logs
    .slice(-RUN_LOG_TAIL_LIMIT)
    .map((entry) => `${entry.stream}: ${entry.message}`);

  return {
    errorMessage: error.message,
    logsTail,
    runId,
  };
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

async function stageReferenceImage(projectId: string, assetUri: string | null) {
  if (!assetUri) {
    return null;
  }

  try {
    const downloaded = await downloadAsset(projectId, assetUri);
    const tempDirectory = await mkdtemp(join(tmpdir(), 'comfyui-blender-reference-'));
    try {
      const sourceImagePath = join(tempDirectory, buildSafeReferenceFilename(downloaded.filename, downloaded.contentType));
      await writeFile(sourceImagePath, downloaded.buffer);
      return {
        cleanup: async () => rm(tempDirectory, { recursive: true, force: true }),
        referenceImage: {
          filename: downloaded.filename,
          content_type: downloaded.contentType,
          base64: downloaded.buffer.toString('base64'),
        },
        sourceImagePath,
      };
    } catch (error) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error?.name === 'NoSuchKey' || message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      throw new TaskRejectedError(`source image asset does not exist: ${assetUri}`, 'source_asset_missing');
    }
    throw error;
  }
}

function buildSafeReferenceFilename(filename: string, contentType: string): string {
  const safeBase = basename(String(filename || '').trim() || 'reference-image')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+/, '') || 'reference-image';
  const extension = extname(safeBase) || inferExtensionFromContentType(contentType);
  const stem = safeBase.slice(0, safeBase.length - extname(safeBase).length) || 'reference-image';
  return `${stem}${extension || '.bin'}`;
}

function inferExtensionFromContentType(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) {
    return '.png';
  }
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return '.jpg';
  }
  if (normalized.includes('webp')) {
    return '.webp';
  }
  return '.bin';
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
      return 40;
    case 'queued':
      return 45;
    case 'running':
      return 60;
    case 'succeeded':
      return 70;
    default:
      return 50;
  }
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
