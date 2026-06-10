import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'worker_task_events' })
@Index('uq_worker_task_events_task_seq', ['taskId', 'eventSeq'], { unique: true })
@Index('idx_worker_task_events_task_seq', ['taskId', 'eventSeq'])
export class WorkerTaskEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'event_seq', type: 'integer' })
  eventSeq!: number;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'attempt_no', type: 'integer', nullable: true })
  attemptNo?: number | null;

  @Column({ name: 'worker_name', type: 'text', nullable: true })
  workerName?: string | null;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ name: 'detail_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  detailJson!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
