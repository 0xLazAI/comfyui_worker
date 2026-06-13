import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ProviderRequestError, TaskRejectedError } from '../render/errors.js';
import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import type { WorkerTaskAttemptInput, WorkerTaskEventInput, WorkerTaskRecord } from './types.js';

const taskStoreMock = {
  appendEvent: vi.fn<(_: WorkerTaskEventInput) => Promise<unknown>>(),
  get: vi.fn<(_: string) => Promise<WorkerTaskRecord | null>>(),
  save: vi.fn<(_: WorkerTaskRecord) => Promise<void>>(),
  saveAttempt: vi.fn<(_: WorkerTaskAttemptInput) => Promise<unknown>>(),
};

const downloadAssetMock = vi.fn();
const uploadWorkerAssetMock = vi.fn();
const generateBlenderScriptMock = vi.fn();
const repairBlenderScriptMock = vi.fn();
const reviewBlenderPreviewMock = vi.fn();
const submitBlenderRunMock = vi.fn();
const pollBlenderRunUntilTerminalMock = vi.fn();
const downloadBlenderRunArtifactMock = vi.fn();
const fetchBlenderRunLogsMock = vi.fn();

vi.mock('./taskStore.js', () => ({
  taskStore: taskStoreMock,
}));

vi.mock('../render/assetStore.js', () => ({
  downloadAsset: downloadAssetMock,
  uploadWorkerAsset: uploadWorkerAssetMock,
}));

vi.mock('../blender/agent.js', () => ({
  generateBlenderScript: generateBlenderScriptMock,
  repairBlenderScript: repairBlenderScriptMock,
  reviewBlenderPreview: reviewBlenderPreviewMock,
}));

vi.mock('../blender/blenderApiClient.js', () => ({
  downloadBlenderRunArtifact: downloadBlenderRunArtifactMock,
  fetchBlenderRunLogs: fetchBlenderRunLogsMock,
  pollBlenderRunUntilTerminal: pollBlenderRunUntilTerminalMock,
  submitBlenderRun: submitBlenderRunMock,
}));

describe('blender task execution', () => {
  let currentRecord: WorkerTaskRecord;
  let appendedEvents: WorkerTaskEventInput[];
  let savedAttempts: WorkerTaskAttemptInput[];
  let tempPathsToCleanup: string[];

  beforeEach(() => {
    currentRecord = createTaskRecord();
    appendedEvents = [];
    savedAttempts = [];
    tempPathsToCleanup = [];

    taskStoreMock.get.mockImplementation(async (taskId: string) => (
      currentRecord && currentRecord.taskId === taskId ? structuredClone(currentRecord) : null
    ));
    taskStoreMock.save.mockImplementation(async (record: WorkerTaskRecord) => {
      currentRecord = structuredClone(record);
    });
    taskStoreMock.appendEvent.mockImplementation(async (input: WorkerTaskEventInput) => {
      appendedEvents.push(structuredClone(input));
      return {
        id: `evt_${appendedEvents.length}`,
        taskId: input.taskId,
        eventSeq: appendedEvents.length,
        eventType: input.eventType,
        attemptNo: input.attemptNo ?? null,
        workerName: input.workerName ?? null,
        message: input.message ?? null,
        detailJson: input.detailJson || {},
        createdAt: new Date().toISOString(),
      };
    });
    taskStoreMock.saveAttempt.mockImplementation(async (input: WorkerTaskAttemptInput) => {
      savedAttempts.push(structuredClone(input));
      return {
        id: `att_${savedAttempts.length}`,
        taskId: input.taskId,
        attemptNo: input.attemptNo,
        status: input.status,
        workerName: input.workerName ?? null,
        startedAt: input.startedAt || new Date().toISOString(),
        finishedAt: input.finishedAt ?? null,
        durationMs: input.durationMs ?? null,
        resultPayload: input.resultPayload ?? null,
        errorMessage: input.errorMessage ?? null,
      };
    });

    downloadAssetMock.mockReset();
    uploadWorkerAssetMock.mockReset();
    generateBlenderScriptMock.mockReset();
    repairBlenderScriptMock.mockReset();
    reviewBlenderPreviewMock.mockReset();
    submitBlenderRunMock.mockReset();
    pollBlenderRunUntilTerminalMock.mockReset();
    downloadBlenderRunArtifactMock.mockReset();
    fetchBlenderRunLogsMock.mockReset();
    fetchBlenderRunLogsMock.mockResolvedValue([]);
    reviewBlenderPreviewMock.mockResolvedValue(null);
    process.env.BLENDER_PREVIEW_REVIEW_ROUNDS = '0';
    taskStoreMock.get.mockClear();
    taskStoreMock.save.mockClear();
    taskStoreMock.appendEvent.mockClear();
    taskStoreMock.saveAttempt.mockClear();
  });

  afterEach(() => {
    for (const filePath of tempPathsToCleanup) {
      if (filePath.includes('/')) {
        rmSync(dirname(filePath), { recursive: true, force: true });
      }
    }
    delete process.env.BLENDER_PREVIEW_REVIEW_ROUNDS;
    delete process.env.BLENDER_PREVIEW_REVIEW_TIMEOUT_MS;
    delete process.env.BLENDER_SCRIPT_REPAIR_ATTEMPTS;
    vi.clearAllMocks();
  });

  test('routes blender tasks through the registered consumer, stages source image for codex, and uploads the required artifact set', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });
    const sourceBuffer = Buffer.from('image-binary');
    let stagedPath = '';

    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://uploads/source.png',
      buffer: sourceBuffer,
      contentType: 'image/png',
      filename: 'source.png',
    });
    generateBlenderScriptMock.mockImplementation(async (_payload, generateContext) => {
      expect(generateContext.workingDirectory).toBe('/data/pai-projects/project-root');
      expect(generateContext.sourceImagePath).toBeTruthy();
      stagedPath = String(generateContext.sourceImagePath);
      tempPathsToCleanup.push(stagedPath);
      expect(existsSync(stagedPath)).toBe(true);
      expect(readFileSync(stagedPath)).toEqual(sourceBuffer);
      return {
        agentInstructionsPath: '/repo/agent.md',
        notes: ['created scene'],
        provider: 'codex',
        referenceAnalysis: {
          blockingNotes: ['Keep slate labels outside hero silhouettes.'],
          cameraBrief: 'Low front camera centered on the puck.',
          environment: ['indoor rink', 'boards'],
          generationPrompt: 'Indoor hockey faceoff previs with referee and two players.',
          primarySubjects: ['referee', 'blue player', 'red player', 'puck'],
          sceneBrief: 'Indoor hockey faceoff with central referee.',
        },
        script: 'import bpy\nbpy.data.objects\n',
        summary: 'Generated a previs scene.',
        threadId: 'thread_123',
      };
    });
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_123',
      status: 'queued',
      status_url: '/runs/run_123',
    });
    pollBlenderRunUntilTerminalMock.mockImplementation(async (_submitted, onUpdate) => {
      await onUpdate?.({
        run_id: 'run_123',
        status: 'running',
      });
      return {
        run_id: 'run_123',
        status: 'succeeded',
        model_id: 'model_task_123',
        artifacts: createProviderArtifacts(),
      };
    });
    for (const artifact of createProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.artifact_id}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.artifact_id}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleTaskExecute, supportsConsumerKey } = await import('./taskExecution.js');

    expect(supportsConsumerKey('blender_consumer')).toBe(true);
    await handleTaskExecute(envelope, context);

    expect(taskStoreMock.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      progress: 0,
      message: 'generating blender script',
    }));
    expect(appendedEvents.some((event) => event.eventType === 'started')).toBe(true);
    expect(appendedEvents.find((event) => event.eventType === 'agent_generated')).toMatchObject({
      detailJson: {
        agentInstructionsPath: '/repo/agent.md',
        referenceAnalysis: {
          cameraBrief: 'Low front camera centered on the puck.',
          sceneBrief: 'Indoor hockey faceoff with central referee.',
        },
      },
    });
    expect(downloadAssetMock).toHaveBeenCalledWith('project_456', 'assets://uploads/source.png');
    expect(submitBlenderRunMock).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'task_123',
      workflow: 'blender-create-3d',
      project_id: 'project_456',
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      script: 'import bpy\nbpy.data.objects\n',
      reference_image: expect.objectContaining({
        base64: sourceBuffer.toString('base64'),
        content_type: 'image/png',
        filename: 'source.png',
      }),
    }));
    expect(downloadBlenderRunArtifactMock).toHaveBeenCalledTimes(6);
    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      workflow: 'blender-create-3d',
      model_id: 'model_task_123',
      run_id: 'run_123',
      runner_status: 'succeeded',
      artifacts: {
        blend: 'assets://blender/scene.blend',
        model_obj: 'assets://blender/model.obj',
        preview: 'assets://blender/preview.png',
        summary: 'assets://blender/summary.json',
        pace: 'assets://blender/pace.json',
        generated_script: 'assets://blender/generated_scene.py',
      },
      artifact_details: [
        expect.objectContaining({ artifact_id: 'scene_blend', kind: 'blend', asset_uri: 'assets://blender/scene.blend' }),
        expect.objectContaining({ artifact_id: 'model_obj', kind: 'model_obj', asset_uri: 'assets://blender/model.obj' }),
        expect.objectContaining({ artifact_id: 'preview_png', kind: 'preview', asset_uri: 'assets://blender/preview.png' }),
        expect.objectContaining({ artifact_id: 'summary_json', kind: 'summary', asset_uri: 'assets://blender/summary.json' }),
        expect.objectContaining({ artifact_id: 'pace_json', kind: 'pace', asset_uri: 'assets://blender/pace.json' }),
        expect.objectContaining({ artifact_id: 'generated_scene_py', kind: 'generated_script', asset_uri: 'assets://blender/generated_scene.py' }),
      ],
    }));
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({
      status: 'succeeded',
      taskId: 'task_123',
    }));
    expect(stagedPath).toBeTruthy();
    expect(existsSync(stagedPath)).toBe(false);
  });

  test('passes a staged optional source image to update workflow codex generation and provider submission', async () => {
    currentRecord = createTaskRecord({
      requestPayload: {
        workflow: 'blender-update-3d',
        scene_id: 'scene_001',
        shot_id: 'shot_010',
        model_id: 'model_existing',
        prompt: 'Add a canopy and soften the light',
        inputs: {
          image: {
            assetUri: 'assets://uploads/update-source.jpg',
          },
        },
      },
    });
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });
    const sourceBuffer = Buffer.from('update-image');

    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://uploads/update-source.jpg',
      buffer: sourceBuffer,
      contentType: 'image/jpeg',
      filename: 'update-source.jpg',
    });
    generateBlenderScriptMock.mockImplementation(async (_payload, generateContext) => {
      const stagedPath = String(generateContext.sourceImagePath);
      tempPathsToCleanup.push(stagedPath);
      expect(stagedPath.endsWith('.jpg')).toBe(true);
      expect(readFileSync(stagedPath)).toEqual(sourceBuffer);
      return {
        notes: [],
        provider: 'codex',
        script: 'import bpy\nbpy.data.objects\n',
        summary: 'Updated the scene.',
        threadId: 'thread_update',
      };
    });
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_update',
      status: 'queued',
      status_url: '/runs/run_update',
    });
    pollBlenderRunUntilTerminalMock.mockResolvedValue({
      run_id: 'run_update',
      status: 'succeeded',
      model_id: 'model_existing',
      artifacts: createProviderArtifacts(),
    });
    for (const artifact of createProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.artifact_id}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.artifact_id}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(submitBlenderRunMock).toHaveBeenCalledWith(expect.objectContaining({
      reference_image: expect.objectContaining({
        content_type: 'image/jpeg',
        filename: 'update-source.jpg',
      }),
    }));
    expect(submitBlenderRunMock.mock.calls[0][0]).not.toHaveProperty('model_id');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      model_id: 'model_existing',
    }));
  });

  test('accepts provider artifacts when semantic kind must be inferred from filename only', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_filename_only',
      status: 'queued',
      status_url: '/runs/run_filename_only',
    });
    pollBlenderRunUntilTerminalMock.mockResolvedValue({
      run_id: 'run_filename_only',
      status: 'succeeded',
      artifacts: createFilenameOnlyProviderArtifacts(),
    });
    for (const artifact of createFilenameOnlyProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.filename}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.filename}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      artifacts: {
        blend: 'assets://blender/scene.blend',
        model_obj: 'assets://blender/model.obj',
        preview: 'assets://blender/preview.png',
        summary: 'assets://blender/summary.json',
        pace: 'assets://blender/pace.json',
        generated_script: 'assets://blender/generated_scene.py',
      },
    }));
  });

  test('marks terminal success with missing artifacts as failed and rethrows', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 3, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_missing',
      status: 'queued',
      status_url: '/runs/run_missing',
    });
    pollBlenderRunUntilTerminalMock.mockResolvedValue({
      run_id: 'run_missing',
      status: 'succeeded',
      artifacts: [],
    });

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');

    await expect(handleBlenderExecute(envelope, context)).rejects.toMatchObject({
      code: 'provider_missing_artifact',
      statusCode: 502,
    });

    expect(currentRecord.status).toBe('failed');
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  test('marks terminal success with an empty artifact download as failed and rethrows', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 3, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_empty',
      status: 'queued',
      status_url: '/runs/run_empty',
    });
    pollBlenderRunUntilTerminalMock.mockResolvedValue({
      run_id: 'run_empty',
      status: 'succeeded',
      artifacts: createProviderArtifacts(),
    });
    downloadBlenderRunArtifactMock.mockResolvedValueOnce({
      buffer: Buffer.alloc(0),
      contentType: 'application/x-blender',
      filename: 'scene.blend',
    });

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');

    await expect(handleBlenderExecute(envelope, context)).rejects.toMatchObject({
      code: 'provider_empty_artifact',
      statusCode: 502,
    });

    expect(currentRecord.status).toBe('failed');
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  test('releases blender tasks for retry on non-terminal provider failures', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_retry',
      status: 'queued',
      status_url: '/runs/run_retry',
    });
    pollBlenderRunUntilTerminalMock.mockRejectedValue(
      new ProviderRequestError('provider unavailable', 503, 'provider_status_failed'),
    );

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');

    await expect(handleBlenderExecute(envelope, context)).rejects.toThrow('provider unavailable');

    expect(currentRecord.status).toBe('retry_waiting');
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({ status: 'released' }));
    expect(appendedEvents.at(-1)).toEqual(expect.objectContaining({ eventType: 'retry_scheduled' }));
  });

  test('marks cancel_requested tasks as cancelled before starting blender execution', async () => {
    currentRecord = createTaskRecord({ status: 'cancel_requested' });
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(currentRecord.status).toBe('cancelled');
    expect(appendedEvents.at(-1)).toEqual(expect.objectContaining({ eventType: 'cancelled' }));
    expect(generateBlenderScriptMock).not.toHaveBeenCalled();
  });

  test('repairs the script with runner feedback and resubmits when the blender run fails', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock
      .mockResolvedValueOnce({ run_id: 'run_fail_1', status: 'queued', status_url: '/runs/run_fail_1' })
      .mockResolvedValueOnce({ run_id: 'run_ok_2', status: 'queued', status_url: '/runs/run_ok_2' });
    pollBlenderRunUntilTerminalMock
      .mockRejectedValueOnce(
        new ProviderRequestError('Blender API run failed', 502, 'provider_run_failed', { run_id: 'run_fail_1' }),
      )
      .mockResolvedValueOnce({
        run_id: 'run_ok_2',
        status: 'succeeded',
        artifacts: createProviderArtifacts(),
      });
    fetchBlenderRunLogsMock.mockResolvedValue([
      { stream: 'stderr', message: "NameError: name 'boom' is not defined" },
    ]);
    repairBlenderScriptMock.mockResolvedValue({
      notes: ['repaired'],
      provider: 'codex',
      script: 'import bpy\nfixed_scene()\n',
      summary: 'Repaired the previs scene.',
      threadId: 'thread_123',
    });
    for (const artifact of createProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.artifact_id}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.artifact_id}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(repairBlenderScriptMock).toHaveBeenCalledTimes(1);
    const [, , , failure] = repairBlenderScriptMock.mock.calls[0];
    expect(failure).toMatchObject({
      errorMessage: 'Blender API run failed',
      runId: 'run_fail_1',
    });
    expect(failure.logsTail).toEqual(["stderr: NameError: name 'boom' is not defined"]);
    expect(submitBlenderRunMock).toHaveBeenCalledTimes(2);
    expect(submitBlenderRunMock.mock.calls[1][0]).toMatchObject({
      script: 'import bpy\nfixed_scene()\n',
    });
    expect(appendedEvents.some((event) => event.eventType === 'script_repair_started')).toBe(true);
    expect(appendedEvents.some((event) => event.eventType === 'script_repaired')).toBe(true);
    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      run_id: 'run_ok_2',
      script_repair_attempts: 1,
    }));
  });

  test('re-renders a corrected script when the preview review is not approved', async () => {
    process.env.BLENDER_PREVIEW_REVIEW_ROUNDS = '1';
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock
      .mockResolvedValueOnce({ run_id: 'run_first', status: 'queued', status_url: '/runs/run_first' })
      .mockResolvedValueOnce({ run_id: 'run_fixed', status: 'queued', status_url: '/runs/run_fixed' });
    pollBlenderRunUntilTerminalMock
      .mockResolvedValueOnce({
        run_id: 'run_first',
        status: 'succeeded',
        artifacts: createProviderArtifacts(),
      })
      .mockResolvedValueOnce({
        run_id: 'run_fixed',
        status: 'succeeded',
        artifacts: createProviderArtifacts(),
      });
    reviewBlenderPreviewMock.mockResolvedValue({
      approved: false,
      issues: ['Preview is too dark to inspect.'],
      script: 'import bpy\nbrighter_scene()\n',
    });
    downloadBlenderRunArtifactMock.mockResolvedValueOnce({
      buffer: Buffer.from('preview-binary'),
      contentType: 'image/png',
      filename: 'preview.png',
    });
    for (const artifact of createProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.artifact_id}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.artifact_id}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(reviewBlenderPreviewMock).toHaveBeenCalledTimes(1);
    expect(submitBlenderRunMock).toHaveBeenCalledTimes(2);
    expect(submitBlenderRunMock.mock.calls[1][0]).toMatchObject({
      script: 'import bpy\nbrighter_scene()\n',
    });
    expect(appendedEvents.some((event) => event.eventType === 'preview_reviewed')).toBe(true);
    expect(appendedEvents.some((event) => event.eventType === 'preview_fix_applied')).toBe(true);
    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      run_id: 'run_fixed',
      preview_reviews: [
        { round: 1, approved: false, issues: ['Preview is too dark to inspect.'] },
      ],
    }));
  });

  test('passes a bounded preview review timeout and keeps successful runner output when review times out', async () => {
    process.env.BLENDER_PREVIEW_REVIEW_ROUNDS = '1';
    process.env.BLENDER_PREVIEW_REVIEW_TIMEOUT_MS = '1234';
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    arrangeScriptGenerationWithSourceImage();
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_first',
      status: 'queued',
      status_url: '/runs/run_first',
    });
    pollBlenderRunUntilTerminalMock.mockResolvedValue({
      run_id: 'run_first',
      status: 'succeeded',
      artifacts: createProviderArtifacts(),
    });
    reviewBlenderPreviewMock.mockRejectedValue(
      new Error('Codex turn timed out after 1234ms and was aborted to release the codex process.'),
    );
    downloadBlenderRunArtifactMock.mockResolvedValueOnce({
      buffer: Buffer.from('preview-binary'),
      contentType: 'image/png',
      filename: 'preview.png',
    });
    for (const artifact of createProviderArtifacts()) {
      downloadBlenderRunArtifactMock.mockResolvedValueOnce({
        buffer: Buffer.from(`${artifact.artifact_id}-binary`),
        contentType: String(artifact.content_type),
        filename: String(artifact.filename),
      });
      uploadWorkerAssetMock.mockResolvedValueOnce({
        assetUri: `assets://blender/${artifact.filename}`,
        bytes: Buffer.byteLength(`${artifact.artifact_id}-binary`),
        contentType: artifact.content_type,
        filename: artifact.filename,
      });
    }

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(envelope, context);

    expect(reviewBlenderPreviewMock).toHaveBeenCalledTimes(1);
    expect(reviewBlenderPreviewMock.mock.calls[0][4]).toEqual({ turnTimeoutMs: 1234 });
    expect(appendedEvents.find((event) => event.eventType === 'preview_review_skipped')).toMatchObject({
      detailJson: {
        error: expect.stringContaining('timed out after 1234ms'),
        round: 1,
      },
    });
    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      run_id: 'run_first',
      preview_reviews: [],
    }));
  });

  test('rejects missing source images with source_asset_missing', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });
    const missingError = new Error('NoSuchKey');
    (missingError as Error & { name: string }).name = 'NoSuchKey';

    downloadAssetMock.mockRejectedValue(missingError);

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await expect(handleBlenderExecute(envelope, context)).resolves.toBeUndefined();

    expect(currentRecord.status).toBe('rejected');
    expect(currentRecord.errorCode).toBe('source_asset_missing');
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({ status: 'rejected' }));
  });
});

function arrangeScriptGenerationWithSourceImage(): void {
  const sourceBuffer = Buffer.from('image-binary');
  downloadAssetMock.mockResolvedValue({
    assetUri: 'assets://uploads/source.png',
    buffer: sourceBuffer,
    contentType: 'image/png',
    filename: 'source.png',
  });
  generateBlenderScriptMock.mockResolvedValue({
    notes: [],
    provider: 'codex',
    script: 'import bpy\nbpy.data.objects\n',
    summary: 'Generated a previs scene.',
    threadId: 'thread_123',
  });
}

function createProviderArtifacts() {
  return [
    { artifact_id: 'scene_blend', filename: 'scene.blend', content_type: 'application/x-blender' },
    { artifact_id: 'model_obj', filename: 'model.obj', content_type: 'model/obj' },
    { artifact_id: 'preview_png', filename: 'preview.png', content_type: 'image/png' },
    { artifact_id: 'summary_json', filename: 'summary.json', content_type: 'application/json' },
    { artifact_id: 'pace_json', filename: 'pace.json', content_type: 'application/json' },
    { artifact_id: 'generated_scene_py', filename: 'generated_scene.py', content_type: 'text/x-python' },
  ];
}

function createFilenameOnlyProviderArtifacts() {
  return [
    { artifact_id: 'artifact_001', filename: 'scene.blend', content_type: 'application/x-blender' },
    { artifact_id: 'artifact_002', filename: 'model.obj', content_type: 'model/obj' },
    { artifact_id: 'artifact_003', filename: 'preview.png', content_type: 'image/png' },
    { artifact_id: 'artifact_004', filename: 'summary.json', content_type: 'application/json' },
    { artifact_id: 'artifact_005', filename: 'pace.json', content_type: 'application/json' },
    { artifact_id: 'artifact_006', filename: 'generated_scene.py', content_type: 'text/x-python' },
  ];
}

function createEnvelope(taskId: string): QueueJobEnvelope<{ taskId: string }> {
  return {
    id: 'job_123',
    queue: 'worker.tasks',
    name: 'task.execute',
    attempts: 1,
    maxAttempts: 3,
    backoff: [5, 10, 30],
    timeout: 300,
    createdAt: 1,
    availableAt: 1,
    body: { taskId },
  };
}

function createContext(input: Pick<QueueHandlerContext, 'attempts' | 'maxAttempts'>): QueueHandlerContext {
  return {
    queue: 'worker.tasks',
    jobId: 'job_123',
    jobName: 'task.execute',
    attempts: input.attempts,
    maxAttempts: input.maxAttempts,
  };
}

function createTaskRecord(overrides?: Partial<WorkerTaskRecord>): WorkerTaskRecord {
  const now = '2026-06-10T00:00:00.000Z';
  const base: WorkerTaskRecord = {
    taskId: 'task_123',
    taskType: 'blender',
    projectId: 'project_456',
    requestPayload: {
      workflow: 'blender-create-3d',
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      pace: {
        schema_version: 'pace-1',
        scene: {
          scene_id: 'scene_001',
          shot_id: 'shot_010',
        },
      },
      inputs: {
        image: {
          assetUri: 'assets://uploads/source.png',
        },
      },
      _taskRuntime: {
        projectRoot: '/data/pai-projects/project-root',
      },
    },
    status: 'queued',
    queuePublishStatus: 'published',
    queuePublishedAt: now,
    queuePublishError: null,
    progress: 0,
    eta: null,
    message: 'queued',
    errorCode: null,
    resultPayload: null,
    createdAt: now,
    updatedAt: now,
    currentAttempt: 0,
    maxAttempts: 3,
    backoffSeconds: [5, 10, 30],
    timeoutSeconds: 300,
    requestId: null,
    dedupeKey: null,
    nextRunAt: null,
    startedAt: null,
    finishedAt: null,
    workerName: null,
  };

  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    requestPayload: overrides.requestPayload ? {
      ...structuredClone(base.requestPayload),
      ...structuredClone(overrides.requestPayload),
      _taskRuntime: {
        ...(base.requestPayload._taskRuntime as Record<string, unknown>),
        ...(((overrides.requestPayload as Record<string, unknown>)._taskRuntime as Record<string, unknown> | undefined) || {}),
      },
    } : structuredClone(base.requestPayload),
  };
}
