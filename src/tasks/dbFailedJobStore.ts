import { getDatabasePool } from '../infra/database.js';
import type { FailedJobStore } from '../queue/FailedJobStore.js';
import type { FailedJobRecord } from '../queue/types.js';

export class DbFailedJobStore implements FailedJobStore {
  async save(record: FailedJobRecord): Promise<void> {
    const pool = await getDatabasePool();
    await pool.query(
      `INSERT INTO failed_jobs (
        queue,
        reserved_payload,
        envelope,
        error_message,
        error_stack,
        failed_at
      ) VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz)`,
      [
        record.queue,
        record.reservedPayload,
        record.envelope ? JSON.stringify(record.envelope) : null,
        record.errorMessage,
        record.errorStack || null,
        new Date(record.failedAt * 1000).toISOString(),
      ],
    );
  }
}
