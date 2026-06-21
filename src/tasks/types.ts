export type PublicTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'rejected' | 'canceled';

export type WorkerTaskStatus =
  | 'accepted'
  | 'queued'
  | 'retry_waiting'
  | 'running'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type WorkerTaskQueuePublishStatus = 'pending' | 'published' | 'publish_failed';

export type WorkerTaskEventType =
  | 'accepted'
  | 'enqueued'
  | 'started'
  | 'provider_submitted'
  | 'provider_polled'
  | 'asset_uploaded'
  | 'metadata_written'
  | 'retry_scheduled'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'timed_out'
  | 'cancel_requested'
  | 'cancelled';

export type WorkerTaskAttemptStatus =
  | 'running'
  | 'released'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface TaskResultPayload {
  file_path?: string;
  bytes_written?: number;
  filename?: string;
  [key: string]: unknown;
}

export interface WorkerTaskRecord {
  taskId: string;
  taskType: string;
  projectId: string;
  requestPayload: Record<string, unknown>;
  status: WorkerTaskStatus;
  queuePublishStatus: WorkerTaskQueuePublishStatus;
  queuePublishedAt: string | null;
  queuePublishError: string | null;
  progress: number | null;
  eta: number | null;
  message: string | null;
  errorCode: string | null;
  resultPayload: TaskResultPayload | null;
  createdAt: string;
  updatedAt: string;
  currentAttempt: number;
  maxAttempts: number;
  backoffSeconds: number[];
  timeoutSeconds: number;
  requestId: string | null;
  dedupeKey: string | null;
  nextRunAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  workerName: string | null;
}

export interface PublicTaskResponse {
  task_id: string;
  status: PublicTaskStatus;
  progress: number | null;
  eta: number | null;
  message: string | null;
  error_code: string | null;
  result: TaskResultPayload;
  created_at: string;
  updated_at: string;
}

export interface SubmitTaskInput {
  taskId: string;
  taskType: string;
  projectId: string;
  payload: Record<string, unknown>;
  sourceImageUpload?: {
    buffer: Buffer;
    contentType?: string | null;
    filename?: string | null;
  } | null;
  requestId?: string | null;
  dedupeKey?: string | null;
}

export interface WorkerTaskEventRecord {
  id: string;
  taskId: string;
  eventSeq: number;
  eventType: WorkerTaskEventType;
  attemptNo: number | null;
  workerName: string | null;
  message: string | null;
  detailJson: Record<string, unknown>;
  createdAt: string;
}

export interface WorkerTaskAttemptRecord {
  id: string;
  taskId: string;
  attemptNo: number;
  status: WorkerTaskAttemptStatus;
  workerName: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  resultPayload: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface WorkerTaskEventInput {
  taskId: string;
  eventType: WorkerTaskEventType;
  attemptNo?: number | null;
  workerName?: string | null;
  message?: string | null;
  detailJson?: Record<string, unknown>;
}

export interface WorkerTaskAttemptInput {
  taskId: string;
  attemptNo: number;
  status: WorkerTaskAttemptStatus;
  workerName?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  resultPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function toPublicTaskResponse(record: WorkerTaskRecord): PublicTaskResponse {
  return {
    task_id: record.taskId,
    status: mapWorkerTaskStatusToPublicStatus(record.status),
    progress: record.progress,
    eta: record.eta,
    message: record.message,
    error_code: record.errorCode,
    result: structuredClone(record.resultPayload || {}),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function mapWorkerTaskStatusToPublicStatus(status: WorkerTaskStatus): PublicTaskStatus {
  switch (status) {
    case 'accepted':
    case 'queued':
    case 'retry_waiting':
      return 'queued';
    case 'running':
    case 'cancel_requested':
      return 'running';
    case 'succeeded':
      return 'done';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'canceled';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

export function isTerminalWorkerTaskStatus(status: WorkerTaskStatus): boolean {
  return ['succeeded', 'rejected', 'failed', 'cancelled'].includes(status);
}
