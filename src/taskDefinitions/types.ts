export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type TaskDefinitionFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'json';

interface TaskDefinitionFieldRuleBase<TType extends TaskDefinitionFieldType, TDefault> {
  type: TType;
  required?: boolean;
  enum?: Array<string | number | boolean>;
  description?: string;
  default?: TDefault;
}

interface TaskDefinitionNumericBounds {
  minimum?: number;
  maximum?: number;
}

export interface TaskDefinitionStringFieldRule extends TaskDefinitionFieldRuleBase<'string', string>, TaskDefinitionNumericBounds {}

export interface TaskDefinitionNumberFieldRule extends TaskDefinitionFieldRuleBase<'number', number>, TaskDefinitionNumericBounds {}

export interface TaskDefinitionIntegerFieldRule extends TaskDefinitionFieldRuleBase<'integer', number>, TaskDefinitionNumericBounds {}

export interface TaskDefinitionBooleanFieldRule extends TaskDefinitionFieldRuleBase<'boolean', boolean>, TaskDefinitionNumericBounds {}

export interface TaskDefinitionObjectFieldRule extends TaskDefinitionFieldRuleBase<'object', JsonObject> {
  minimum?: never;
  maximum?: never;
}

export interface TaskDefinitionJsonFieldRule extends TaskDefinitionFieldRuleBase<'json', JsonValue> {
  minimum?: never;
  maximum?: never;
}

export type TaskDefinitionFieldRule =
  | TaskDefinitionStringFieldRule
  | TaskDefinitionNumberFieldRule
  | TaskDefinitionIntegerFieldRule
  | TaskDefinitionBooleanFieldRule
  | TaskDefinitionObjectFieldRule
  | TaskDefinitionJsonFieldRule;

export interface TaskDefinitionPayloadRuleSet {
  allow_unknown_fields?: boolean;
  fields: Record<string, TaskDefinitionFieldRule>;
}

export interface TaskDefinitionExecution {
  timeout_seconds?: number;
  max_attempts?: number;
  backoff_seconds?: number[];
}

export interface TaskDefinitionJson {
  consumer_key: string;
  execution?: TaskDefinitionExecution;
  payload: TaskDefinitionPayloadRuleSet;
}

export interface TaskTypeDefinitionRecord {
  id: string;
  workerName: string;
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
  workerName: string;
  taskType: string;
  version: number;
  enabled: boolean;
  description: string | null;
  definitionJson: TaskDefinitionJson;
  actor: string;
}

export interface TaskTypeDefinitionUpdateInput {
  workerName?: string;
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
