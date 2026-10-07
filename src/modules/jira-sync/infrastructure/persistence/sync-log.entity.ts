import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { JiraIssueMappingEntity } from './jira-issue-mapping.entity';

export enum SyncDirection {
  TO_JIRA = 'TO_JIRA',
  FROM_JIRA = 'FROM_JIRA',
}

export enum SyncStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CONFLICT = 'CONFLICT',
}

@Entity('sync_logs')
export class SyncLogEntity extends BaseEntity {
  @Column({ type: 'enum', enum: SyncDirection })
  direction: SyncDirection;

  @Column({ type: 'enum', enum: SyncStatus })
  status: SyncStatus;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'mapping_id', type: 'uuid', nullable: true })
  mappingId: string | null;

  @ManyToOne(() => JiraIssueMappingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mapping_id' })
  mapping?: JiraIssueMappingEntity;
}
