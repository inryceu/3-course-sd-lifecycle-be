import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventOf } from '../../../common/events/domain-events';
import { JiraStatusSyncService } from './jira-status-sync.service';

/** Starts outbound status synchronization without delaying the card-move request. */
@Injectable()
export class JiraStatusSyncListener {
  private readonly logger = new Logger(JiraStatusSyncListener.name);

  constructor(private readonly sync: JiraStatusSyncService) {}

  @OnEvent('card.moved')
  onCardMoved(event: DomainEventOf<'card.moved'>): void {
    if (event.origin !== 'user') {
      return;
    }
    if (event.payload.fromColumnId === event.payload.toColumnId) {
      return;
    }
    if (event.payload.card.jiraIssueKey === null) {
      this.logger.debug(`Skipping Jira status sync for unlinked card ${event.payload.card.id}`);
      return;
    }

    void this.sync.syncCardMove(event).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Unexpected Jira status sync failure for card ${event.payload.card.id}: ${message}`,
        stack,
      );
    });
  }
}
