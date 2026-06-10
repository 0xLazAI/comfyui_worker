import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { TaskTypeDefinitionRecord } from './types.js';

const { initializeDatabaseMock, getDatabasePoolMock, queryMock } = vi.hoisted(() => ({
  initializeDatabaseMock: vi.fn<() => Promise<null>>(),
  getDatabasePoolMock: vi.fn<() => Promise<{ query: ReturnType<typeof vi.fn> }>>(),
  queryMock: vi.fn(),
}));

vi.mock('../infra/database.js', () => ({
  getDatabasePool: getDatabasePoolMock,
  initializeDatabase: initializeDatabaseMock,
}));

import { TaskTypeDefinitionStore } from './taskTypeDefinitionStore.js';

describe('TaskTypeDefinitionStore.ensureReady', () => {
  beforeEach(() => {
    initializeDatabaseMock.mockReset();
    getDatabasePoolMock.mockReset();
    queryMock.mockReset();

    initializeDatabaseMock.mockResolvedValue(null);
    getDatabasePoolMock.mockResolvedValue({ query: queryMock });
  });

  test('creates an enabled blender definition when one is missing', async () => {
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('WHERE task_type = $1 AND enabled = true')) {
        return createEnabledLookupResult(String(values?.[0] || ''));
      }
      if (sql.includes('SELECT COUNT(*) AS count')) {
        return createCountLookupResult(String(values?.[0] || ''));
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const store = new TaskTypeDefinitionStore();
    const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

    await store.ensureReady();

    expect(initializeDatabaseMock).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createInput = createSpy.mock.calls[0]?.[0];

    expect(createInput).toMatchObject({
      taskType: 'blender',
      version: 1,
      enabled: true,
      description: '默认的 blender 任务定义。',
      actor: 'system',
      definitionJson: {
        consumer_key: 'blender_consumer',
        payload: {
          allow_unknown_fields: false,
          fields: {
            workflow: { type: 'string', required: true },
            scene_id: { type: 'string', required: true },
            shot_id: { type: 'string', required: true },
            model_id: { type: 'string', required: false },
            prompt: { type: 'string', required: false },
            pace: { type: 'object', required: false },
            'inputs.image.assetUri': { type: 'string', required: false },
            agent: { type: 'string', required: false, default: 'codex' },
            runner_target: { type: 'string', required: false, default: 'gpu' },
          },
        },
      },
    });
  });

  test('does not create a blender definition when an enabled one already exists', async () => {
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('WHERE task_type = $1 AND enabled = true')) {
        return createEnabledLookupResult(String(values?.[0] || ''), { blenderEnabled: true });
      }
      if (sql.includes('SELECT COUNT(*) AS count')) {
        return createCountLookupResult(String(values?.[0] || ''));
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const store = new TaskTypeDefinitionStore();
    const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

    await store.ensureReady();

    expect(createSpy).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'blender' }));
  });

  test('does not create a blender definition when any blender version already exists', async () => {
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('WHERE task_type = $1 AND enabled = true')) {
        return createEnabledLookupResult(String(values?.[0] || ''));
      }
      if (sql.includes('SELECT COUNT(*) AS count')) {
        return createCountLookupResult(String(values?.[0] || ''), { blenderCount: 1 });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const store = new TaskTypeDefinitionStore();
    const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

    await store.ensureReady();

    expect(createSpy).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'blender' }));
  });
});

function createEnabledLookupResult(
  taskType: string,
  options: { blenderEnabled?: boolean } = {},
): { rowCount: number; rows: Record<string, unknown>[] } {
  if (taskType === 'render_panel') {
    return {
      rowCount: 1,
      rows: [createRow('render_panel')],
    };
  }

  if (taskType === 'blender' && options.blenderEnabled) {
    return {
      rowCount: 1,
      rows: [createRow('blender')],
    };
  }

  return {
    rowCount: 0,
    rows: [],
  };
}

function createCountLookupResult(
  taskType: string,
  options: { blenderCount?: number } = {},
): { rowCount: number; rows: Array<{ count: string }> } {
  if (taskType === 'blender') {
    return {
      rowCount: 1,
      rows: [{ count: String(options.blenderCount ?? 0) }],
    };
  }

  if (taskType === 'render_panel') {
    return {
      rowCount: 1,
      rows: [{ count: '1' }],
    };
  }

  return {
    rowCount: 1,
    rows: [{ count: '0' }],
  };
}

function createRecord(taskType: string): TaskTypeDefinitionRecord {
  return {
    id: `${taskType}-1`,
    taskType,
    version: 1,
    enabled: true,
    description: `默认的 ${taskType} 任务定义。`,
    definitionJson: {
      consumer_key: `${taskType}_consumer`,
      payload: {
        allow_unknown_fields: false,
        fields: {},
      },
    },
    createdAt: new Date('2026-06-11T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-06-11T00:00:00.000Z').toISOString(),
    createdBy: 'system',
    updatedBy: 'system',
  };
}

function createRow(taskType: string): Record<string, unknown> {
  return {
    id: `${taskType}-1`,
    task_type: taskType,
    version: 1,
    enabled: true,
    description: `默认的 ${taskType} 任务定义。`,
    definition_json: {
      consumer_key: `${taskType}_consumer`,
      payload: {
        allow_unknown_fields: false,
        fields: {},
      },
    },
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    created_by: 'system',
    updated_by: 'system',
  };
}
