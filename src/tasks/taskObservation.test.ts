import { beforeEach, expect, test, vi } from 'vitest';
import type { WorkerTaskEventRecord, WorkerTaskRecord } from './types.js';

const taskStoreMock = {
  get: vi.fn(),
  list: vi.fn(),
  listEvents: vi.fn(),
};

vi.mock('./taskStore.js', () => ({
  taskStore: taskStoreMock,
}));

const { listTaskEvents, listTaskObservations } = await import('./taskService.js');

const baseTask: WorkerTaskRecord = {
  backoffSeconds: [15, 60, 180],
  createdAt: '2026-06-10T12:00:00.000Z',
  currentAttempt: 1,
  dedupeKey: null,
  errorCode: null,
  eta: null,
  finishedAt: null,
  maxAttempts: 3,
  message: 'provider submitted',
  nextRunAt: null,
  progress: 35,
  projectId: 'project_1',
  queuePublishedAt: '2026-06-10T12:00:01.000Z',
  queuePublishError: null,
  queuePublishStatus: 'published',
  requestId: 'req_1',
  requestPayload: {
    pace: { schema_version: 'pace-test' },
    scene_id: 's001',
    shot_id: 'hs001_sh001',
    workflow: 'blender-create-3d',
  },
  resultPayload: {
    run_id: 'run_123',
    workflow: 'blender-create-3d',
  },
  startedAt: '2026-06-10T12:00:02.000Z',
  status: 'running',
  taskId: 'task_1',
  taskType: 'blender',
  timeoutSeconds: 300,
  updatedAt: '2026-06-10T12:00:03.000Z',
  workerName: 'worker-a',
};

beforeEach(() => {
  taskStoreMock.get.mockReset();
  taskStoreMock.list.mockReset();
  taskStoreMock.listEvents.mockReset();
});

test('listTaskObservations returns dashboard-safe task details ordered by the store', async () => {
  taskStoreMock.list.mockResolvedValueOnce([baseTask]);

  const observations = await listTaskObservations({
    limit: 25,
    taskType: 'blender',
  });

  expect(taskStoreMock.list).toHaveBeenCalledWith({
    limit: 25,
    taskType: 'blender',
  });
  expect(observations).toEqual([
    {
      created_at: '2026-06-10T12:00:00.000Z',
      error_code: null,
      eta: null,
      finished_at: null,
      message: 'provider submitted',
      progress: 35,
      project_id: 'project_1',
      request_payload: {
        pace: { schema_version: 'pace-test' },
        scene_id: 's001',
        shot_id: 'hs001_sh001',
        workflow: 'blender-create-3d',
      },
      result: {
        run_id: 'run_123',
        workflow: 'blender-create-3d',
      },
      started_at: '2026-06-10T12:00:02.000Z',
      status: 'running',
      task_id: 'task_1',
      task_type: 'blender',
      updated_at: '2026-06-10T12:00:03.000Z',
      worker_name: 'worker-a',
    },
  ]);
});

test('listTaskEvents returns null when the task does not exist', async () => {
  taskStoreMock.get.mockResolvedValueOnce(null);

  await expect(listTaskEvents('missing_task')).resolves.toBeNull();
  expect(taskStoreMock.listEvents).not.toHaveBeenCalled();
});

test('listTaskEvents maps worker events to API shape', async () => {
  const event: WorkerTaskEventRecord = {
    attemptNo: 1,
    createdAt: '2026-06-10T12:00:04.000Z',
    detailJson: {
      runId: 'run_123',
      status: 'running',
    },
    eventSeq: 3,
    eventType: 'provider_submitted',
    id: 'event_1',
    message: 'blender run submitted',
    taskId: 'task_1',
    workerName: 'worker-a',
  };
  taskStoreMock.get.mockResolvedValueOnce(baseTask);
  taskStoreMock.listEvents.mockResolvedValueOnce([event]);

  const events = await listTaskEvents('task_1');

  expect(events).toEqual([
    {
      attempt_no: 1,
      created_at: '2026-06-10T12:00:04.000Z',
      detail: {
        runId: 'run_123',
        status: 'running',
      },
      event_seq: 3,
      event_type: 'provider_submitted',
      id: 'event_1',
      message: 'blender run submitted',
      task_id: 'task_1',
      worker_name: 'worker-a',
    },
  ]);
});
