import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardColumn } from './entities/column.entity';
import { Board } from './entities/board.entity';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { BoardsService } from './boards.service';

@Injectable()
export class ColumnsService {
  constructor(
    @InjectRepository(BoardColumn)
    private columnsRepository: Repository<BoardColumn>,
    @InjectRepository(Board)
    private boardsRepository: Repository<Board>,
    private boardsService: BoardsService,
  ) {}

  async create(userId: string, createColumnDto: CreateColumnDto): Promise<BoardColumn> {
    await this.boardsService.findOne(userId, createColumnDto.boardId);

    const maxPosition = await this.columnsRepository
      .createQueryBuilder('column')
      .where('column.boardId = :boardId', { boardId: createColumnDto.boardId })
      .select('MAX(column.position)', 'max')
      .getRawOne();

    const column = this.columnsRepository.create({
      ...createColumnDto,
      board: { id: createColumnDto.boardId } as Board,
      position: (maxPosition?.max ?? -1) + 1,
    });

    return this.columnsRepository.save(column);
  }

  async findByBoard(userId: string, boardId: string): Promise<BoardColumn[]> {
    await this.boardsService.findOne(userId, boardId);

    return this.columnsRepository.find({
      where: { board: { id: boardId } },
      relations: ['cards', 'cards.labels', 'cards.assignee'],
      order: { position: 'ASC' },
    });
  }

  async update(
    userId: string,
    columnId: string,
    updateColumnDto: UpdateColumnDto,
  ): Promise<BoardColumn> {
    const column = await this.columnsRepository.findOne({
      where: { id: columnId },
      relations: ['board'],
    });

    if (!column) {
      throw new NotFoundException('Column not found');
    }

    await this.boardsService.findOne(userId, column.board.id);

    Object.assign(column, updateColumnDto);
    return this.columnsRepository.save(column);
  }

  async reorder(userId: string, columnId: string, newPosition: number): Promise<BoardColumn> {
    const column = await this.columnsRepository.findOne({
      where: { id: columnId },
      relations: ['board'],
    });

    if (!column) {
      throw new NotFoundException('Column not found');
    }

    await this.boardsService.findOne(userId, column.board.id);

    const oldPosition = column.position;

    if (newPosition > oldPosition) {
      await this.columnsRepository
        .createQueryBuilder()
        .update(BoardColumn)
        .set({ position: () => 'position - 1' })
        .where('boardId = :boardId AND position > :oldPosition AND position <= :newPosition', {
          boardId: column.board.id,
          oldPosition,
          newPosition,
        })
        .execute();
    } else if (newPosition < oldPosition) {
      await this.columnsRepository
        .createQueryBuilder()
        .update(BoardColumn)
        .set({ position: () => 'position + 1' })
        .where('boardId = :boardId AND position >= :newPosition AND position < :oldPosition', {
          boardId: column.board.id,
          newPosition,
          oldPosition,
        })
        .execute();
    }

    column.position = newPosition;
    return this.columnsRepository.save(column);
  }

  async remove(userId: string, columnId: string): Promise<void> {
    const column = await this.columnsRepository.findOne({
      where: { id: columnId },
      relations: ['board'],
    });

    if (!column) {
      throw new NotFoundException('Column not found');
    }

    await this.boardsService.findOne(userId, column.board.id);

    await this.columnsRepository
      .createQueryBuilder()
      .update(BoardColumn)
      .set({ position: () => 'position - 1' })
      .where('boardId = :boardId AND position > :position', {
        boardId: column.board.id,
        position: column.position,
      })
      .execute();

    await this.columnsRepository.remove(column);
  }
}
