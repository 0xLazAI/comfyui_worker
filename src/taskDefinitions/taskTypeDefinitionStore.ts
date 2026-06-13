import { getDatabasePool, initializeDatabase } from '../infra/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../infra/HttpError.js';
import { normalizeTaskDefinitionJson } from './definitionSchema.js';
import type {
  TaskDefinitionJson,
  TaskTypeDefinitionCreateInput,
  TaskTypeDefinitionRecord,
  TaskTypeDefinitionUpdateInput,
} from './types.js';
import { RENDER_PANEL_TASK_TYPE } from '../render/workflowCatalog.js';

const DEFAULT_TASK_DEFINITION_DESCRIPTION = '默认的 render_panel 任务定义。';
const DEFAULT_BLENDER_TASK_DEFINITION_DESCRIPTION = '默认的 blender 任务定义。';
const BLENDER_TASK_TYPE = 'blender';
const SYSTEM_ACTOR = 'system';

export class TaskTypeDefinitionStore {
  async ensureReady(): Promise<void> {
    await initializeDatabase();
    await this.ensureBuiltInDefinitions();
  }

  async list(filters?: {
    taskType?: string;
    enabled?: boolean;
  }): Promise<TaskTypeDefinitionRecord[]> {
    const pool = await getDatabasePool();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.taskType) {
      values.push(filters.taskType);
      conditions.push(`task_type = $${values.length}`);
    }
    if (filters?.enabled !== undefined) {
      values.push(filters.enabled);
      conditions.push(`enabled = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
      FROM task_type_definitions
      ${whereClause}
      ORDER BY task_type ASC, version DESC, id DESC`,
      values,
    );
    return result.rows.map(mapRowToRecord);
  }

  async getById(id: string): Promise<TaskTypeDefinitionRecord | null> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT id, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
      FROM task_type_definitions
      WHERE id = $1`,
      [id],
    );
    if (!result.rowCount) {
      return null;
    }
    return mapRowToRecord(result.rows[0]);
  }

  async getEnabledByTaskType(taskType: string): Promise<TaskTypeDefinitionRecord | null> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT id, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
      FROM task_type_definitions
      WHERE task_type = $1 AND enabled = true
      ORDER BY version DESC, id DESC
      LIMIT 1`,
      [taskType],
    );
    if (!result.rowCount) {
      return null;
    }
    return mapRowToRecord(result.rows[0]);
  }

  async listEnabledTaskTypes(): Promise<string[]> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT DISTINCT task_type
      FROM task_type_definitions
      WHERE enabled = true
      ORDER BY task_type ASC`,
    );
    return result.rows.map((row) => String(row.task_type));
  }

  async create(input: TaskTypeDefinitionCreateInput): Promise<TaskTypeDefinitionRecord> {
    const pool = await getDatabasePool();
    const client = await pool.connect();
    const actor = normalizeActor(input.actor);
    const normalizedTaskType = normalizeTaskType(input.taskType);

    try {
      await client.query('BEGIN');
      if (input.enabled) {
        await client.query(
          `UPDATE task_type_definitions
          SET enabled = false, updated_at = NOW(), updated_by = $2
          WHERE task_type = $1 AND enabled = true`,
          [normalizedTaskType, actor],
        );
      }

      const result = await client.query(
        `INSERT INTO task_type_definitions (
          task_type,
          version,
          enabled,
          description,
          definition_json,
          created_by,
          updated_by
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        RETURNING id, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by`,
        [
          normalizedTaskType,
          normalizeVersion(input.version),
          input.enabled,
          normalizeOptionalString(input.description),
          JSON.stringify(input.definitionJson),
          actor,
          actor,
        ],
      );

      await client.query('COMMIT');
      return mapRowToRecord(result.rows[0]);
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        throw new ConflictError('task_type + version already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: TaskTypeDefinitionUpdateInput): Promise<TaskTypeDefinitionRecord> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundError('Task definition not found');
    }

    const nextTaskType = input.taskType === undefined ? existing.taskType : normalizeTaskType(input.taskType);
    const nextVersion = input.version === undefined ? existing.version : normalizeVersion(input.version);
    const nextEnabled = input.enabled === undefined ? existing.enabled : input.enabled;
    const nextDescription = input.description === undefined ? existing.description : normalizeOptionalString(input.description);
    const nextDefinitionJson = input.definitionJson === undefined ? existing.definitionJson : input.definitionJson;
    const actor = normalizeActor(input.actor);

    const pool = await getDatabasePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (nextEnabled) {
        await client.query(
          `UPDATE task_type_definitions
          SET enabled = false, updated_at = NOW(), updated_by = $3
          WHERE task_type = $1 AND enabled = true AND id <> $2`,
          [nextTaskType, id, actor],
        );
      }

      const result = await client.query(
        `UPDATE task_type_definitions
        SET task_type = $2,
            version = $3,
            enabled = $4,
            description = $5,
            definition_json = $6::jsonb,
            updated_at = NOW(),
            updated_by = $7
        WHERE id = $1
        RETURNING id, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by`,
        [
          id,
          nextTaskType,
          nextVersion,
          nextEnabled,
          nextDescription,
          JSON.stringify(nextDefinitionJson),
          actor,
        ],
      );

      await client.query('COMMIT');
      return mapRowToRecord(result.rows[0]);
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        throw new ConflictError('task_type + version already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<boolean> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `DELETE FROM task_type_definitions
      WHERE id = $1`,
      [id],
    );
    return Boolean(result.rowCount);
  }

  private async ensureBuiltInDefinitions(): Promise<void> {
    for (const definition of BUILT_IN_TASK_DEFINITIONS) {
      await this.ensureBuiltInDefinition(definition);
    }
  }

  private async ensureBuiltInDefinition(definition: BuiltInTaskDefinitionSeed): Promise<void> {
    const existing = await this.getEnabledByTaskType(definition.taskType);
    if (existing) {
      return;
    }

    const pool = await getDatabasePool();
    const count = await pool.query(
      `SELECT COUNT(*) AS count
      FROM task_type_definitions
      WHERE task_type = $1`,
      [definition.taskType],
    );
    if (Number(count.rows[0]?.count || 0) > 0) {
      return;
    }

    await this.create({
      taskType: definition.taskType,
      version: 1,
      enabled: true,
      description: definition.description,
      definitionJson: definition.definitionJson(),
      actor: SYSTEM_ACTOR,
    }).catch((error: any) => {
      if (error?.code !== '23505') {
        throw error;
      }
    });
  }
}

export const taskTypeDefinitionStore = new TaskTypeDefinitionStore();

type BuiltInTaskDefinitionSeed = {
  taskType: string;
  description: string;
  definitionJson: () => TaskDefinitionJson;
};

const BUILT_IN_TASK_DEFINITIONS: BuiltInTaskDefinitionSeed[] = [
  {
    taskType: RENDER_PANEL_TASK_TYPE,
    description: DEFAULT_TASK_DEFINITION_DESCRIPTION,
    definitionJson: defaultRenderPanelDefinitionJson,
  },
  {
    taskType: BLENDER_TASK_TYPE,
    description: DEFAULT_BLENDER_TASK_DEFINITION_DESCRIPTION,
    definitionJson: defaultBlenderDefinitionJson,
  },
];

function mapRowToRecord(row: Record<string, unknown>): TaskTypeDefinitionRecord {
  return {
    id: String(row.id),
    taskType: String(row.task_type),
    version: Number(row.version),
    enabled: Boolean(row.enabled),
    description: normalizeOptionalString(row.description),
    definitionJson: normalizeTaskDefinitionJson((row.definition_json || {}) as Record<string, unknown>),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
  };
}

function normalizeTaskType(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new ValidationError('task_type is required');
  }
  return normalized;
}

function normalizeVersion(value: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new ValidationError('version must be >= 1');
  }
  return Math.floor(normalized);
}

function normalizeActor(value: string): string {
  const normalized = String(value || '').trim();
  return normalized || SYSTEM_ACTOR;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function defaultRenderPanelDefinitionJson(): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: 'render_panel_consumer',
    payload: {
      allow_unknown_fields: false,
      fields: {
        workflow: {
          type: 'string',
          required: true,
          description: '逻辑工作流 ID。',
        },
        panelId: {
          type: 'string',
          required: true,
          description: '目标 panel 业务 ID。',
        },
        'prompt.text': {
          type: 'string',
          required: true,
          description: '正向提示词。',
        },
        'prompt.negativeText': {
          type: 'string',
          required: false,
          default: '',
          description: '负向提示词。',
        },
        'inputs.image.assetUri': {
          type: 'string',
          required: true,
          description: '输入图片资产。',
        },
        seed: {
          type: 'integer',
          required: false,
          description: '可选随机种子。',
        },
        'extraParams.denoise': {
          type: 'number',
          required: false,
          default: 0.76,
          minimum: 0,
          maximum: 1,
          description: '背景重绘强度。',
        },
        'extraParams.growMask': {
          type: 'integer',
          required: false,
          default: 5,
          minimum: 0,
          maximum: 128,
          description: '主体 mask 外扩像素。',
        },
      },
    },
  });
}

function defaultBlenderDefinitionJson(): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    execution: {
      // Blender generation runs a vision-capable agent plus a render + review loop,
      // which routinely takes several minutes; keep the job from timing out at the 300s default.
      timeout_seconds: 1800,
    },
    payload: {
      allow_unknown_fields: false,
      fields: {
        workflow: {
          type: 'string',
          required: true,
        },
        scene_id: {
          type: 'string',
          required: true,
        },
        shot_id: {
          type: 'string',
          required: true,
        },
        model_id: {
          type: 'string',
          required: false,
        },
        prompt: {
          type: 'string',
          required: false,
        },
        pace: {
          type: 'object',
          required: false,
        },
        'inputs.image.assetUri': {
          type: 'string',
          required: false,
        },
        agent: {
          type: 'string',
          required: false,
          default: 'codex',
        },
        runner_target: {
          type: 'string',
          required: false,
          default: 'gpu',
        },
      },
    },
  });
}
