export type TaskDefinitionFieldType = 'string' | 'number' | 'integer' | 'boolean';

export interface TaskDefinitionFieldRule {
  type: TaskDefinitionFieldType;
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface TaskDefinitionPayloadRuleSet {
  allow_unknown_fields?: boolean;
  fields: Record<string, TaskDefinitionFieldRule>;
}

export interface TaskDefinitionJson {
  consumer_key: string;
  payload: TaskDefinitionPayloadRuleSet;
}

export interface TaskTypeDefinitionRecord {
  id: string;
  taskType: string;
  version: number;
  enabled: boolean;
  description: string | null;
  definitionJson: TaskDefinitionJson;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface TaskTypeDefinitionCreateInput {
  taskType: string;
  version: number;
  enabled: boolean;
  description: string | null;
  definitionJson: TaskDefinitionJson;
  actor: string;
}

export interface TaskTypeDefinitionUpdateInput {
  taskType?: string;
  version?: number;
  enabled?: boolean;
  description?: string | null;
  definitionJson?: TaskDefinitionJson;
  actor: string;
}

export interface TaskDefinitionBinding {
  definitionId: string;
  version: number;
  consumerKey: string;
  taskType: string;
}

export const TASK_DEFINITION_META_KEY = '_taskDefinition';
export const TASK_RUNTIME_META_KEY = '_taskRuntime';
