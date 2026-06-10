import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const taskTypeDefinitionStoreMock = {
  list: vi.fn(),
  listEnabledTaskTypes: vi.fn(),
};
const taskServiceMock = {
  getTaskResponse: vi.fn(),
  listTaskEvents: vi.fn(),
  listTaskObservations: vi.fn(),
  submitTask: vi.fn(),
};

vi.mock('./taskDefinitions/taskTypeDefinitionStore.js', () => ({
  taskTypeDefinitionStore: taskTypeDefinitionStoreMock,
}));

vi.mock('./tasks/taskService.js', () => taskServiceMock);

const { createApp } = await import('./app.js');

let server: Server | null = null;

beforeEach(() => {
  taskTypeDefinitionStoreMock.list.mockReset();
  taskTypeDefinitionStoreMock.listEnabledTaskTypes.mockReset();
  taskServiceMock.getTaskResponse.mockReset();
  taskServiceMock.listTaskEvents.mockReset();
  taskServiceMock.listTaskObservations.mockReset();
  taskServiceMock.submitTask.mockReset();
});

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
});

async function request(path: string, init?: RequestInit): Promise<Response> {
  if (!server) {
    server = createApp().listen(0);
  }
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

test('GET /tasks rejects observation requests without the worker bearer token', async () => {
  const response = await request('/tasks?task_type=blender');

  expect(response.status).toBe(401);
  expect(taskServiceMock.listTaskObservations).not.toHaveBeenCalled();
});

test('GET /tasks returns authorized task observations', async () => {
  taskServiceMock.listTaskObservations.mockResolvedValueOnce([
    {
      created_at: '2026-06-10T12:00:00.000Z',
      error_code: null,
      eta: null,
      finished_at: null,
      message: 'queued',
      progress: 0,
      project_id: 'project_1',
      request_payload: { workflow: 'blender-create-3d' },
      result: {},
      started_at: null,
      status: 'queued',
      task_id: 'task_1',
      task_type: 'blender',
      updated_at: '2026-06-10T12:00:00.000Z',
      worker_name: null,
    },
  ]);

  const response = await request('/tasks?task_type=blender&limit=25', {
    headers: {
      authorization: 'Bearer demo-worker-token',
    },
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(taskServiceMock.listTaskObservations).toHaveBeenCalledWith({
    limit: 25,
    taskType: 'blender',
  });
  expect(body.tasks).toHaveLength(1);
  expect(body.tasks[0].task_id).toBe('task_1');
});

test('GET /tasks/:taskId/events returns authorized task events', async () => {
  taskServiceMock.listTaskEvents.mockResolvedValueOnce([
    {
      attempt_no: 1,
      created_at: '2026-06-10T12:00:04.000Z',
      detail: { runId: 'run_123' },
      event_seq: 3,
      event_type: 'provider_submitted',
      id: 'event_1',
      message: 'blender run submitted',
      task_id: 'task_1',
      worker_name: 'worker-a',
    },
  ]);

  const response = await request('/tasks/task_1/events', {
    headers: {
      authorization: 'Bearer demo-worker-token',
    },
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(taskServiceMock.listTaskEvents).toHaveBeenCalledWith('task_1');
  expect(body.events).toEqual([
    expect.objectContaining({
      event_type: 'provider_submitted',
      task_id: 'task_1',
    }),
  ]);
});

test('GET /tasks/:taskId/events returns 404 when the task is missing', async () => {
  taskServiceMock.listTaskEvents.mockResolvedValueOnce(null);

  const response = await request('/tasks/missing_task/events', {
    headers: {
      authorization: 'Bearer demo-worker-token',
    },
  });

  expect(response.status).toBe(404);
});
