import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'task_type_definitions' })
@Index('uq_task_type_definitions_type_version', ['taskType', 'version'], { unique: true })
@Index('idx_task_type_definitions_type_enabled', ['taskType', 'enabled'])
@Index('idx_task_type_definitions_updated_at', ['updatedAt'])
export class TaskTypeDefinitionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'task_type', type: 'text' })
  taskType!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'definition_json', type: 'jsonb' })
  definitionJson!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'text' })
  updatedBy!: string;
}
