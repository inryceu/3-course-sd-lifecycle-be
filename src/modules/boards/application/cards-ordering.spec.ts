import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BoardRole } from '../domain/board-role';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { CardsService } from './cards.service';
import { EventPublisher } from '../../../common/events';

describe('CardsService - Move and Ordering', () => {
  it('throws BadRequest if target position is out of bounds', async () => {
    const dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: EntityManager) => Promise<unknown>) => {
        const manager = {
          createQueryBuilder: () => ({
            setLock: () => ({ where: () => ({ getOne: jest.fn().mockResolvedValue({}) }) }),
          }),
          findOne: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === CardEntity) return { columnId: 'col-1', position: 0 };
            if (entity === BoardColumnEntity) return { id: 'col-2', boardId: 'b1' };
            return null;
          }),
          count: jest.fn().mockResolvedValue(2),
        } as unknown as EntityManager;
        return cb(manager);
      }),
    } as unknown as DataSource;

    const access = {
      requireEditor: jest.fn().mockResolvedValue(BoardRole.MEMBER),
    } as unknown as BoardAccessService;
    const service = new CardsService(
      dataSource,
      {} as Repository<CardEntity>,
      {} as Repository<BoardColumnEntity>,
      access,
      { publish: jest.fn() } as unknown as EventPublisher,
    );

    const cardMock = { boardId: 'b1' };
    (service as any).findCard = jest.fn().mockResolvedValue(cardMock);

    await expect(
      service.move('u1', 'card-1', { columnId: 'col-2', position: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns view immediately if card is moved to its exact current column and position', async () => {
    const dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: EntityManager) => Promise<unknown>) => {
        const manager = {
          createQueryBuilder: () => ({
            setLock: () => ({ where: () => ({ getOne: jest.fn().mockResolvedValue({}) }) }),
            update: () => ({ set: () => ({ where: () => ({ execute: jest.fn() }) }) }),
          }),
          findOne: jest.fn().mockImplementation((entity: unknown) => {
            if (entity === CardEntity) {
              return {
                id: 'card-1',
                columnId: 'col-1',
                position: 1,
                boardId: 'b1',
                labels: [],
                moveTo: jest.fn(),
              };
            }
            if (entity === BoardColumnEntity) return { id: 'col-1', boardId: 'b1' };
            return null;
          }),
          findOneOrFail: jest.fn().mockResolvedValue({
            id: 'card-1',
            columnId: 'col-1',
            position: 1,
            boardId: 'b1',
            labels: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
          count: jest.fn().mockResolvedValue(3),
          update: jest.fn(),
        } as unknown as EntityManager;
        return cb(manager);
      }),
    } as unknown as DataSource;

    const access = {
      requireEditor: jest.fn().mockResolvedValue(BoardRole.MEMBER),
    } as unknown as BoardAccessService;
    const publisher = { publish: jest.fn() };
    const service = new CardsService(
      dataSource,
      {} as Repository<CardEntity>,
      {} as Repository<BoardColumnEntity>,
      access,
      publisher as unknown as EventPublisher,
    );

    const cardMock = { boardId: 'b1', columnId: 'col-1', position: 1, labels: [] };
    (service as any).findCard = jest.fn().mockResolvedValue(cardMock);

    await expect(
      service.move('u1', 'card-1', { columnId: 'col-1', position: 1 }),
    ).resolves.not.toThrow();
  });
});
