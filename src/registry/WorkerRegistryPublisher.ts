import fs from 'fs/promises';
import path from 'path';
import {
  BASE_URL,
  CONTRACT_VERSION,
  HEARTBEAT_INTERVAL_SECONDS,
  PLATFORM_API_ENABLED,
  REGISTRY_ROOT,
  WORKER_NODE_TYPE,
  WORKER_TOKEN,
  WORKER_VERSION,
} from '../infra/constants.js';
import {
  getSupportedWorkflows,
  RENDER_PANEL_TASK_TYPE,
  REPLACE_PROP_PANEL_TASK_TYPE,
} from '../render/workflowCatalog.js';
import { taskTypeDefinitionStore } from '../taskDefinitions/taskTypeDefinitionStore.js';
import type { TaskDefinitionJson, TaskTypeDefinitionRecord } from '../taskDefinitions/types.js';
import { atomicWriteJson, atomicWriteText, ensureDirectory } from '../infra/filesystem.js';
import { paiPlatformClient } from '../platform/paiPlatformClient.js';

export class WorkerRegistryPublisher {
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (!PLATFORM_API_ENABLED) {
      await ensureDirectory(REGISTRY_ROOT);
    }
    await this.publishStaticFiles();
    await this.publishHeartbeatFiles('online', 'idle');
    this.timer = setInterval(() => {
      void this.publishHeartbeatFiles('online', 'idle');
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.publishHeartbeatFiles('offline', 'stopped');
  }

  async publishStaticFiles(): Promise<void> {
    const taskDefinitions = await taskTypeDefinitionStore.list({ enabled: true });
    const grouped = groupTaskDefinitionsByWorker(taskDefinitions);
    if (PLATFORM_API_ENABLED) {
      for (const [workerName, definitions] of Object.entries(grouped)) {
        await this.publishStaticFilesForWorker(workerName, definitions);
      }
      return;
    }

    const activeWorkerNames = new Set(Object.keys(grouped));
    const existingWorkerNames = await this.listRegistryWorkerNames();

    for (const existingWorkerName of existingWorkerNames) {
      if (!activeWorkerNames.has(existingWorkerName)) {
        await this.removeWorkerDir(existingWorkerName);
      }
    }

    for (const [workerName, definitions] of Object.entries(grouped)) {
      await this.publishStaticFilesForWorker(workerName, definitions);
    }
  }

  async syncWorker(workerName: string): Promise<void> {
    const normalizedWorkerName = normalizeWorkerName(workerName);
    if (!normalizedWorkerName) {
      return;
    }
    const taskDefinitions = await taskTypeDefinitionStore.listEnabledByWorkerName(normalizedWorkerName);
    if (!taskDefinitions.length) {
      if (PLATFORM_API_ENABLED) {
        await this.publishStaticFilesForWorker(normalizedWorkerName, []);
      } else {
        await this.removeWorkerDir(normalizedWorkerName);
      }
      return;
    }

    await this.publishStaticFilesForWorker(normalizedWorkerName, dedupeTaskDefinitions(taskDefinitions));
    await this.publishHeartbeatForWorker(normalizedWorkerName, 'online', 'idle');
  }

  private async publishStaticFilesForWorker(workerName: string, taskDefinitions: TaskTypeDefinitionRecord[]): Promise<void> {
    if (PLATFORM_API_ENABLED) {
      await paiPlatformClient.registerNamedWorker(workerName, {
        schema: this.schemaPayload(workerName, taskDefinitions),
        credentials: this.credentialsPayload(),
        descriptionMd: this.descriptionMarkdown(workerName, taskDefinitions),
        maxConcurrent: 1,
      });
      return;
    }

    const workerDir = this.workerDir(workerName);
    await ensureDirectory(workerDir);
    await atomicWriteJson(path.join(workerDir, 'schema.json'), this.schemaPayload(workerName, taskDefinitions));
    await atomicWriteJson(path.join(workerDir, 'credentials.json'), this.credentialsPayload());
    await atomicWriteText(path.join(workerDir, 'description.md'), this.descriptionMarkdown(workerName, taskDefinitions));
  }

  private async publishHeartbeatFiles(status: string, message: string): Promise<void> {
    const workerNames = PLATFORM_API_ENABLED
      ? await taskTypeDefinitionStore.listEnabledWorkerNames()
      : await this.listRegistryWorkerNames();
    for (const workerName of workerNames) {
      await this.publishHeartbeatForWorker(workerName, status, message);
    }
  }

  private async publishHeartbeatForWorker(workerName: string, status: string, message: string): Promise<void> {
    if (PLATFORM_API_ENABLED) {
      await paiPlatformClient.heartbeatWorker(workerName, {
        status,
        capacity: {
          running: status === 'online' && message !== 'idle' ? 1 : 0,
          maxConcurrent: 1,
        },
      });
      return;
    }

    await atomicWriteJson(path.join(this.workerDir(workerName), 'heartbeat.json'), {
      heartbeat_at: new Date().toISOString(),
      status,
      message,
    });
  }

  private schemaPayload(workerName: string, taskDefinitions: TaskTypeDefinitionRecord[]): Record<string, unknown> {
    const supportedWorkflows = getSupportedWorkflows();
    const supportedTaskTypes = taskDefinitions.map((definition) => definition.taskType);
    return {
      name: workerName,
      description: '通用 render_panel / replace_prop_panel worker，内部转发到 Stephen 平台已注册 workflow，并把最终图片落成 assets:// 引用。',
      nodeType: WORKER_NODE_TYPE,
      baseUrl: BASE_URL,
      healthPath: '/health',
      tasksPath: '/tasks',
      capabilitiesPath: '/capabilities',
      contractVersion: CONTRACT_VERSION,
      workerVersion: WORKER_VERSION,
      node_type: WORKER_NODE_TYPE,
      base_url: BASE_URL,
      health_path: '/health',
      tasks_path: '/tasks',
      capabilities_path: '/capabilities',
      contract_version: CONTRACT_VERSION,
      worker_version: WORKER_VERSION,
      styles: [],
      models: supportedWorkflows.map((workflow) => workflow.baseModel),
      loras: [],
      summary: '通用 render_panel worker，内部转发到 Stephen 平台已注册 workflow，并把最终图片落成 assets:// 引用。',
      best_for: ['panel 精修', '背景重绘', 'ComfyUI storyboard rerender'],
      limitations: ['当前 provider 仅接 Stephen render API', '输入图片必须使用 assets:// 引用'],
      preferred_task_patterns: supportedTaskTypes,
      examples: ['对 scene_02_shot_01_panel_0001 执行保留人物的背景精修'],
      tags: ['comfyui', 'render', 'storyboard'],
      priority: 100,
      tasks: Object.fromEntries(taskDefinitions.map((definition) => [definition.taskType, buildTaskSchema(definition, supportedWorkflows.map((workflow) => workflow.id))])),
    };
  }

  private credentialsPayload(): Record<string, unknown> {
    return {
      auth_type: 'bearer',
      token: WORKER_TOKEN,
    };
  }

  private descriptionMarkdown(workerName: string, taskDefinitions: TaskTypeDefinitionRecord[]): string {
    return [
      `# ${workerName}`,
      '',
      '这是一个由 task_type_definitions 驱动的通用 worker。',
      '',
      `- 当前启用任务：${taskDefinitions.map((definition) => `\`${definition.taskType}\``).join(', ') || '无'}`,
      '- payload 校验规则来自数据库里的 task_type_definitions.definition_json',
      '- 输入图片长期引用必须使用 `assets://`',
      '- 新 Worker 通过 Pai Platform API 注册、更新心跳、读写 PACE 文件',
      '- 最终图片长期引用写回 `manifest.artifacts`，不再依赖旧的 storyboard sidecar',
      '',
    ].join('\n');
  }

  private async listRegistryWorkerNames(): Promise<string[]> {
    await ensureDirectory(REGISTRY_ROOT);
    const entries = await fs.readdir(REGISTRY_ROOT, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.trim())
      .filter(Boolean)
      .sort();
  }

  private async removeWorkerDir(workerName: string): Promise<void> {
    await fs.rm(this.workerDir(workerName), {
      recursive: true,
      force: true,
    });
  }

  private workerDir(workerName: string): string {
    return path.join(REGISTRY_ROOT, workerName);
  }
}

function groupTaskDefinitionsByWorker(taskDefinitions: TaskTypeDefinitionRecord[]): Record<string, TaskTypeDefinitionRecord[]> {
  const grouped: Record<string, TaskTypeDefinitionRecord[]> = {};
  for (const definition of taskDefinitions) {
    const workerName = normalizeWorkerName(definition.workerName);
    grouped[workerName] ||= [];
    grouped[workerName]!.push(definition);
  }

  for (const workerName of Object.keys(grouped)) {
    grouped[workerName] = dedupeTaskDefinitions(grouped[workerName]!);
  }

  return grouped;
}

function dedupeTaskDefinitions(taskDefinitions: TaskTypeDefinitionRecord[]): TaskTypeDefinitionRecord[] {
  const ordered = [...taskDefinitions].sort((left, right) => {
    if (left.taskType !== right.taskType) {
      return left.taskType.localeCompare(right.taskType);
    }
    if (left.version !== right.version) {
      return right.version - left.version;
    }
    return Number(right.id) - Number(left.id);
  });

  const byTaskType = new Map<string, TaskTypeDefinitionRecord>();
  for (const definition of ordered) {
    if (!byTaskType.has(definition.taskType)) {
      byTaskType.set(definition.taskType, definition);
    }
  }

  return [...byTaskType.values()];
}

function normalizeWorkerName(value: unknown): string {
  return String(value || '').trim();
}

const STANDARD_RENDER_RESULT_PROPERTIES: Record<string, unknown> = {
  panelId: { type: 'string', description: '目标 panel ID。' },
  project: { type: 'string', description: '项目 slug。' },
  workflow: { type: 'string', description: '逻辑工作流 ID。' },
  backend: { type: 'string', description: '实际调用的底层 backend。' },
  filename: { type: 'string', description: '最终产物文件名。' },
  renderUri: { type: 'string', description: '最终图片的 assets:// 引用。' },
  seed: { type: 'integer', description: '最终使用的种子。' },
  meta: { type: 'object', description: '执行元信息。' },
};

function buildTaskSchema(definition: TaskTypeDefinitionRecord, workflowIds: string[]): Record<string, unknown> {
  const payload = definition.definitionJson.payload;
  const fields = payload.fields;
  const inputProperties: Record<string, unknown> = {};
  const requiredFields: string[] = [];

  for (const [fieldPath, rule] of Object.entries(fields)) {
    inputProperties[fieldPath] = {
      type: rule.type,
      description: rule.description || inferFieldDescription(definition.definitionJson, fieldPath, workflowIds),
      default: rule.default,
      minimum: rule.minimum,
      maximum: rule.maximum,
    };
    if (rule.required) {
      requiredFields.push(fieldPath);
    }
  }

  return {
    title: definition.taskType,
    description: definition.description || `${definition.taskType} task`,
    payloadSchema: {
      type: 'object',
      required: requiredFields,
      properties: inputProperties,
    },
    summary: definition.description || `${definition.taskType} task`,
    input_schema_version: CONTRACT_VERSION,
    input_required: requiredFields,
    input_properties: inputProperties,
    output_schema_version: CONTRACT_VERSION,
    result_properties: (
      definition.taskType === RENDER_PANEL_TASK_TYPE ||
      definition.taskType === REPLACE_PROP_PANEL_TASK_TYPE
    )
      ? STANDARD_RENDER_RESULT_PROPERTIES
      : {},
  };
}

function inferFieldDescription(definitionJson: TaskDefinitionJson, fieldPath: string, workflowIds: string[]): string {
  if (fieldPath === 'workflow') {
    return `逻辑工作流 ID。当前支持：${workflowIds.join(', ')}`;
  }
  if (fieldPath === 'panelId') {
    return '目标 panel 业务 ID，格式 scene_<id>_shot_<id>_panel_<id>。';
  }
  if (fieldPath === 'prompt.text') {
    return '正向提示词。';
  }
  if (fieldPath === 'prompt.negativeText') {
    return '负向提示词。';
  }
  if (fieldPath === 'inputs.image.assetUri') {
    return '输入图片资产 URI。';
  }
  if (fieldPath.startsWith('extraParams.')) {
    return `可变参数 ${fieldPath.slice('extraParams.'.length)}。`;
  }
  return `payload 字段 ${fieldPath}。`;
}
