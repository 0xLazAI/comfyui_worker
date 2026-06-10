import { randomUUID } from 'crypto';

export interface QueueJobEnvelope<T = unknown> {
  id: string;
  queue: string;
  name: string;
  attempts: number;
  maxAttempts: number;
  backoff: number[];
  timeout: number;
  createdAt: number;
  availableAt: number;
  body: T;
}

export interface EnqueueOptions {
  id?: string;
  maxAttempts?: number;
  backoff?: number[];
  timeout?: number;
  delaySeconds?: number;
  now?: number;
}

export interface ReservedJob<T = unknown> {
  queue: string;
  reservedPayload: string;
  envelope: QueueJobEnvelope<T> | null;
  parseError?: string;
}

export interface QueueHandlerContext {
  queue: string;
  jobId: string;
  jobName: string;
  attempts: number;
  maxAttempts: number;
  abortSignal?: AbortSignal;
}

export type QueueHandler<T = unknown> = (
  envelope: QueueJobEnvelope<T>,
  context: QueueHandlerContext,
) => Promise<void>;

export interface QueueWorkerOptions {
  queues: string[];
  blockForSeconds: number;
  retryAfterSeconds: number;
  idleSleepMs?: number;
  workerTimeoutSeconds?: number;
  once?: boolean;
  stopWhenEmpty?: boolean;
  maxJobs?: number;
  maxTimeSeconds?: number;
  restMs?: number;
  workerName?: string;
}

export interface QueueMetric {
  name: string;
  value: number;
  tags?: Record<string, string | number | boolean>;
}

export type QueueMetricSink = (metric: QueueMetric) => void;

export interface FailedJobRecord {
  queue: string;
  reservedPayload: string;
  envelope: QueueJobEnvelope | null;
  errorMessage: string;
  errorStack?: string;
  failedAt: number;
}

export function createQueueJobEnvelope<T>(
  queue: string,
  name: string,
  body: T,
  options: EnqueueOptions = {},
): QueueJobEnvelope<T> {
  const now = normalizeUnixSeconds(options.now);
  const delaySeconds = normalizeNonNegativeInteger(options.delaySeconds ?? 0, 'delaySeconds');

  return {
    id: options.id || `job_${randomUUID()}`,
    queue: String(queue || '').trim(),
    name: String(name || '').trim(),
    attempts: 0,
    maxAttempts: normalizePositiveInteger(options.maxAttempts ?? 3, 'maxAttempts'),
    backoff: normalizeBackoff(options.backoff),
    timeout: normalizePositiveInteger(options.timeout ?? 300, 'timeout'),
    createdAt: now,
    availableAt: now + delaySeconds,
    body,
  };
}

export function computeRetryDelaySeconds(envelope: QueueJobEnvelope): number {
  const backoff = Array.isArray(envelope.backoff) ? envelope.backoff : [];
  if (!backoff.length) {
    return 0;
  }
  const index = Math.max(0, envelope.attempts - 1);
  if (backoff[index] !== undefined) {
    return normalizeNonNegativeInteger(backoff[index], 'backoff');
  }
  return normalizeNonNegativeInteger(backoff[backoff.length - 1], 'backoff');
}

export function normalizeUnixSeconds(value?: number): number {
  const normalized = Number(value ?? Math.floor(Date.now() / 1000));
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('time must be a non-negative unix second value');
  }
  return Math.floor(normalized);
}

export function normalizeQueueNames(input: string | string[]): string[] {
  const source = Array.isArray(input) ? input : String(input || '').split(',');
  const normalized = source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error('at least one queue name is required');
  }

  return normalized;
}

function normalizeBackoff(input?: number[]): number[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((value) => normalizeNonNegativeInteger(value, 'backoff'));
}

function normalizePositiveInteger(value: number, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Math.floor(normalized);
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return Math.floor(normalized);
}
