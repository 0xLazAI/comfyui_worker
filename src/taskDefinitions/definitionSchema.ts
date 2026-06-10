import { ConflictError, ValidationError } from '../infra/HttpError.js';
import {
  TASK_DEFINITION_META_KEY,
  TASK_RUNTIME_META_KEY,
  type JsonObject,
  type JsonValue,
  type TaskDefinitionBinding,
  type TaskDefinitionFieldType,
  type TaskDefinitionFieldRule,
  type TaskDefinitionJson,
} from './types.js';

export function normalizeTaskDefinitionJson(input: Record<string, unknown>): TaskDefinitionJson {
  const consumerKey = requireString(input.consumer_key, 'definition_json.consumer_key');
  const payload = requireObject(input.payload, 'definition_json.payload');
  const allowUnknownFields = normalizeOptionalBoolean(payload.allow_unknown_fields, 'definition_json.payload.allow_unknown_fields', false);
  const fields = requireObject(payload.fields, 'definition_json.payload.fields');
  const normalizedFields: TaskDefinitionJson['payload']['fields'] = {};

  for (const [fieldPath, rawRule] of Object.entries(fields)) {
    validateFieldPath(fieldPath);
    const rule = normalizeTaskDefinitionFieldRule(rawRule, `definition_json.payload.fields.${fieldPath}`);
    normalizedFields[fieldPath] = rule;
  }

  return {
    consumer_key: consumerKey,
    payload: {
      allow_unknown_fields: allowUnknownFields,
      fields: normalizedFields,
    },
  };
}

export function normalizePayloadWithDefinition(
  rawPayload: Record<string, unknown>,
  definitionJson: TaskDefinitionJson,
): Record<string, unknown> {
  const source = structuredClone(rawPayload || {});
  if (source[TASK_DEFINITION_META_KEY] !== undefined) {
    throw new ValidationError(`payload contains reserved field: ${TASK_DEFINITION_META_KEY}`);
  }
  if (source[TASK_RUNTIME_META_KEY] !== undefined) {
    throw new ValidationError(`payload contains reserved field: ${TASK_RUNTIME_META_KEY}`);
  }

  const normalized: Record<string, unknown> = {};
  const fieldRules = definitionJson.payload.fields;

  if (!definitionJson.payload.allow_unknown_fields) {
    const unknownPaths = collectObjectPaths(source).filter((path) => !isAllowedPath(path, fieldRules));
    if (unknownPaths.length) {
      throw new ValidationError(`payload contains unsupported fields: ${unknownPaths.join(', ')}`);
    }
  }

  for (const [fieldPath, rule] of Object.entries(fieldRules)) {
    const rawValue = getValueAtPath(source, fieldPath);
    if (isMissingValue(rawValue, rule)) {
      if (rule.default !== undefined) {
        setValueAtPath(normalized, fieldPath, structuredClone(rule.default));
        continue;
      }
      if (rule.required) {
        throw new ValidationError(`payload.${fieldPath} is required`);
      }
      continue;
    }

    const value = normalizeValueByRule(rawValue, `payload.${fieldPath}`, rule);
    setValueAtPath(normalized, fieldPath, value);
  }

  return normalized;
}

export function attachTaskDefinitionBinding(
  payload: Record<string, unknown>,
  binding: TaskDefinitionBinding,
): Record<string, unknown> {
  const normalized = structuredClone(payload);
  normalized[TASK_DEFINITION_META_KEY] = {
    definitionId: binding.definitionId,
    version: binding.version,
    consumerKey: binding.consumerKey,
    taskType: binding.taskType,
  };
  return normalized;
}

export function readTaskDefinitionBinding(payload: Record<string, unknown>): TaskDefinitionBinding | null {
  const raw = payload?.[TASK_DEFINITION_META_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const binding = raw as Record<string, unknown>;
  const definitionId = String(binding.definitionId || '').trim();
  const version = Number(binding.version);
  const consumerKey = String(binding.consumerKey || '').trim();
  const taskType = String(binding.taskType || '').trim();

  if (!definitionId || !Number.isFinite(version) || !consumerKey || !taskType) {
    return null;
  }

  return {
    definitionId,
    version: Math.floor(version),
    consumerKey,
    taskType,
  };
}

export function assertUniqueDefinitionVersion(error: unknown): void {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    throw new ConflictError('task_type + version already exists');
  }
}

function normalizeTaskDefinitionFieldRule(value: unknown, field: string): TaskDefinitionFieldRule {
  const rule = requireObject(value, field);
  const type = normalizeFieldType(rule.type, `${field}.type`);
  const required = normalizeOptionalBoolean(rule.required, `${field}.required`, false);
  const description = optionalString(rule.description);
  const minimum = normalizeOptionalNumber(rule.minimum, `${field}.minimum`);
  const maximum = normalizeOptionalNumber(rule.maximum, `${field}.maximum`);

  if (!isNumericFieldType(type)) {
    if (minimum !== undefined) {
      throw new ValidationError(`${field}.minimum is only allowed for number or integer fields`);
    }
    if (maximum !== undefined) {
      throw new ValidationError(`${field}.maximum is only allowed for number or integer fields`);
    }
  }

  const defaultValue = rule.default === undefined ? undefined : normalizeDefaultValue(rule.default, `${field}.default`, {
    type,
    minimum,
    maximum,
  });

  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new ValidationError(`${field}.minimum must be <= ${field}.maximum`);
  }

  return {
    type,
    required,
    default: defaultValue,
    description: description || undefined,
    minimum,
    maximum,
  };
}

function normalizeFieldType(value: unknown, field: string): TaskDefinitionFieldType {
  const normalized = requireString(value, field);
  if (!['string', 'number', 'integer', 'boolean', 'object', 'json'].includes(normalized)) {
    throw new ValidationError(`${field} must be one of string, number, integer, boolean, object, json`);
  }
  return normalized as TaskDefinitionFieldType;
}

function normalizeValueByRule(value: unknown, field: string, rule: TaskDefinitionFieldRule): JsonValue {
  if (rule.type === 'string') {
    return requireString(value, field);
  }

  if (rule.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    throw new ValidationError(`${field} must be a boolean`);
  }

  if (rule.type === 'object') {
    return structuredClone(requirePlainObject(value, field)) as JsonObject;
  }

  if (rule.type === 'json') {
    return normalizeJsonValue(value, field);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new ValidationError(`${field} must be a ${rule.type}`);
  }

  const normalized = rule.type === 'integer' ? Math.floor(numeric) : numeric;
  if (rule.minimum !== undefined && normalized < rule.minimum) {
    throw new ValidationError(`${field} must be >= ${rule.minimum}`);
  }
  if (rule.maximum !== undefined && normalized > rule.maximum) {
    throw new ValidationError(`${field} must be <= ${rule.maximum}`);
  }
  return normalized;
}

function normalizeDefaultValue(value: unknown, field: string, rule: TaskDefinitionFieldRule): JsonValue {
  if (rule.type === 'string') {
    return String(value ?? '');
  }
  return normalizeValueByRule(value, field, rule);
}

function isNumericFieldType(type: TaskDefinitionFieldType): type is 'number' | 'integer' {
  return type === 'number' || type === 'integer';
}

function normalizeJsonValue(value: unknown, field: string): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${field} must be JSON-compatible`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${field}[${index}]`));
  }

  if (isPlainObject(value)) {
    const normalized: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(child, `${field}.${key}`);
    }
    return normalized;
  }

  throw new ValidationError(`${field} must be JSON-compatible`);
}

function validateFieldPath(fieldPath: string): void {
  const normalized = requireString(fieldPath, 'definition_json.payload.fields key');
  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) {
    throw new ValidationError(`invalid field path: ${fieldPath}`);
  }
}

function collectObjectPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) {
    return prefix ? [prefix] : [];
  }

  const output = prefix ? [prefix] : [];
  for (const [key, child] of entries) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    output.push(...collectObjectPaths(child, childPath));
  }
  return Array.from(new Set(output));
}

function isAllowedPath(path: string, fieldRules: Record<string, TaskDefinitionFieldRule>): boolean {
  return Object.keys(fieldRules).some((fieldPath) => fieldPath === path || fieldPath.startsWith(`${path}.`) || path.startsWith(`${fieldPath}.`));
}

function getValueAtPath(source: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setValueAtPath(target: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const parts = fieldPath.split('.');
  let current: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeOptionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new ValidationError(`${field} must be a boolean`);
}

function normalizeOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new ValidationError(`${field} must be a number`);
  }
  return normalized;
}

function isMissingValue(value: unknown, rule: TaskDefinitionFieldRule): boolean {
  if (value === undefined || value === '') {
    return true;
  }
  if (value === null) {
    return rule.type !== 'object' && rule.type !== 'json';
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
