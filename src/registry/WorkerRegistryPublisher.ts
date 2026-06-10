import path from 'path';
import {
  BASE_URL,
  CONTRACT_VERSION,
  HEARTBEAT_INTERVAL_SECONDS,
  REGISTRY_ROOT,
  WORKER_NODE_TYPE,
  WORKER_NAME,
  WORKER_TOKEN,
  WORKER_VERSION,
} from '../infra/constants.js';
import { getSupportedWorkflows, RENDER_PANEL_TASK_TYPE } from '../render/workflowCatalog.js';
import { taskTypeDefinitionStore } from '../taskDefinitions/taskTypeDefinitionStore.js';
import type { TaskDefinitionJson, TaskTypeDefinitionRecord } from '../taskDefinitions/types.js';
import { atomicWriteJson, atomicWriteText, ensureDirectory } from '../infra/filesystem.js';

export class WorkerRegistryPublisher {
  private workerDir = path.join(REGISTRY_ROOT, WORKER_NAME);
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    await ensureDirectory(this.workerDir);
    await this.publishStaticFiles();
    await this.publishHeartbeat('online', 'idle');
    this.timer = setInterval(() => {
      void this.publishHeartbeat('online', 'idle');
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.publishHeartbeat('offline', 'stopped');
  }

  async publishStaticFiles(): Promise<void> {
    const taskDefinitions = await taskTypeDefinitionStore.list({ enabled: true });
    await atomicWriteJson(path.join(this.workerDir, 'schema.json'), this.schemaPayload(taskDefinitions));
    await atomicWriteJson(path.join(this.workerDir, 'credentials.json'), this.credentialsPayload());
    await atomicWriteText(path.join(this.workerDir, 'description.md'), this.descriptionMarkdown(taskDefinitions));
  }

  async publishHeartbeat(status: string, message: string): Promise<void> {
    await atomicWriteJson(path.join(this.workerDir, 'heartbeat.json'), {
      heartbeat_at: new Date().toISOString(),
      status,
      message,
    });
  }

  private schemaPayload(taskDefinitions: TaskTypeDefinitionRecord[]): Record<string, unknown> {
    const supportedWorkflows = getSupportedWorkflows();
    const supportedTaskTypes = taskDefinitions.map((definition) => definition.taskType);
    return {
      name: WORKER_NAME,
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

  private descriptionMarkdown(taskDefinitions: TaskTypeDefinitionRecord[]): string {
    return [
      `# ${WORKER_NAME}`,
      '',
      '这是一个由 task_type_definitions 驱动的通用 worker。',
      '',
      `- 当前启用任务：${taskDefinitions.map((definition) => `\`${definition.taskType}\``).join(', ') || '无'}`,
      '- payload 校验规则来自数据库里的 task_type_definitions.definition_json',
      '- 输入图片必须使用 `assets://` 引用，不接受外部图片链接',
      '- 最终图片上传到对象存储，并把 `assets://renders/...` 写回 storyboard outputs sidecar',
      '',
    ].join('\n');
  }
}

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
    summary: definition.description || `${definition.taskType} task`,
    input_schema_version: CONTRACT_VERSION,
    input_required: requiredFields,
    input_properties: inputProperties,
    output_schema_version: CONTRACT_VERSION,
    result_properties: definition.taskType === RENDER_PANEL_TASK_TYPE
      ? {
          panel_id: { type: 'string', description: '目标 panel ID。' },
          project: { type: 'string', description: '项目 slug。' },
          backend: { type: 'string', description: '实际调用的底层 backend。' },
          filename: { type: 'string', description: '最终产物文件名。' },
          render_uri: { type: 'string', description: '最终图片的 assets:// 引用。' },
          seed: { type: 'integer', description: '最终使用的种子。' },
        }
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
