import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createEvent, EVENT_PUBLISHER, EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import {
  NotificationEntity,
  NotificationType,
} from '../infrastructure/persistence/notification.entity';
import { NotificationPageView, NotificationView, toNotificationView } from './views';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(BoardMembershipEntity)
    private readonly memberships: Repository<BoardMembershipEntity>,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /**
   * The user's notifications, newest first. The cursor is the id of the last item of the previous
   * page; comparing against that row keeps the full timestamp precision.
   */
  async list(userId: string, limit = 50, cursor?: string): Promise<NotificationPageView> {
    const query = this.notifications
      .createQueryBuilder('n')
      .where('n.recipientId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .limit(limit + 1);
    if (cursor) {
      query.andWhere(
        `(n.createdAt, n.id) < (SELECT c."createdAt", c.id FROM notifications c
            WHERE c.id = :cursor AND c.recipient_id = :userId)`,
        { cursor },
      );
    }
    const rows = await query.getMany();
    const items = rows.slice(0, limit).map(toNotificationView);
    return {
      items,
      nextCursor: rows.length > limit ? items[items.length - 1].id : null,
    };
  }

  /** Marks the user's notification read (keeps the first `readAt`); others answer 404. */
  async markRead(userId: string, notificationId: string): Promise<NotificationView> {
    await this.notifications
      .createQueryBuilder()
      .update()
      .set({ readAt: () => 'COALESCE(read_at, now())' })
      .where('id = :notificationId AND recipient_id = :userId', { notificationId, userId })
      .execute();
    const notification = await this.notifications.findOne({
      where: { id: notificationId, recipientId: userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return toNotificationView(notification);
  }

  /** One notification per Admin of the board. Returns the number created. */
  async notifyAdmins(
    boardId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const admins = await this.memberships.find({
      where: { boardId, role: BoardRole.ADMIN },
      select: { userId: true },
    });
    return this.createFor([...new Set(admins.map((m) => m.userId))], boardId, type, payload);
  }

  /** Notifies one member; a user who is not (or no longer) a member gets nothing. */
  async notifyUser(
    userId: string,
    boardId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const member = await this.memberships.exist({ where: { boardId, userId } });
    if (!member) return 0;
    return this.createFor([userId], boardId, type, payload);
  }

  private async createFor(
    recipientIds: string[],
    boardId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    if (recipientIds.length === 0) return 0;
    const saved = await this.notifications.save(
      recipientIds.map((recipientId) =>
        this.notifications.create({ recipientId, boardId, type, payload, readAt: null }),
      ),
    );
    for (const notification of saved) {
      await this.events.publish(
        createEvent('notification.created', {
          boardId,
          payload: {
            recipientId: notification.recipientId,
            notification: toNotificationView(notification),
          },
        }),
      );
    }
    return saved.length;
  }
}
