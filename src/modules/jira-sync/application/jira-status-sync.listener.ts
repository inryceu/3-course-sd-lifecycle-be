import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventOf } from '../../../common/events/domain-events';
import { OutboxWorker } from '../../../common/outbox/outbox.worker';

/** Wakes the outbox worker after a committed user move; it contains no Jira logic. */
@Injectable()
export class JiraStatusSyncListener {
  constructor(private readonly worker: OutboxWorker) {}

  @OnEvent('card.moved')
  onCardMoved(event: DomainEventOf<'card.moved'>): void {
    if (event.origin !== 'user') return;
    this.worker.kick();
  }
}
