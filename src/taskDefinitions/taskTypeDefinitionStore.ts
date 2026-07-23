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
import { TRAIN_STYLE_LORA_CONSUMER_KEY, TRAIN_STYLE_LORA_TASK_TYPE } from '../train/loraTrainPayload.js';
import { THREE_VIEW_3D_CONSUMER_KEY, THREE_VIEW_3D_TASK_TYPE } from '../model3d/threeViewPayload.js';

const DEFAULT_TASK_DEFINITION_DESCRIPTION = '默认的 render_panel 任务定义。';
const DEFAULT_REPLACE_PROP_TASK_DEFINITION_DESCRIPTION = '默认的 replace_prop_panel 任务定义。';
const DEFAULT_TRAIN_STYLE_LORA_TASK_DEFINITION_DESCRIPTION = '默认的 train_style_lora 风格 LoRA 训练任务定义。';
const DEFAULT_THREE_VIEW_3D_TASK_DEFINITION_DESCRIPTION = '默认的 hunyuan3d_three_view 三视图生成 3D 模型任务定义。';
const SYSTEM_ACTOR = 'system';

export class TaskTypeDefinitionStore {
  async ensureReady(): Promise<void> {
    await initializeDatabase();
    await this.ensureWorkerNames();
    await this.ensureBuiltInDefinitions();
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
    await this.ensureBuiltInDefinition({
      taskType: TRAIN_STYLE_LORA_TASK_TYPE,
      description: DEFAULT_TRAIN_STYLE_LORA_TASK_DEFINITION_DESCRIPTION,
      definitionJson: defaultTrainStyleLoraDefinitionJson(),
    });
    await this.ensureBuiltInDefinition({
      taskType: THREE_VIEW_3D_TASK_TYPE,
      description: DEFAULT_THREE_VIEW_3D_TASK_DEFINITION_DESCRIPTION,
      definitionJson: defaultThreeView3dDefinitionJson(),
      // Definitions live in the DB and are never refreshed in place — an existing enabled
      // row wins over whatever this file says. `requiredFieldPaths` is the only upgrade
      // path: name a field the old row lacks and startup publishes a new version carrying
      // the whole definition above.
      //
      // Naming the `turnaround` umbrella (not the leaves under it) is the point: once a row
      // carries the umbrella, every future field storyboard-tool adds under `turnaround`
      // passes without another entry here.
      //
      // `target` is the same idea for the OTHER umbrella: naming it republishes the row that
      // predates it, so `target.bboxM` (the prop's intrinsic size, forwarded for the metric
      // bake) — and any future `target.*` field — passes without further churn.
      requiredFieldPaths: ['turnaround', 'target'],
      // `requiredFieldEnums` is the enum-VALUE upgrade path. Widening an enum (adding
      // `location` to `target.entityKind`) adds no new field, so `requiredFieldPaths` can't
      // see it — the deployed row already carries `target.entityKind`, just with a narrower
      // enum, and the submit-time validator (server) keeps rejecting the new value. Naming
      // the required members here republishes the row when the live enum lacks any of them.
      // Superset test: the live enum must CONTAIN these; extra live values are fine.
      requiredFieldEnums: { 'target.entityKind': ['prop', 'character', 'location'] },
    });
  }

  private async ensureBuiltInDefinition(input: {
    taskType: string;
    description: string;
    definitionJson: TaskDefinitionJson;
    requiredFieldPaths?: string[];
    requiredFieldEnums?: Record<string, string[]>;
  }): Promise<void> {
    const existing = await this.getEnabledByWorkerAndTaskType(WORKER_NAME, input.taskType);
    if (existing) {
      const missingFields = (input.requiredFieldPaths || [])
        .filter((fieldPath) => !existing.definitionJson.payload.fields[fieldPath]);
      // A field that exists but whose enum has since widened also needs a republish. Compare
      // the live row's enum against the required members; a missing member (or an absent enum
      // where one is now required) forces the upgrade, same as a missing field.
      const staleEnumFields = Object.entries(input.requiredFieldEnums || {})
        .filter(([fieldPath, requiredValues]) => {
          const liveEnum = existing.definitionJson.payload.fields[fieldPath]?.enum ?? [];
          return requiredValues.some((value) => !liveEnum.includes(value));
        })
        .map(([fieldPath]) => fieldPath);
      if (missingFields.length || staleEnumFields.length) {
        const definitions = await this.list({
          workerName: WORKER_NAME,
          taskType: input.taskType,
        });
        const nextVersion = Math.max(existing.version, ...definitions.map((definition) => definition.version)) + 1;
        await this.create({
          workerName: WORKER_NAME,
          taskType: input.taskType,
          version: nextVersion,
          enabled: true,
          description: input.description,
          definitionJson: input.definitionJson,
          actor: SYSTEM_ACTOR,
        });
      }
      return;
    }

    const pool = await getDatabasePool();
    const count = await pool.query(
      `SELECT COUNT(*) AS count
      FROM task_type_definitions
      WHERE worker_name = $1 AND task_type = $2`,
      [WORKER_NAME, input.taskType],
    );
    if (Number(count.rows[0]?.count || 0) > 0) {
      return;
    }

    await this.create({
      workerName: WORKER_NAME,
      taskType: input.taskType,
      version: 1,
      enabled: true,
      description: input.description,
      definitionJson: input.definitionJson,
      actor: SYSTEM_ACTOR,
    }).catch((error: any) => {
      if (error?.code !== '23505') {
        throw error;
      }
    });
  }

  private async ensureWorkerNames(): Promise<void> {
    const pool = await getDatabasePool();
    await pool.query(
      `UPDATE task_type_definitions
      SET worker_name = CASE
        WHEN task_type = 'render_panel' THEN $1
        WHEN task_type = 'blender' THEN 'blender_worker'
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

function defaultTrainStyleLoraDefinitionJson(): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: TRAIN_STYLE_LORA_CONSUMER_KEY,
    payload: {
      allow_unknown_fields: false,
      fields: {
        mode: {
          type: 'string',
          required: true,
          enum: ['initial', 'continue_weights'],
          description: '训练模式：initial 初训；continue_weights 从已有 LoRA 权重继续训练。',
        },
        baseProfile: {
          type: 'string',
          required: true,
          enum: ['flux2_dev_bf16', 'flux2_klein9b'],
          description: '训练基座 profile。flux2_dev_bf16 产物给 flux2_dev_fp8mixed 推理；flux2_klein9b 产物给 Klein9B 工作流推理。',
        },
        'lora.name': {
          type: 'string',
          required: true,
          description: '输出 LoRA 名称，不含路径。建议只用字母、数字、点、下划线、连字符。',
        },
        'lora.kind': {
          type: 'string',
          required: false,
          default: 'style',
          enum: ['style'],
          description: 'LoRA 类型。第一版仅支持 style。',
        },
        'lora.trigger': {
          type: 'string',
          required: true,
          description: '触发词，例如 dunhuangmap。',
        },
        'lora.description': {
          type: 'string',
          required: false,
          description: '可选的人类可读描述。',
        },
        'dataset.uri': {
          type: 'string',
          required: true,
          description: '训练集 S3 prefix。必须是单层平铺 image/txt pairs，例如 s3://bucket/path/to/dataset/。',
        },
        'continueFrom.loraPath': {
          type: 'string',
          required: false,
          description: 'mode=continue_weights 时必填，训练机上的旧 LoRA 本地路径。',
        },
        'train.preset': {
          type: 'string',
          required: false,
          description: '训练 preset 名称。不传时按 mode 使用 style 或 style_continue。',
        },
        'train.rank': {
          type: 'integer',
          required: false,
          minimum: 1,
          description: 'LoRA rank。不传时按 baseProfile 默认。',
        },
        'train.alpha': {
          type: 'number',
          required: false,
          minimum: 0,
          description: 'LoRA alpha。不传时按 baseProfile 默认。',
        },
        'train.steps': {
          type: 'integer',
          required: false,
          minimum: 1,
          description: '训练步数。不传时按 baseProfile + mode 默认。',
        },
        'train.lr': {
          type: 'number',
          required: false,
          minimum: 0,
          description: '学习率。不传时按 baseProfile + mode 默认。',
        },
        'train.seed': {
          type: 'integer',
          required: false,
          minimum: 0,
          description: '随机种子，默认 42。',
        },
        'train.saveEvery': {
          type: 'integer',
          required: false,
          minimum: 1,
          description: 'checkpoint 保存间隔，不传默认 500。',
        },
        'publish.mode': {
          type: 'string',
          required: false,
          default: 'local',
          enum: ['local'],
          description: '发布模式。第一版仅登记训练机本地路径，不上传 S3。',
        },
        'publish.filename': {
          type: 'string',
          required: false,
          description: '最终文件名，默认 <lora.name>.safetensors。',
        },
      },
    },
  });
}

/** Exported for the contract test that asserts this allowlist accepts everything
 *  `hydrateThreeView3dPayload` consumes — the two must not drift apart. */
export function defaultThreeView3dDefinitionJson(): TaskDefinitionJson {
  return normalizeTaskDefinitionJson({
    consumer_key: THREE_VIEW_3D_CONSUMER_KEY,
    payload: {
      allow_unknown_fields: false,
      fields: {
        // ── 伞节点：turnaround 的**内部形状不由契约主张** ──────────────────────────
        // isAllowedPath 放行「已声明路径的任何后代」，所以声明了 turnaround 这个 object，
        // turnaround.* 下的任何字段都自动过闸 —— 上游 storyboard-tool 往 model_input_sheet
        // artifact 上加字段（新的 formatVersion 带来的元数据等）时，**这里不用改**。
        //
        // 为什么不靠枚举：契约存在 DB 里、且 ensureBuiltInDefinition 不原地刷新，所以每加一个
        // 字段都要「改代码 + 加 requiredFieldPaths + 部署」三连，漏一步就是线上 400（#10 就是
        // 这么死的）。而字段合法性本来就是 hydrateThreeView3dPayload 的职责（它认版本、校验
        // assets:// 前缀、拒未知 formatVersion）——契约再枚举一遍就是第二份真值，只会漂移。
        //
        // 下面的叶子**仍然保留**：它们不是校验用的（伞节点已放行一切），而是
        // WorkerRegistryPublisher 把 fields 发布成 payloadSchema 给平台/agent 表单渲染的文档。
        // 即：**校验归 worker，文档归契约**。新字段无需登记即可工作，想让它出现在表单里再补一行。
        turnaround: {
          type: 'object',
          required: false,
          description:
            '模式A：三视图整图 sheet。与 views 二选一。内部字段由 worker 校验（assetUri 必填；model_input_sheet 另带 formatVersion/normalized）。',
        },
        'turnaround.assetUri': {
          type: 'string',
          required: false,
          description: '模式A：三视图整图 sheet 的 assets:// URI，worker 内部切片。与 views 二选一。',
        },
        'turnaround.formatVersion': {
          type: 'string',
          required: false,
          description:
            'storyboard-tool model_input_sheet 的格式版本（现只认 v1 = 一行 front/left/back，三类实体统一）。不传=老的 styled turnaround sheet，按 entityKind 切。未知版本直接拒绝，绝不猜。',
        },
        'turnaround.normalized': {
          type: 'boolean',
          required: false,
          description:
            '上游三等分归一化是否真的成功。true → 按精确 1/N 等分切；false/缺省 → 上游回退了原图，改用空白投影测量。缺省当 false（来路不明不算保证）。',
        },
        'views.front.assetUri': {
          type: 'string',
          required: false,
          description: '模式B：正面单视图的 assets:// URI。与 turnaround 二选一（提供 views 时 front 必填，由 worker 校验）。',
        },
        'views.left.assetUri': {
          type: 'string',
          required: false,
          description: '左视图图片的 assets:// URI（可选）。',
        },
        'views.right.assetUri': {
          type: 'string',
          required: false,
          description: '右视图图片的 assets:// URI（可选）。',
        },
        'views.back.assetUri': {
          type: 'string',
          required: false,
          description: '背面视图图片的 assets:// URI（可选）。',
        },
        // ── 伞节点：target 的内部形状整体透传 ─────────────────────────────────────
        // 声明为 object，使 target.* 下的任意字段（含 `target.bboxM` 这种数组值）整体过闸
        // 并原样透传——契约的字段校验只支持标量叶子（object 走 requireObject，会拒数组），
        // 数组值只能藏在 object 伞节点里整体透传（真正的值校验归 hydrateThreeView3dPayload）。
        // 必须声明在下面 `target.*` 叶子**之前**：归一化按声明顺序执行，伞节点先落整块、叶子
        // 再逐个精校（enum/required），顺序反了会用未校验的整块覆盖已校验的叶子。
        target: {
          type: 'object',
          required: true,
          description:
            '目标实体（挂产物）+ 其固有尺寸。内部叶子见下（entityKind/entityId/depictionIndex 校验；bboxM 为道具固有尺寸[宽,深,高]米，由 worker 校验后透传给 studio 做米制烘焙）。',
        },
        'target.entityKind': {
          type: 'string',
          required: true,
          enum: ['prop', 'character', 'location'],
          description: '产物挂到哪类资产台账：prop 道具 / character 角色 / location 场景。',
        },
        'target.entityId': {
          type: 'string',
          required: true,
          description: '目标实体 id，例如 prop_oil_lamp（须已存在于对应台账）。',
        },
        'target.depictionIndex': {
          type: 'integer',
          required: false,
          minimum: 0,
          description: '可选：挂到实体某个 depiction 的 model3d，而非实体级 model3d。',
        },
        preset: {
          type: 'string',
          required: false,
          default: 'standard',
          enum: ['fast', 'standard'],
          description: 'fast=快速预览(50k 面)；standard=最终产物(120k 面)。',
        },
        seed: {
          type: 'integer',
          required: false,
          minimum: 0,
          description: '随机种子（可选，省略则由资产派生）。',
        },
        maxFaces: {
          type: 'integer',
          required: false,
          minimum: 1000,
          description: '覆盖 preset 的目标面数（可选）。',
        },
      },
    },
  });
}
