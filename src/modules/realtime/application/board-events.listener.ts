import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, DomainEventOf } from '../../../common/events';
import { originSocketId } from '../presentation/origin-socket';
import { RealtimeGateway } from '../presentation/realtime.gateway';
import { boardRoom, userRoom } from './rooms';

/**
 * Forwards domain events to connected clients. The Socket.IO event name equals the event type and
 * the payload is the full envelope. The author's other sockets get the event too; only the socket
 * the author named in `X-Socket-Id` is skipped (otherwise clients dedupe by `actorId`).
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

  /** Evicts the removed user's sockets first, then tells the board and the removed user. */
  @OnEvent('member.removed')
  onMemberRemoved(event: DomainEventOf<'member.removed'>): void {
    const removed = userRoom(event.payload.userId);
    this.gateway.leaveRoom(removed, boardRoom(event.boardId));
    this.gateway.emitToRoom(
      [boardRoom(event.boardId), removed],
      event.type,
      event,
      this.originSocket(event),
    );
  }

  private toBoard(event: DomainEvent): void {
    this.gateway.emitToRoom(boardRoom(event.boardId), event.type, event, this.originSocket(event));
  }

  /** The request's `X-Socket-Id`, only if that socket belongs to the event's author. */
  private originSocket(event: DomainEvent): string | undefined {
    const socketId = originSocketId();
    return socketId && event.actorId && this.gateway.isSocketOf(socketId, event.actorId)
      ? socketId
      : undefined;
  }
}
