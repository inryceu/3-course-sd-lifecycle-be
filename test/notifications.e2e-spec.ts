import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DomainEventOf } from '../src/common/events';
import { DeadlineRemindersService } from '../src/modules/boards/application/deadline-reminders.service';
import {
  bearer,
  BoardBody,
  createBoard,
  createTestApp,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

interface NotificationBody {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface PageBody {
  items: NotificationBody[];
  nextCursor: string | null;
}

const HOUR = 3600_000;

/** Component tests for the `deadline-reminders` spec (T-32): real Postgres, scheduler run directly. */
describe('Deadline reminders and notifications (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let reminders: DeadlineRemindersService;
  const events: DomainEventOf<'notification.created'>[] = [];

  let admin: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let board: BoardBody;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    reminders = app.get(DeadlineRemindersService);
    app
      .get(EventEmitter2)
      .on('notification.created', (e: DomainEventOf<'notification.created'>) => events.push(e));

    admin = await registerUser(app, 'n-admin');
    bob = await registerUser(app, 'n-bob');
    carol = await registerUser(app, 'n-carol');
    board = await createBoard(app, admin, 'Reminders');
    for (const user of [bob, carol]) {
      await request(server)
        .post(`${PREFIX}/boards/${board.id}/members`)
        .set(bearer(admin))
        .send({ email: user.email, role: 'MEMBER' })
        .expect(201);
    }
  });
  afterAll(() => app.close());

  const card = async (title: string, dueInMs: number | null, assignee?: TestUser) => {
    const res = await request(server)
      .post(`${PREFIX}/columns/${board.columns[0].id}/cards`)
      .set(bearer(admin))
      .send({
        title,
        ...(dueInMs === null ? {} : { deadline: new Date(Date.now() + dueInMs).toISOString() }),
        ...(assignee ? { assigneeId: assignee.id } : {}),
      })
      .expect(201);
    return res.body as { id: string };
  };
  const list = (user: TestUser, query = '') =>
    request(server).get(`${PREFIX}/notifications${query}`).set(bearer(user));
  const items = async (user: TestUser) => ((await list(user).expect(200)).body as PageBody).items;
  const markRead = (user: TestUser, id: string) =>
    request(server).post(`${PREFIX}/notifications/${id}/read`).set(bearer(user));

  it('reminds the assignee of a card due within 24 h once, and pushes notification.created', async () => {
    const due = await card('Due soon', 3 * HOUR, bob);
    await card('Due later', 30 * HOUR, bob);
    await card('Overdue', -HOUR, bob);
    await card('Nobody assigned', 2 * HOUR);
    await card('No deadline', null, bob);

    expect(await reminders.runOnce()).toBeGreaterThanOrEqual(1);

    const mine = await items(bob);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      id: expect.any(String),
      type: 'deadline.reminder',
      payload: {
        cardId: due.id,
        boardId: board.id,
        cardTitle: 'Due soon',
        deadline: expect.stringMatching(/Z$/),
      },
      readAt: null,
      createdAt: expect.stringMatching(/Z$/),
    });
    const pushed = events.filter((e) => e.payload.recipientId === bob.id);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ boardId: board.id, payload: { notification: mine[0] } });

    // Second run and a "restart" (another run later) create nothing new for the reminded card.
    await reminders.runOnce();
    await reminders.runOnce(new Date(Date.now() + 60_000));
    expect(await items(bob)).toHaveLength(1);
    expect(events.filter((e) => e.payload.recipientId === bob.id)).toHaveLength(1);
  });

  it('reminds exactly once when two runs execute concurrently', async () => {
    await card('Race', 2 * HOUR, carol);

    await Promise.all([reminders.runOnce(), reminders.runOnce(), reminders.runOnce()]);

    expect(await items(carol)).toHaveLength(1);
  });

  it('reminds again after the deadline moves, and pages newest first', async () => {
    const moved = await card('Moved', 5 * HOUR, bob);
    await reminders.runOnce();
    const before = await items(bob);

    await request(server)
      .patch(`${PREFIX}/cards/${moved.id}`)
      .set(bearer(admin))
      .send({ deadline: new Date(Date.now() + 6 * HOUR).toISOString() })
      .expect(200);
    await reminders.runOnce();

    const all = await items(bob);
    expect(all).toHaveLength(before.length + 1);
    expect(all.map((n) => n.createdAt)).toEqual([...all.map((n) => n.createdAt)].sort().reverse());

    const first = (await list(bob, '?limit=1').expect(200)).body as PageBody;
    expect(first.items).toEqual([all[0]]);
    expect(first.nextCursor).toBe(all[0].id);
    const second = (await list(bob, `?limit=2&cursor=${first.nextCursor}`).expect(200))
      .body as PageBody;
    expect(second.items).toEqual(all.slice(1, 3));
    expect(second.nextCursor).toBeNull();
  });

  it('marks a notification read idempotently and keeps it private', async () => {
    const [notification] = await items(bob);

    await markRead(carol, notification.id).expect(404);
    await markRead(bob, randomUUID()).expect(404);
    expect((await items(bob)).find((n) => n.id === notification.id)?.readAt).toBeNull();

    const read = (await markRead(bob, notification.id).expect(200)).body as NotificationBody;
    expect(read).toMatchObject({ id: notification.id, readAt: expect.stringMatching(/Z$/) });
    const again = (await markRead(bob, notification.id).expect(200)).body as NotificationBody;
    expect(again.readAt).toBe(read.readAt);
    expect((await items(bob)).find((n) => n.id === notification.id)?.readAt).toBe(read.readAt);

    expect(await items(admin)).toEqual([]);
  });

  it('validates the query and requires authentication', async () => {
    await list(bob, '?cursor=not-a-uuid').expect(400);
    await list(bob, '?limit=0').expect(400);
    await list(bob, '?limit=101').expect(400);
    await markRead(bob, 'not-a-uuid').expect(400);
    await request(server).get(`${PREFIX}/notifications`).expect(401);
  });
});
