import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'worker_tasks' })
@Index('idx_worker_tasks_status_next_run', ['status', 'nextRunAt', 'createdAt'])
@Index('idx_worker_tasks_created_at', ['createdAt'])
@Index('uq_worker_tasks_dedupe_key', ['dedupeKey'], {
  unique: true,
  where: '"dedupe_key" IS NOT NULL',
})
export class WorkerTaskEntity {
  @PrimaryColumn({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'task_type', type: 'text' })
  taskType!: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ name: 'request_payload', type: 'jsonb' })
  requestPayload!: Record<string, unknown>;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'double precision', nullable: true })
  progress?: number | null;

  @Column({ type: 'integer', nullable: true })
  eta?: number | null;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode?: string | null;

  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'::jsonb" })
  result?: Record<string, unknown> | null;

  @Column({ name: 'queue_name', type: 'text', nullable: true })
  queueName?: string | null;

  @Column({ name: 'queue_job_name', type: 'text', nullable: true })
  queueJobName?: string | null;

  @Column({ name: 'current_attempt', type: 'integer', default: 0 })
  currentAttempt!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'backoff_seconds', type: 'integer', array: true })
  backoffSeconds!: number[];

  @Column({ name: 'timeout_seconds', type: 'integer' })
  timeoutSeconds!: number;

  @Column({ name: 'queue_publish_status', type: 'text', default: 'pending' })
  queuePublishStatus!: string;

  @Column({ name: 'queue_published_at', type: 'timestamptz', nullable: true })
  queuePublishedAt?: Date | null;

  @Column({ name: 'queue_publish_error', type: 'text', nullable: true })
  queuePublishError?: string | null;

  @Column({ name: 'result_payload', type: 'jsonb', nullable: true })
  resultPayload?: Record<string, unknown> | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId?: string | null;

  @Column({ name: 'dedupe_key', type: 'text', nullable: true })
  dedupeKey?: string | null;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt?: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ name: 'worker_name', type: 'text', nullable: true })
  workerName?: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
