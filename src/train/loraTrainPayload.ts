import { ValidationError } from '../infra/HttpError.js';

export const TRAIN_STYLE_LORA_TASK_TYPE = 'train_style_lora';
export const TRAIN_STYLE_LORA_CONSUMER_KEY = 'train_style_lora_consumer';

export type LoraTrainMode = 'initial' | 'continue_weights';
export type LoraBaseProfile = 'flux2_dev_bf16' | 'flux2_klein9b';
export type LoraKind = 'style';

export interface NormalizedTrainStyleLoraPayload {
  taskId: string;
  projectId: string;
  mode: LoraTrainMode;
  baseProfile: LoraBaseProfile;
  lora: {
    name: string;
    kind: LoraKind;
    trigger: string;
    description: string | null;
  };
  dataset: {
    uri: string;
  };
  continueFrom: {
    loraPath: string | null;
  };
  train: {
    preset: string;
    rank: number;
    alpha: number;
    steps: number;
    lr: number;
    seed: number;
    saveEvery: number;
  };
  publish: {
    mode: 'local';
    filename: string;
  };
}

interface ProfileDefaults {
  rank: number;
  alpha: number;
  initialSteps: number;
  continueSteps: number;
  initialLr: number;
  continueLr: number;
  seed: number;
  saveEvery: number;
}

const PROFILE_DEFAULTS: Record<LoraBaseProfile, ProfileDefaults> = {
  flux2_dev_bf16: {
    rank: 16,
    alpha: 16,
    initialSteps: 2000,
    continueSteps: 1200,
    initialLr: 1e-4,
    continueLr: 5e-5,
    seed: 42,
    saveEvery: 500,
  },
  flux2_klein9b: {
    rank: 32,
    alpha: 16,
    initialSteps: 4000,
    continueSteps: 1500,
    initialLr: 1e-4,
    continueLr: 5e-5,
    seed: 42,
    saveEvery: 500,
  },
};

export function hydrateTrainStyleLoraPayload(
  payload: Record<string, unknown>,
  context: {
    taskId: string;
    projectId: string;
  },
): NormalizedTrainStyleLoraPayload {
  const mode = normalizeMode(payload.mode);
  const baseProfile = normalizeBaseProfile(payload.baseProfile);
  const defaults = PROFILE_DEFAULTS[baseProfile];
  const lora = normalizeLora(payload.lora);
  const dataset = normalizeDataset(payload.dataset);
  const continueFrom = normalizeContinueFrom(payload.continueFrom);
  const train = normalizeTrain(payload.train, defaults, mode);
  const publish = normalizePublish(payload.publish, lora.name);

  if (mode === 'continue_weights' && !continueFrom.loraPath) {
    throw new ValidationError('payload.continueFrom.loraPath is required when mode=continue_weights');
  }

  return {
    taskId: context.taskId,
    projectId: context.projectId,
    mode,
    baseProfile,
    lora,
    dataset,
    continueFrom,
    train,
    publish,
  };
}

function normalizeMode(value: unknown): LoraTrainMode {
  const normalized = requireString(value, 'payload.mode');
  if (normalized === 'initial' || normalized === 'continue_weights') {
    return normalized;
  }
  throw new ValidationError('payload.mode must be one of: initial, continue_weights');
}

function normalizeBaseProfile(value: unknown): LoraBaseProfile {
  const normalized = requireString(value, 'payload.baseProfile');
  if (normalized === 'flux2_dev_bf16' || normalized === 'flux2_klein9b') {
    return normalized;
  }
  throw new ValidationError('payload.baseProfile must be one of: flux2_dev_bf16, flux2_klein9b');
}

function normalizeLora(value: unknown): NormalizedTrainStyleLoraPayload['lora'] {
  const lora = requireObject(value, 'payload.lora');
  const kind = optionalString(lora.kind) || 'style';
  if (kind !== 'style') {
    throw new ValidationError('payload.lora.kind must be style');
  }
  return {
    name: requireSafeName(lora.name, 'payload.lora.name'),
    kind,
    trigger: requireString(lora.trigger, 'payload.lora.trigger'),
    description: optionalString(lora.description) || null,
  };
}

function normalizeDataset(value: unknown): NormalizedTrainStyleLoraPayload['dataset'] {
  const dataset = requireObject(value, 'payload.dataset');
  const uri = requireString(dataset.uri, 'payload.dataset.uri');
  if (!uri.startsWith('s3://')) {
    throw new ValidationError('payload.dataset.uri must start with s3://');
  }
  if (!uri.endsWith('/')) {
    throw new ValidationError('payload.dataset.uri must be an S3 prefix ending with /');
  }
  return { uri };
}

function normalizeContinueFrom(value: unknown): NormalizedTrainStyleLoraPayload['continueFrom'] {
  if (value === undefined || value === null) {
    return { loraPath: null };
  }
  const source = requireObject(value, 'payload.continueFrom');
  return {
    loraPath: optionalString(source.loraPath) || null,
  };
}

function normalizeTrain(
  value: unknown,
  defaults: ProfileDefaults,
  mode: LoraTrainMode,
): NormalizedTrainStyleLoraPayload['train'] {
  const train = value === undefined ? {} : requireObject(value, 'payload.train');
  const defaultSteps = mode === 'initial' ? defaults.initialSteps : defaults.continueSteps;
  const defaultLr = mode === 'initial' ? defaults.initialLr : defaults.continueLr;
  const steps = normalizeInteger(train.steps, defaultSteps, 'payload.train.steps', 1);
  const saveEvery = normalizeInteger(train.saveEvery, defaults.saveEvery, 'payload.train.saveEvery', 1);

  return {
    preset: optionalString(train.preset) || (mode === 'initial' ? 'style' : 'style_continue'),
    rank: normalizeInteger(train.rank, defaults.rank, 'payload.train.rank', 1),
    alpha: normalizeNumber(train.alpha, defaults.alpha, 'payload.train.alpha', 0),
    steps,
    lr: normalizeNumber(train.lr, defaultLr, 'payload.train.lr', 0),
    seed: normalizeInteger(train.seed, defaults.seed, 'payload.train.seed', 0),
    saveEvery: Math.min(saveEvery, steps),
  };
}

function normalizePublish(value: unknown, loraName: string): NormalizedTrainStyleLoraPayload['publish'] {
  const publish = value === undefined ? {} : requireObject(value, 'payload.publish');
  const mode = optionalString(publish.mode) || 'local';
  if (mode !== 'local') {
    throw new ValidationError('payload.publish.mode must be local in this worker version');
  }
  const filename = optionalString(publish.filename) || `${loraName}.safetensors`;
  if (!filename.endsWith('.safetensors')) {
    throw new ValidationError('payload.publish.filename must end with .safetensors');
  }
  return { mode, filename };
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }
  return normalized;
}

function requireSafeName(value: unknown, field: string): string {
  const normalized = requireString(value, field);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new ValidationError(`${field} must use only letters, numbers, dot, underscore, or hyphen`);
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeInteger(value: unknown, fallback: number, field: string, minimum: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new ValidationError(`${field} must be an integer >= ${minimum}`);
  }
  return Math.floor(normalized);
}

function normalizeNumber(value: unknown, fallback: number, field: string, minimum: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new ValidationError(`${field} must be a number >= ${minimum}`);
  }
  return normalized;
}
