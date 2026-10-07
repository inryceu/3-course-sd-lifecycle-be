import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createEvent, EVENT_PUBLISHER, EventPublisher } from '../../../common/events';
import { BoardRole, DEFAULT_COLUMNS } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { toBoardSnapshot } from './board-events';
import { BoardDetailView, BoardView, toBoardDetailView, toBoardView } from './views';

export interface CreateBoardInput {
  title: string;
  description?: string;
  jiraProjectKey?: string;
}

export interface UpdateBoardInput {
  title?: string;
  description?: string | null;
  jiraProjectKey?: string | null;
}

@Injectable()
export class BoardsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(BoardEntity) private readonly boards: Repository<BoardEntity>,
    @InjectRepository(BoardMembershipEntity)
    private readonly memberships: Repository<BoardMembershipEntity>,
    private readonly access: BoardAccessService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  /** Creates the board, its default columns and the creator's Admin membership atomically. */
  async create(userId: string, input: CreateBoardInput): Promise<BoardDetailView> {
    const boardId = await this.dataSource.transaction(async (manager) => {
      const board = await manager.save(
        manager.create(BoardEntity, {
          title: input.title,
          description: input.description ?? null,
          jiraProjectKey: input.jiraProjectKey ?? null,
        }),
      );
      await manager.save(
        DEFAULT_COLUMNS.map((column, position) =>
          manager.create(BoardColumnEntity, {
            boardId: board.id,
            title: column.title,
            type: column.type,
            position,
          }),
        ),
      );
      await manager.save(
        manager.create(BoardMembershipEntity, {
          boardId: board.id,
          userId,
          role: BoardRole.ADMIN,
        }),
      );
      return board.id;
    });
    return this.get(userId, boardId);
  }

  async list(userId: string): Promise<BoardView[]> {
    const memberships = await this.memberships.find({
      where: { userId },
      relations: { board: true },
      order: { createdAt: 'ASC' },
    });
    return memberships
      .filter((membership) => membership.board)
      .map((membership) => toBoardView(membership.board, membership.role));
  }

  async get(userId: string, boardId: string): Promise<BoardDetailView> {
    const role = await this.access.requireMember(userId, boardId);
    const board = await this.boards.findOne({
      where: { id: boardId },
      relations: { columns: { cards: { labels: true } } },
    });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    return toBoardDetailView(board, role);
  }

  async update(userId: string, boardId: string, input: UpdateBoardInput): Promise<BoardView> {
    const role = await this.access.requireAdmin(userId, boardId);
    const board = await this.boards.findOne({ where: { id: boardId } });
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (input.title !== undefined) board.title = input.title;
    if (input.description !== undefined) board.description = input.description;
    if (input.jiraProjectKey !== undefined) board.jiraProjectKey = input.jiraProjectKey;
    const saved = await this.boards.save(board);

    await this.events.publish(
      createEvent('board.updated', {
        boardId,
        actorId: userId,
        payload: { board: toBoardSnapshot(saved) },
      }),
    );
    return toBoardView(saved, role);
  }

  async remove(userId: string, boardId: string): Promise<void> {
    await this.access.requireAdmin(userId, boardId);
    await this.boards.delete({ id: boardId });
  }
}
