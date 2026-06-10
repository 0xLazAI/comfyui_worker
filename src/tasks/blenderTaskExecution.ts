import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import os from 'os';
import { generateBlenderScript } from '../blender/agent.js';
import {
  downloadBlenderRunArtifact,
  pollBlenderRunUntilTerminal,
  submitBlenderRun,
  type BlenderApiArtifactMetadata,
  type BlenderApiRunStatus,
} from '../blender/blenderApiClient.js';
import { WORKER_NAME } from '../infra/constants.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import { downloadAsset, uploadWorkerAsset } from '../render/assetStore.js';
import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import { hydrateBlenderTaskPayload } from '../blender/payload.js';
import { taskStore } from './taskStore.js';
import { isTerminalWorkerTaskStatus, utcNow } from './types.js';

export const BLENDER_CONSUMER_KEY = 'blender_consumer';

const REQUIRED_ARTIFACT_KINDS = [
  'blend',
  'model_obj',
  'preview',
  'summary',
  'pace',
  'generated_script',
] as const;

type RequiredArtifactKind = (typeof REQUIRED_ARTIFACT_KINDS)[number];

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
      const generatedScript = await generateBlenderScript(payload, {
        workingDirectory: payload.projectRoot,
        sourceImagePath: stagedReferenceImage?.sourceImagePath || null,
      });
    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 20,
      eta: null,
      message: 'submitting blender run',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });
    await taskStore.appendEvent({
      taskId,
      eventType: 'agent_generated',
      attemptNo: context.attempts,
      workerName,
      message: 'blender script generated',
      detailJson: {
        provider: generatedScript.provider,
        summary: generatedScript.summary,
        threadId: generatedScript.threadId || null,
      },
    });

    const modelId = resolveModelId(payload.taskId, payload.modelId);
    const submitted = await submitBlenderRun({
      task_id: payload.taskId,
      workflow: payload.workflow.id,
      project_id: payload.projectId,
      scene_id: payload.sceneId,
      shot_id: payload.shotId,
      model_id: modelId,
      pace: payload.pace,
      script: generatedScript.script,
      ...(stagedReferenceImage?.referenceImage ? { reference_image: stagedReferenceImage.referenceImage } : {}),
    });
    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 35,
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
      message: 'blender run submitted',
      detailJson: {
        runId: submitted.run_id,
        status: submitted.status,
        statusUrl: submitted.status_url || null,
        workflow: payload.workflow.id,
        modelId,
      },
    });

    let lastProviderStatus = String(submitted.status || '').trim();
    const terminalStatus = await pollBlenderRunUntilTerminal(submitted, async (status) => {
      const normalizedStatus = String(status.status || '').trim();
      if (!normalizedStatus || normalizedStatus === lastProviderStatus) {
        return;
      }
      lastProviderStatus = normalizedStatus;

      await taskStore.save({
        ...(await expectTask(taskId)),
        status: 'running',
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
        message: `blender run status changed to ${normalizedStatus}`,
        detailJson: {
          runId: status.run_id,
          status: normalizedStatus,
          modelId: status.model_id || modelId,
        },
      });
    });

    await taskStore.save({
      ...(await expectTask(taskId)),
      status: 'running',
      progress: 75,
      eta: null,
      message: 'uploading blender artifacts',
      errorCode: null,
      currentAttempt: context.attempts,
      workerName,
      updatedAt: utcNow(),
    });

    const artifacts = await uploadArtifacts(taskId, payload.projectId, terminalStatus, context.attempts, workerName);
    const result = {
      workflow: payload.workflow.id,
      model_id: terminalStatus.model_id || modelId,
      run_id: terminalStatus.run_id,
      runner_status: terminalStatus.status,
      artifacts,
      artifact_uris: buildArtifactUriMap(artifacts),
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
        artifacts: artifacts.map((artifact) => ({
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

async function stageReferenceImage(projectId: string, assetUri: string | null) {
  if (!assetUri) {
    return null;
  }

  try {
    const downloaded = await downloadAsset(projectId, assetUri);
    const tempDirectory = await mkdtemp(join(tmpdir(), 'comfyui-blender-reference-'));
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
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error?.name === 'NoSuchKey' || message.includes('NoSuchKey') || message.includes('The specified key does not exist')) {
      throw new TaskRejectedError(`source image asset does not exist: ${assetUri}`, 'source_asset_missing');
    }
    throw error;
  }
}

async function uploadArtifacts(
  taskId: string,
  projectId: string,
  terminalStatus: BlenderApiRunStatus,
  attemptNo: number,
  workerName: string,
): Promise<Array<Record<string, unknown>>> {
  const artifacts = normalizeRequiredArtifacts(terminalStatus);
  const uploadedArtifacts: Array<Record<string, unknown>> = [];

  for (const artifact of artifacts) {
    const downloaded = await downloadBlenderRunArtifact(terminalStatus.run_id, artifact);
    if (!downloaded.buffer.byteLength) {
      throw new ProviderRequestError(
        `Blender API returned an empty artifact: ${artifact.kind}`,
        502,
        'provider_empty_artifact',
        {
          artifact_id: artifact.artifact_id,
          filename: artifact.filename || null,
          kind: artifact.kind,
          run_id: terminalStatus.run_id,
        },
      );
    }
    const uploaded = await uploadWorkerAsset(projectId, 'blender', {
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      filenameHint: downloaded.filename,
    });
    const detail = buildUploadedArtifactDetail(artifact, uploaded);
    uploadedArtifacts.push(detail);

    await taskStore.appendEvent({
      taskId,
      eventType: 'asset_uploaded',
      attemptNo,
      workerName,
      message: `uploaded blender artifact ${artifact.artifact_id}`,
      detailJson: detail,
    });
  }

  return uploadedArtifacts;
}

function buildUploadedArtifactDetail(
  artifact: BlenderApiArtifactMetadata & { kind: RequiredArtifactKind },
  uploaded: Awaited<ReturnType<typeof uploadWorkerAsset>>,
): Record<string, unknown> {
  return {
    artifact_id: artifact.artifact_id,
    kind: artifact.kind,
    filename: uploaded.filename,
    content_type: uploaded.contentType,
    bytes: uploaded.bytes,
    asset_uri: uploaded.assetUri,
  };
}

function normalizeRequiredArtifacts(
  terminalStatus: BlenderApiRunStatus,
): Array<BlenderApiArtifactMetadata & { kind: RequiredArtifactKind }> {
  const artifacts = Array.isArray(terminalStatus.artifacts) ? terminalStatus.artifacts : [];
  const artifactByKind = new Map<RequiredArtifactKind, BlenderApiArtifactMetadata & { kind: RequiredArtifactKind }>();

  for (const artifact of artifacts) {
    const kind = inferArtifactKind(artifact);
    if (kind && !artifactByKind.has(kind)) {
      artifactByKind.set(kind, { ...artifact, kind });
    }
  }

  const missingKinds = REQUIRED_ARTIFACT_KINDS.filter((kind) => !artifactByKind.has(kind));
  if (missingKinds.length) {
    throw new ProviderRequestError(
      `Blender API run completed without required artifacts: ${missingKinds.join(', ')}`,
      502,
      'provider_missing_artifact',
      {
        missing_kinds: missingKinds,
        run_id: terminalStatus.run_id,
      },
    );
  }

  return REQUIRED_ARTIFACT_KINDS.map((kind) => artifactByKind.get(kind) as BlenderApiArtifactMetadata & { kind: RequiredArtifactKind });
}

function inferArtifactKind(artifact: Pick<BlenderApiArtifactMetadata, 'artifact_id' | 'filename'>): RequiredArtifactKind | null {
  const artifactId = normalizeArtifactToken(artifact.artifact_id);
  const filename = normalizeArtifactToken(artifact.filename);

  if (artifactId === 'scene_blend' || filename === 'scene_blend') {
    return 'blend';
  }
  if (artifactId === 'model_obj' || filename === 'model_obj') {
    return 'model_obj';
  }
  if (artifactId === 'preview_png' || filename === 'preview_png') {
    return 'preview';
  }
  if (artifactId === 'summary_json' || filename === 'summary_json') {
    return 'summary';
  }
  if (artifactId === 'pace_json' || filename === 'pace_json') {
    return 'pace';
  }
  if (artifactId === 'generated_scene_py' || filename === 'generated_scene_py') {
    return 'generated_script';
  }
  return null;
}

function buildArtifactUriMap(artifacts: Array<Record<string, unknown>>): Record<RequiredArtifactKind, string> {
  const result = {} as Record<RequiredArtifactKind, string>;
  for (const artifact of artifacts) {
    const kind = artifact.kind as RequiredArtifactKind;
    result[kind] = String(artifact.asset_uri || '');
  }
  return result;
}

function normalizeArtifactToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

function computeRetryDelaySeconds(backoffSeconds: number[], attemptNo: number): number {
  if (!backoffSeconds.length) {
    return 0;
  }
  const index = Math.max(0, attemptNo - 1);
  return backoffSeconds[index] ?? backoffSeconds[backoffSeconds.length - 1] ?? 0;
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
