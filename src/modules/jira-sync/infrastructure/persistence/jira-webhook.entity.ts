import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

@Entity('jira_webhooks')
@Index('UQ_jira_webhooks_board', ['boardId'], { unique: true })
export class JiraWebhookEntity extends BaseEntity {
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'project_key', type: 'varchar', length: 10 })
  projectKey: string;

  @Column({ name: 'webhook_id', type: 'int' })
  webhookId: number;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  events: string[];

  @Column({ name: 'jql_filter', type: 'varchar', length: 255 })
  jqlFilter: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_refreshed_at', type: 'timestamptz', nullable: true })
  lastRefreshedAt: Date | null;
}
