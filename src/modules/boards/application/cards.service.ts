import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { createEvent, EVENT_PUBLISHER, EventPublisher } from '../../../common/events';
import { CrossBoardMoveError, InvalidPositionError } from '../domain/errors';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { LabelEntity } from '../infrastructure/persistence/label.entity';
import { BoardAccessService } from './board-access.service';
import { toBoardSnapshot, toCardSnapshot } from './board-events';
import { CardView, toCardView } from './views';

export interface CreateCardInput {
  title: string;
  description?: string;
  deadline?: string;
  assigneeId?: string;
  labelIds?: string[];
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  deadline?: string | null;
}

export interface MoveCardInput {
  columnId: string;
  position: number;
}

@Injectable()
export class CardsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CardEntity) private readonly cards: Repository<CardEntity>,
    @InjectRepository(BoardColumnEntity) private readonly columns: Repository<BoardColumnEntity>,
    private readonly access: BoardAccessService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async listByColumn(userId: string, columnId: string): Promise<CardView[]> {
    const column = await this.findColumn(columnId);
    await this.access.requireMember(userId, column.boardId);
    const cards = await this.cards.find({
      where: { columnId },
      relations: { labels: true },
      order: { position: 'ASC' },
    });
    return cards.map(toCardView);
  }

  async get(userId: string, cardId: string): Promise<CardView> {
    const card = await this.findCard(cardId);
    await this.access.requireMember(userId, card.boardId);
    return toCardView(card);
  }

  /** Appends a card at the end of the column; the board is derived from the column. */
  async create(userId: string, columnId: string, input: CreateCardInput): Promise<CardView> {
    const column = await this.findColumn(columnId);
    const { boardId } = column;
    await this.access.requireEditor(userId, boardId);

    const labels = await this.resolveLabels(boardId, input.labelIds);
    if (input.assigneeId) {
      await this.assertMember(boardId, input.assigneeId);
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, boardId);
      const count = await manager.count(CardEntity, { where: { columnId } });
      return manager.save(
        manager.create(CardEntity, {
          boardId,
          columnId,
          title: input.title,
          description: input.description ?? null,
          deadline: input.deadline ? new Date(input.deadline) : null,
          assigneeId: input.assigneeId ?? null,
          position: count,
          labels,
        }),
      );
    });

    const view = toCardView(saved);
    await this.events.publish(
      createEvent('card.created', {
        boardId,
        actorId: userId,
        payload: toCardSnapshot(view),
      }),
    );
    return view;
  }

  async update(userId: string, cardId: string, input: UpdateCardInput): Promise<CardView> {
    const card = await this.findCard(cardId);
    await this.access.requireEditor(userId, card.boardId);

    if (input.title !== undefined) card.title = input.title;
    if (input.description !== undefined) card.description = input.description;
    if (input.deadline !== undefined) {
      card.deadline = input.deadline ? new Date(input.deadline) : null;
    }
    const saved = await this.cards.save(card);

    const view = toCardView(saved);
    await this.events.publish(
      createEvent('card.updated', {
        boardId: card.boardId,
        actorId: userId,
        payload: toCardSnapshot(view),
      }),
    );
    return view;
  }

  /**
   * Moves a card to a column of the same board. Positions of the source and target column stay
   * 0..n-1; the whole change is one transaction serialised per board.
   */
  async move(userId: string, cardId: string, input: MoveCardInput): Promise<CardView> {
    const card = await this.findCard(cardId);
    const { boardId } = card;
    await this.access.requireEditor(userId, boardId);

    const { view, fromColumnId } = await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, boardId);

      const current = await manager.findOne(CardEntity, {
        where: { id: cardId },
        relations: { labels: true },
      });
      const target = await manager.findOne(BoardColumnEntity, { where: { id: input.columnId } });
      if (!current) throw new NotFoundException('Card not found');
      if (!target) throw new NotFoundException('Target column not found');

      const from = { columnId: current.columnId, position: current.position };
      const sameColumn = from.columnId === target.id;
      const count = await manager.count(CardEntity, { where: { columnId: target.id } });
      const maxPosition = sameColumn ? count - 1 : count;
      if (input.position > maxPosition) {
        throw new BadRequestException(`Position must be between 0 and ${maxPosition}`);
      }

      try {
        current.moveTo({ id: target.id, boardId: target.boardId }, input.position);
      } catch (error) {
        if (error instanceof CrossBoardMoveError || error instanceof InvalidPositionError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }

      await this.shiftNeighbours(manager, from, { columnId: target.id, position: input.position });
      await manager.update(
        CardEntity,
        { id: cardId },
        { columnId: current.columnId, position: current.position },
      );
      const moved = await manager.findOneOrFail(CardEntity, {
        where: { id: cardId },
        relations: { labels: true },
      });
      return { view: toCardView(moved), fromColumnId: from.columnId };
    });

    await this.events.publish(
      createEvent('card.moved', {
        boardId,
        actorId: userId,
        payload: {
          card: toCardSnapshot(view),
          fromColumnId,
          toColumnId: view.columnId,
          position: view.position,
        },
      }),
    );
    return view;
  }

  async remove(userId: string, cardId: string): Promise<void> {
    const card = await this.findCard(cardId);
    await this.access.requireEditor(userId, card.boardId);

    await this.dataSource.transaction(async (manager) => {
      await this.lockBoard(manager, card.boardId);
      const current = await manager.findOne(CardEntity, { where: { id: cardId } });
      if (!current) return;
      await manager.delete(CardEntity, { id: cardId });
      await manager
        .createQueryBuilder()
        .update(CardEntity)
        .set({ position: () => 'position - 1' })
        .where('column_id = :columnId AND position > :position', {
          columnId: current.columnId,
          position: current.position,
        })
        .execute();
    });

    await this.events.publish(
      createEvent('board.updated', {
        boardId: card.boardId,
        actorId: userId,
        payload: { board: await this.boardSnapshot(card.boardId) },
      }),
    );
  }

  /** Closes the gap at `from` and opens one at `to`, without touching the moved card itself. */
  private async shiftNeighbours(
    manager: EntityManager,
    from: { columnId: string; position: number },
    to: { columnId: string; position: number },
  ): Promise<void> {
    const shift = (columnId: string, delta: '+ 1' | '- 1', condition: string, params: object) =>
      manager
        .createQueryBuilder()
        .update(CardEntity)
        .set({ position: () => `position ${delta}` })
        .where(`column_id = :columnId AND ${condition}`, { columnId, ...params })
        .execute();

    if (from.columnId === to.columnId) {
      if (to.position > from.position) {
        await shift(from.columnId, '- 1', 'position > :from AND position <= :to', {
          from: from.position,
          to: to.position,
        });
      } else if (to.position < from.position) {
        await shift(from.columnId, '+ 1', 'position >= :to AND position < :from', {
          from: from.position,
          to: to.position,
        });
      }
      return;
    }
    await shift(from.columnId, '- 1', 'position > :from', { from: from.position });
    await shift(to.columnId, '+ 1', 'position >= :to', { to: to.position });
  }

  private async findColumn(columnId: string): Promise<BoardColumnEntity> {
    const column = await this.columns.findOne({ where: { id: columnId } });
    if (!column) {
      throw new NotFoundException('Column not found');
    }
    return column;
  }

  private async findCard(cardId: string): Promise<CardEntity> {
    const card = await this.cards.findOne({ where: { id: cardId }, relations: { labels: true } });
    if (!card) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }

  private async resolveLabels(boardId: string, labelIds?: string[]): Promise<LabelEntity[]> {
    if (!labelIds?.length) return [];
    const labels = await this.dataSource
      .getRepository(LabelEntity)
      .find({ where: { id: In(labelIds), boardId } });
    if (labels.length !== new Set(labelIds).size) {
      throw new BadRequestException('Unknown label for this board');
    }
    return labels;
  }

  private async assertMember(boardId: string, userId: string): Promise<void> {
    const membership = await this.dataSource
      .getRepository(BoardMembershipEntity)
      .findOne({ where: { boardId, userId } });
    if (!membership) {
      throw new BadRequestException('The assignee is not a member of this board');
    }
  }

  private async boardSnapshot(boardId: string) {
    const board = await this.dataSource.getRepository(BoardEntity).findOneOrFail({
      where: { id: boardId },
    });
    return toBoardSnapshot(board);
  }

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
}
