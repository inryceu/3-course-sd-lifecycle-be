import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { LabelEntity } from '../infrastructure/persistence/label.entity';
import { BoardAccessService } from './board-access.service';
import { CardsService } from './cards.service';

const T0 = new Date('2026-10-27T10:00:00.000Z');

const card = (over: Partial<CardEntity> = {}): CardEntity =>
  Object.assign(new CardEntity(), {
    id: 'c1',
    boardId: 'b1',
    columnId: 'col-1',
    title: 'Card',
    description: null,
    deadline: null,
    jiraIssueKey: null,
    assigneeId: null,
    position: 0,
    labels: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  });

const column = (id: string, boardId = 'b1') =>
  Object.assign(new BoardColumnEntity(), { id, boardId });

/** A query builder whose chained calls are recorded; `update` records the SET and WHERE text. */
function recorder() {
  const calls: { set?: string; where?: string }[] = [];
  const qb = {
    setLock: () => qb,
    update: () => {
      calls.push({});
      return qb;
    },
    set: (values: { position: () => string }) => {
      calls[calls.length - 1].set = values.position();
      return qb;
    },
    where: (text: string) => {
      if (calls.length) calls[calls.length - 1].where = text;
      return qb;
    },
    getOne: () => Promise.resolve({ id: 'b1' }),
    execute: () => Promise.resolve(),
  };
  return { qb, calls };
}

interface Setup {
  /** What `manager.findOne` answers per entity class. */
  card?: CardEntity | null;
  column?: BoardColumnEntity | null;
  count?: number;
  role?: BoardRole;
  storedCard?: CardEntity | null;
  labels?: LabelEntity[];
  member?: boolean;
  board?: boolean;
}

function build(setup: Setup = {}) {
  const { qb, calls } = recorder();
  const manager = {
    createQueryBuilder: (entity?: unknown) => (entity === BoardEntity ? qb : qb),
    findOne: jest.fn((entity: unknown) =>
      Promise.resolve(entity === CardEntity ? setup.card : setup.column),
    ),
    findOneOrFail: jest.fn(() => Promise.resolve(setup.card)),
    count: jest.fn().mockResolvedValue(setup.count ?? 0),
    create: jest.fn((_e: unknown, values: object) => Object.assign(card(), values)),
    save: jest.fn((entity: CardEntity) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const repos = new Map<unknown, unknown>([
    [LabelEntity, { find: jest.fn().mockResolvedValue(setup.labels ?? []) }],
    [
      BoardMembershipEntity,
      { findOne: jest.fn().mockResolvedValue(setup.member === false ? null : { userId: 'u2' }) },
    ],
    [
      BoardEntity,
      {
        findOneOrFail: jest.fn().mockResolvedValue({
          id: 'b1',
          title: 'Board',
          description: null,
          jiraProjectKey: null,
          createdAt: T0,
          updatedAt: T0,
        }),
      },
    ],
  ]);
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
    getRepository: (entity: unknown) => repos.get(entity),
  } as unknown as DataSource;
  const cards = {
    find: jest.fn().mockResolvedValue([card()]),
    findOne: jest
      .fn()
      .mockResolvedValue(setup.storedCard === undefined ? card() : setup.storedCard),
    save: jest.fn((entity: CardEntity) => Promise.resolve(entity)),
  };
  const columns = {
    findOne: jest
      .fn()
      .mockResolvedValue(setup.column === undefined ? column('col-1') : setup.column),
  };
  const denied = setup.role === BoardRole.VIEWER;
  const access = {
    requireMember: jest.fn().mockResolvedValue(setup.role ?? BoardRole.MEMBER),
    requireEditor: jest.fn(() =>
      denied ? Promise.reject(new ForbiddenException()) : Promise.resolve(BoardRole.MEMBER),
    ),
  } as unknown as BoardAccessService;
  const publish = jest.fn().mockResolvedValue(undefined);
  const service = new CardsService(
    dataSource,
    cards as unknown as Repository<CardEntity>,
    columns as unknown as Repository<BoardColumnEntity>,
    access,
    { publish } as unknown as EventPublisher,
  );
  return { service, manager, dataSource, cards, access, publish, calls };
}

const published = (publish: jest.Mock) =>
  publish.mock.calls.map(([event]: [{ type: string }]) => event.type);

describe('CardsService reads', () => {
  it('lists a column for a member after resolving the board from the column', async () => {
    const { service, access, cards } = build({ column: column('col-1', 'b9') });
    const list = await service.listByColumn('u1', 'col-1');
    expect(access.requireMember).toHaveBeenCalledWith('u1', 'b9');
    expect(cards.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { columnId: 'col-1' }, order: { position: 'ASC' } }),
    );
    expect(list).toHaveLength(1);
  });

  it('answers 404 for an unknown column or card without touching access', async () => {
    const missingColumn = build({ column: null });
    await expect(missingColumn.service.listByColumn('u1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(missingColumn.access.requireMember).not.toHaveBeenCalled();

    const missingCard = build({ storedCard: null });
    await expect(missingCard.service.get('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(missingCard.access.requireMember).not.toHaveBeenCalled();
  });

  it('returns the card view to a member of its board', async () => {
    const { service, access } = build({
      storedCard: card({ boardId: 'b7', labels: [{ id: 'l1' } as LabelEntity] }),
    });
    const view = await service.get('u1', 'c1');
    expect(access.requireMember).toHaveBeenCalledWith('u1', 'b7');
    expect(view).toMatchObject({ id: 'c1', labelIds: ['l1'], deadline: null });
  });
});

describe('CardsService.create', () => {
  it('appends the card at the end of the column and announces it', async () => {
    const { service, manager, publish } = build({ count: 3 });
    const view = await service.create('u1', 'col-1', {
      title: 'New',
      deadline: '2026-11-01T09:00:00.000Z',
    });
    expect(manager.create).toHaveBeenCalledWith(
      CardEntity,
      expect.objectContaining({ position: 3, columnId: 'col-1', boardId: 'b1', assigneeId: null }),
    );
    expect(view.deadline).toBe('2026-11-01T09:00:00.000Z');
    expect(published(publish)).toEqual(['card.created']);
    expect(publish.mock.calls[0][0]).toMatchObject({
      boardId: 'b1',
      actorId: 'u1',
      origin: 'user',
    });
  });

  it('refuses a Viewer before anything is written', async () => {
    const { service, dataSource, publish } = build({ role: BoardRole.VIEWER });
    await expect(service.create('u1', 'col-1', { title: 'T' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown column', async () => {
    const { service } = build({ column: null });
    await expect(service.create('u1', 'x', { title: 'T' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a label of another board, also when only some ids resolve', async () => {
    const { service, dataSource } = build({ labels: [{ id: 'l1' } as LabelEntity] });
    await expect(
      service.create('u1', 'col-1', { title: 'T', labelIds: ['l1', 'l2'] }),
    ).rejects.toThrow('Unknown label for this board');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts duplicate label ids that resolve to one label', async () => {
    const { service } = build({ labels: [{ id: 'l1' } as LabelEntity] });
    const view = await service.create('u1', 'col-1', { title: 'T', labelIds: ['l1', 'l1'] });
    expect(view.labelIds).toEqual(['l1']);
  });

  it('rejects an assignee who is not a member of the board', async () => {
    const { service, dataSource } = build({ member: false });
    await expect(
      service.create('u1', 'col-1', { title: 'T', assigneeId: 'stranger' }),
    ).rejects.toThrow('The assignee is not a member of this board');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('CardsService.update', () => {
  it('changes only the sent fields and announces card.updated', async () => {
    const stored = card({ title: 'Old', description: 'keep', deadline: T0 });
    const { service, cards, publish } = build({ storedCard: stored });
    const view = await service.update('u1', 'c1', { title: 'New' });
    expect(cards.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New', description: 'keep', deadline: T0 }),
    );
    expect(view.title).toBe('New');
    expect(published(publish)).toEqual(['card.updated']);
  });

  it('clears the description and the deadline when null is sent', async () => {
    const { service } = build({ storedCard: card({ description: 'x', deadline: T0 }) });
    const view = await service.update('u1', 'c1', { description: null, deadline: null });
    expect(view).toMatchObject({ description: null, deadline: null });
  });

  it('refuses a Viewer and answers 404 for a missing card; nothing is saved or published', async () => {
    const viewer = build({ role: BoardRole.VIEWER });
    await expect(viewer.service.update('u', 'c1', { title: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(viewer.cards.save).not.toHaveBeenCalled();
    expect(viewer.publish).not.toHaveBeenCalled();

    const missing = build({ storedCard: null });
    await expect(missing.service.update('u', 'c1', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CardsService.move', () => {
  const sameColumn = (count: number) =>
    build({ card: card({ columnId: 'col-1', position: 0 }), column: column('col-1'), count });

  it('allows the last index of the same column and refuses one past it', async () => {
    const ok = sameColumn(3);
    await expect(
      ok.service.move('u1', 'c1', { columnId: 'col-1', position: 2 }),
    ).resolves.toBeDefined();

    const tooFar = sameColumn(3);
    await expect(
      tooFar.service.move('u1', 'c1', { columnId: 'col-1', position: 3 }),
    ).rejects.toThrow('Position must be between 0 and 2');
    expect(tooFar.publish).not.toHaveBeenCalled();
  });

  it('allows appending to another column (count) and refuses count + 1', async () => {
    const make = () =>
      build({ card: card({ columnId: 'col-1' }), column: column('col-2'), count: 2 });
    await expect(
      make().service.move('u1', 'c1', { columnId: 'col-2', position: 2 }),
    ).resolves.toBeDefined();
    await expect(
      make().service.move('u1', 'c1', { columnId: 'col-2', position: 3 }),
    ).rejects.toThrow('Position must be between 0 and 2');
  });

  it('rejects a column of another board as 400 and writes nothing', async () => {
    const { service, manager, publish } = build({
      card: card({ columnId: 'col-1' }),
      column: column('other', 'b2'),
      count: 1,
    });
    await expect(
      service.move('u1', 'c1', { columnId: 'other', position: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a negative or fractional position as 400', async () => {
    for (const position of [-1, 0.5]) {
      const { service } = build({ card: card(), column: column('col-2'), count: 2 });
      await expect(
        service.move('u1', 'c1', { columnId: 'col-2', position }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('answers 404 for a vanished card or target column', async () => {
    await expect(
      build({ card: null, column: column('col-2') }).service.move('u1', 'c1', {
        columnId: 'col-2',
        position: 0,
      }),
    ).rejects.toThrow('Card not found');
    await expect(
      build({ card: card(), column: null }).service.move('u1', 'c1', {
        columnId: 'col-2',
        position: 0,
      }),
    ).rejects.toThrow('Target column not found');
  });

  it('refuses a Viewer before the transaction opens', async () => {
    const { service, dataSource } = build({ role: BoardRole.VIEWER });
    await expect(
      service.move('u1', 'c1', { columnId: 'col-1', position: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('moving down in a column pulls the cards in between up, moving up pushes them down', async () => {
    const down = build({
      card: card({ columnId: 'col-1', position: 0 }),
      column: column('col-1'),
      count: 4,
    });
    await down.service.move('u1', 'c1', { columnId: 'col-1', position: 2 });
    expect(down.calls.map((c) => [c.set, c.where])).toEqual([
      ['position - 1', expect.stringContaining('position > :from AND position <= :to')],
    ]);

    const up = build({
      card: card({ columnId: 'col-1', position: 3 }),
      column: column('col-1'),
      count: 4,
    });
    await up.service.move('u1', 'c1', { columnId: 'col-1', position: 1 });
    expect(up.calls.map((c) => [c.set, c.where])).toEqual([
      ['position + 1', expect.stringContaining('position >= :to AND position < :from')],
    ]);
  });

  it('moving within the same slot shifts nobody; across columns closes the gap and opens one', async () => {
    const same = build({
      card: card({ columnId: 'col-1', position: 1 }),
      column: column('col-1'),
      count: 3,
    });
    await same.service.move('u1', 'c1', { columnId: 'col-1', position: 1 });
    expect(same.calls).toEqual([]);

    const across = build({
      card: card({ columnId: 'col-1', position: 1 }),
      column: column('col-2'),
      count: 2,
    });
    await across.service.move('u1', 'c1', { columnId: 'col-2', position: 0 });
    expect(across.calls.map((c) => c.set)).toEqual(['position - 1', 'position + 1']);
  });

  it('stores the new column and position and announces card.moved with both columns', async () => {
    const moved = card({ columnId: 'col-2', position: 1 });
    const { service, manager, publish } = build({
      card: card({ columnId: 'col-1', position: 0 }),
      column: column('col-2'),
      count: 2,
    });
    manager.findOneOrFail.mockResolvedValue(moved);
    const view = await service.move('u1', 'c1', { columnId: 'col-2', position: 1 });
    expect(manager.update).toHaveBeenCalledWith(
      CardEntity,
      { id: 'c1' },
      { columnId: 'col-2', position: 1 },
    );
    expect(view).toMatchObject({ columnId: 'col-2', position: 1 });
    expect(publish.mock.calls[0][0]).toMatchObject({
      type: 'card.moved',
      actorId: 'u1',
      payload: { fromColumnId: 'col-1', toColumnId: 'col-2', position: 1 },
    });
  });
});

describe('CardsService.remove', () => {
  it('deletes the card, closes the gap and announces board.updated', async () => {
    const { service, manager, calls, publish } = build({ card: card({ position: 1 }) });
    await service.remove('u1', 'c1');
    expect(manager.delete).toHaveBeenCalledWith(CardEntity, { id: 'c1' });
    expect(calls.map((c) => c.set)).toEqual(['position - 1']);
    expect(published(publish)).toEqual(['board.updated']);
  });

  it('does not announce a removal that already happened elsewhere', async () => {
    const { service, manager, calls } = build({ card: null });
    await service.remove('u1', 'c1');
    expect(manager.delete).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('refuses a Viewer and answers 404 for a missing card', async () => {
    const viewer = build({ role: BoardRole.VIEWER });
    await expect(viewer.service.remove('u', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(viewer.dataSource.transaction).not.toHaveBeenCalled();
    await expect(build({ storedCard: null }).service.remove('u', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('CardsService.assign', () => {
  it('sets a member as assignee and clears with null without a membership lookup', async () => {
    const withMember = build({ storedCard: card() });
    expect((await withMember.service.assign('u1', 'c1', 'u2')).assigneeId).toBe('u2');

    const clear = build({ storedCard: card({ assigneeId: 'u2' }), member: false });
    expect((await clear.service.assign('u1', 'c1', null)).assigneeId).toBeNull();
    expect(published(clear.publish)).toEqual(['card.updated']);
  });

  it('rejects a non-member and saves nothing', async () => {
    const { service, cards, publish } = build({ member: false });
    await expect(service.assign('u1', 'c1', 'stranger')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(cards.save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses a Viewer', async () => {
    await expect(
      build({ role: BoardRole.VIEWER }).service.assign('u1', 'c1', 'u2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CardsService Jira import', () => {
  const base = { boardId: 'b1', columnId: 'col-1', jiraIssueKey: 'KAN-1', title: 'Issue' };

  it('creates a card at the end of the column, origin jira', async () => {
    const { service, manager, publish } = build({ card: null, column: column('col-1'), count: 4 });
    const result = await service.upsertFromExternal({ ...base, description: 'd' });
    expect(result.outcome).toBe('created');
    expect(manager.create).toHaveBeenCalledWith(
      CardEntity,
      expect.objectContaining({ position: 4, jiraIssueKey: 'KAN-1', description: 'd' }),
    );
    expect(publish.mock.calls[0][0]).toMatchObject({ type: 'card.created', origin: 'jira' });
  });

  it('refuses a column of another board', async () => {
    const { service } = build({ card: null, column: null });
    await expect(service.upsertFromExternal(base)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports unchanged and publishes nothing when title, description and column match; undefined keeps the description', async () => {
    const stored = card({ title: 'Issue', description: 'keep', jiraIssueKey: 'KAN-1' });
    const { service, publish, manager } = build({ card: stored, column: column('col-1') });
    const result = await service.upsertFromExternal(base);
    expect(result.outcome).toBe('unchanged');
    expect(publish).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('updates changed text in place (card.updated) without moving it', async () => {
    const stored = card({ title: 'Old', jiraIssueKey: 'KAN-1' });
    const { service, manager, publish } = build({ card: stored, column: column('col-1') });
    const result = await service.upsertFromExternal({ ...base, description: null });
    expect(result.outcome).toBe('updated');
    expect(manager.update).toHaveBeenCalledWith(
      CardEntity,
      { id: 'c1' },
      { title: 'Issue', description: null },
    );
    expect(published(publish)).toEqual(['card.updated']);
  });

  it('moves a card whose status maps to another column to its end (card.moved)', async () => {
    const stored = card({ title: 'Issue', jiraIssueKey: 'KAN-1', columnId: 'col-1', position: 0 });
    const { service, manager, publish, calls } = build({
      card: stored,
      column: column('col-2'),
      count: 5,
    });
    manager.findOneOrFail.mockResolvedValue(card({ columnId: 'col-2', position: 5 }));
    const result = await service.upsertFromExternal({ ...base, columnId: 'col-2' });
    expect(result.outcome).toBe('updated');
    expect(manager.update).toHaveBeenCalledWith(
      CardEntity,
      { id: 'c1' },
      { columnId: 'col-2', position: 5 },
    );
    expect(calls).toHaveLength(2);
    expect(publish.mock.calls[0][0]).toMatchObject({
      type: 'card.moved',
      origin: 'jira',
      payload: { fromColumnId: 'col-1', toColumnId: 'col-2' },
    });
  });

  describe('moveFromExternal', () => {
    const input = { boardId: 'b1', jiraIssueKey: 'KAN-1', columnId: 'col-2' };

    it('answers not-found for an unknown issue or a column of another board', async () => {
      expect(
        await build({ card: null, column: column('col-2') }).service.moveFromExternal(input),
      ).toBe('not-found');
      expect(await build({ card: card(), column: null }).service.moveFromExternal(input)).toBe(
        'not-found',
      );
    });

    it('leaves the user order alone when the status maps to the current column', async () => {
      const { service, publish } = build({
        card: card({ columnId: 'col-2', position: 1 }),
        column: column('col-2'),
        count: 3,
      });
      expect(await service.moveFromExternal(input)).toBe('unchanged');
      expect(publish).not.toHaveBeenCalled();
    });

    it('clamps an explicit position into the target column and reports unchanged for the same slot', async () => {
      const clamp = build({
        card: card({ columnId: 'col-1', position: 0 }),
        column: column('col-2'),
        count: 2,
      });
      clamp.manager.findOneOrFail.mockResolvedValue(card({ columnId: 'col-2', position: 2 }));
      expect(await clamp.service.moveFromExternal({ ...input, position: 99 })).toBe('moved');
      expect(clamp.manager.update).toHaveBeenCalledWith(
        CardEntity,
        { id: 'c1' },
        { columnId: 'col-2', position: 2 },
      );

      const negative = build({
        card: card({ columnId: 'col-1', position: 0 }),
        column: column('col-2'),
        count: 2,
      });
      await negative.service.moveFromExternal({ ...input, position: -5 });
      expect(negative.manager.update).toHaveBeenCalledWith(
        CardEntity,
        { id: 'c1' },
        { columnId: 'col-2', position: 0 },
      );

      const same = build({
        card: card({ columnId: 'col-2', position: 1 }),
        column: column('col-2'),
        count: 3,
      });
      expect(await same.service.moveFromExternal({ ...input, position: 1 })).toBe('unchanged');
    });

    it('appends to the end when no position is given and announces card.moved with origin jira', async () => {
      const { service, manager, publish } = build({
        card: card({ columnId: 'col-1', position: 0 }),
        column: column('col-2'),
        count: 3,
      });
      manager.findOneOrFail.mockResolvedValue(card({ columnId: 'col-2', position: 3 }));
      expect(await service.moveFromExternal(input)).toBe('moved');
      expect(manager.update).toHaveBeenCalledWith(
        CardEntity,
        { id: 'c1' },
        { columnId: 'col-2', position: 3 },
      );
      expect(publish.mock.calls[0][0]).toMatchObject({ type: 'card.moved', origin: 'jira' });
    });
  });
});
