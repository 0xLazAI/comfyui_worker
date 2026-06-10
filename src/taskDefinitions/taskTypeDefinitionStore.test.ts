import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { TaskTypeDefinitionRecord } from './types.js';

const { getDatabasePoolMock, initializeDatabaseMock } = vi.hoisted(() => ({
  getDatabasePoolMock: vi.fn(),
  initializeDatabaseMock: vi.fn<() => Promise<null>>(),
}));

vi.mock('../infra/database.js', () => ({
  getDatabasePool: getDatabasePoolMock,
  initializeDatabase: initializeDatabaseMock,
}));

import { TaskTypeDefinitionStore } from './taskTypeDefinitionStore.js';

describe('TaskTypeDefinitionStore.ensureReady', () => {
  beforeEach(() => {
    getDatabasePoolMock.mockReset();
    initializeDatabaseMock.mockReset();
    initializeDatabaseMock.mockResolvedValue(null);
  });

  describe('render_panel built-in seed', () => {
    test('skips create when an enabled render_panel definition already exists', async () => {
      const database = createDatabaseHarness({
        enabledTaskTypes: ['render_panel', 'blender'],
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('render_panel'));

      await store.ensureReady();

      expect(createSpy).not.toHaveBeenCalled();
      expect(database.connectMock).not.toHaveBeenCalled();
    });

    test('skips create when any render_panel version already exists', async () => {
      const database = createDatabaseHarness({
        enabledTaskTypes: ['blender'],
        countsByTaskType: { render_panel: 1 },
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('render_panel'));

      await store.ensureReady();

      expect(createSpy).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'render_panel' }));
      expect(database.connectMock).not.toHaveBeenCalled();
    });

    test('creates the default enabled render_panel definition when missing', async () => {
      const database = createDatabaseHarness({
        enabledTaskTypes: ['blender'],
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();

      await store.ensureReady();

      expect(initializeDatabaseMock).toHaveBeenCalledTimes(1);
      expect(database.connectMock).toHaveBeenCalledTimes(1);
      expect(database.releaseMock).toHaveBeenCalledTimes(1);
      expect(database.clientQueryMock.mock.calls.map(([sql]) => String(sql))).toEqual([
        'BEGIN',
        expect.stringContaining('UPDATE task_type_definitions'),
        expect.stringContaining('INSERT INTO task_type_definitions'),
        'COMMIT',
      ]);

      expect(database.clientQueryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('WHERE task_type = $1 AND enabled = true'),
        ['render_panel', 'system'],
      );

      const insertCall = database.clientQueryMock.mock.calls[2];
      expect(insertCall?.[1]).toEqual([
        'render_panel',
        1,
        true,
        '默认的 render_panel 任务定义。',
        expect.any(String),
        'system',
        'system',
      ]);

      const insertedDefinition = JSON.parse(String(insertCall?.[1]?.[4]));
      expect(insertedDefinition).toMatchObject({
        consumer_key: 'render_panel_consumer',
        payload: {
          allow_unknown_fields: false,
          fields: {
            workflow: { type: 'string', required: true },
            panelId: { type: 'string', required: true },
            'prompt.text': { type: 'string', required: true },
            'prompt.negativeText': { type: 'string', required: false, default: '' },
            'inputs.image.assetUri': { type: 'string', required: true },
            seed: { type: 'integer', required: false },
            'extraParams.denoise': { type: 'number', required: false, default: 0.76, minimum: 0, maximum: 1 },
            'extraParams.growMask': { type: 'integer', required: false, default: 5, minimum: 0, maximum: 128 },
          },
        },
      });
    });
  });

  describe('blender built-in seed', () => {
    test('creates an enabled blender definition when one is missing', async () => {
      const database = createDatabaseHarness({
        enabledTaskTypes: ['render_panel'],
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

      await store.ensureReady();

      expect(initializeDatabaseMock).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
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
      const database = createDatabaseHarness({
        enabledTaskTypes: ['render_panel', 'blender'],
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

      await store.ensureReady();

      expect(createSpy).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'blender' }));
    });

    test('does not create a blender definition when any blender version already exists', async () => {
      const database = createDatabaseHarness({
        enabledTaskTypes: ['render_panel'],
        countsByTaskType: { blender: 1 },
      });
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      const createSpy = vi.spyOn(store, 'create').mockResolvedValue(createRecord('blender'));

      await store.ensureReady();

      expect(createSpy).not.toHaveBeenCalledWith(expect.objectContaining({ taskType: 'blender' }));
    });
  });
});

type DatabaseHarnessOptions = {
  enabledTaskTypes?: string[];
  countsByTaskType?: Record<string, number>;
};

function createDatabaseHarness(options: DatabaseHarnessOptions = {}) {
  const enabledTaskTypes = new Set(options.enabledTaskTypes || []);
  const countsByTaskType = options.countsByTaskType || {};
  const releaseMock = vi.fn();

  const clientQueryMock = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('UPDATE task_type_definitions')) {
      return { rowCount: 0, rows: [] };
    }

    if (sql.includes('INSERT INTO task_type_definitions')) {
      return {
        rowCount: 1,
        rows: [
          createInsertRow({
            taskType: String(values?.[0] || ''),
            version: Number(values?.[1] || 0),
            enabled: Boolean(values?.[2]),
            description: values?.[3] == null ? null : String(values[3]),
            definitionJson: JSON.parse(String(values?.[4] || '{}')),
            createdBy: String(values?.[5] || 'system'),
            updatedBy: String(values?.[6] || 'system'),
          }),
        ],
      };
    }

    throw new Error(`Unexpected client query: ${sql}`);
  });

  const connectMock = vi.fn(async () => ({
    query: clientQueryMock,
    release: releaseMock,
  }));

  const poolQueryMock = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('WHERE task_type = $1 AND enabled = true')) {
      const taskType = String(values?.[0] || '');
      return enabledTaskTypes.has(taskType)
        ? { rowCount: 1, rows: [createRow(taskType)] }
        : { rowCount: 0, rows: [] };
    }

    if (sql.includes('SELECT COUNT(*) AS count')) {
      const taskType = String(values?.[0] || '');
      return {
        rowCount: 1,
        rows: [{ count: String(countsByTaskType[taskType] ?? 0) }],
      };
    }

    throw new Error(`Unexpected pool query: ${sql}`);
  });

  return {
    clientQueryMock,
    connectMock,
    pool: {
      connect: connectMock,
      query: poolQueryMock,
    },
    poolQueryMock,
    releaseMock,
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
  return createInsertRow({
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
    createdBy: 'system',
    updatedBy: 'system',
  });
}

function createInsertRow(input: {
  taskType: string;
  version: number;
  enabled: boolean;
  description: string | null;
  definitionJson: Record<string, unknown>;
  createdBy: string;
  updatedBy: string;
}): Record<string, unknown> {
  return {
    id: `${input.taskType}-1`,
    task_type: input.taskType,
    version: input.version,
    enabled: input.enabled,
    description: input.description,
    definition_json: input.definitionJson,
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    created_by: input.createdBy,
    updated_by: input.updatedBy,
  };
}
