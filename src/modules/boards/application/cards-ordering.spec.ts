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
    jest
      .spyOn(service as unknown as { findCard: () => Promise<unknown> }, 'findCard')
      .mockResolvedValue(cardMock);

    await expect(
      service.move('u1', 'card-1', { columnId: 'col-2', position: 99 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  function externalSetup(
    options: {
      current?: Record<string, unknown> | null;
      target?: Record<string, unknown> | null;
      count?: number;
    } = {},
  ) {
    const current =
      options.current === undefined
        ? {
            id: 'card-1',
            columnId: 'col-1',
            position: 0,
            boardId: 'b1',
            title: 'Card',
            description: null,
            deadline: null,
            jiraIssueKey: 'KAN-1',
            assigneeId: null,
            labels: [],
            moveTo: jest.fn(function (
              this: Record<string, unknown>,
              target: { id: string },
              position: number,
            ) {
              this.columnId = target.id;
              this.position = position;
            }),
          }
        : options.current;
    const target = options.target === undefined ? { id: 'col-2', boardId: 'b1' } : options.target;
    const saved = {
      id: 'card-1',
      columnId: 'col-2',
      position: options.count ?? 2,
      boardId: 'b1',
      title: 'Card',
      description: null,
      deadline: null,
      jiraIssueKey: 'KAN-1',
      assigneeId: null,
      labels: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const builder = {
      setLock: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'b1' }),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      createQueryBuilder: jest.fn(() => builder),
      findOne: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === CardEntity) return Promise.resolve(current);
        if (entity === BoardColumnEntity) return Promise.resolve(target);
        return Promise.resolve(null);
      }),
      count: jest.fn().mockResolvedValue(options.count ?? 2),
      update: jest.fn().mockResolvedValue(undefined),
      findOneOrFail: jest.fn().mockResolvedValue(saved),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: EntityManager) => Promise<unknown>) => cb(manager)),
    } as unknown as DataSource;
    const publisher = { publish: jest.fn() };
    const service = new CardsService(
      dataSource,
      {} as Repository<CardEntity>,
      {} as Repository<BoardColumnEntity>,
      {} as BoardAccessService,
      publisher as unknown as EventPublisher,
    );
    return { service, publisher, manager, current };
  }

  it('appends an externally moved card to the end of the target column', async () => {
    const { service, publisher, current } = externalSetup();

    await expect(
      service.moveFromExternal({ boardId: 'b1', jiraIssueKey: 'KAN-1', columnId: 'col-2' }),
    ).resolves.toBe('moved');

    expect((current as { moveTo: jest.Mock }).moveTo).toHaveBeenCalledWith(
      { id: 'col-2', boardId: 'b1' },
      2,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'card.moved', origin: 'jira' }),
    );
  });

  it('preserves an explicit external position', async () => {
    const { service, current } = externalSetup();

    await service.moveFromExternal({
      boardId: 'b1',
      jiraIssueKey: 'KAN-1',
      columnId: 'col-2',
      position: 0,
    });

    expect((current as { moveTo: jest.Mock }).moveTo).toHaveBeenCalledWith(
      { id: 'col-2', boardId: 'b1' },
      0,
    );
  });

  it('reports unchanged when an external move appends a card already at the end', async () => {
    const { service, publisher } = externalSetup({
      count: 1,
      target: { id: 'col-1', boardId: 'b1' },
    });

    await expect(
      service.moveFromExternal({ boardId: 'b1', jiraIssueKey: 'KAN-1', columnId: 'col-1' }),
    ).resolves.toBe('unchanged');

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('keeps the position and publishes nothing when the status maps to the current column', async () => {
    const { service, publisher, current } = externalSetup({
      count: 3,
      target: { id: 'col-1', boardId: 'b1' },
    });

    await expect(
      service.moveFromExternal({ boardId: 'b1', jiraIssueKey: 'KAN-1', columnId: 'col-1' }),
    ).resolves.toBe('unchanged');

    expect((current as { moveTo: jest.Mock }).moveTo).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('reports not-found when the card or target column is missing', async () => {
    const missingCard = externalSetup({ current: null });
    await expect(
      missingCard.service.moveFromExternal({
        boardId: 'b1',
        jiraIssueKey: 'KAN-1',
        columnId: 'col-2',
      }),
    ).resolves.toBe('not-found');

    const missingColumn = externalSetup({ target: null });
    await expect(
      missingColumn.service.moveFromExternal({
        boardId: 'b1',
        jiraIssueKey: 'KAN-1',
        columnId: 'col-2',
      }),
    ).resolves.toBe('not-found');
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
    jest
      .spyOn(service as unknown as { findCard: () => Promise<unknown> }, 'findCard')
      .mockResolvedValue(cardMock);

    await expect(
      service.move('u1', 'card-1', { columnId: 'col-1', position: 1 }),
    ).resolves.toMatchObject({ id: 'card-1', columnId: 'col-1', position: 1 });
  });
});
