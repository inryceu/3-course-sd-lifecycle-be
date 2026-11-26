import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole, ColumnType } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { NotificationEntity } from '../infrastructure/persistence/notification.entity';
import { BoardAccessService } from './board-access.service';
import { BoardsService } from './boards.service';
import { ColumnsService } from './columns.service';
import { NotificationsService } from './notifications.service';

const T0 = new Date('2026-10-27T10:00:00.000Z');
const board = {
  id: 'b1',
  title: 'B',
  description: null,
  jiraProjectKey: null,
  createdAt: T0,
  updatedAt: T0,
};
const notification = (id: string, recipientId = 'u1') =>
  Object.assign(new NotificationEntity(), {
    id,
    recipientId,
    boardId: 'b1',
    type: 'jira.conflict',
    payload: {},
    readAt: null,
    createdAt: T0,
  });

describe('NotificationsService', () => {
  function setup() {
    const qb: Record<string, jest.Mock> = {};
    for (const name of ['where', 'orderBy', 'addOrderBy', 'limit', 'andWhere', 'update', 'set']) {
      qb[name] = jest.fn(() => qb);
    }
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.execute = jest.fn().mockResolvedValue(undefined);
    const notifications = {
      createQueryBuilder: jest.fn(() => qb),
      create: jest.fn((v: object) => Object.assign(new NotificationEntity(), v)),
      save: jest.fn((rows: NotificationEntity[]) =>
        Promise.resolve(rows.map((row, i) => Object.assign(row, { id: `n${i}`, createdAt: T0 }))),
      ),
      findOne: jest.fn().mockResolvedValue(notification('n1')),
    };
    const memberships = { find: jest.fn().mockResolvedValue([]) };
    const publish = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationsService(
      notifications as unknown as Repository<NotificationEntity>,
      memberships as unknown as Repository<BoardMembershipEntity>,
      { publish } as unknown as EventPublisher,
    );
    return { service, qb, notifications, memberships, publish };
  }

  it('notifies every Admin of the board once and announces each to its recipient', async () => {
    const { service, memberships, notifications, publish } = setup();
    memberships.find.mockResolvedValue([{ userId: 'a1' }, { userId: 'a2' }]);
    expect(await service.notifyAdmins('b1', 'jira.conflict', { cardId: 'c1' })).toBe(2);
    expect(memberships.find).toHaveBeenCalledWith({
      where: { boardId: 'b1', role: BoardRole.ADMIN },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'a1',
        boardId: 'b1',
        payload: { cardId: 'c1' },
        readAt: null,
      }),
    );
    expect(publish.mock.calls.map(([e]) => [e.type, e.payload.recipientId])).toEqual([
      ['notification.created', 'a1'],
      ['notification.created', 'a2'],
    ]);
  });

  it('stores and announces nothing for a board without Admins', async () => {
    const { service, notifications, publish } = setup();
    expect(await service.notifyAdmins('b1', 'jira.conflict', {})).toBe(0);
    expect(notifications.save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  describe('list', () => {
    it('scopes to the caller, asks for one extra row and returns the last id as cursor when more exist', async () => {
      const { service, qb } = setup();
      qb.getMany.mockResolvedValue([notification('n3'), notification('n2'), notification('n1')]);
      const page = await service.list('u1', 2);
      expect(qb.where).toHaveBeenCalledWith('n.recipientId = :userId', { userId: 'u1' });
      expect(qb.limit).toHaveBeenCalledWith(3);
      expect(page.items.map((n) => n.id)).toEqual(['n3', 'n2']);
      expect(page.nextCursor).toBe('n2');
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('has no next cursor on the last page and keyset-filters by the caller own cursor row', async () => {
      const { service, qb } = setup();
      qb.getMany.mockResolvedValue([notification('n1')]);
      const page = await service.list('u1', 2, 'n2');
      expect(page.nextCursor).toBeNull();
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('c.recipient_id = :userId'),
        {
          cursor: 'n2',
        },
      );
    });
  });

  describe('markRead', () => {
    it('updates only the caller row and returns it', async () => {
      const { service, qb, notifications } = setup();
      const view = await service.markRead('u1', 'n1');
      expect(qb.where).toHaveBeenCalledWith(expect.stringContaining('recipient_id = :userId'), {
        notificationId: 'n1',
        userId: 'u1',
      });
      expect(notifications.findOne).toHaveBeenCalledWith({
        where: { id: 'n1', recipientId: 'u1' },
      });
      expect(view.id).toBe('n1');
    });

    it("answers 404 for someone else's or an unknown notification", async () => {
      const { service, notifications } = setup();
      notifications.findOne.mockResolvedValue(null);
      await expect(service.markRead('u1', 'n9')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('ColumnsService', () => {
  function setup(
    opts: { current?: object | null; count?: number; cards?: number; role?: BoardRole } = {},
  ) {
    const updates: { set?: string; where?: string }[] = [];
    const qb: Record<string, jest.Mock> = {};
    qb.setLock = jest.fn(() => qb);
    qb.getOne = jest.fn().mockResolvedValue({ id: 'b1' });
    qb.update = jest.fn(() => {
      updates.push({});
      return qb;
    });
    qb.set = jest.fn((v: { position: () => string }) => {
      updates[updates.length - 1].set = v.position();
      return qb;
    });
    qb.where = jest.fn((text: string) => {
      if (updates.length) updates[updates.length - 1].where = text;
      return qb;
    });
    qb.execute = jest.fn().mockResolvedValue(undefined);
    const manager = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest
        .fn()
        .mockResolvedValue(opts.current === undefined ? { id: 'col', position: 1 } : opts.current),
      count: jest.fn((entity: unknown) =>
        Promise.resolve(entity === BoardColumnEntity ? (opts.count ?? 4) : (opts.cards ?? 0)),
      ),
      create: jest.fn((_e: unknown, v: object) => v),
      save: jest.fn((v: object) => Promise.resolve({ id: 'new', ...v })),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
      getRepository: () => ({ findOne: jest.fn().mockResolvedValue(board) }),
    } as unknown as DataSource;
    const columns = {
      findOne: jest.fn().mockResolvedValue({
        id: 'col',
        boardId: 'b1',
        title: 'T',
        type: ColumnType.TODO,
        position: 1,
      }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((v: object) => Promise.resolve(v)),
    };
    const requireAdmin = jest.fn().mockResolvedValue(BoardRole.ADMIN);
    const access = {
      requireMember: jest.fn().mockResolvedValue(BoardRole.MEMBER),
      requireAdmin,
    } as unknown as BoardAccessService;
    const publish = jest.fn().mockResolvedValue(undefined);
    const service = new ColumnsService(
      dataSource,
      columns as unknown as Repository<BoardColumnEntity>,
      access,
      { publish } as unknown as EventPublisher,
    );
    return { service, manager, columns, updates, publish, requireAdmin };
  }

  it('lists the board columns in position order for a member', async () => {
    const { service, columns } = setup();
    await service.list('u1', 'b1');
    expect(columns.find).toHaveBeenCalledWith({
      where: { boardId: 'b1' },
      order: { position: 'ASC' },
    });
  });

  describe('create', () => {
    it('appends by default as TODO and announces board.updated', async () => {
      const { service, manager, publish } = setup({ count: 3 });
      const view = await service.create('u1', 'b1', { title: 'New' });
      expect(manager.create).toHaveBeenCalledWith(
        BoardColumnEntity,
        expect.objectContaining({ position: 3, type: ColumnType.TODO }),
      );
      expect(view).toMatchObject({ position: 3, title: 'New' });
      expect(publish.mock.calls[0][0]).toMatchObject({ type: 'board.updated' });
    });

    it('inserts in the middle by shifting the columns behind it, and refuses a position past the end', async () => {
      const { service, updates } = setup({ count: 3 });
      await service.create('u1', 'b1', { title: 'Mid', type: ColumnType.DONE, position: 1 });
      expect(updates.map((u) => u.set)).toEqual(['position + 1']);

      const tooFar = setup({ count: 3 });
      await expect(
        tooFar.service.create('u1', 'b1', { title: 'x', position: 4 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tooFar.publish).not.toHaveBeenCalled();
      await expect(
        setup({ count: 3 }).service.create('u1', 'b1', { title: 'x', position: 3 }),
      ).resolves.toBeDefined();
    });
  });

  it('update changes only the sent fields', async () => {
    const { service, columns } = setup();
    await service.update('u1', 'col', { type: ColumnType.DONE });
    expect(columns.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'T', type: ColumnType.DONE }),
    );
    await service.update('u1', 'col', { title: 'Renamed' });
    expect(columns.save).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Renamed' }));
  });

  it('answers 404 for an unknown column and requires an Admin for every change', async () => {
    const { service, columns, requireAdmin } = setup();
    columns.findOne.mockResolvedValue(null);
    await expect(service.update('u1', 'x', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reorder('u1', 'x', 0)).rejects.toBeInstanceOf(NotFoundException);
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  describe('remove', () => {
    it('refuses to drop below three columns and refuses a column with cards', async () => {
      const min = setup({ count: 3 });
      await expect(min.service.remove('u1', 'col')).rejects.toBeInstanceOf(ConflictException);
      expect(min.manager.delete).not.toHaveBeenCalled();

      const full = setup({ count: 4, cards: 1 });
      await expect(full.service.remove('u1', 'col')).rejects.toThrow('Move or delete the cards');
      expect(full.manager.delete).not.toHaveBeenCalled();
      expect(full.publish).not.toHaveBeenCalled();
    });

    it('deletes an empty column, closes the position gap and announces board.updated', async () => {
      const { service, manager, updates, publish } = setup({ count: 4, cards: 0 });
      await service.remove('u1', 'col');
      expect(manager.delete).toHaveBeenCalledWith(BoardColumnEntity, { id: 'col' });
      expect(updates.map((u) => u.set)).toEqual(['position - 1']);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('answers 404 when the column vanished inside the transaction', async () => {
      await expect(setup({ current: null }).service.remove('u1', 'col')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it.each([-1, 4, 1.5])('refuses position %s with 400', async (position) => {
      const { service, manager } = setup({ count: 4 });
      await expect(service.reorder('u1', 'col', position)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('is a no-op without an event when the column is already there', async () => {
      const { service, manager, publish } = setup({ count: 4 });
      await service.reorder('u1', 'col', 1);
      expect(manager.update).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('moving right pulls the columns in between left, moving left pushes them right', async () => {
      const right = setup({ count: 4 });
      await right.service.reorder('u1', 'col', 3);
      expect(right.updates.map((u) => u.set)).toEqual(['position - 1']);
      expect(right.manager.update).toHaveBeenCalledWith(
        BoardColumnEntity,
        { id: 'col' },
        { position: 3 },
      );
      expect(right.publish).toHaveBeenCalledTimes(1);

      const left = setup({ count: 4 });
      await left.service.reorder('u1', 'col', 0);
      expect(left.updates.map((u) => u.set)).toEqual(['position + 1']);
    });
  });
});

describe('BoardsService gaps', () => {
  function setup(role = BoardRole.ADMIN) {
    const boards = {
      findOne: jest.fn().mockResolvedValue({ ...board, columns: [] }),
      save: jest.fn((v: object) => Promise.resolve(v)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const memberships = { find: jest.fn().mockResolvedValue([]) };
    const requireAdmin = jest.fn().mockResolvedValue(role);
    const access = {
      requireMember: jest.fn().mockResolvedValue(role),
      requireAdmin,
    } as unknown as BoardAccessService;
    const publish = jest.fn().mockResolvedValue(undefined);
    const service = new BoardsService(
      {} as DataSource,
      boards as unknown as Repository<BoardEntity>,
      memberships as unknown as Repository<BoardMembershipEntity>,
      access,
      { publish } as unknown as EventPublisher,
    );
    return { service, boards, memberships, publish, requireAdmin };
  }

  it('lists the boards of the caller with the caller role and skips memberships whose board is gone', async () => {
    const { service, memberships } = setup();
    memberships.find.mockResolvedValue([
      { role: BoardRole.VIEWER, board: { ...board, id: 'b1' } },
      { role: BoardRole.ADMIN, board: null },
    ]);
    const list = await service.list('u1');
    expect(memberships.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
    expect(list).toEqual([expect.objectContaining({ id: 'b1', myRole: BoardRole.VIEWER })]);
  });

  it('get answers 404 for a vanished board and returns the role for an existing one', async () => {
    const found = setup(BoardRole.MEMBER);
    expect(await found.service.get('u1', 'b1')).toMatchObject({
      myRole: BoardRole.MEMBER,
      columns: [],
    });
    const gone = setup();
    gone.boards.findOne.mockResolvedValue(null);
    await expect(gone.service.get('u1', 'b1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update changes only the sent fields (null clears), announces board.updated, 404 for a missing board', async () => {
    const { service, boards, publish } = setup();
    boards.findOne.mockResolvedValue({
      ...board,
      title: 'Old',
      description: 'd',
      jiraProjectKey: 'KAN',
    });
    await service.update('u1', 'b1', { description: null });
    expect(boards.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Old', description: null, jiraProjectKey: 'KAN' }),
    );
    await service.update('u1', 'b1', { title: 'New', jiraProjectKey: null });
    expect(boards.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'New', jiraProjectKey: null }),
    );
    expect(publish).toHaveBeenCalledTimes(2);

    boards.findOne.mockResolvedValue(null);
    await expect(service.update('u1', 'b1', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove needs an Admin and deletes by id', async () => {
    const { service, boards, requireAdmin } = setup();
    await service.remove('u1', 'b1');
    expect(requireAdmin).toHaveBeenCalledWith('u1', 'b1');
    expect(boards.delete).toHaveBeenCalledWith({ id: 'b1' });
  });
});
