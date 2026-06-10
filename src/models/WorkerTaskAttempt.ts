import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'worker_task_attempts' })
@Index('uq_worker_task_attempts_task_attempt', ['taskId', 'attemptNo'], { unique: true })
@Index('idx_worker_task_attempts_task_attempt', ['taskId', 'attemptNo'])
export class WorkerTaskAttemptEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'attempt_no', type: 'integer' })
  attemptNo!: number;

  @Column({ type: 'text' })
  status!: string;

  @Column({ name: 'worker_name', type: 'text', nullable: true })
  workerName?: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs?: number | null;

  @Column({ name: 'result_payload', type: 'jsonb', nullable: true })
  resultPayload?: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;
}
