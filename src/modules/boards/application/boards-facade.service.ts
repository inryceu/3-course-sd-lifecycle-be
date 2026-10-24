import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardRole } from '../domain/board-role';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import {
  BoardsFacade,
  BoardSummary,
  ExternalCardInput,
  ExternalCardMove,
  ExternalUpsertResult,
} from './boards-facade.port';
import { CardsService } from './cards.service';

@Injectable()
export class BoardsFacadeService implements BoardsFacade {
  constructor(
    private readonly access: BoardAccessService,
    private readonly cards: CardsService,
    @InjectRepository(BoardEntity) private readonly boards: Repository<BoardEntity>,
    @InjectRepository(BoardColumnEntity) private readonly columns: Repository<BoardColumnEntity>,
  ) {}

  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null> {
    return this.access.getRole(userId, boardId);
  }

  async getBoardSummary(boardId: string): Promise<BoardSummary | null> {
    const board = await this.boards.findOne({ where: { id: boardId } });
    if (!board) return null;
    const columns = await this.columns.find({ where: { boardId }, order: { position: 'ASC' } });
    return {
      id: board.id,
      jiraProjectKey: board.jiraProjectKey ?? null,
      columns: columns.map(({ id, title, type, position }) => ({ id, title, type, position })),
    };
  }

  async setJiraProjectKey(boardId: string, projectKey: string): Promise<void> {
    await this.boards.update({ id: boardId }, { jiraProjectKey: projectKey });
  }

  upsertCardFromExternal(input: ExternalCardInput): Promise<ExternalUpsertResult> {
    return this.cards.upsertFromExternal(input);
  }

  moveCardFromExternal(input: ExternalCardMove): Promise<'moved' | 'unchanged' | 'not-found'> {
    return this.cards.moveFromExternal(input);
  }
}
