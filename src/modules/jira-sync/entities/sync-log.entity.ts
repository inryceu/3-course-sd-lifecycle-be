import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { JiraIssueMapping } from './jira-issue-mapping.entity';

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
export class SyncLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: SyncDirection })
  direction: SyncDirection;

  @Column({ type: 'enum', enum: SyncStatus })
  status: SyncStatus;

  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  payload: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'mapping_id', nullable: true })
  mappingId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => JiraIssueMapping, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mapping_id' })
  mapping: JiraIssueMapping | null;
}
