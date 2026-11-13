import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

@Entity('jira_webhook_deliveries')
@Index('UQ_jira_webhook_deliveries_key', ['deliveryKey'], { unique: true })
@Index('IDX_jira_webhook_deliveries_expires', ['expiresAt'])
export class JiraWebhookDeliveryEntity extends BaseEntity {
  @Column({ name: 'delivery_key', type: 'varchar', length: 255 })
  deliveryKey: string;

  @Column({ type: 'varchar', length: 20, default: 'processing' })
  status: 'processing' | 'processed';

  @Column({ type: 'int', default: 1 })
  attempts: number;

  @Column({ name: 'claimed_at', type: 'timestamptz' })
  claimedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
