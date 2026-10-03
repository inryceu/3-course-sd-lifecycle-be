import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

/** Single-use anti-CSRF state plus the PKCE verifier (encrypted) of one OAuth flow, valid 10 minutes. */
@Entity('jira_oauth_states')
@Index('UQ_jira_oauth_states_state', ['state'], { unique: true })
@Index('IDX_jira_oauth_states_expires', ['expiresAt'])
export class JiraOAuthStateEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 128 })
  state: string;

  @Column({ type: 'text' })
  codeVerifierEnc: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
