import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'failed_jobs' })
@Index('idx_failed_jobs_failed_at', ['failedAt'])
export class FailedJobEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  queue!: string;

  @Column({ name: 'reserved_payload', type: 'text' })
  reservedPayload!: string;

  @Column({ type: 'jsonb', nullable: true })
  envelope?: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage!: string;

  @Column({ name: 'error_stack', type: 'text', nullable: true })
  errorStack?: string | null;

  @Column({ name: 'failed_at', type: 'timestamptz' })
  failedAt!: Date;
}
