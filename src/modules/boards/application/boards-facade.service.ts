import { Injectable } from '@nestjs/common';
import { BoardRole } from '../domain/board-role';
import { BoardAccessService } from './board-access.service';
import { BoardsFacade, ExternalCardInput, ExternalCardMove } from './boards-facade.port';
import { CardsService } from './cards.service';

@Injectable()
export class BoardsFacadeService implements BoardsFacade {
  constructor(
    private readonly access: BoardAccessService,
    private readonly cards: CardsService,
  ) {}

  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null> {
    return this.access.getRole(userId, boardId);
  }

  async upsertCardFromExternal(input: ExternalCardInput): Promise<void> {
    return this.cards.upsertFromExternal(input);
  }

  async moveCardFromExternal(
    input: ExternalCardMove,
  ): Promise<'moved' | 'unchanged' | 'not-found'> {
    return this.cards.moveFromExternal(input);
  }
}
