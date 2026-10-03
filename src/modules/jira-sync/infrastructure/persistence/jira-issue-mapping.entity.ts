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
}
