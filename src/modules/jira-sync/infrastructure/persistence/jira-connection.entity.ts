import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

/** One Jira workspace connection per board. Tokens are stored encrypted and never selected by default. */
@Entity('jira_connections')
@Index('UQ_jira_connections_board', ['boardId'], { unique: true })
export class JiraConnectionEntity extends BaseEntity {
  /** Board id (boards module); deliberately not a foreign key across modules. */
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  /** User id (auth module) who connected the workspace. */
  @Column({ name: 'connected_by_id', type: 'uuid' })
  connectedById: string;

  @Column({ type: 'varchar', length: 100 })
  cloudId: string;

  @Column({ type: 'varchar', length: 255 })
  siteUrl: string;

  @Column({ type: 'text', select: false })
  accessTokenEnc: string;

  @Column({ type: 'text', nullable: true, select: false })
  refreshTokenEnc: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  scopes: string[];

  @Column({ type: 'timestamptz' })
  connectedAt: Date;
}
