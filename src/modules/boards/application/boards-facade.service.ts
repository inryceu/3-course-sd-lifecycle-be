import { Injectable } from '@nestjs/common';
import { BoardAccess } from '../../../common/ports';
import { BoardRole } from '../domain/board-role';
import { BoardAccessService } from './board-access.service';
import { BoardsFacade } from './boards-facade.port';

/** Implements both the boards-specific facade and the shared `BOARD_ACCESS` port. */
@Injectable()
export class BoardsFacadeService implements BoardsFacade, BoardAccess {
  constructor(private readonly access: BoardAccessService) {}

  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null> {
    return this.access.getRole(userId, boardId);
  }

  async canView(userId: string, boardId: string): Promise<boolean> {
    return (await this.access.getRole(userId, boardId)) !== null;
  }
}
