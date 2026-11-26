import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OUTBOX_CLOCK, OUTBOX_CONFIG, loadOutboxConfig } from '../src/common/outbox/outbox.config';
import { OutboxWorker } from '../src/common/outbox/outbox.worker';
import { BoardEntity } from '../src/modules/boards/infrastructure/persistence/board.entity';
import { CardEntity } from '../src/modules/boards/infrastructure/persistence/card.entity';
import {
  DoTransitionInput,
  GetIssueInput,
  GetIssueResult,
  JIRA_GATEWAY,
  JiraStatus,
  JiraTransition,
} from '../src/modules/jira-sync/application/jira-gateway.port';
import {
  JiraServerError,
  JiraTimeoutError,
} from '../src/modules/jira-sync/domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import {
  SyncLogEntity,
  SyncStatus,
} from '../src/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import {
  BoardBody,
  bearer,
  createBoard,
  createCard,
  PREFIX,
  registerUser,
  TestUser,
} from './helpers';

/**
 * Component test for T-35 (NFR-REL-2): the real worker, handler, outbox and Admin API against a
 * Jira stand-in that goes down and comes back. Time is simulated: the worker reads an injected
 * clock, and each step advances it by one poll interval and drains what is due.
 */

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const DONE = status('9', 'Done', 'done');
const ALL = [TODO, DOING, DONE];

const transition = (to: JiraStatus): JiraTransition => ({
  id: `${to.id}1`,
  name: `To ${to.name}`,
  to,
  hasScreen: false,
  isGlobal: true,
  isInitial: false,
  isConditional: false,
  isAvailable: true,
});

class FakeJira {
  readonly statuses = new Map<string, JiraStatus>();
  readonly transitions: DoTransitionInput[] = [];
  down = false;
  /** The next doTransition is applied by "Jira" but the answer never arrives. */
  timeoutAfterApplying = false;

  getIssue(input: GetIssueInput): Promise<GetIssueResult> {
    if (this.down) return Promise.reject(new JiraServerError(503, 1, 1));
    const current = this.statuses.get(input.issueIdOrKey) ?? TODO;
    return Promise.resolve({ id: '1', key: input.issueIdOrKey, status: current });
  }

  listTransitions() {
    if (this.down) return Promise.reject(new JiraServerError(503, 1, 1));
    return Promise.resolve({ transitions: ALL.map(transition) });
  }

  doTransition(input: DoTransitionInput): Promise<void> {
    if (this.down) return Promise.reject(new JiraServerError(503, 1, 1));
    this.transitions.push(input);
    const target = ALL.find((s) => transition(s).id === input.transitionId);
    if (target) this.statuses.set(input.issueIdOrKey, target);
    if (this.timeoutAfterApplying) {
      this.timeoutAfterApplying = false;
      return Promise.reject(new JiraTimeoutError(1, 1));
    }
    return Promise.resolve();
  }
}

interface OutboxRow {
  id: string;
  card_id: string;
  status: string;
  attempts: number;
  error_code: string | null;
}

describe('Jira outbox: outage and recovery (component)', () => {
  const jira = new FakeJira();
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let admin2: TestUser;
  let member: TestUser;
  let stranger: TestUser;
  let issueCounter = 0;
  let clock = Date.now();

  const advance = (ms: number) => {
    clock += ms;
  };
  /** One poll step: time passes, then the worker drains every row that is due. */
  const step = async (ms: number) => {
    advance(ms);
    await worker.drain();
  };

  const linkedBoard = async (): Promise<BoardBody> => {
    const board = await createBoard(app, admin, 'Outage board');
    await dataSource.getRepository(BoardEntity).update(board.id, { jiraProjectKey: 'OUT' });
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId: board.id,
      connectedById: admin.id,
      cloudId: `cloud-${board.id}`,
      siteUrl: 'https://outage.atlassian.net',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      connectedAt: new Date(),
    });
    for (const user of [admin2, member]) {
      await request(server)
        .post(`${PREFIX}/boards/${board.id}/members`)
        .set(bearer(admin))
        .send({ email: user.email, role: 'MEMBER' })
        .expect(201);
    }
    await request(server)
      .patch(`${PREFIX}/boards/${board.id}/members/${admin2.id}`)
      .set(bearer(admin))
      .send({ role: 'ADMIN' })
      .expect(200);
    return board;
  };

  const linkedCard = async (board: BoardBody) => {
    const card = await createCard(app, admin, board.columns[0].id, 'Outage card');
    const issueKey = `OUT-${++issueCounter}`;
    await dataSource.getRepository(CardEntity).update(card.id, { jiraIssueKey: issueKey });
    return { card, issueKey };
  };

  const moveCard = (user: TestUser, cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(user))
      .send({ columnId, position: 0 })
      .expect(200);

  const rows = (boardId: string): Promise<OutboxRow[]> =>
    dataSource.query(
      `SELECT id, card_id, status, attempts, error_code FROM sync_outbox
        WHERE board_id = $1 ORDER BY sequence`,
      [boardId],
    );

  const inbox = async (user: TestUser, type: string) =>
    (
      (await request(server).get(`${PREFIX}/notifications`).set(bearer(user)).expect(200)).body as {
        items: Array<{ type: string; boardId?: string; payload: { cardId?: string } }>;
      }
    ).items.filter((n) => n.type === type);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JIRA_GATEWAY)
      .useValue(jira)
      .overrideProvider(OUTBOX_CONFIG)
      .useValue({ ...loadOutboxConfig(), pollIntervalSeconds: 0, concurrency: 20, batchSize: 20 })
      .overrideProvider(OUTBOX_CLOCK)
      .useValue({ now: () => new Date(clock) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    worker = app.get(OutboxWorker);
    admin = await registerUser(app, 'outage-admin');
    admin2 = await registerUser(app, 'outage-admin2');
    member = await registerUser(app, 'outage-member');
    stranger = await registerUser(app, 'outage-stranger');
  });

  beforeEach(() => {
    jira.statuses.clear();
    jira.transitions.length = 0;
    jira.down = false;
    jira.timeoutAfterApplying = false;
  });

  afterAll(() => app.close());

  it('keeps 100 moves queued through a 5-minute outage, then drains them within 60 s', async () => {
    const board = await linkedBoard();
    const [, doing, done] = board.columns.map((c) => c.id);
    const cards = [];
    for (let i = 0; i < 100; i++) cards.push(await linkedCard(board));

    jira.down = true;
    for (const [i, { card }] of cards.entries()) {
      await moveCard(admin, card.id, i % 2 === 0 ? done : doing);
    }
    // Ten cards are moved again while queued: the newest destination must be what Jira ends in.
    for (const { card } of cards.slice(0, 10)) await moveCard(admin, card.id, doing);

    for (let t = 0; t < 10; t++) await step(30_000);
    const queued = await rows(board.id);
    expect(queued).toHaveLength(100); // coalesced: one row per card
    expect(queued.every((r) => r.status === 'PENDING' && r.attempts > 0)).toBe(true);
    expect(jira.transitions).toHaveLength(0);

    jira.down = false; // connectivity is back
    let waited = 0;
    while ((await rows(board.id)).some((r) => r.status !== 'SENT') && waited < 60_000) {
      await step(5_000);
      waited += 5_000;
    }

    expect((await rows(board.id)).every((r) => r.status === 'SENT')).toBe(true);
    expect(waited).toBeLessThanOrEqual(60_000);
    expect(jira.transitions).toHaveLength(100); // one transition per card, none duplicated
    for (const [i, { issueKey }] of cards.entries()) {
      const expected = i < 10 ? DOING : i % 2 === 0 ? DONE : DOING;
      expect(jira.statuses.get(issueKey)).toBe(expected);
    }
  }, 240_000);

  it('does not send a timed-out transition twice: the retry reads the status first', async () => {
    const board = await linkedBoard();
    const { card, issueKey } = await linkedCard(board);
    jira.timeoutAfterApplying = true;

    await moveCard(admin, card.id, board.columns[2].id);
    await step(0); // attempt 1: Jira applied it, the answer timed out
    await step(60_000); // attempt 2: reads the issue, it is already Done

    expect(jira.transitions).toHaveLength(1);
    expect(jira.statuses.get(issueKey)).toBe(DONE);
    expect((await rows(board.id))[0]).toMatchObject({ status: 'SENT', attempts: 1 });
    const logs = (
      await dataSource.getRepository(SyncLogEntity).find({ order: { createdAt: 'ASC' } })
    ).filter((l) => (l.payload as { cardId?: string } | null)?.cardId === card.id);
    expect(logs[0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: expect.objectContaining({ outcome: 'unknown' }) as unknown,
    });
    expect(logs[1]).toMatchObject({
      status: SyncStatus.SUCCESS,
      payload: expect.objectContaining({ outcome: 'no-op' }) as unknown,
    });
  });

  it('dead-letters after the 24 h window, notifies Admins and the mover once, and an Admin requeues', async () => {
    const board = await linkedBoard();
    const { card, issueKey } = await linkedCard(board);
    jira.down = true;
    await moveCard(member, card.id, board.columns[2].id);

    for (let hour = 0; hour < 23; hour++) await step(3_600_000);
    expect((await rows(board.id))[0].status).toBe('PENDING'); // 23 h of outage: still queued
    await step(2 * 3_600_000);

    const [dead] = await rows(board.id);
    expect(dead).toMatchObject({ status: 'DEAD', error_code: 'attempts_exhausted' });
    for (const user of [admin, admin2, member]) {
      const own = (await inbox(user, 'jira.sync.failed')).filter(
        (n) => n.payload.cardId === card.id,
      );
      expect(own).toHaveLength(1);
      expect(own[0].payload).toMatchObject({ outboxId: dead.id, jiraIssueKey: issueKey });
    }
    await expect(inbox(stranger, 'jira.sync.failed')).resolves.toHaveLength(0);

    // Admin API: list, authorization, bulk requeue, single requeue refusal
    const list = await request(server)
      .get(`${PREFIX}/jira/sync/outbox`)
      .query({ boardId: board.id })
      .set(bearer(admin))
      .expect(200);
    expect((list.body as { items: Array<{ id: string; status: string }> }).items).toEqual([
      expect.objectContaining({ id: dead.id, status: 'DEAD', jiraIssueKey: issueKey }),
    ]);
    await request(server)
      .get(`${PREFIX}/jira/sync/outbox`)
      .query({ boardId: board.id })
      .set(bearer(member))
      .expect(403);
    await request(server)
      .get(`${PREFIX}/jira/sync/outbox`)
      .query({ boardId: board.id })
      .set(bearer(stranger))
      .expect(404);
    await request(server).get(`${PREFIX}/jira/sync/outbox`).set(bearer(admin)).expect(400);
    await request(server)
      .post(`${PREFIX}/jira/sync/outbox/requeue-dead`)
      .query({ boardId: board.id })
      .set(bearer(member))
      .expect(403);

    jira.down = false;
    const bulk = await request(server)
      .post(`${PREFIX}/jira/sync/outbox/requeue-dead`)
      .query({ boardId: board.id })
      .set(bearer(admin))
      .expect(200);
    expect(bulk.body).toEqual({ requeued: 1, skipped: 0 });
    await worker.drain();
    expect((await rows(board.id))[0].status).toBe('SENT');
    expect(jira.statuses.get(issueKey)).toBe(DONE);

    await request(server)
      .post(`${PREFIX}/jira/sync/outbox/${dead.id}/requeue`)
      .set(bearer(admin))
      .expect(409); // no longer dead
    await request(server)
      .post(`${PREFIX}/jira/sync/outbox/${dead.id}/requeue`)
      .set(bearer(member))
      .expect(403);
    await request(server)
      .post(`${PREFIX}/jira/sync/outbox/00000000-0000-4000-8000-000000000000/requeue`)
      .set(bearer(admin))
      .expect(404);
  }, 120_000);

  it('a bulk requeue skips a dead row that an earlier dead row of the same card blocks', async () => {
    const board = await linkedBoard();
    const { card } = await linkedCard(board);
    const [, doing, done] = board.columns.map((c) => c.id);
    await moveCard(admin, card.id, done);
    // Two DEAD rows for one card (the newer one was queued after the older one died).
    await dataSource.query(
      `UPDATE sync_outbox SET status = 'DEAD', dead_at = now(), error_code = 'jira_error' WHERE board_id = $1`,
      [board.id],
    );
    await moveCard(admin, card.id, doing);
    await dataSource.query(
      `UPDATE sync_outbox SET status = 'DEAD', dead_at = now(), error_code = 'jira_error'
        WHERE board_id = $1 AND status = 'PENDING'`,
      [board.id],
    );

    const bulk = await request(server)
      .post(`${PREFIX}/jira/sync/outbox/requeue-dead`)
      .query({ boardId: board.id })
      .set(bearer(admin))
      .expect(200);

    expect(bulk.body).toEqual({ requeued: 1, skipped: 1 });
    expect((await rows(board.id)).map((r) => r.status)).toEqual(['PENDING', 'DEAD']);
  });
});
