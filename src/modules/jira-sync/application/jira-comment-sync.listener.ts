import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventOf } from '../../../common/events/domain-events';
import { JiraCommentSyncService } from './jira-comment-sync.service';

/** Starts outbound comment synchronization without delaying the comment-create request. */
@Injectable()
export class JiraCommentSyncListener {
  private readonly logger = new Logger(JiraCommentSyncListener.name);

  constructor(private readonly sync: JiraCommentSyncService) {}

  @OnEvent('card.commented')
  onCardCommented(event: DomainEventOf<'card.commented'>): void {
    if (event.origin !== 'user') {
      return;
    }

    void this.sync.syncComment(event).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Unexpected Jira comment sync failure for card ${event.payload.cardId}: ${message}`,
        stack,
      );
    });
  }
}
