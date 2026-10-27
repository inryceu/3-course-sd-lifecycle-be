import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { LabelEntity } from '../infrastructure/persistence/label.entity';
import { BoardAccessService } from './board-access.service';
import { LabelsService } from './labels.service';

const events = (): EventPublisher & { publish: jest.Mock } => ({ publish: jest.fn() });

const access = (role: BoardRole | null) =>
  ({
    requireMember: jest.fn().mockResolvedValue(role),
    requireEditor: jest.fn().mockResolvedValue(role),
  }) as unknown as BoardAccessService;

const repo = <T extends object>(methods: Record<string, unknown>) =>
  methods as unknown as Repository<T>;

describe('LabelsService', () => {
  it('creates a label', async () => {
    const labels = repo<LabelEntity>({
      create: jest.fn().mockReturnValue({ id: 'l1', name: 'Bug' }),
      save: jest.fn().mockResolvedValue({ id: 'l1', name: 'Bug' }),
    });
    const service = new LabelsService(
      labels,
      repo<CardEntity>({}),
      access(BoardRole.ADMIN),
      events(),
    );

    const result = await service.create('u1', 'b1', 'Bug', '#ff0000');
    expect(result.id).toBe('l1');
    expect(labels.save).toHaveBeenCalled();
  });

  it('attaches a label and publishes an event', async () => {
    const publisher = events();
    const card = {
      id: 'c1',
      boardId: 'b1',
      labels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const cards = repo<CardEntity>({
      findOne: jest.fn().mockResolvedValue(card),
      save: jest.fn().mockResolvedValue({ ...card, labels: [{ id: 'l1' }] }),
    });
    const labels = repo<LabelEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'l1', boardId: 'b1' }),
    });

    const service = new LabelsService(labels, cards, access(BoardRole.ADMIN), publisher);
    await service.attachToCard('u1', 'c1', 'l1');

    expect(cards.save).toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'card.updated' }),
    );
  });
});
