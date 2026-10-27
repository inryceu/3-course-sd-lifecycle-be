import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../infrastructure/persistence/notification.entity';
import { NotificationPageView, NotificationView, toNotificationView } from './views';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
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
}
