import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createEvent, EVENT_PUBLISHER, EventPublisher } from '../../../common/events';
import { NotificationEntity } from '../infrastructure/persistence/notification.entity';
import { toNotificationView } from './views';

export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

interface ClaimedCard {
  id: string;
  board_id: string;
  title: string;
  deadline: Date;
  assignee_id: string;
}

/**
 * Reminds assignees of cards due within the next 24 hours (FR-09). A card is claimed by setting
 * `reminder_sent_at` in the same transaction that stores its notification, so restarts and
 * several instances never remind twice; `notification.created` is published after the commit.
 */
@Injectable()
export class DeadlineRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeadlineRemindersService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.getOrThrow<number>('reminders.intervalSeconds');
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One scheduler tick; skipped while the previous run is still in progress. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Deadline reminder run failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Creates the due reminders and returns how many were created. `now` is UTC by definition. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

    const created = await this.dataSource.transaction(async (manager) => {
      // Raw SQL so the claim does not bump the card's updatedAt. A concurrent run blocks on the
      // row lock, re-checks `reminder_sent_at IS NULL` and skips the row.
      const [claimed] = (await manager.query(
        `UPDATE cards SET reminder_sent_at = $1
          WHERE assignee_id IS NOT NULL AND reminder_sent_at IS NULL
            AND deadline > $1 AND deadline <= $2
          RETURNING id, board_id, title, deadline, assignee_id`,
        [now, windowEnd],
      )) as [ClaimedCard[], number];
      if (claimed.length === 0) return [];
      return manager.save(
        claimed.map((card) =>
          manager.create(NotificationEntity, {
            recipientId: card.assignee_id,
            boardId: card.board_id,
            type: 'deadline.reminder',
            payload: {
              cardId: card.id,
              boardId: card.board_id,
              cardTitle: card.title,
              deadline: new Date(card.deadline).toISOString(),
            },
            readAt: null,
          }),
        ),
      );
    });

    for (const notification of created) {
      await this.events.publish(
        createEvent('notification.created', {
          boardId: notification.boardId,
          occurredAt: now,
          payload: {
            recipientId: notification.recipientId,
            notification: toNotificationView(notification),
          },
        }),
      );
    }
    return created.length;
  }
}
