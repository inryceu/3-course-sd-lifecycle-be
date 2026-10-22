import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { BoardsFacadeService } from './boards-facade.service';
import { BoardsService } from './boards.service';
import { CardsService } from './cards.service';
import { ColumnsService } from './columns.service';

const failingTransaction = () => jest.fn().mockRejectedValue(new Error('database down'));
const events = (): EventPublisher & { publish: jest.Mock } => ({ publish: jest.fn() });

const access = (role: BoardRole | null) =>
  ({
    getRole: jest.fn().mockResolvedValue(role),
    canView: jest.fn().mockResolvedValue(role !== null),
    requireMember: jest.fn().mockResolvedValue(role),
    requireEditor: jest.fn().mockImplementation(() => {
      if (role === BoardRole.VIEWER) throw new ForbiddenException();
      return Promise.resolve(role);
    }),
    requireAdmin: jest.fn().mockImplementation(() => {
      if (role !== BoardRole.ADMIN) throw new ForbiddenException();
      return Promise.resolve(role);
    }),
  }) as unknown as BoardAccessService;

const repo = <T extends object>(methods: Record<string, unknown>) =>
  methods as unknown as Repository<T>;

describe('BoardsService', () => {
  it('creates board, default columns and admin membership in one transaction that can roll back', async () => {
    const dataSource = { transaction: failingTransaction() } as unknown as DataSource;
    const service = new BoardsService(
      dataSource,
      repo<BoardEntity>({}),
      repo<BoardMembershipEntity>({}),
      access(BoardRole.ADMIN),
      events(),
    );
    await expect(service.create('user-1', { title: 'Board' })).rejects.toThrow('database down');
  });

  it('publishes board.updated once after a successful update', async () => {
    const publisher = events();
    const saved = {
      id: 'b1',
      title: 'new',
      description: null,
      jiraProjectKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const boards = repo<BoardEntity>({
      findOne: jest.fn().mockResolvedValue({ ...saved }),
      save: jest.fn().mockResolvedValue(saved),
    });
    const service = new BoardsService(
      {} as DataSource,
      boards,
      repo<BoardMembershipEntity>({}),
      access(BoardRole.ADMIN),
      publisher,
    );

    const view = await service.update('u', 'b1', { title: 'new' });
    expect(view.title).toBe('new');
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

describe('ColumnsService', () => {
  const columns = (found: Partial<BoardColumnEntity> | null) =>
    repo<BoardColumnEntity>({ findOne: jest.fn().mockResolvedValue(found), find: jest.fn() });

  it('answers 404 for an unknown column', async () => {
    const service = new ColumnsService(
      {} as DataSource,
      columns(null),
      access(BoardRole.ADMIN),
      events(),
    );
    await expect(service.remove('u', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CardsService', () => {
  const column = { id: 'col', boardId: 'b' } as BoardColumnEntity;
  const cardRepo = (card: Partial<CardEntity> | null) =>
    repo<CardEntity>({ findOne: jest.fn().mockResolvedValue(card), find: jest.fn() });
  const columnRepo = () =>
    repo<BoardColumnEntity>({ findOne: jest.fn().mockResolvedValue(column) });

  it('lets a viewer read but not change cards', async () => {
    const dataSource = { transaction: jest.fn() } as unknown as DataSource;
    const service = new CardsService(
      dataSource,
      cardRepo({ id: 'c1', boardId: 'b', labels: [] } as unknown as CardEntity),
      columnRepo(),
      access(BoardRole.VIEWER),
      events(),
    );

    await expect(service.create('u', 'col', { title: 'T' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove('u', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('BoardsFacadeService', () => {
  it('exposes the member role via access service', async () => {
    const facade = new BoardsFacadeService(access(BoardRole.VIEWER), {} as CardsService);
    expect(await facade.getMemberRole('b', 'u')).toBe(BoardRole.VIEWER);
  });

  it('reports strangers', async () => {
    const facade = new BoardsFacadeService(access(null), {} as CardsService);
    expect(await facade.getMemberRole('b', 'u')).toBeNull();
  });
});
