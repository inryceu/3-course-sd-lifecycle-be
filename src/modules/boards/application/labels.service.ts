import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EVENT_PUBLISHER, EventPublisher, createEvent } from '../../../common/events';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { LabelEntity } from '../infrastructure/persistence/label.entity';
import { BoardAccessService } from './board-access.service';
import { toCardSnapshot } from './board-events';
import { CardView, toCardView } from './views';

@Injectable()
export class LabelsService {
  constructor(
    @InjectRepository(LabelEntity) private readonly labels: Repository<LabelEntity>,
    @InjectRepository(CardEntity) private readonly cards: Repository<CardEntity>,
    private readonly access: BoardAccessService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async list(userId: string, boardId: string): Promise<LabelEntity[]> {
    await this.access.requireMember(userId, boardId);
    return this.labels.find({ where: { boardId }, order: { name: 'ASC' } });
  }

  async create(userId: string, boardId: string, name: string, color: string): Promise<LabelEntity> {
    await this.access.requireEditor(userId, boardId);
    try {
      const label = this.labels.create({ boardId, name, color });
      return await this.labels.save(label);
    } catch (error: any) {
      if (error.code === '23505') {
        throw new ConflictException('A label with this name already exists on this board');
      }
      throw error;
    }
  }

  async update(
    userId: string,
    labelId: string,
    name?: string,
    color?: string,
  ): Promise<LabelEntity> {
    const label = await this.labels.findOne({ where: { id: labelId } });
    if (!label) throw new NotFoundException('Label not found');
    await this.access.requireEditor(userId, label.boardId);

    if (name !== undefined) label.name = name;
    if (color !== undefined) label.color = color;

    try {
      return await this.labels.save(label);
    } catch (error: any) {
      if (error.code === '23505')
        throw new ConflictException('A label with this name already exists');
      throw error;
    }
  }

  async delete(userId: string, labelId: string): Promise<void> {
    const label = await this.labels.findOne({ where: { id: labelId } });
    if (!label) throw new NotFoundException('Label not found');
    await this.access.requireEditor(userId, label.boardId);
    await this.labels.remove(label);
  }

  async attachToCard(userId: string, cardId: string, labelId: string): Promise<CardView> {
    const card = await this.cards.findOne({ where: { id: cardId }, relations: { labels: true } });
    if (!card) throw new NotFoundException('Card not found');
    await this.access.requireEditor(userId, card.boardId);

    const label = await this.labels.findOne({ where: { id: labelId, boardId: card.boardId } });
    if (!label) throw new NotFoundException('Label not found');

    if (!card.labels.some((l) => l.id === label.id)) {
      card.labels.push(label);
      const saved = await this.cards.save(card);
      const view = toCardView(saved);
      await this.events.publish(
        createEvent('card.updated', {
          boardId: card.boardId,
          actorId: userId,
          origin: 'user',
          payload: toCardSnapshot(view),
        }),
      );
      return view;
    }
    return toCardView(card);
  }

  async detachFromCard(userId: string, cardId: string, labelId: string): Promise<CardView> {
    const card = await this.cards.findOne({ where: { id: cardId }, relations: { labels: true } });
    if (!card) throw new NotFoundException('Card not found');
    await this.access.requireEditor(userId, card.boardId);

    const initialLength = card.labels.length;
    card.labels = card.labels.filter((l) => l.id !== labelId);

    if (card.labels.length !== initialLength) {
      const saved = await this.cards.save(card);
      const view = toCardView(saved);
      await this.events.publish(
        createEvent('card.updated', {
          boardId: card.boardId,
          actorId: userId,
          origin: 'user',
          payload: toCardSnapshot(view),
        }),
      );
      return view;
    }
    return toCardView(card);
  }
}
