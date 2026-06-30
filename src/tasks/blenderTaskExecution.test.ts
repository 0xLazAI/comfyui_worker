import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { QueueHandlerContext, QueueJobEnvelope } from '../queue/types.js';
import type { WorkerTaskAttemptInput, WorkerTaskEventInput, WorkerTaskRecord } from './types.js';

const taskStoreMock = {
  appendEvent: vi.fn<(_: WorkerTaskEventInput) => Promise<unknown>>(),
  get: vi.fn<(_: string) => Promise<WorkerTaskRecord | null>>(),
  save: vi.fn<(_: WorkerTaskRecord) => Promise<void>>(),
  saveAttempt: vi.fn<(_: WorkerTaskAttemptInput) => Promise<unknown>>(),
};

const downloadAssetMock = vi.fn();
const fetchShotReviewInputMock = vi.fn();
const writeShotGlbCheckedArtifactMock = vi.fn();
const generatePaceReviewArtifactsMock = vi.fn();
const inspectGlbMock = vi.fn();
const prependGlbImportPreambleMock = vi.fn();
const submitBlenderRunBatchMock = vi.fn();
const pollBlenderBatchUntilTerminalMock = vi.fn();
const uploadSceneGlbArtifactMock = vi.fn();

vi.mock('./taskStore.js', () => ({ taskStore: taskStoreMock }));
vi.mock('../render/assetStore.js', () => ({ downloadAsset: downloadAssetMock }));
vi.mock('./scenePaceFetch.js', () => ({
  fetchShotReviewInput: fetchShotReviewInputMock,
  writeShotGlbCheckedArtifact: writeShotGlbCheckedArtifactMock,
}));
vi.mock('../blender/paceReviewAgent.js', () => ({
  generatePaceReviewArtifacts: generatePaceReviewArtifactsMock,
}));
vi.mock('../blender/glbInspect.js', () => ({ inspectGlb: inspectGlbMock }));
vi.mock('../blender/glbImportPreamble.js', () => ({ prependGlbImportPreamble: prependGlbImportPreambleMock }));
vi.mock('../blender/blenderApiClient.js', () => ({
  submitBlenderRunBatch: submitBlenderRunBatchMock,
  pollBlenderBatchUntilTerminal: pollBlenderBatchUntilTerminalMock,
}));
vi.mock('./blenderArtifacts.js', () => ({ uploadSceneGlbArtifact: uploadSceneGlbArtifactMock }));

describe('blender pace-review batch execution', () => {
  let currentRecord: WorkerTaskRecord;
  let appendedEvents: WorkerTaskEventInput[];
  let savedAttempts: WorkerTaskAttemptInput[];

  beforeEach(() => {
    currentRecord = createTaskRecord();
    appendedEvents = [];
    savedAttempts = [];

    taskStoreMock.get.mockImplementation(async (taskId: string) =>
      currentRecord && currentRecord.taskId === taskId ? structuredClone(currentRecord) : null,
    );
    taskStoreMock.save.mockImplementation(async (record: WorkerTaskRecord) => {
      currentRecord = structuredClone(record);
    });
    taskStoreMock.appendEvent.mockImplementation(async (input: WorkerTaskEventInput) => {
      appendedEvents.push(structuredClone(input));
      return { id: `evt_${appendedEvents.length}` };
    });
    taskStoreMock.saveAttempt.mockImplementation(async (input: WorkerTaskAttemptInput) => {
      savedAttempts.push(structuredClone(input));
      return { id: `att_${savedAttempts.length}` };
    });

    downloadAssetMock.mockReset();
    fetchShotReviewInputMock.mockReset();
    writeShotGlbCheckedArtifactMock.mockReset();
    generatePaceReviewArtifactsMock.mockReset();
    inspectGlbMock.mockReset();
    prependGlbImportPreambleMock.mockReset();
    submitBlenderRunBatchMock.mockReset();
    pollBlenderBatchUntilTerminalMock.mockReset();
    uploadSceneGlbArtifactMock.mockReset();

    // Happy-path defaults; individual tests override as needed.
    fetchShotReviewInputMock.mockResolvedValue({
      paceDocument: { scenes: [{ sceneId: 's001' }] },
      glbAssetUri: 'assets://3d_storyboard/hs001_sh001.glb',
    });
    downloadAssetMock.mockResolvedValue({
      assetUri: 'assets://3d_storyboard/hs001_sh001.glb',
      buffer: Buffer.from('base-glb-binary'),
      contentType: 'model/gltf-binary',
      filename: 'hs001_sh001.glb',
    });
    inspectGlbMock.mockReturnValue({ nodes: [], cameras: [], lights: [], subjectGroups: [] });
    generatePaceReviewArtifactsMock.mockResolvedValue({
      report: '# review\nfixed the camera',
      issues: [{ category: 'missing_camera', target: 'cam', description: 'no camera', fixed: true, unfixableReason: null }],
      script: 'import bpy\n# fix\n',
      summary: 'fixed 1 issue',
      notes: [],
      agentInstructionsPath: '/repo/workflows/blender-pace-review/agent.md',
      threadId: 'thread_review',
    });
    prependGlbImportPreambleMock.mockImplementation((script: string) => `# import preamble\n${script}`);
    submitBlenderRunBatchMock.mockResolvedValue({
      batch_id: 'batch_1',
      pailang_base_url: 'http://runner.example',
      jobs: [{ run_id: 'run_1' }],
    });
    pollBlenderBatchUntilTerminalMock.mockImplementation(async (_batchId, _baseUrl, onUpdate) => {
      await onUpdate?.({ jobs: [{ run_id: 'run_1', status: 'succeeded' }] });
      return { jobs: [{ run_id: 'run_1', status: 'succeeded', error: null }] };
    });
    uploadSceneGlbArtifactMock.mockResolvedValue({
      artifact_id: 'hs001_sh001_op',
      kind: 'model_glb',
      asset_uri: 'assets://blender/hs001_sh001_op.glb',
    });
    writeShotGlbCheckedArtifactMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('runs the 3-phase batch, uploads the optimized GLB and writes it back to the shot manifest', async () => {
    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(createEnvelope(currentRecord.taskId), createContext({ attempts: 1, maxAttempts: 1 }));

    // Phase 1: PACE + base GLB fetched and audited.
    expect(fetchShotReviewInputMock).toHaveBeenCalledWith('project_456', 's001', 'hs001_sh001');
    expect(generatePaceReviewArtifactsMock).toHaveBeenCalledTimes(1);

    // Phase 2: one fix script submitted as a single batch.
    expect(submitBlenderRunBatchMock).toHaveBeenCalledTimes(1);
    const [batchRequests] = submitBlenderRunBatchMock.mock.calls[0] as [Array<{ script: string; runner_target: string }>];
    expect(batchRequests).toHaveLength(1);
    expect(batchRequests[0].runner_target).toBe('gpu');
    expect(batchRequests[0].script).toContain('import preamble');

    // Phase 3: optimized GLB uploaded + written back as 3d_storyboard_op.
    expect(uploadSceneGlbArtifactMock).toHaveBeenCalledTimes(1);
    expect(writeShotGlbCheckedArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project_456', sceneId: 's001', shotId: 'hs001_sh001' }),
    );

    expect(currentRecord.status).toBe('succeeded');
    expect(currentRecord.resultPayload).toEqual(
      expect.objectContaining({
        workflow: 'blender-pace-review',
        batch_id: 'batch_1',
        shot_count: 1,
        succeeded_count: 1,
        failed_count: 0,
      }),
    );
    expect(savedAttempts.at(-1)).toEqual(expect.objectContaining({ status: 'succeeded', taskId: 'task_123' }));
  });

  test('rejects the task when every shot fails to prepare', async () => {
    fetchShotReviewInputMock.mockRejectedValue(new Error('platform unavailable'));

    const { handleBlenderExecute } = await import('./blenderTaskExecution.js');
    await handleBlenderExecute(createEnvelope(currentRecord.taskId), createContext({ attempts: 1, maxAttempts: 1 }));

    expect(submitBlenderRunBatchMock).not.toHaveBeenCalled();
    expect(currentRecord.status).toBe('rejected');
    expect(currentRecord.errorCode).toBe('pace_review_all_failed');
  });
});

function createEnvelope(taskId: string): QueueJobEnvelope<{ taskId: string }> {
  return {
    id: 'job_123',
    queue: 'worker.tasks',
    name: 'task.execute',
    attempts: 1,
    maxAttempts: 1,
    backoff: [5, 10, 30],
    timeout: 1800,
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
    taskType: 'blender_pace_review',
    projectId: 'project_456',
    requestPayload: {
      shots: ['hs001_sh001'],
      _taskRuntime: { projectRoot: '/data/pai-projects/project-root' },
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
    maxAttempts: 1,
    backoffSeconds: [5, 10, 30],
    timeoutSeconds: 1800,
    requestId: null,
    dedupeKey: null,
    nextRunAt: null,
    startedAt: null,
    finishedAt: null,
    workerName: null,
  };

  return overrides ? { ...base, ...overrides } : base;
}
