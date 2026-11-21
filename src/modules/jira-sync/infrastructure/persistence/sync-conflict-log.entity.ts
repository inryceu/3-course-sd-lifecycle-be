import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { JiraIssueMappingEntity } from './jira-issue-mapping.entity';

/** Which version a conflict ended with. `jira` is applied automatically when it is detected. */
export type ConflictResolution = 'jira' | 'boardsync';

/**
 * A card changed in BoardSync and in Jira within the conflict window (FR-13). Boards, cards and
 * users are referenced by id only; `createdAt` is the detection time.
 */
@Entity('sync_conflict_log')
@Index('IDX_sync_conflict_log_board_created', ['boardId', 'createdAt', 'id'])
export class SyncConflictLogEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  @Column({ name: 'mapping_id', type: 'uuid', nullable: true })
  mappingId: string | null;

  @ManyToOne(() => JiraIssueMappingEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'mapping_id' })
  mapping?: JiraIssueMappingEntity;

  @Column({ name: 'jira_issue_key', type: 'varchar', length: 50 })
  jiraIssueKey: string;

  @Column({ name: 'board_column_id', type: 'uuid' })
  boardColumnId: string;

  @Column({ name: 'board_status', type: 'varchar', length: 255 })
  boardStatus: string;

  @Column({ name: 'board_changed_at', type: 'timestamptz' })
  boardChangedAt: Date;

  @Column({ name: 'jira_column_id', type: 'uuid' })
  jiraColumnId: string;

  @Column({ name: 'jira_status', type: 'varchar', length: 255 })
  jiraStatus: string;

  @Column({ name: 'jira_changed_at', type: 'timestamptz' })
  jiraChangedAt: Date;

  @Column({ type: 'varchar', length: 20, default: 'jira' })
  resolution: ConflictResolution;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true })
  resolvedById: string | null;
}
