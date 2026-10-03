import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, DomainEventOf } from '../../../common/events';
import { RealtimeGateway } from '../presentation/realtime.gateway';
import { boardRoom, userRoom } from './rooms';

/**
 * Forwards domain events to connected clients. The Socket.IO event name equals the event type and
 * the payload is the full envelope; the author is not excluded (clients dedupe by `actorId`).
 */
@Injectable()
export class BoardEventsListener {
  constructor(private readonly gateway: RealtimeGateway) {}

  @OnEvent('card.created')
  onCardCreated(event: DomainEventOf<'card.created'>): void {
    this.toBoard(event);
  }

  @OnEvent('card.updated')
  onCardUpdated(event: DomainEventOf<'card.updated'>): void {
    this.toBoard(event);
  }

  @OnEvent('card.moved')
  onCardMoved(event: DomainEventOf<'card.moved'>): void {
    this.toBoard(event);
  }

  @OnEvent('card.commented')
  onCardCommented(event: DomainEventOf<'card.commented'>): void {
    this.toBoard(event);
  }

  @OnEvent('board.updated')
  onBoardUpdated(event: DomainEventOf<'board.updated'>): void {
    this.toBoard(event);
  }

  @OnEvent('notification.created')
  onNotificationCreated(event: DomainEventOf<'notification.created'>): void {
    this.gateway.emitToRoom(userRoom(event.payload.recipientId), event.type, event);
  }

  private toBoard(event: DomainEvent): void {
    this.gateway.emitToRoom(boardRoom(event.boardId), event.type, event);
  }
}
