import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

/**
 * Link between a board card and a Jira issue. Boards, cards and users are referenced by id only
 * (no cross-module foreign keys); the sync tickets (T-23+) own the behaviour built on it.
 */
@Entity('jira_issue_mappings')
@Index('IDX_jira_issue_mappings_board', ['boardId'])
@Index('UQ_jira_issue_mappings_board_issue', ['boardId', 'jiraIssueKey'], { unique: true })
export class JiraIssueMappingEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  jiraIssueKey: string;

  @Column({ type: 'varchar', length: 50 })
  jiraIssueId: string;

  @Column({ type: 'varchar', length: 100 })
  jiraProjectKey: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'card_id', type: 'uuid', nullable: true })
  cardId: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  /** `timestamp` (ms) of the last Jira webhook delivery applied; older deliveries are dropped. */
  @Column({ name: 'last_jira_event_at', type: 'bigint', nullable: true })
  lastJiraEventAt: string | null;

  // Latest change on each side, for conflict detection (FR-13); see JiraSyncConflictDetector.
  @Column({ name: 'last_board_move_at', type: 'timestamptz', nullable: true })
  lastBoardMoveAt: Date | null;

  @Column({ name: 'last_board_column_id', type: 'uuid', nullable: true })
  lastBoardColumnId: string | null;

  /** Latest Jira status change that was not an echo of BoardSync's own transition. */
  @Column({ name: 'last_jira_change_at', type: 'timestamptz', nullable: true })
  lastJiraChangeAt: Date | null;

  @Column({ name: 'last_jira_column_id', type: 'uuid', nullable: true })
  lastJiraColumnId: string | null;

  @Column({ name: 'last_jira_status_name', type: 'varchar', length: 255, nullable: true })
  lastJiraStatusName: string | null;
}
