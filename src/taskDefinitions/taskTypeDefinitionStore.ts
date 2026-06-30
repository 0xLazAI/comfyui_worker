import { getDatabasePool, initializeDatabase } from '../infra/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../infra/HttpError.js';
import { WORKER_NAME } from '../infra/constants.js';
import { normalizeTaskDefinitionJson } from './definitionSchema.js';
import type {
  TaskDefinitionJson,
  TaskTypeDefinitionCreateInput,
  TaskTypeDefinitionRecord,
  TaskTypeDefinitionUpdateInput,
} from './types.js';
import { REPLACE_PROP_PANEL_TASK_TYPE, RENDER_PANEL_TASK_TYPE } from '../render/workflowCatalog.js';

const DEFAULT_TASK_DEFINITION_DESCRIPTION = '默认的 render_panel 任务定义。';
const DEFAULT_REPLACE_PROP_TASK_DEFINITION_DESCRIPTION = '默认的 replace_prop_panel 任务定义。';
const SYSTEM_ACTOR = 'system';

export class TaskTypeDefinitionStore {
  async ensureReady(): Promise<void> {
    await initializeDatabase();
    await this.ensureBuiltInDefinitions();
    await this.ensureWorkerNames();
  }

  async list(filters?: {
    workerName?: string;
    taskType?: string;
    enabled?: boolean;
  }): Promise<TaskTypeDefinitionRecord[]> {
    const pool = await getDatabasePool();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters?.workerName) {
      values.push(filters.workerName);
      conditions.push(`worker_name = $${values.length}`);
    }
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
      `SELECT id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
      FROM task_type_definitions
      ${whereClause}
      ORDER BY worker_name ASC, task_type ASC, version DESC, id DESC`,
      values,
    );
    return result.rows.map(mapRowToRecord);
  }

  async getById(id: string): Promise<TaskTypeDefinitionRecord | null> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
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
      `SELECT id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
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

  async getEnabledByWorkerAndTaskType(workerName: string, taskType: string): Promise<TaskTypeDefinitionRecord | null> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by
      FROM task_type_definitions
      WHERE worker_name = $1 AND task_type = $2 AND enabled = true
      ORDER BY version DESC, id DESC
      LIMIT 1`,
      [normalizeWorkerName(workerName), taskType],
    );
    if (!result.rowCount) {
      return null;
    }
    return mapRowToRecord(result.rows[0]);
  }

  async listEnabledByWorkerName(workerName: string): Promise<TaskTypeDefinitionRecord[]> {
    return this.list({
      workerName,
      enabled: true,
    });
  }

  async listEnabledWorkerNames(): Promise<string[]> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT DISTINCT worker_name
      FROM task_type_definitions
      WHERE enabled = true
      ORDER BY worker_name ASC`,
    );
    return result.rows
      .map((row) => String(row.worker_name || '').trim())
      .filter(Boolean);
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
    const normalizedWorkerName = normalizeWorkerName(input.workerName);
    const normalizedTaskType = normalizeTaskType(input.taskType);

    try {
      await client.query('BEGIN');
      if (input.enabled) {
        await client.query(
          `UPDATE task_type_definitions
          SET enabled = false, updated_at = NOW(), updated_by = $3
          WHERE worker_name = $1 AND task_type = $2 AND enabled = true`,
          [normalizedWorkerName, normalizedTaskType, actor],
        );
      }

      const result = await client.query(
        `INSERT INTO task_type_definitions (
          worker_name,
          task_type,
          version,
          enabled,
          description,
          definition_json,
          created_by,
          updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        RETURNING id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by`,
        [
          normalizedWorkerName,
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
        throw new ConflictError('worker_name + task_type + version already exists');
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

    const nextWorkerName = input.workerName === undefined ? existing.workerName : normalizeWorkerName(input.workerName);
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
          SET enabled = false, updated_at = NOW(), updated_by = $4
          WHERE worker_name = $1 AND task_type = $2 AND enabled = true AND id <> $3`,
          [nextWorkerName, nextTaskType, id, actor],
        );
      }

      const result = await client.query(
        `UPDATE task_type_definitions
        SET worker_name = $2,
            task_type = $3,
            version = $4,
            enabled = $5,
            description = $6,
            definition_json = $7::jsonb,
            updated_at = NOW(),
            updated_by = $8
        WHERE id = $1
        RETURNING id, worker_name, task_type, version, enabled, description, definition_json, created_at, updated_at, created_by, updated_by`,
        [
          id,
          nextWorkerName,
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
        throw new ConflictError('worker_name + task_type + version already exists');
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
    await this.ensureBuiltInDefinition({
      taskType: RENDER_PANEL_TASK_TYPE,
      description: DEFAULT_TASK_DEFINITION_DESCRIPTION,
      definitionJson: defaultRenderPanelDefinitionJson(),
    });
    await this.ensureBuiltInDefinition({
      taskType: REPLACE_PROP_PANEL_TASK_TYPE,
      description: DEFAULT_REPLACE_PROP_TASK_DEFINITION_DESCRIPTION,
      definitionJson: defaultReplacePropPanelDefinitionJson(),
      requiredFieldPaths: ['params.maskMode'],
    });
    for (const seed of BLENDER_BUILT_IN_SEEDS) {
      await this.ensureBuiltInDefinition({
        taskType: seed.taskType,
        description: seed.description,
        definitionJson: seed.definitionJson(),
      });
    }
  }

  private async ensureBuiltInDefinition(input: {
    taskType: string;
    description: string;
    definitionJson: TaskDefinitionJson;
    requiredFieldPaths?: string[];
  }): Promise<void> {
    const pool = await getDatabasePool();
    // Single atomic upsert: no TOCTOU race when multiple workers start concurrently
    // against the same shared DB. The conflict arbiter must match the live unique
    // index `uq_task_type_definitions_worker_type_version (worker_name, task_type,
    // version)`; worker_name is omitted so it takes its column default and is then
    // normalized per task_type by ensureWorkerNames().
    await pool.query(
      `INSERT INTO task_type_definitions
        (task_type, version, enabled, description, definition_json, created_by, updated_by)
       VALUES ($1, 1, true, $2, $3::jsonb, $4, $4)
       ON CONFLICT (worker_name, task_type, version)
       DO UPDATE SET
         description = EXCLUDED.description,
         definition_json = EXCLUDED.definition_json,
         updated_by = EXCLUDED.updated_by`,
      [
        input.taskType,
        input.description,
        JSON.stringify(input.definitionJson),
        SYSTEM_ACTOR,
      ],
    );
  }

  private async ensureWorkerNames(): Promise<void> {
    const pool = await getDatabasePool();
    await pool.query(
      `UPDATE task_type_definitions
      SET worker_name = CASE
        WHEN task_type = 'render_panel' THEN $1
        WHEN task_type LIKE 'blender\\_%' THEN 'blender_worker'
        ELSE 'default-worker'
      END
      WHERE worker_name IS NULL OR BTRIM(worker_name) = ''`,
      [WORKER_NAME],
    );
  }
}

export const taskTypeDefinitionStore = new TaskTypeDefinitionStore();

function mapRowToRecord(row: Record<string, unknown>): TaskTypeDefinitionRecord {
  return {
    id: String(row.id),
    workerName: normalizeWorkerName(row.worker_name),
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

function normalizeWorkerName(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new ValidationError('worker_name is required');
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

function defaultReplacePropPanelDefinitionJson(): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: 'replace_prop_panel_consumer',
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
        'replace.sourceProp': {
          type: 'string',
          required: true,
          description: '用于 grounding 的原始道具描述。',
        },
        'replace.instruction': {
          type: 'string',
          required: true,
          description: '替换目标和风格约束。',
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
        'params.denoise': {
          type: 'number',
          required: false,
          default: 0.56,
          minimum: 0,
          maximum: 1,
          description: '局部重绘强度。',
        },
        'params.growMask': {
          type: 'integer',
          required: false,
          default: 6,
          minimum: 0,
          maximum: 128,
          description: '替换区域 mask 外扩像素。',
        },
        'params.guidance': {
          type: 'number',
          required: false,
          default: 3.4,
          minimum: 0,
          description: 'Flux guidance 参数。',
        },
        'params.steps': {
          type: 'integer',
          required: false,
          default: 24,
          minimum: 1,
          maximum: 128,
          description: '采样步数。',
        },
        'params.cfg': {
          type: 'number',
          required: false,
          default: 2,
          minimum: 0,
          description: '采样 CFG 参数。',
        },
        'params.groundConfidence': {
          type: 'number',
          required: false,
          default: 0.05,
          minimum: 0,
          maximum: 1,
          description: 'Grounding confidence threshold。',
        },
        'params.groundTextThreshold': {
          type: 'number',
          required: false,
          default: 0.1,
          minimum: 0,
          maximum: 1,
          description: 'Grounding text threshold。',
        },
        'params.maskMode': {
          type: 'string',
          required: false,
          default: 'auto',
          enum: ['auto', 'precise'],
          description: 'Mask 模式。auto 默认自动判断是否使用长条 corridor；precise 强制使用 SAM2 精确 mask。',
        },
      },
    },
  });
}

// Each Blender workflow is its own task_type (snake_case, mirroring render_panel /
// replace_prop_panel) with a precise per-workflow input contract, so the platform sees
// exactly which fields each workflow requires. task_type is authoritative for the
// workflow — there is no `workflow` payload field. The fine-grained validation still
// runs in hydrateBlenderTaskPayload (src/blender/payload.ts); these definitions are the
// published contract.
type BlenderFieldRule = {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'json';
  required: boolean;
  default?: string | number | boolean;
  description?: string;
};

// Codex agent + GPU runner selection are shared by every Blender workflow.
const BLENDER_COMMON_FIELDS: Record<string, BlenderFieldRule> = {
  agent: { type: 'string', required: false, default: 'codex', description: '生成 agent，目前仅支持 codex。' },
  runner_target: { type: 'string', required: false, default: 'gpu', description: '执行目标：gpu（走队列，唯一选项）。' },
};

function blenderDefinitionJson(fields: Record<string, BlenderFieldRule>): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: 'blender_consumer',
    execution: {
      // Blender generation runs a vision-capable agent plus a render + review loop,
      // which routinely takes several minutes; keep the job from timing out at the 300s default.
      timeout_seconds: 1800,
    },
    payload: {
      allow_unknown_fields: false,
      fields: { ...fields, ...BLENDER_COMMON_FIELDS },
    },
  });
}

// blender_pace_review is the only blender workflow this worker runs. The other blender
// workflows (create-3d / update-3d / pace-3d) are not part of this worker.
const BLENDER_BUILT_IN_SEEDS: Array<{
  taskType: string;
  description: string;
  definitionJson: () => TaskDefinitionJson;
}> = [
  {
    taskType: 'blender_pace_review',
    description: '批量按 shot 审核并修正 GLB：每个 shot 从平台取 PACE + shot_glb 产物，修正后回写 glb_checked。',
    definitionJson: () =>
      blenderDefinitionJson({
        // Full shot ids, e.g. ["hs001_sh001","hs001_sh002"]. sceneId is derived from each
        // shot id; the shot's PACE and its shot_glb artifact are fetched from the platform.
        shots: { type: 'json', required: true, description: '待审核的完整 shot id 数组，如 ["hs001_sh001"]。' },
        prompt: { type: 'string', required: false, description: '可选补充提示词。' },
      }),
  },
];
