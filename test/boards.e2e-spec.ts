import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../src/common/events';
import { BoardRole } from '../src/modules/boards';
import { BoardMembershipEntity } from '../src/modules/boards/infrastructure/persistence/board-membership.entity';
import { CardEntity } from '../src/modules/boards/infrastructure/persistence/card.entity';
import {
  BoardBody,
  bearer,
  CardBody,
  ColumnBody,
  createBoard,
  createCard,
  createTestApp,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

describe('Boards, columns and cards (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let events: DomainEvent[];

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    server = app.getHttpServer();
    const emitter = app.get(EventEmitter2);
    for (const type of [
      'card.created',
      'card.updated',
      'card.moved',
      'card.commented',
      'board.updated',
    ]) {
      emitter.on(type, (event: DomainEvent) => events.push(event));
    }
  });

  beforeEach(() => {
    events = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (user: TestUser, path: string) =>
    request(server).get(`${PREFIX}${path}`).set(bearer(user));
  const post = (user: TestUser, path: string, body: object = {}) =>
    request(server).post(`${PREFIX}${path}`).set(bearer(user)).send(body);
  const patch = (user: TestUser, path: string, body: object = {}) =>
    request(server).patch(`${PREFIX}${path}`).set(bearer(user)).send(body);
  const del = (user: TestUser, path: string) =>
    request(server).delete(`${PREFIX}${path}`).set(bearer(user));

  async function addMember(boardId: string, user: TestUser, role: BoardRole): Promise<void> {
    await dataSource
      .getRepository(BoardMembershipEntity)
      .insert({ boardId, userId: user.id, role });
  }

  async function columns(user: TestUser, boardId: string): Promise<ColumnBody[]> {
    return (await get(user, `/boards/${boardId}/columns`).expect(200)).body as ColumnBody[];
  }

  const positions = (items: { position: number }[]) => items.map((item) => item.position);

  describe('creating a board', () => {
    it('creates default columns To Do, In Progress, Done and makes the creator Admin', async () => {
      const owner = await registerUser(app, 'owner');

      const response = await post(owner, '/boards', { title: '  My board  ' }).expect(201);
      const board = response.body as BoardBody;

      expect(board.title).toBe('My board');
      expect(board.myRole).toBe('ADMIN');
      expect(board.columns.map((c) => [c.title, c.type, c.position])).toEqual([
        ['To Do', 'TODO', 0],
        ['In Progress', 'IN_PROGRESS', 1],
        ['Done', 'DONE', 2],
      ]);
      const memberships = await dataSource
        .getRepository(BoardMembershipEntity)
        .find({ where: { boardId: board.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ userId: owner.id, role: BoardRole.ADMIN });
    });

    it('rejects an invalid title with 400 and creates nothing', async () => {
      const owner = await registerUser(app, 'owner');
      await post(owner, '/boards', { title: '' }).expect(400);
      await post(owner, '/boards', {}).expect(400);
      await post(owner, '/boards', { title: 'x'.repeat(256) }).expect(400);
      expect((await get(owner, '/boards').expect(200)).body).toEqual([]);
    });
  });

  describe('visibility', () => {
    it('lists only boards the user belongs to and 404s for strangers', async () => {
      const owner = await registerUser(app, 'owner');
      const stranger = await registerUser(app, 'stranger');
      const board = await createBoard(app, owner, 'Private');
      await createBoard(app, stranger, 'Other');

      const mine = (await get(owner, '/boards').expect(200)).body as BoardBody[];
      expect(mine.map((b) => b.id)).toEqual([board.id]);

      await get(stranger, `/boards/${board.id}`).expect(404);
      await get(stranger, `/boards/${board.id}/columns`).expect(404);
      await patch(stranger, `/boards/${board.id}`, { title: 'x' }).expect(404);
      await get(stranger, `/boards/${randomUUID()}`).expect(404);
    });

    it('returns columns with their cards ordered by position', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const [todo] = board.columns;
      await createCard(app, owner, todo.id, 'first');
      await createCard(app, owner, todo.id, 'second');

      const detail = (await get(owner, `/boards/${board.id}`).expect(200)).body as BoardBody;

      expect(detail.columns[0].cards?.map((c) => [c.title, c.position])).toEqual([
        ['first', 0],
        ['second', 1],
      ]);
    });

    it('answers 400 for a malformed id', async () => {
      const owner = await registerUser(app, 'owner');
      await get(owner, '/boards/not-a-uuid').expect(400);
    });
  });

  describe('board administration', () => {
    it('lets only the Admin update and delete', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const viewer = await registerUser(app, 'viewer');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      await addMember(board.id, viewer, BoardRole.VIEWER);

      await patch(member, `/boards/${board.id}`, { title: 'hijack' }).expect(403);
      await patch(viewer, `/boards/${board.id}`, { title: 'hijack' }).expect(403);
      await del(member, `/boards/${board.id}`).expect(403);

      const updated = await patch(owner, `/boards/${board.id}`, {
        title: 'Renamed',
        jiraProjectKey: 'KAN',
      }).expect(200);
      expect(updated.body).toMatchObject({ title: 'Renamed', jiraProjectKey: 'KAN' });
      expect(events.filter((e) => e.type === 'board.updated')).toHaveLength(1);
    });

    it('deletes the board and everything it owns', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const card = await createCard(app, owner, board.columns[0].id);

      await del(owner, `/boards/${board.id}`).expect(204);

      await get(owner, `/boards/${board.id}`).expect(404);
      for (const [table, column, value] of [
        ['columns', 'board_id', board.id],
        ['board_memberships', 'board_id', board.id],
        ['cards', 'id', card.id],
      ]) {
        const rows = await dataSource.query<unknown[]>(
          `SELECT 1 FROM ${table} WHERE ${column} = $1`,
          [value],
        );
        expect(rows).toHaveLength(0);
      }
    });
  });

  describe('columns', () => {
    it('appends a column at the end and keeps positions 0..n-1', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);

      const created = await post(owner, `/boards/${board.id}/columns`, {
        title: 'Review',
        type: 'REVIEW',
      }).expect(201);

      expect(created.body).toMatchObject({ title: 'Review', type: 'REVIEW', position: 3 });
      expect(positions(await columns(owner, board.id))).toEqual([0, 1, 2, 3]);
    });

    it('inserts at a position and shifts the others', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);

      await post(owner, `/boards/${board.id}/columns`, { title: 'Backlog', position: 0 }).expect(
        201,
      );

      const list = await columns(owner, board.id);
      expect(list.map((c) => c.title)).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
      expect(positions(list)).toEqual([0, 1, 2, 3]);
      await post(owner, `/boards/${board.id}/columns`, { title: 'Far', position: 9 }).expect(400);
    });

    it('allows only the Admin to change structure', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      const [todo] = board.columns;

      await post(member, `/boards/${board.id}/columns`, { title: 'X' }).expect(403);
      await patch(member, `/columns/${todo.id}`, { title: 'X' }).expect(403);
      await patch(member, `/columns/${todo.id}/reorder`, { position: 1 }).expect(403);
      await del(member, `/columns/${todo.id}`).expect(403);
      await patch(owner, `/columns/${todo.id}`, { title: 'Backlog', type: 'TODO' }).expect(200);
    });

    it('refuses to drop below three columns', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);

      await del(owner, `/columns/${board.columns[2].id}`).expect(409);

      expect(await columns(owner, board.id)).toHaveLength(3);
    });

    it('refuses to delete a column that still holds cards, and closes the gap otherwise', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const extra = (
        await post(owner, `/boards/${board.id}/columns`, { title: 'Extra', position: 1 }).expect(
          201,
        )
      ).body as ColumnBody;
      await createCard(app, owner, extra.id);

      await del(owner, `/columns/${extra.id}`).expect(409);

      const card = (await get(owner, `/columns/${extra.id}/cards`).expect(200)).body as CardBody[];
      await del(owner, `/cards/${card[0].id}`).expect(204);
      await del(owner, `/columns/${extra.id}`).expect(204);
      const list = await columns(owner, board.id);
      expect(list).toHaveLength(3);
      expect(positions(list)).toEqual([0, 1, 2]);
    });

    it('reorders a column transactionally', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      await post(owner, `/boards/${board.id}/columns`, { title: 'Four' }).expect(201);
      const list = await columns(owner, board.id);

      const moved = await patch(owner, `/columns/${list[3].id}/reorder`, { position: 0 }).expect(
        200,
      );

      const result = moved.body as ColumnBody[];
      expect(result.map((c) => c.title)).toEqual(['Four', 'To Do', 'In Progress', 'Done']);
      expect(positions(result)).toEqual([0, 1, 2, 3]);

      const down = await patch(owner, `/columns/${list[3].id}/reorder`, { position: 3 }).expect(
        200,
      );
      expect((down.body as ColumnBody[]).map((c) => c.title)).toEqual([
        'To Do',
        'In Progress',
        'Done',
        'Four',
      ]);
    });

    it.each([-1, 4, 1.5])('rejects reorder position %s and changes nothing', async (position) => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      await post(owner, `/boards/${board.id}/columns`, { title: 'Four' }).expect(201);
      const before = await columns(owner, board.id);

      await patch(owner, `/columns/${before[0].id}/reorder`, { position }).expect(400);

      expect(await columns(owner, board.id)).toEqual(before);
    });

    it('keeps positions consistent under concurrent reorders', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      for (const title of ['A', 'B', 'C', 'D', 'E']) {
        await post(owner, `/boards/${board.id}/columns`, { title }).expect(201);
      }
      const list = await columns(owner, board.id);
      const count = list.length;

      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          patch(owner, `/columns/${list[i % count].id}/reorder`, {
            position: (i * 5 + 3) % count,
          }),
        ),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
      const after = await columns(owner, board.id);
      expect(positions(after)).toEqual(Array.from({ length: count }, (_, i) => i));
      expect(new Set(after.map((c) => c.id)).size).toBe(count);
    });
  });

  describe('cards', () => {
    it('lets members and admins create, edit, move and delete; viewers only read', async () => {
      const owner = await registerUser(app, 'owner');
      const member = await registerUser(app, 'member');
      const viewer = await registerUser(app, 'viewer');
      const board = await createBoard(app, owner);
      await addMember(board.id, member, BoardRole.MEMBER);
      await addMember(board.id, viewer, BoardRole.VIEWER);
      const [todo, doing] = board.columns;
      const card = await createCard(app, member, todo.id, 'by member');

      await get(viewer, `/cards/${card.id}`).expect(200);
      await get(viewer, `/columns/${todo.id}/cards`).expect(200);
      await post(viewer, `/columns/${todo.id}/cards`, { title: 'nope' }).expect(403);
      await patch(viewer, `/cards/${card.id}`, { title: 'nope' }).expect(403);
      await patch(viewer, `/cards/${card.id}/move`, { columnId: doing.id, position: 0 }).expect(
        403,
      );
      await del(viewer, `/cards/${card.id}`).expect(403);

      await patch(member, `/cards/${card.id}`, { title: 'edited' }).expect(200);
      await patch(owner, `/cards/${card.id}/move`, { columnId: doing.id, position: 0 }).expect(200);
      await del(member, `/cards/${card.id}`).expect(204);
    });

    it('answers 404 to non-members for every card operation', async () => {
      const owner = await registerUser(app, 'owner');
      const stranger = await registerUser(app, 'stranger');
      const board = await createBoard(app, owner);
      const card = await createCard(app, owner, board.columns[0].id);

      await get(stranger, `/cards/${card.id}`).expect(404);
      await post(stranger, `/columns/${board.columns[0].id}/cards`, { title: 'x' }).expect(404);
      await patch(stranger, `/cards/${card.id}`, { title: 'x' }).expect(404);
      await del(stranger, `/cards/${card.id}`).expect(404);
    });

    it('creates a card at the end of a column, deriving the board from the column', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const [todo] = board.columns;

      const first = await createCard(app, owner, todo.id, 'first');
      const second = (
        await post(owner, `/columns/${todo.id}/cards`, {
          title: 'second',
          description: 'details',
          deadline: '2026-12-31T10:00:00.000Z',
          assigneeId: owner.id,
        }).expect(201)
      ).body as CardBody & { description: string; deadline: string };

      expect([first.position, second.position]).toEqual([0, 1]);
      expect(second).toMatchObject({
        boardId: board.id,
        columnId: todo.id,
        description: 'details',
        deadline: '2026-12-31T10:00:00.000Z',
        assigneeId: owner.id,
        labelIds: [],
        jiraIssueKey: null,
      });
    });

    it('rejects an assignee who is not a board member and unknown labels', async () => {
      const owner = await registerUser(app, 'owner');
      const outsider = await registerUser(app, 'outsider');
      const board = await createBoard(app, owner);
      const url = `/columns/${board.columns[0].id}/cards`;

      await post(owner, url, { title: 'x', assigneeId: outsider.id }).expect(400);
      await post(owner, url, { title: 'x', labelIds: [randomUUID()] }).expect(400);
      await post(owner, url, { title: '' }).expect(400);
      await post(owner, url, { title: 'x', unknown: true }).expect(400);
    });

    it('updates and clears optional fields', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const card = await createCard(app, owner, board.columns[0].id);

      const set = await patch(owner, `/cards/${card.id}`, {
        title: 'Renamed',
        description: 'text',
        deadline: '2027-01-01T00:00:00.000Z',
      }).expect(200);
      expect(set.body).toMatchObject({
        title: 'Renamed',
        description: 'text',
        deadline: '2027-01-01T00:00:00.000Z',
      });

      const cleared = await patch(owner, `/cards/${card.id}`, {
        description: null,
        deadline: null,
      }).expect(200);
      expect(cleared.body).toMatchObject({ description: null, deadline: null });
    });

    it('moves between columns closing the gap in the source and opening one in the target', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const [todo, doing] = board.columns;
      const [a, b, c] = [
        await createCard(app, owner, todo.id, 'a'),
        await createCard(app, owner, todo.id, 'b'),
        await createCard(app, owner, todo.id, 'c'),
      ];
      const x = await createCard(app, owner, doing.id, 'x');
      const y = await createCard(app, owner, doing.id, 'y');

      const moved = await patch(owner, `/cards/${b.id}/move`, {
        columnId: doing.id,
        position: 1,
      }).expect(200);

      expect(moved.body).toMatchObject({ id: b.id, columnId: doing.id, position: 1 });
      const source = (await get(owner, `/columns/${todo.id}/cards`)).body as CardBody[];
      const target = (await get(owner, `/columns/${doing.id}/cards`)).body as CardBody[];
      expect(source.map((card) => [card.id, card.position])).toEqual([
        [a.id, 0],
        [c.id, 1],
      ]);
      expect(target.map((card) => [card.id, card.position])).toEqual([
        [x.id, 0],
        [b.id, 1],
        [y.id, 2],
      ]);
    });

    it('reorders inside the same column in both directions', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const todo = board.columns[0];
      const [a, b, c, d] = await Promise.all(
        ['a', 'b', 'c', 'd'].map((title) => createCard(app, owner, todo.id, title)),
      ).then((cards) => cards.sort((p, q) => p.position - q.position));

      await patch(owner, `/cards/${a.id}/move`, { columnId: todo.id, position: 2 }).expect(200);
      let order = (await get(owner, `/columns/${todo.id}/cards`)).body as CardBody[];
      expect(order.map((card) => card.id)).toEqual([b.id, c.id, a.id, d.id]);
      expect(positions(order)).toEqual([0, 1, 2, 3]);

      await patch(owner, `/cards/${d.id}/move`, { columnId: todo.id, position: 0 }).expect(200);
      order = (await get(owner, `/columns/${todo.id}/cards`)).body as CardBody[];
      expect(order.map((card) => card.id)).toEqual([d.id, b.id, c.id, a.id]);
      expect(positions(order)).toEqual([0, 1, 2, 3]);
    });

    it('rejects a move to another board, an out-of-range position and an unknown column', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner, 'one');
      const other = await createBoard(app, owner, 'two');
      const card = await createCard(app, owner, board.columns[0].id);

      await patch(owner, `/cards/${card.id}/move`, {
        columnId: other.columns[0].id,
        position: 0,
      }).expect(400);
      await patch(owner, `/cards/${card.id}/move`, {
        columnId: board.columns[1].id,
        position: 5,
      }).expect(400);
      await patch(owner, `/cards/${card.id}/move`, {
        columnId: board.columns[0].id,
        position: 1,
      }).expect(400);
      await patch(owner, `/cards/${card.id}/move`, {
        columnId: randomUUID(),
        position: 0,
      }).expect(404);
      await patch(owner, `/cards/${card.id}/move`, {
        columnId: board.columns[1].id,
        position: -1,
      }).expect(400);

      const unchanged = (await get(owner, `/cards/${card.id}`)).body as CardBody;
      expect(unchanged).toMatchObject({ columnId: board.columns[0].id, position: 0 });
    });

    it('keeps positions consistent under concurrent moves', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const [todo, doing, done] = board.columns;
      const cards = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createCard(app, owner, todo.id, `c${i}`)),
      );
      const targets = [todo, doing, done];

      const responses = await Promise.all(
        cards.map((card, i) =>
          patch(owner, `/cards/${card.id}/move`, { columnId: targets[i % 3].id, position: 0 }),
        ),
      );

      expect(responses.every((r) => r.status === 200 || r.status === 400)).toBe(true);
      let total = 0;
      for (const column of targets) {
        const list = (await get(owner, `/columns/${column.id}/cards`)).body as CardBody[];
        expect(positions(list)).toEqual(list.map((_, i) => i));
        total += list.length;
      }
      expect(total).toBe(6);
    });

    it('enforces a unique Jira issue key per board in the database', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner, 'one');
      const other = await createBoard(app, owner, 'two');
      const [a, b] = [
        await createCard(app, owner, board.columns[0].id),
        await createCard(app, owner, board.columns[0].id),
      ];
      const otherCard = await createCard(app, owner, other.columns[0].id);
      const repo = dataSource.getRepository(CardEntity);

      await repo.update(a.id, { jiraIssueKey: 'KAN-1' });
      await expect(repo.update(b.id, { jiraIssueKey: 'KAN-1' })).rejects.toThrow(/unique/i);
      await expect(repo.update(otherCard.id, { jiraIssueKey: 'KAN-1' })).resolves.toBeDefined();
      await expect(repo.update(b.id, { jiraIssueKey: null })).resolves.toBeDefined();
    });
  });

  describe('events', () => {
    it('publishes card.created, card.updated, card.moved after the change is committed', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const [todo, doing] = board.columns;
      events = [];

      const card = await createCard(app, owner, todo.id);
      await patch(owner, `/cards/${card.id}`, { title: 'renamed' }).expect(200);
      await patch(owner, `/cards/${card.id}/move`, { columnId: doing.id, position: 0 }).expect(200);

      expect(events.map((e) => e.type)).toEqual(['card.created', 'card.updated', 'card.moved']);
      for (const event of events) {
        expect(event).toMatchObject({ boardId: board.id, actorId: owner.id, origin: 'user' });
        expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
      }
      const moved = events[2];
      expect(moved.payload).toMatchObject({
        fromColumnId: todo.id,
        toColumnId: doing.id,
        position: 0,
      });
      // The committed state is visible when the event is published.
      expect((await get(owner, `/cards/${card.id}`)).body).toMatchObject({ columnId: doing.id });
    });

    it('publishes board.updated for structure changes and not for failed requests', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      events = [];

      await post(owner, `/boards/${board.id}/columns`, { title: 'New' }).expect(201);
      await del(owner, `/columns/${board.columns[2].id}`).expect(204);
      expect(events.map((e) => e.type)).toEqual(['board.updated', 'board.updated']);

      events = [];
      await del(owner, `/columns/${board.columns[1].id}`).expect(409);
      await patch(owner, `/columns/${board.columns[0].id}/reorder`, { position: 9 }).expect(400);
      expect(events).toHaveLength(0);
    });

    it('does not let a failing listener fail the request', async () => {
      const owner = await registerUser(app, 'owner');
      const board = await createBoard(app, owner);
      const emitter = app.get(EventEmitter2);
      const failing = () => {
        throw new Error('listener exploded');
      };
      emitter.on('card.created', failing);
      try {
        await post(owner, `/columns/${board.columns[0].id}/cards`, { title: 'still fine' }).expect(
          201,
        );
      } finally {
        emitter.off('card.created', failing);
      }
    });
  });
});
