import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

/**
 * Which board column a Jira status of the linked project maps to. Statuses without a row use the
 * default from their status category. Board and column are referenced by id only (no cross-module
 * foreign keys); a deleted column falls back to the default.
 */
@Entity('jira_status_mappings')
@Index('UQ_jira_status_mappings_board_status', ['boardId', 'jiraStatusId'], { unique: true })
export class JiraStatusMappingEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'jira_status_id', type: 'varchar', length: 50 })
  jiraStatusId: string;

  @Column({ name: 'jira_status_name', type: 'varchar', length: 255 })
  jiraStatusName: string;

  @Column({ name: 'column_id', type: 'uuid' })
  columnId: string;
}
