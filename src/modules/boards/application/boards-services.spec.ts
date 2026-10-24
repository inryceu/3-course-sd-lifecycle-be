import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole, ColumnType } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { BoardsFacade } from './boards-facade.port';
import { BoardsFacadeService } from './boards-facade.service';
import { BoardsService } from './boards.service';
import { CardsService } from './cards.service';
import { ColumnsService } from './columns.service';

const failingTransaction = () => jest.fn().mockRejectedValue(new Error('database down'));

const events = (): EventPublisher & { publish: jest.Mock } => ({ publish: jest.fn() });

const access = (role: BoardRole | null) =>
  ({
    getRole: jest.fn().mockResolvedValue(role),
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

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('does not publish board.updated when saving the update fails', async () => {
    const publisher = events();
    const boards = repo<BoardEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'b1', title: 'old' }),
      save: jest.fn().mockRejectedValue(new Error('write failed')),
    });
    const service = new BoardsService(
      {} as DataSource,
      boards,
      repo<BoardMembershipEntity>({}),
      access(BoardRole.ADMIN),
      publisher,
    );

    await expect(service.update('u', 'b1', { title: 'new' })).rejects.toThrow('write failed');

    expect(publisher.publish).not.toHaveBeenCalled();
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
    expect(view.myRole).toBe(BoardRole.ADMIN);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0][0]).toMatchObject({
      type: 'board.updated',
      boardId: 'b1',
      actorId: 'u',
      origin: 'user',
    });
  });

  it('refuses a non-admin before touching the database', async () => {
    const boards = repo<BoardEntity>({ findOne: jest.fn(), save: jest.fn() });
    const service = new BoardsService(
      {} as DataSource,
      boards,
      repo<BoardMembershipEntity>({}),
      access(BoardRole.MEMBER),
      events(),
    );

    await expect(service.update('u', 'b1', { title: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove('u', 'b1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(boards.findOne).not.toHaveBeenCalled();
  });
});

describe('ColumnsService', () => {
  const columns = (found: Partial<BoardColumnEntity> | null) =>
    repo<BoardColumnEntity>({ findOne: jest.fn().mockResolvedValue(found), find: jest.fn() });

  it.each([
    ['create', (s: ColumnsService) => s.create('u', 'b', { title: 'X' })],
    ['update', (s: ColumnsService) => s.update('u', 'c', { title: 'X' })],
    ['remove', (s: ColumnsService) => s.remove('u', 'c')],
    ['reorder', (s: ColumnsService) => s.reorder('u', 'c', 0)],
  ])('%s is admin only', async (_name, call) => {
    const dataSource = { transaction: jest.fn() } as unknown as DataSource;
    const service = new ColumnsService(
      dataSource,
      columns({ id: 'c', boardId: 'b' }),
      access(BoardRole.MEMBER),
      events(),
    );

    await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown column', async () => {
    const service = new ColumnsService(
      {} as DataSource,
      columns(null),
      access(BoardRole.ADMIN),
      events(),
    );
    await expect(service.remove('u', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not publish when the structural transaction fails', async () => {
    const publisher = events();
    const service = new ColumnsService(
      { transaction: failingTransaction() } as unknown as DataSource,
      columns({ id: 'c', boardId: 'b' }),
      access(BoardRole.ADMIN),
      publisher,
    );

    await expect(service.reorder('u', 'c', 1)).rejects.toThrow('database down');
    expect(publisher.publish).not.toHaveBeenCalled();
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
    await expect(service.move('u', 'c1', { columnId: 'col', position: 0 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.remove('u', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not publish card.created when saving fails', async () => {
    const publisher = events();
    const service = new CardsService(
      { transaction: failingTransaction() } as unknown as DataSource,
      cardRepo(null),
      columnRepo(),
      access(BoardRole.MEMBER),
      publisher,
    );

    await expect(service.create('u', 'col', { title: 'T' })).rejects.toThrow('database down');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('does not publish card.moved when the move transaction fails', async () => {
    const publisher = events();
    const service = new CardsService(
      { transaction: failingTransaction() } as unknown as DataSource,
      cardRepo({ id: 'c1', boardId: 'b', labels: [] } as unknown as CardEntity),
      columnRepo(),
      access(BoardRole.MEMBER),
      publisher,
    );

    await expect(service.move('u', 'c1', { columnId: 'col', position: 0 })).rejects.toThrow(
      'database down',
    );
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown card', async () => {
    const service = new CardsService(
      {} as DataSource,
      cardRepo(null),
      columnRepo(),
      access(BoardRole.MEMBER),
      events(),
    );
    await expect(service.get('u', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BoardsFacadeService', () => {
  const facadeWith = (
    role: BoardRole | null,
    cards: Partial<CardsService> = {},
    board: Partial<BoardEntity> | null = null,
    columns: Partial<BoardColumnEntity>[] = [],
  ) =>
    new BoardsFacadeService(
      access(role),
      cards as CardsService,
      repo<BoardEntity>({
        findOne: jest.fn().mockResolvedValue(board),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
      repo<BoardColumnEntity>({ find: jest.fn().mockResolvedValue(columns) }),
    );

  it('exposes the member role via access service', async () => {
    expect(await facadeWith(BoardRole.VIEWER).getMemberRole('b', 'u')).toBe(BoardRole.VIEWER);
  });

  it('reports strangers', async () => {
    expect(await facadeWith(null).getMemberRole('b', 'u')).toBeNull();
  });

  it('summarises a board with its ordered columns and project key', async () => {
    const facade = facadeWith(null, {}, { id: 'b1', jiraProjectKey: 'KAN' }, [
      { id: 'c1', title: 'To Do', type: ColumnType.TODO, position: 0, boardId: 'b1' },
    ]);
    expect(await facade.getBoardSummary('b1')).toEqual({
      id: 'b1',
      jiraProjectKey: 'KAN',
      columns: [{ id: 'c1', title: 'To Do', type: ColumnType.TODO, position: 0 }],
    });
    expect(await facadeWith(null).getBoardSummary('missing')).toBeNull();
  });

  it('offers upsertCardFromExternal through the port type and returns the outcome', async () => {
    const upsertFromExternal = jest.fn().mockResolvedValue({ cardId: 'k1', outcome: 'created' });
    // Typed as the port on purpose: other modules only see `BoardsFacade`.
    const port: BoardsFacade = facadeWith(null, { upsertFromExternal });
    const input = { boardId: 'b', columnId: 'c', jiraIssueKey: 'KAN-1', title: 'T' };

    expect(await port.upsertCardFromExternal(input)).toEqual({ cardId: 'k1', outcome: 'created' });
    expect(upsertFromExternal).toHaveBeenCalledWith(input);
  });
});
