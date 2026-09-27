import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Card } from './entities/card.entity';
import { Column } from './entities/column.entity';
import { Label } from './entities/label.entity';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { BoardsService } from './boards.service';

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card)
    private cardsRepository: Repository<Card>,
    @InjectRepository(Column)
    private columnsRepository: Repository<Column>,
    @InjectRepository(Label)
    private labelsRepository: Repository<Label>,
    private boardsService: BoardsService,
  ) {}

  async create(userId: string, boardId: string, createCardDto: CreateCardDto): Promise<Card> {
    const column = await this.columnsRepository.findOne({
      where: { id: createCardDto.columnId },
      relations: ['board'],
    });

    if (!column) {
      throw new NotFoundException('Column not found');
    }

    await this.boardsService.findOne(userId, column.board.id);

    const labels = createCardDto.labelIds?.length
      ? await this.labelsRepository.findByIds(createCardDto.labelIds)
      : [];

    const maxPosition = await this.cardsRepository
      .createQueryBuilder('card')
      .where('card.columnId = :columnId', { columnId: createCardDto.columnId })
      .select('MAX(card.position)', 'max')
      .getRawOne();

    const card = this.cardsRepository.create({
      ...createCardDto,
      column,
      labels,
      position: (maxPosition?.max ?? -1) + 1,
    });

    return this.cardsRepository.save(card);
  }

  async findByColumn(userId: string, columnId: string): Promise<Card[]> {
    const column = await this.columnsRepository.findOne({
      where: { id: columnId },
      relations: ['board'],
    });

    if (!column) {
      throw new NotFoundException('Column not found');
    }

    await this.boardsService.findOne(userId, column.board.id);

    return this.cardsRepository.find({
      where: { column: { id: columnId } },
      relations: ['labels', 'assignee'],
      order: { position: 'ASC' },
    });
  }

  async findOne(userId: string, cardId: string): Promise<Card> {
    const card = await this.cardsRepository.findOne({
      where: { id: cardId },
      relations: ['column', 'column.board', 'labels', 'assignee', 'comments', 'comments.author'],
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    await this.boardsService.findOne(userId, card.column.board.id);
    return card;
  }

  async update(userId: string, cardId: string, updateCardDto: UpdateCardDto): Promise<Card> {
    const card = await this.findOne(userId, cardId);

    if (updateCardDto.labelIds) {
      card.labels = await this.labelsRepository.findByIds(updateCardDto.labelIds);
    }

    Object.assign(card, updateCardDto);
    return this.cardsRepository.save(card);
  }

  async move(userId: string, cardId: string, targetColumnId: string, newPosition: number): Promise<Card> {
    const card = await this.findOne(userId, cardId);
    const targetColumn = await this.columnsRepository.findOne({
      where: { id: targetColumnId },
      relations: ['board'],
    });

    if (!targetColumn) {
      throw new NotFoundException('Target column not found');
    }

    await this.boardsService.findOne(userId, targetColumn.board.id);

    // Reorder cards in target column
    await this.cardsRepository
      .createQueryBuilder()
      .update(Card)
      .set({ position: () => 'position + 1' })
      .where('columnId = :columnId AND position >= :position', {
        columnId: targetColumnId,
        position: newPosition,
      })
      .execute();

    card.column = targetColumn;
    card.position = newPosition;
    return this.cardsRepository.save(card);
  }

  async remove(userId: string, cardId: string): Promise<void> {
    const card = await this.findOne(userId, cardId);
    await this.cardsRepository.remove(card);
  }
}