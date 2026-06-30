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

  // ensureBuiltInDefinition now uses a single atomic INSERT ... ON CONFLICT (worker_name, task_type, version) DO UPDATE
  // instead of the old check-then-insert pattern. Uniqueness is enforced by the DB; no transaction needed.
  // DO UPDATE (not DO NOTHING) lets a fresh restart overwrite a stale row with the new definition fields.

  describe('render_panel built-in seed', () => {
    test('upserts with ON CONFLICT DO UPDATE regardless of existing state', async () => {
      const database = createDatabaseHarness();
      getDatabasePoolMock.mockResolvedValue(database.pool);

      const store = new TaskTypeDefinitionStore();
      await store.ensureReady();

      // One ON CONFLICT INSERT per built-in definition (render_panel, replace_prop_panel,
      // blender_pace_review) plus the ensureWorkerNames() backfill UPDATE. No transaction.
      expect(database.connectMock).not.toHaveBeenCalled();
      expect(database.poolQueryMock).toHaveBeenCalledTimes(4);
      const seedSql = String(database.poolQueryMock.mock.calls[0]?.[0]);
      expect(seedSql).toContain('ON CONFLICT (worker_name, task_type, version)');
      expect(seedSql).toContain('DO UPDATE SET');
      expect(seedSql).toContain('definition_json = EXCLUDED.definition_json');
    });

    test('inserts render_panel definition with correct params', async () => {
      const database = createDatabaseHarness();
      getDatabasePoolMock.mockResolvedValue(database.pool);

      await new TaskTypeDefinitionStore().ensureReady();

      expect(initializeDatabaseMock).toHaveBeenCalledTimes(1);
      const [sql, values] = database.poolQueryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT (worker_name, task_type, version)');
      expect(sql).toContain('DO UPDATE SET');
      expect(values[0]).toBe('render_panel');
      expect(values[1]).toBe('默认的 render_panel 任务定义。');
      expect(values[3]).toBe('system');

      const insertedDefinition = JSON.parse(String(values[2]));
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

  describe('blender built-in seed (only blender_pace_review online)', () => {
    // Collect every seed INSERT keyed by task_type ($1) → parsed definition_json ($3).
    function seededDefinitionsByTaskType(database: ReturnType<typeof createDatabaseHarness>): Record<string, any> {
      const byTaskType: Record<string, any> = {};
      for (const call of database.poolQueryMock.mock.calls) {
        const [sql, values] = call as [string, unknown[]];
        if (!sql.includes('ON CONFLICT (worker_name, task_type, version)') || !sql.includes('DO UPDATE SET')) {
          continue;
        }
        byTaskType[String(values[0])] = {
          description: values[1],
          actor: values[3],
          definition: JSON.parse(String(values[2])),
        };
      }
      return byTaskType;
    }

    test('seeds only blender_pace_review with a blender_consumer + 1800s timeout', async () => {
      const database = createDatabaseHarness();
      getDatabasePoolMock.mockResolvedValue(database.pool);

      await new TaskTypeDefinitionStore().ensureReady();

      const seeded = seededDefinitionsByTaskType(database);
      expect(seeded.blender_pace_review).toBeDefined();
      // The other blender workflows are not registered online yet.
      expect(seeded.blender_create_3d).toBeUndefined();
      expect(seeded.blender_update_3d).toBeUndefined();
      expect(seeded.blender_pace_3d).toBeUndefined();

      expect(seeded.blender_pace_review.actor).toBe('system');
      expect(seeded.blender_pace_review.definition).toMatchObject({
        consumer_key: 'blender_consumer',
        execution: { timeout_seconds: 1800 },
        payload: { allow_unknown_fields: false },
      });
    });

    test('blender_pace_review declares the batch shots contract', async () => {
      const database = createDatabaseHarness();
      getDatabasePoolMock.mockResolvedValue(database.pool);

      await new TaskTypeDefinitionStore().ensureReady();
      const fields = seededDefinitionsByTaskType(database).blender_pace_review.definition.payload.fields;

      expect(fields).toMatchObject({
        shots: { type: 'json', required: true },
        agent: { type: 'string', required: false, default: 'codex' },
        runner_target: { type: 'string', required: false, default: 'gpu' },
      });
      // task_type selects the workflow; the GLB + PACE are resolved from the platform.
      expect(fields.workflow).toBeUndefined();
      expect(fields.scenes).toBeUndefined();
      expect(fields.glbs).toBeUndefined();
      expect(fields.pace_document).toBeUndefined();
      expect(fields['inputs.base_glb.assetUri']).toBeUndefined();
    });

    test('INSERT is always attempted; DB handles idempotency via ON CONFLICT', async () => {
      const database = createDatabaseHarness();
      getDatabasePoolMock.mockResolvedValue(database.pool);

      await new TaskTypeDefinitionStore().ensureReady();

      // Three built-ins (render_panel, replace_prop_panel, blender_pace_review) each get an
      // INSERT attempt, plus the ensureWorkerNames UPDATE; no transaction needed.
      expect(database.connectMock).not.toHaveBeenCalled();
      expect(database.poolQueryMock).toHaveBeenCalledTimes(4);
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
    // ensureBuiltInDefinition uses a direct pool INSERT with ON CONFLICT ... DO UPDATE
    if (sql.includes('ON CONFLICT (worker_name, task_type, version)')) {
      return { rowCount: 0, rows: [] };
    }

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

    // ensureWorkerNames backfills NULL/empty worker_name rows on startup.
    if (sql.includes('UPDATE task_type_definitions') && sql.includes('SET worker_name = CASE')) {
      return { rowCount: 0, rows: [] };
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
    workerName: 'comfyui-render-worker',
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
