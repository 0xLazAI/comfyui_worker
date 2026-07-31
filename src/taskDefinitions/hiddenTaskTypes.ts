import { HIDDEN_TASK_TYPES_RAW } from '../infra/constants.js';

/**
 * Blender 系列任务已经下线：处理器早已不在本仓库，只剩历史 task_type_definitions 记录还挂在
 * `default-worker` 名下。它们如果继续出现在 `/capabilities` 和注册到平台的 schema 里，调度方会
 * 以为这台 worker 能跑 Blender，属于误导性的能力声明。
 *
 * 用 `PAI_WORKER_HIDDEN_TASK_TYPES` 覆盖：逗号分隔的 task_type 列表；显式设成空串表示不隐藏任何任务。
 */
export const DEFAULT_HIDDEN_TASK_TYPES: readonly string[] = [
  'blender',
  'blender_create_3d',
  'blender_update_3d',
  'blender_pace_3d',
  'blender_pace_review',
];

export function parseHiddenTaskTypes(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined) {
    return new Set(DEFAULT_HIDDEN_TASK_TYPES);
  }

  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

const hiddenTaskTypes = parseHiddenTaskTypes(HIDDEN_TASK_TYPES_RAW);

export function isHiddenTaskType(taskType: string): boolean {
  return hiddenTaskTypes.has(String(taskType || '').trim());
}

export function excludeHiddenTaskTypes<T extends { taskType: string }>(definitions: readonly T[]): T[] {
  return definitions.filter((definition) => !isHiddenTaskType(definition.taskType));
}

export function excludeHiddenTaskTypeNames(taskTypes: readonly string[]): string[] {
  return taskTypes.filter((taskType) => !isHiddenTaskType(taskType));
}
