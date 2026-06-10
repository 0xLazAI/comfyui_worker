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
const submitBlenderRunMock = vi.fn();
const pollBlenderRunUntilTerminalMock = vi.fn();
const downloadBlenderRunArtifactMock = vi.fn();

vi.mock('./taskStore.js', () => ({
  taskStore: taskStoreMock,
}));

vi.mock('../render/assetStore.js', () => ({
  downloadAsset: downloadAssetMock,
  uploadWorkerAsset: uploadWorkerAssetMock,
}));

vi.mock('../blender/agent.js', () => ({
  generateBlenderScript: generateBlenderScriptMock,
}));

vi.mock('../blender/blenderApiClient.js', () => ({
  downloadBlenderRunArtifact: downloadBlenderRunArtifactMock,
  pollBlenderRunUntilTerminal: pollBlenderRunUntilTerminalMock,
  submitBlenderRun: submitBlenderRunMock,
}));

describe('blender task execution', () => {
  let currentRecord: WorkerTaskRecord;
  let appendedEvents: WorkerTaskEventInput[];
  let savedAttempts: WorkerTaskAttemptInput[];

  beforeEach(() => {
    currentRecord = createTaskRecord();
    appendedEvents = [];
    savedAttempts = [];

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
    submitBlenderRunMock.mockReset();
    pollBlenderRunUntilTerminalMock.mockReset();
    downloadBlenderRunArtifactMock.mockReset();
    taskStoreMock.get.mockClear();
    taskStoreMock.save.mockClear();
    taskStoreMock.appendEvent.mockClear();
    taskStoreMock.saveAttempt.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('routes blender tasks through the registered consumer and uploads returned artifacts', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://uploads/source.png',
      buffer: Buffer.from('image-binary'),
      contentType: 'image/png',
      filename: 'source.png',
    });
    generateBlenderScriptMock.mockResolvedValue({
      notes: ['created scene'],
      provider: 'codex',
      script: 'import bpy\nbpy.data.objects\n',
      summary: 'Generated a previs scene.',
      threadId: 'thread_123',
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
        artifacts: [
          { artifact_id: 'artifact_blend', filename: 'scene.blend', content_type: 'application/x-blender', kind: 'blend' },
          { artifact_id: 'artifact_preview', filename: 'preview.png', content_type: 'image/png', kind: 'preview' },
        ],
      };
    });
    downloadBlenderRunArtifactMock
      .mockResolvedValueOnce({
        buffer: Buffer.from('blend-binary'),
        contentType: 'application/x-blender',
        filename: 'scene.blend',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('preview-binary'),
        contentType: 'image/png',
        filename: 'preview.png',
      });
    uploadWorkerAssetMock
      .mockResolvedValueOnce({
        assetUri: 'assets://blender/scene.blend',
        bytes: 12,
        contentType: 'application/x-blender',
        filename: 'scene.blend',
      })
      .mockResolvedValueOnce({
        assetUri: 'assets://blender/preview.png',
        bytes: 14,
        contentType: 'image/png',
        filename: 'preview.png',
      });

    const { handleTaskExecute, supportsConsumerKey } = await import('./taskExecution.js');

    expect(supportsConsumerKey('blender_consumer')).toBe(true);
    await handleTaskExecute(envelope, context);

    expect(taskStoreMock.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      progress: 0,
      message: 'generating blender script',
    }));
    expect(appendedEvents.some((event) => event.eventType === 'started')).toBe(true);
    expect(downloadAssetMock).toHaveBeenCalledWith('project_456', 'assets://uploads/source.png');
    expect(generateBlenderScriptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project_456',
        taskId: 'task_123',
        workflow: expect.objectContaining({ id: 'blender-create-3d' }),
      }),
      expect.objectContaining({
        sourceImagePath: null,
        workingDirectory: '/data/pai-projects/project-root',
      }),
    );
    expect(submitBlenderRunMock).toHaveBeenCalledWith(expect.objectContaining({
      task_id: 'task_123',
      workflow: 'blender-create-3d',
      project_id: 'project_456',
      scene_id: 'scene_001',
      shot_id: 'shot_010',
      model_id: 'model_task_123',
      script: 'import bpy\nbpy.data.objects\n',
      reference_image: expect.objectContaining({
        base64: Buffer.from('image-binary').toString('base64'),
        content_type: 'image/png',
        filename: 'source.png',
      }),
    }));
    expect(pollBlenderRunUntilTerminalMock).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'run_123' }),
      expect.any(Function),
    );
    expect(downloadBlenderRunArtifactMock).toHaveBeenCalledTimes(2);
    expect(uploadWorkerAssetMock).toHaveBeenNthCalledWith(
      1,
      'project_456',
      'blender',
      expect.objectContaining({
        contentType: 'application/x-blender',
        filenameHint: 'scene.blend',
      }),
    );
    expect(uploadWorkerAssetMock).toHaveBeenNthCalledWith(
      2,
      'project_456',
      'blender',
      expect.objectContaining({
        contentType: 'image/png',
        filenameHint: 'preview.png',
      }),
    );
    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      workflow: 'blender-create-3d',
      model_id: 'model_task_123',
      run_id: 'run_123',
      runner_status: 'succeeded',
      artifacts: [
        expect.objectContaining({
          artifact_id: 'artifact_blend',
          asset_uri: 'assets://blender/scene.blend',
        }),
        expect.objectContaining({
          artifact_id: 'artifact_preview',
          asset_uri: 'assets://blender/preview.png',
        }),
      ],
    }));
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({
      status: 'succeeded',
      taskId: 'task_123',
    }));
  });

  test('marks blender tasks failed on terminal provider errors after the last attempt and rethrows', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 3, maxAttempts: 3 });
    const providerError = new ProviderRequestError('Blender crashed during bake', 502, 'provider_run_failed', {
      run_id: 'run_failed',
    });

    generateBlenderScriptMock.mockResolvedValue({
      notes: [],
      provider: 'codex',
      script: 'import bpy\nbpy.data.objects\n',
      summary: 'Generated a previs scene.',
      threadId: 'thread_123',
    });
    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://uploads/source.png',
      buffer: Buffer.from('image-binary'),
      contentType: 'image/png',
      filename: 'source.png',
    });
    submitBlenderRunMock.mockResolvedValue({
      run_id: 'run_failed',
      status: 'queued',
      status_url: '/runs/run_failed',
    });
    pollBlenderRunUntilTerminalMock.mockRejectedValue(providerError);

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');

    await expect(handleBlenderExecute(envelope, context)).rejects.toThrow('Blender crashed during bake');

    expect(currentRecord.status).toBe('failed');
    expect(currentRecord.message).toBe('Blender crashed during bake');
    expect(currentRecord.resultPayload).toEqual(expect.objectContaining({
      errorName: 'Error',
      message: 'Blender crashed during bake',
    }));
    expect(appendedEvents.at(-1)).toEqual(expect.objectContaining({
      eventType: 'failed',
    }));
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      errorMessage: 'Blender crashed during bake',
    }));
  });

  test('marks blender tasks rejected without rethrowing TaskRejectedError', async () => {
    const envelope = createEnvelope(currentRecord.taskId);
    const context = createContext({ attempts: 1, maxAttempts: 3 });

    generateBlenderScriptMock.mockRejectedValue(new TaskRejectedError('unsupported workflow combination', 'provider_rejected'));
    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://uploads/source.png',
      buffer: Buffer.from('image-binary'),
      contentType: 'image/png',
      filename: 'source.png',
    });

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');

    await expect(handleBlenderExecute(envelope, context)).resolves.toBeUndefined();

    expect(currentRecord.status).toBe('rejected');
    expect(currentRecord.message).toBe('unsupported workflow combination');
    expect(currentRecord.errorCode).toBe('provider_rejected');
    expect(appendedEvents.at(-1)).toEqual(expect.objectContaining({
      eventType: 'rejected',
    }));
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({
      status: 'rejected',
      errorMessage: 'unsupported workflow combination',
    }));
  });
});

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

function createTaskRecord(): WorkerTaskRecord {
  const now = '2026-06-10T00:00:00.000Z';
  return {
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
}
