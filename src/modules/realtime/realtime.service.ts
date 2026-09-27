import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

export interface BoardUpdateEvent {
  type:
    | 'card.created'
    | 'card.updated'
    | 'card.moved'
    | 'card.deleted'
    | 'column.created'
    | 'column.updated'
    | 'column.deleted'
    | 'column.reordered';
  boardId: string;
  payload: any;
}

@Injectable()
export class RealtimeService {
  constructor(private realtimeGateway: RealtimeGateway) {}

  emitBoardUpdate(event: BoardUpdateEvent) {
    this.realtimeGateway.broadcastToBoard(event.boardId, 'board:update', event);
  }

  emitCardCreated(boardId: string, card: any) {
    this.emitBoardUpdate({ type: 'card.created', boardId, payload: card });
  }

  emitCardUpdated(boardId: string, card: any) {
    this.emitBoardUpdate({ type: 'card.updated', boardId, payload: card });
  }

  emitCardMoved(
    boardId: string,
    cardId: string,
    fromColumnId: string,
    toColumnId: string,
    position: number,
  ) {
    this.emitBoardUpdate({
      type: 'card.moved',
      boardId,
      payload: { cardId, fromColumnId, toColumnId, position },
    });
  }

  emitCardDeleted(boardId: string, cardId: string) {
    this.emitBoardUpdate({ type: 'card.deleted', boardId, payload: { cardId } });
  }

  emitColumnCreated(boardId: string, column: any) {
    this.emitBoardUpdate({ type: 'column.created', boardId, payload: column });
  }

  emitColumnUpdated(boardId: string, column: any) {
    this.emitBoardUpdate({ type: 'column.updated', boardId, payload: column });
  }

  emitColumnDeleted(boardId: string, columnId: string) {
    this.emitBoardUpdate({ type: 'column.deleted', boardId, payload: { columnId } });
  }

  emitColumnReordered(boardId: string, columnId: string, newPosition: number) {
    this.emitBoardUpdate({ type: 'column.reordered', boardId, payload: { columnId, newPosition } });
  }
}
