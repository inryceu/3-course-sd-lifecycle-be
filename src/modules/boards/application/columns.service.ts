import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { createEvent, EVENT_PUBLISHER, EventPublisher } from '../../../common/events';
import { ColumnType, MIN_COLUMNS } from '../domain/board-role';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { toBoardSnapshot } from './board-events';
import { ColumnView, toColumnView } from './views';

export interface CreateColumnInput {
  title: string;
  type?: ColumnType;
  position?: number;
}

export interface UpdateColumnInput {
  title?: string;
  type?: ColumnType;
}

@Injectable()
export class ColumnsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(BoardColumnEntity) private readonly columns: Repository<BoardColumnEntity>,
    private readonly access: BoardAccessService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async list(userId: string, boardId: string): Promise<ColumnView[]> {
    await this.access.requireMember(userId, boardId);
    return this.orderedColumns(boardId);
  }

  async create(userId: string, boardId: string, input: CreateColumnInput): Promise<ColumnView> {
    await this.access.requireAdmin(userId, boardId);

    const created = await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, boardId);
      const count = await manager.count(BoardColumnEntity, { where: { boardId } });
      const position = input.position ?? count;
      if (position > count) {
        throw new BadRequestException(`Position must be between 0 and ${count}`);
      }
      await manager
        .createQueryBuilder()
        .update(BoardColumnEntity)
        .set({ position: () => 'position + 1' })
        .where('board_id = :boardId AND position >= :position', { boardId, position })
        .execute();
      return manager.save(
        manager.create(BoardColumnEntity, {
          boardId,
          title: input.title,
          type: input.type ?? ColumnType.TODO,
          position,
        }),
      );
    });

    await this.publishBoardUpdated(boardId, userId);
    return toColumnView(created);
  }

  async update(userId: string, columnId: string, input: UpdateColumnInput): Promise<ColumnView> {
    const column = await this.findColumn(columnId);
    await this.access.requireAdmin(userId, column.boardId);

    if (input.title !== undefined) column.title = input.title;
    if (input.type !== undefined) column.type = input.type;
    const saved = await this.columns.save(column);

    await this.publishBoardUpdated(column.boardId, userId);
    return toColumnView(saved);
  }

  /** Deletes an empty column while at least three columns remain. */
  async remove(userId: string, columnId: string): Promise<void> {
    const column = await this.findColumn(columnId);
    const { boardId } = column;
    await this.access.requireAdmin(userId, boardId);

    await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, boardId);
      const current = await manager.findOne(BoardColumnEntity, { where: { id: columnId } });
      if (!current) {
        throw new NotFoundException('Column not found');
      }
      const count = await manager.count(BoardColumnEntity, { where: { boardId } });
      if (count <= MIN_COLUMNS) {
        throw new ConflictException(`A board must keep at least ${MIN_COLUMNS} columns`);
      }
      const cards = await manager.count(CardEntity, { where: { columnId } });
      if (cards > 0) {
        throw new ConflictException('Move or delete the cards of this column first');
      }
      await manager.delete(BoardColumnEntity, { id: columnId });
      await manager
        .createQueryBuilder()
        .update(BoardColumnEntity)
        .set({ position: () => 'position - 1' })
        .where('board_id = :boardId AND position > :position', {
          boardId,
          position: current.position,
        })
        .execute();
    });

    await this.publishBoardUpdated(boardId, userId);
  }

  /** Moves a column to `position`, keeping positions 0..n-1 without gaps or duplicates. */
  async reorder(userId: string, columnId: string, position: number): Promise<ColumnView[]> {
    const column = await this.findColumn(columnId);
    const { boardId } = column;
    await this.access.requireAdmin(userId, boardId);

    const changed = await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, boardId);
      const current = await manager.findOne(BoardColumnEntity, { where: { id: columnId } });
      if (!current) {
        throw new NotFoundException('Column not found');
      }
      const count = await manager.count(BoardColumnEntity, { where: { boardId } });
      if (!Number.isInteger(position) || position < 0 || position > count - 1) {
        throw new BadRequestException(`Position must be between 0 and ${count - 1}`);
      }
      if (position === current.position) {
        return false;
      }
      const columns = manager.createQueryBuilder().update(BoardColumnEntity);
      if (position > current.position) {
        await columns
          .set({ position: () => 'position - 1' })
          .where('board_id = :boardId AND position > :from AND position <= :to', {
            boardId,
            from: current.position,
            to: position,
          })
          .execute();
      } else {
        await columns
          .set({ position: () => 'position + 1' })
          .where('board_id = :boardId AND position >= :to AND position < :from', {
            boardId,
            from: current.position,
            to: position,
          })
          .execute();
      }
      await manager.update(BoardColumnEntity, { id: columnId }, { position });
      return true;
    });

    if (changed) {
      await this.publishBoardUpdated(boardId, userId);
    }
    return this.orderedColumns(boardId);
  }

  private async findColumn(columnId: string): Promise<BoardColumnEntity> {
    const column = await this.columns.findOne({ where: { id: columnId } });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    return column;
  }

  private async orderedColumns(boardId: string): Promise<ColumnView[]> {
    const columns = await this.columns.find({ where: { boardId }, order: { position: 'ASC' } });
    return columns.map(toColumnView);
  }

  /** Serialises structural changes of one board; concurrent reorders queue behind this lock. */
  private async lockBoard(manager: EntityManager, boardId: string): Promise<void> {
    const board = await manager
      .createQueryBuilder(BoardEntity, 'board')
      .setLock('pessimistic_write')
      .where('board.id = :boardId', { boardId })
      .getOne();
    if (!board) {
      throw new NotFoundException('Board not found');
    }
  }

  private async publishBoardUpdated(boardId: string, actorId: string): Promise<void> {
    const board = await this.dataSource.getRepository(BoardEntity).findOne({
      where: { id: boardId },
    });
    if (!board) return;
    await this.events.publish(
      createEvent('board.updated', {
        boardId,
        actorId,
        payload: { board: toBoardSnapshot(board) },
      }),
    );
  }
}
