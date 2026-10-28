import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../src/common/events';
import { BoardRole } from '../src/modules/boards';
import { BoardMembershipEntity } from '../src/modules/boards/infrastructure/persistence/board-membership.entity';
import {
  bearer,
  createBoard,
  createCard,
  createTestApp,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

describe('Labels and comments (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let events: DomainEvent[];

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    server = app.getHttpServer();
    const emitter = app.get(EventEmitter2);
    for (const type of ['card.commented', 'card.updated', 'board.updated']) {
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
  const put = (user: TestUser, path: string, body: object = {}) =>
    request(server).put(`${PREFIX}${path}`).set(bearer(user)).send(body);
  const del = (user: TestUser, path: string) =>
    request(server).delete(`${PREFIX}${path}`).set(bearer(user));

  async function addMember(boardId: string, user: TestUser, role: BoardRole): Promise<void> {
    await dataSource
      .getRepository(BoardMembershipEntity)
      .insert({ boardId, userId: user.id, role });
  }

  async function removeMember(boardId: string, userId: string): Promise<void> {
    await dataSource.getRepository(BoardMembershipEntity).delete({ boardId, userId });
  }

  describe('Labels', () => {
    it('supports create, duplicate check, attach, and delete workflows', async () => {
      const owner = await registerUser(app, 'owner1');
      const board = await createBoard(app, owner, 'Label Board');
      const card = await createCard(app, owner, board.columns[0].id, 'Card 1');

      const createRes = await post(owner, `/boards/${board.id}/labels`, { name: 'bug ' }).expect(
        201,
      );
      const label = createRes.body;
      expect(label.name).toBe('bug');
      expect(label.color).toMatch(/^#[0-9a-fA-F]{6}$/);

      await post(owner, `/boards/${board.id}/labels`, { name: 'bug', color: '#ff0000' }).expect(
        409,
      );

      const attachRes = await put(owner, `/cards/${card.id}/labels/${label.id}`).expect(200);
      expect(attachRes.body.labelIds).toContain(label.id);
      expect(events.map((e) => e.type)).toContain('card.updated');

      events = [];
      await del(owner, `/labels/${label.id}`).expect(204);
      expect(events.map((e) => e.type)).toContain('board.updated');

      const cardRes = await get(owner, `/cards/${card.id}`).expect(200);
      expect(cardRes.body.labelIds).not.toContain(label.id);
    });

    it('rejects labels from another board and viewer creations', async () => {
      const owner = await registerUser(app, 'owner2');
      const viewer = await registerUser(app, 'viewer2');
      const board1 = await createBoard(app, owner, 'B1');
      const board2 = await createBoard(app, owner, 'B2');
      await addMember(board1.id, viewer, BoardRole.VIEWER);

      const card1 = await createCard(app, owner, board1.columns[0].id);
      const label2Res = await post(owner, `/boards/${board2.id}/labels`, { name: 'other' }).expect(
        201,
      );

      await post(viewer, `/boards/${board1.id}/labels`, { name: 'v' }).expect(403);
      await put(owner, `/cards/${card1.id}/labels/${label2Res.body.id}`).expect(404);
    });
  });

  describe('Comments', () => {
    it('supports create, delete, and pages correctly over multiple pages', async () => {
      const owner = await registerUser(app, 'owner3');
      const board = await createBoard(app, owner, 'Comment Board');
      const card = await createCard(app, owner, board.columns[0].id);

      for (let i = 0; i < 9; i++) {
        await post(owner, `/cards/${card.id}/comments`, { text: `Comment ${i}` }).expect(201);
      }

      expect(events.filter((e) => e.type === 'card.commented').length).toBe(9);

      const page1 = await get(owner, `/cards/${card.id}/comments?limit=4`).expect(200);
      expect(page1.body.items).toHaveLength(4);
      expect(page1.body.items.map((i: any) => i.text)).toEqual([
        'Comment 0',
        'Comment 1',
        'Comment 2',
        'Comment 3',
      ]);
      expect(page1.body.nextCursor).not.toBeNull();

      const page2 = await get(
        owner,
        `/cards/${card.id}/comments?limit=4&cursor=${page1.body.nextCursor}`,
      ).expect(200);
      expect(page2.body.items).toHaveLength(4);
      expect(page2.body.items.map((i: any) => i.text)).toEqual([
        'Comment 4',
        'Comment 5',
        'Comment 6',
        'Comment 7',
      ]);

      const page3 = await get(
        owner,
        `/cards/${card.id}/comments?limit=4&cursor=${page2.body.nextCursor}`,
      ).expect(200);
      expect(page3.body.items).toHaveLength(1);
      expect(page3.body.items[0].text).toBe('Comment 8');
      expect(page3.body.nextCursor).toBeNull();
    });

    it('does not allow a removed member to delete comments and triggers board.updated', async () => {
      const owner = await registerUser(app, 'owner4');
      const member = await registerUser(app, 'member4');
      const board = await createBoard(app, owner, 'Removal Board');
      const card = await createCard(app, owner, board.columns[0].id);
      await addMember(board.id, member, BoardRole.MEMBER);

      const commentRes = await post(member, `/cards/${card.id}/comments`, {
        text: 'Bob says hi',
      }).expect(201);
      const commentId = commentRes.body.id;

      await removeMember(board.id, member.id);

      await get(member, `/cards/${card.id}/comments`).expect(404);
      await del(member, `/cards/${card.id}/comments/${commentId}`).expect(404);

      const stranger = await registerUser(app, 'stranger4');
      await del(stranger, `/cards/${card.id}/comments/${commentId}`).expect(404);

      events = [];
      await del(owner, `/cards/${card.id}/comments/${commentId}`).expect(204);
      expect(events.map((e) => e.type)).toContain('board.updated');
    });
  });
});
