import type { PoolClient } from 'pg';
import { getDatabasePool, initializeDatabase } from '../infra/database.js';
import type {
  WorkerTaskAttemptInput,
  WorkerTaskAttemptRecord,
  WorkerTaskEventInput,
  WorkerTaskEventRecord,
  WorkerTaskRecord,
} from './types.js';

export class TaskStore {
  async ensureReady(): Promise<void> {
    await initializeDatabase();
  }

  async get(taskId: string): Promise<WorkerTaskRecord | null> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT
        task_id,
        task_type,
        project_id,
        request_payload,
        status,
        queue_publish_status,
        queue_published_at,
        queue_publish_error,
        progress,
        eta,
        message,
        error_code,
        result_payload,
        request_id,
        dedupe_key,
        next_run_at,
        started_at,
        finished_at,
        worker_name,
        created_at,
        updated_at,
        current_attempt,
        max_attempts,
        backoff_seconds,
        timeout_seconds
      FROM worker_tasks
      WHERE task_id = $1`,
      [taskId],
    );

    if (!result.rowCount) {
      return null;
    }

    return mapRowToTaskRecord(result.rows[0]);
  }

  async list(filters?: {
    limit?: number;
    taskType?: string;
  }): Promise<WorkerTaskRecord[]> {
    const pool = await getDatabasePool();
    const conditions: string[] = [];
    const values: unknown[] = [];

    const taskType = normalizeOptionalString(filters?.taskType);
    if (taskType) {
      values.push(taskType);
      conditions.push(`task_type = $${values.length}`);
    }

    const limit = normalizeLimit(filters?.limit);
    values.push(limit);
    const limitParam = `$${values.length}`;
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT
        task_id,
        task_type,
        project_id,
        request_payload,
        status,
        queue_publish_status,
        queue_published_at,
        queue_publish_error,
        progress,
        eta,
        message,
        error_code,
        result_payload,
        request_id,
        dedupe_key,
        next_run_at,
        started_at,
        finished_at,
        worker_name,
        created_at,
        updated_at,
        current_attempt,
        max_attempts,
        backoff_seconds,
        timeout_seconds
      FROM worker_tasks
      ${whereClause}
      ORDER BY created_at DESC, task_id DESC
      LIMIT ${limitParam}`,
      values,
    );
    return result.rows.map(mapRowToTaskRecord);
  }

  async create(record: WorkerTaskRecord): Promise<boolean> {
    const pool = await getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `INSERT INTO worker_tasks (
          task_id,
          task_type,
          project_id,
          request_payload,
          status,
          queue_publish_status,
          queue_published_at,
          queue_publish_error,
          progress,
          eta,
          message,
          error_code,
          result_payload,
          request_id,
          dedupe_key,
          next_run_at,
          started_at,
          finished_at,
          worker_name,
          created_at,
          updated_at,
          current_attempt,
          max_attempts,
          backoff_seconds,
          timeout_seconds
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::timestamptz, $17::timestamptz, $18::timestamptz, $19, $20::timestamptz, $21::timestamptz, $22, $23, $24::integer[], $25
        )
        ON CONFLICT (task_id) DO NOTHING
        RETURNING task_id`,
        serializeTaskRecord(record),
      );

      if (!insertResult.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `INSERT INTO worker_task_events (
          task_id,
          event_seq,
          event_type,
          attempt_no,
          worker_name,
          message,
          detail_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          record.taskId,
          1,
          'accepted',
          record.currentAttempt,
          record.workerName,
          'task accepted',
          JSON.stringify({ status: record.status }),
        ],
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async save(record: WorkerTaskRecord): Promise<void> {
    const pool = await getDatabasePool();
    await pool.query(
      `INSERT INTO worker_tasks (
        task_id,
        task_type,
        project_id,
        request_payload,
        status,
        queue_publish_status,
        queue_published_at,
        queue_publish_error,
        progress,
        eta,
        message,
        error_code,
        result_payload,
        request_id,
        dedupe_key,
        next_run_at,
        started_at,
        finished_at,
        worker_name,
        created_at,
        updated_at,
        current_attempt,
        max_attempts,
        backoff_seconds,
        timeout_seconds
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::timestamptz, $17::timestamptz, $18::timestamptz, $19, $20::timestamptz, $21::timestamptz, $22, $23, $24::integer[], $25
      )
      ON CONFLICT (task_id) DO UPDATE SET
        task_type = EXCLUDED.task_type,
        project_id = EXCLUDED.project_id,
        request_payload = EXCLUDED.request_payload,
        status = EXCLUDED.status,
        queue_publish_status = EXCLUDED.queue_publish_status,
        queue_published_at = EXCLUDED.queue_published_at,
        queue_publish_error = EXCLUDED.queue_publish_error,
        progress = EXCLUDED.progress,
        eta = EXCLUDED.eta,
        message = EXCLUDED.message,
        error_code = EXCLUDED.error_code,
        result_payload = EXCLUDED.result_payload,
        request_id = EXCLUDED.request_id,
        dedupe_key = EXCLUDED.dedupe_key,
        next_run_at = EXCLUDED.next_run_at,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        worker_name = EXCLUDED.worker_name,
        updated_at = EXCLUDED.updated_at,
        current_attempt = EXCLUDED.current_attempt,
        max_attempts = EXCLUDED.max_attempts,
        backoff_seconds = EXCLUDED.backoff_seconds,
        timeout_seconds = EXCLUDED.timeout_seconds`,
      serializeTaskRecord(record),
    );
  }

  async update(
    taskId: string,
    updater: (record: WorkerTaskRecord) => WorkerTaskRecord | Promise<WorkerTaskRecord>,
  ): Promise<WorkerTaskRecord> {
    const existing = await this.get(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const updated = await updater(existing);
    await this.save(updated);
    return updated;
  }

  async appendEvent(input: WorkerTaskEventInput): Promise<WorkerTaskEventRecord> {
    const pool = await getDatabasePool();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const eventSeq = await this.getNextEventSequence(input.taskId);
      try {
        const result = await pool.query(
          `INSERT INTO worker_task_events (
            task_id,
            event_seq,
            event_type,
            attempt_no,
            worker_name,
            message,
            detail_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          RETURNING id, task_id, event_seq, event_type, attempt_no, worker_name, message, detail_json, created_at`,
          [
            input.taskId,
            eventSeq,
            input.eventType,
            input.attemptNo ?? null,
            normalizeOptionalString(input.workerName),
            normalizeOptionalString(input.message),
            JSON.stringify(input.detailJson || {}),
          ],
        );
        return mapRowToTaskEventRecord(result.rows[0]);
      } catch (error: any) {
        if (isUniqueViolationError(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to append worker task event for task ${input.taskId}`);
  }

  async saveAttempt(input: WorkerTaskAttemptInput): Promise<WorkerTaskAttemptRecord> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `INSERT INTO worker_task_attempts (
        task_id,
        attempt_no,
        status,
        worker_name,
        started_at,
        finished_at,
        duration_ms,
        result_payload,
        error_message
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb, $9)
      ON CONFLICT (task_id, attempt_no) DO UPDATE SET
        status = EXCLUDED.status,
        worker_name = EXCLUDED.worker_name,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        duration_ms = EXCLUDED.duration_ms,
        result_payload = EXCLUDED.result_payload,
        error_message = EXCLUDED.error_message
      RETURNING id, task_id, attempt_no, status, worker_name, started_at, finished_at, duration_ms, result_payload, error_message`,
      [
        input.taskId,
        input.attemptNo,
        input.status,
        normalizeOptionalString(input.workerName),
        input.startedAt || new Date().toISOString(),
        input.finishedAt ?? null,
        input.durationMs ?? null,
        input.resultPayload ? JSON.stringify(input.resultPayload) : null,
        normalizeOptionalString(input.errorMessage),
      ],
    );

    return mapRowToTaskAttemptRecord(result.rows[0]);
  }

  async listEvents(taskId: string): Promise<WorkerTaskEventRecord[]> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT id, task_id, event_seq, event_type, attempt_no, worker_name, message, detail_json, created_at
      FROM worker_task_events
      WHERE task_id = $1
      ORDER BY event_seq ASC`,
      [taskId],
    );
    return result.rows.map(mapRowToTaskEventRecord);
  }

  private async getNextEventSequence(taskId: string): Promise<number> {
    const pool = await getDatabasePool();
    const result = await pool.query(
      `SELECT COALESCE(MAX(event_seq), 0) AS max_event_seq
      FROM worker_task_events
      WHERE task_id = $1`,
      [taskId],
    );
    return Number(result.rows[0]?.max_event_seq || 0) + 1;
  }
}

export const taskStore = new TaskStore();

function serializeTaskRecord(record: WorkerTaskRecord): unknown[] {
  return [
    record.taskId,
    record.taskType,
    record.projectId,
    JSON.stringify(record.requestPayload),
    record.status,
    record.queuePublishStatus,
    record.queuePublishedAt,
    record.queuePublishError,
    record.progress,
    record.eta,
    record.message,
    record.errorCode,
    record.resultPayload ? JSON.stringify(record.resultPayload) : null,
    record.requestId,
    record.dedupeKey,
    record.nextRunAt,
    record.startedAt,
    record.finishedAt,
    record.workerName,
    record.createdAt,
    record.updatedAt,
    record.currentAttempt,
    record.maxAttempts,
    record.backoffSeconds,
    record.timeoutSeconds,
  ];
}

function mapRowToTaskRecord(row: Record<string, any>): WorkerTaskRecord {
  return {
    taskId: String(row.task_id),
    taskType: String(row.task_type),
    projectId: String(row.project_id),
    requestPayload: (row.request_payload || {}) as Record<string, unknown>,
    status: row.status,
    queuePublishStatus: row.queue_publish_status,
    queuePublishedAt: normalizeDateString(row.queue_published_at),
    queuePublishError: normalizeOptionalString(row.queue_publish_error),
    progress: row.progress === null ? null : Number(row.progress),
    eta: row.eta === null ? null : Number(row.eta),
    message: normalizeOptionalString(row.message),
    errorCode: normalizeOptionalString(row.error_code),
    resultPayload: row.result_payload ? (row.result_payload as Record<string, unknown>) : null,
    requestId: normalizeOptionalString(row.request_id),
    dedupeKey: normalizeOptionalString(row.dedupe_key),
    nextRunAt: normalizeDateString(row.next_run_at),
    startedAt: normalizeDateString(row.started_at),
    finishedAt: normalizeDateString(row.finished_at),
    workerName: normalizeOptionalString(row.worker_name),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    currentAttempt: Number(row.current_attempt),
    maxAttempts: Number(row.max_attempts),
    backoffSeconds: Array.isArray(row.backoff_seconds) ? row.backoff_seconds.map((value: unknown) => Number(value)) : [],
    timeoutSeconds: Number(row.timeout_seconds),
  };
}

function mapRowToTaskEventRecord(row: Record<string, any>): WorkerTaskEventRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    eventSeq: Number(row.event_seq),
    eventType: row.event_type,
    attemptNo: row.attempt_no === null ? null : Number(row.attempt_no),
    workerName: normalizeOptionalString(row.worker_name),
    message: normalizeOptionalString(row.message),
    detailJson: (row.detail_json || {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapRowToTaskAttemptRecord(row: Record<string, any>): WorkerTaskAttemptRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    attemptNo: Number(row.attempt_no),
    status: row.status,
    workerName: normalizeOptionalString(row.worker_name),
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: normalizeDateString(row.finished_at),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    resultPayload: row.result_payload ? (row.result_payload as Record<string, unknown>) : null,
    errorMessage: normalizeOptionalString(row.error_message),
  };
}

function normalizeDateString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  return new Date(String(value)).toISOString();
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeLimit(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 50;
  }
  return Math.min(Math.max(Math.floor(normalized), 1), 500);
}

function isUniqueViolationError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: string }).code === '23505';
}
