import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DomainEvent } from '../src/common/events';
import {
  bearer,
  createBoard,
  createCard,
  createTestApp,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

/** Component tests for the `board-members` spec (T-18) and card assignment (T-19). */
describe('Board members and card assignment (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  const events: DomainEvent[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    app.get(EventEmitter2).on('card.updated', (e: DomainEvent) => events.push(e));
  });
  afterAll(() => app.close());

  const invite = (board: string, by: TestUser, email: string, role = 'MEMBER') =>
    request(server).post(`${PREFIX}/boards/${board}/members`).set(bearer(by)).send({ email, role });
  const setRole = (board: string, by: TestUser, target: TestUser, role: string) =>
    request(server)
      .patch(`${PREFIX}/boards/${board}/members/${target.id}`)
      .set(bearer(by))
      .send({ role });

  describe('members', () => {
    it('invites by e-mail in any letter case and answers with the contract Member', async () => {
      const admin = await registerUser(app, 'm-admin');
      const bob = await registerUser(app, 'm-bob');
      const board = await createBoard(app, admin);

      const res = await invite(board.id, admin, bob.email.toUpperCase()).expect(201);

      expect(res.body).toEqual({
        boardId: board.id,
        userId: bob.id,
        email: bob.email,
        displayName: 'm-bob',
        role: 'MEMBER',
        invitedAt: expect.any(String),
      });
    });

    it('rejects ADMIN invites, unknown e-mails, duplicates, and concurrent duplicates', async () => {
      const admin = await registerUser(app, 'd-admin');
      const bob = await registerUser(app, 'd-bob');
      const carol = await registerUser(app, 'd-carol');
      const board = await createBoard(app, admin);

      await invite(board.id, admin, bob.email, 'ADMIN').expect(400);
      await invite(board.id, admin, 'nobody-here@example.com').expect(400);
      await invite(board.id, admin, bob.email).expect(201);
      await invite(board.id, admin, bob.email).expect(409);

      const statuses = (
        await Promise.all([1, 2, 3].map(() => invite(board.id, admin, carol.email)))
      ).map((r) => r.status);
      expect(statuses.sort()).toEqual([201, 409, 409]);
    });

    it('changes a role with 200 and the updated Member', async () => {
      const admin = await registerUser(app, 'r-admin');
      const bob = await registerUser(app, 'r-bob');
      const board = await createBoard(app, admin);
      await invite(board.id, admin, bob.email).expect(201);

      const res = await setRole(board.id, admin, bob, 'VIEWER').expect(200);

      expect(res.body).toMatchObject({ boardId: board.id, userId: bob.id, role: 'VIEWER' });
    });

    it('keeps the last Admin, also when two Admins demote each other at once', async () => {
      const x = await registerUser(app, 'la-x');
      const y = await registerUser(app, 'la-y');
      const board = await createBoard(app, x);
      await setRole(board.id, x, x, 'MEMBER').expect(409);
      await request(server)
        .delete(`${PREFIX}/boards/${board.id}/members/${x.id}`)
        .set(bearer(x))
        .expect(409);

      await invite(board.id, x, y.email).expect(201);
      await setRole(board.id, x, y, 'ADMIN').expect(200);
      const [a, b] = await Promise.all([
        setRole(board.id, x, y, 'MEMBER'),
        setRole(board.id, y, x, 'MEMBER'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const list = await request(server)
        .get(`${PREFIX}/boards/${board.id}/members`)
        .set(bearer(x))
        .expect(200);
      expect((list.body as { role: string }[]).filter((m) => m.role === 'ADMIN')).toHaveLength(1);
    });

    it('lets only the Admin change members and hides the board from strangers', async () => {
      const admin = await registerUser(app, 'p-admin');
      const member = await registerUser(app, 'p-member');
      const stranger = await registerUser(app, 'p-stranger');
      const board = await createBoard(app, admin);
      await invite(board.id, admin, member.email).expect(201);

      await invite(board.id, member, stranger.email).expect(403);
      await request(server)
        .get(`${PREFIX}/boards/${board.id}/members`)
        .set(bearer(stranger))
        .expect(404);
    });
  });

  describe('card assignment', () => {
    it('assigns a member, clears with null, rejects outsiders and Viewers', async () => {
      const admin = await registerUser(app, 'a-admin');
      const bob = await registerUser(app, 'a-bob');
      const viewer = await registerUser(app, 'a-viewer');
      const outsider = await registerUser(app, 'a-outsider');
      const board = await createBoard(app, admin);
      await invite(board.id, admin, bob.email).expect(201);
      await invite(board.id, admin, viewer.email, 'VIEWER').expect(201);
      const card = await createCard(app, admin, board.columns[0].id, 'Assign me');
      const assign = (by: TestUser, assigneeId: string | null) =>
        request(server)
          .put(`${PREFIX}/cards/${card.id}/assignee`)
          .set(bearer(by))
          .send({ assigneeId });

      events.length = 0;
      const assigned = await assign(admin, bob.id).expect(200);
      expect(assigned.body).toMatchObject({ id: card.id, assigneeId: bob.id });
      expect(events.some((e) => e.type === 'card.updated' && e.boardId === board.id)).toBe(true);

      await assign(admin, outsider.id).expect(400);
      await assign(viewer, bob.id).expect(403);
      await request(server)
        .put(`${PREFIX}/cards/${card.id}/assignee`)
        .set(bearer(admin))
        .send({})
        .expect(400);

      const cleared = await assign(bob, null).expect(200);
      expect(cleared.body).toMatchObject({ assigneeId: null });
    });
  });
});
