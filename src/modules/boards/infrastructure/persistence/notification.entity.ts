import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

export type NotificationType = 'deadline.reminder' | 'jira.conflict' | 'board.invited';

/** In-app notification of one user. `recipientId` is a user id (auth module), not a foreign key. */
@Entity('notifications')
@Index('IDX_notifications_recipient_created', ['recipientId', 'createdAt', 'id'])
export class NotificationEntity extends BaseEntity {
  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId: string;

  /** Board the notification is about; used as the event's `boardId`. */
  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ type: 'varchar', length: 50 })
  type: NotificationType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
