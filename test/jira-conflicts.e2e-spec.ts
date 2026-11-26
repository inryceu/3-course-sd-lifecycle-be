import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OUTBOX_CONFIG, loadOutboxConfig } from '../src/common/outbox/outbox.config';
import { DomainEventOf } from '../src/common/events';
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
import { JiraServerError } from '../src/modules/jira-sync/domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncLogEntity,
  SyncStatus,
} from '../src/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import {
  BoardBody,
  bearer,
  CardBody,
  createBoard,
  createCard,
  PREFIX,
  registerUser,
  sleep,
  TestUser,
} from './helpers';

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const DONE = status('9', 'Done', 'done');
const ALL = [TODO, DOING, DONE];
const SITE = 'https://conflicts.atlassian.net';

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

/** Jira stand-in: one status per issue, every status reachable directly. */
class FakeJira {
  readonly statuses = new Map<string, JiraStatus>();
  readonly doTransitionCalls: DoTransitionInput[] = [];
  doTransitionError: Error | null = null;
  /** Set to simulate an outage: every read fails. */
  getIssueError: Error | null = null;

  reset(): void {
    this.statuses.clear();
    this.getIssueError = null;
    this.doTransitionCalls.length = 0;
    this.doTransitionError = null;
  }

  getIssue(input: GetIssueInput): Promise<GetIssueResult> {
    if (this.getIssueError) return Promise.reject(this.getIssueError);
    const current = this.statuses.get(input.issueIdOrKey) ?? TODO;
    return Promise.resolve({ id: '1', key: input.issueIdOrKey, status: current });
  }

  listTransitions() {
    return Promise.resolve({ transitions: ALL.map(transition) });
  }

  doTransition(input: DoTransitionInput): Promise<void> {
    this.doTransitionCalls.push(input);
    if (this.doTransitionError) return Promise.reject(this.doTransitionError);
    const target = ALL.find((s) => transition(s).id === input.transitionId);
    if (target) this.statuses.set(input.issueIdOrKey, target);
    return Promise.resolve();
  }
}

interface Linked {
  board: BoardBody;
  card: CardBody;
  issueKey: string;
  todo: string;
  doing: string;
  done: string;
}

interface ConflictBody {
  id: string;
  boardId: string;
  cardId: string;
  jiraIssueKey: string;
  boardColumnId: string;
  boardStatus: string;
  jiraColumnId: string;
  jiraStatus: string;
  boardChangedAt: string;
  jiraChangedAt: string;
  detectedAt: string;
  resolution: string;
  resolvedAt: string | null;
  resolvedById: string | null;
}

describe('Jira sync conflicts (e2e)', () => {
  const jira = new FakeJira();
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let secret: string;
  let admin: TestUser;
  let member: TestUser;
  let stranger: TestUser;
  let issueCounter = 0;
  let deliveryCounter = 0;
  let notificationEvents: DomainEventOf<'notification.created'>[] = [];

  const linkedBoard = async (): Promise<BoardBody> => {
    const board = await createBoard(app, admin, 'Conflict board');
    await dataSource.getRepository(BoardEntity).update(board.id, { jiraProjectKey: 'CON' });
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId: board.id,
      connectedById: admin.id,
      cloudId: `cloud-${board.id}`,
      siteUrl: SITE,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      connectedAt: new Date(),
    });
    await request(server)
      .post(`${PREFIX}/boards/${board.id}/members`)
      .set(bearer(admin))
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    return board;
  };

  const linkedCard = async (existing?: BoardBody): Promise<Linked> => {
    const board = existing ?? (await linkedBoard());
    const [todo, doing, done] = board.columns.map((column) => column.id);
    const card = await createCard(app, admin, todo, 'Linked card');
    const issueKey = `CON-${++issueCounter}`;
    await dataSource.getRepository(CardEntity).update(card.id, { jiraIssueKey: issueKey });
    await dataSource.getRepository(JiraIssueMappingEntity).save({
      boardId: board.id,
      cardId: card.id,
      jiraIssueKey: issueKey,
      jiraIssueId: String(20_000 + issueCounter),
      jiraProjectKey: 'CON',
      createdById: admin.id,
    });
    return { board, card, issueKey, todo, doing, done };
  };

  const move = (cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 })
      .expect(200);

  /** A signed status delivery, as Jira would send it, for a change made at `timestamp`. */
  const deliver = (issueKey: string, to: JiraStatus, timestamp = Date.now()) => {
    deliveryCounter += 1;
    const raw = JSON.stringify({
      webhookEvent: 'jira:issue_updated',
      timestamp,
      issue: {
        id: String(deliveryCounter),
        self: `${SITE}/rest/api/2/issue/${deliveryCounter}`,
        key: issueKey,
        fields: {
          status: {
            id: to.id,
            name: to.name,
            statusCategory: { id: 2, key: to.statusCategory.key, name: to.name },
          },
        },
      },
      changelog: { id: `chg-${deliveryCounter}`, items: [{ field: 'status' }] },
    });
    return request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw)
      .expect(200);
  };

  const columnOf = async (cardId: string): Promise<string> =>
    (
      (await request(server).get(`${PREFIX}/cards/${cardId}`).set(bearer(admin)).expect(200))
        .body as CardBody
    ).columnId;

  const logsFor = async (cardId: string): Promise<SyncLogEntity[]> =>
    (await dataSource.getRepository(SyncLogEntity).find({ order: { createdAt: 'ASC' } })).filter(
      (row) => (row.payload as { cardId?: string } | null)?.cardId === cardId,
    );

  const waitForLogs = async (cardId: string, count: number): Promise<SyncLogEntity[]> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await logsFor(cardId);
      if (rows.length >= count) return rows;
      await sleep(25);
    }
    throw new Error(`Expected ${count} sync log rows for card ${cardId}`);
  };

  const conflicts = async (boardId: string, user = admin): Promise<ConflictBody[]> =>
    (
      (
        await request(server)
          .get(`${PREFIX}/jira/conflicts`)
          .query({ boardId })
          .set(bearer(user))
          .expect(200)
      ).body as { items: ConflictBody[] }
    ).items;

  const resolve = (conflictId: string, resolution: string, user = admin) =>
    request(server)
      .post(`${PREFIX}/jira/conflicts/${conflictId}/resolve`)
      .set(bearer(user))
      .send({ resolution });

  /** Jira moved the issue to In Progress, then the user moved the card to Done 1 s later. */
  const conflictByLateUserMove = async (existing?: BoardBody) => {
    const linked = await linkedCard(existing);
    jira.statuses.set(linked.issueKey, DOING);
    await deliver(linked.issueKey, DOING);
    await sleep(1_000);
    await move(linked.card.id, linked.done);
    await waitForLogs(linked.card.id, 1);
    return linked;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JIRA_GATEWAY)
      .useValue(jira)
      .overrideProvider(OUTBOX_CONFIG)
      .useValue({ ...loadOutboxConfig(), pollIntervalSeconds: 1 })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    secret = app.get(ConfigService).getOrThrow<{ secret: string }>('webhook').secret;
    admin = await registerUser(app, 'conflict-admin');
    member = await registerUser(app, 'conflict-member');
    stranger = await registerUser(app, 'conflict-stranger');
    app
      .get(EventEmitter2)
      .on('notification.created', (event: DomainEventOf<'notification.created'>) =>
        notificationEvents.push(event),
      );
  });

  beforeEach(() => {
    jira.reset();
    notificationEvents = [];
  });

  afterAll(() => app.close());

  describe('detection (5-second window)', () => {
    it('logs a conflict when Jira changes the issue 1 s after a user move, and Jira wins', async () => {
      const { board, card, issueKey, doing, done } = await linkedCard();

      await move(card.id, done);
      await waitForLogs(card.id, 1);
      await sleep(1_000);
      jira.statuses.set(issueKey, DOING);
      await deliver(issueKey, DOING);

      await expect(columnOf(card.id)).resolves.toBe(doing);
      const [conflict, ...rest] = await conflicts(board.id);
      expect(rest).toHaveLength(0);
      expect(conflict).toMatchObject({
        boardId: board.id,
        cardId: card.id,
        jiraIssueKey: issueKey,
        boardColumnId: done,
        boardStatus: 'Done',
        jiraColumnId: doing,
        jiraStatus: 'In Progress',
        resolution: 'jira',
        resolvedAt: null,
        resolvedById: null,
      });
      expect(
        Math.abs(Date.parse(conflict.jiraChangedAt) - Date.parse(conflict.boardChangedAt)),
      ).toBeLessThanOrEqual(5_000);
    });

    it('logs a conflict when the user moves the card 1 s after a Jira change; the move is not sent', async () => {
      const { board, card, doing, done } = await conflictByLateUserMove();

      const [row] = await logsFor(card.id);
      expect(row.status).toBe(SyncStatus.CONFLICT);
      expect(row.payload).toMatchObject({ outcome: 'conflict', toColumnId: done });
      expect(jira.doTransitionCalls).toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(doing);
      const items = await conflicts(board.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ boardColumnId: done, jiraColumnId: doing });
    });

    it('does not log a conflict when the changes are more than 5 s apart', async () => {
      const { board, card, issueKey, done } = await linkedCard();
      jira.statuses.set(issueKey, DOING);
      await deliver(issueKey, DOING, Date.now() - 10_000);

      await move(card.id, done);
      const [row] = await waitForLogs(card.id, 1);

      expect(row.status).toBe(SyncStatus.SUCCESS);
      expect(jira.doTransitionCalls).toHaveLength(1);
      await expect(conflicts(board.id)).resolves.toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(done);
    });

    it('does not log a conflict when both sides end in the same column', async () => {
      const { board, card, issueKey, done } = await linkedCard();
      jira.statuses.set(issueKey, DONE);

      await move(card.id, done);
      await waitForLogs(card.id, 1); // no-op: Jira already Done
      await deliver(issueKey, DONE);

      await expect(conflicts(board.id)).resolves.toHaveLength(0);
    });

    it("does not treat echoes of BoardSync's own transitions as Jira changes", async () => {
      const { board, card, issueKey, doing, done } = await linkedCard();

      await move(card.id, doing);
      await move(card.id, done);
      await waitForLogs(card.id, 2);
      await deliver(issueKey, DOING); // echo of the first transition, after the second move
      await deliver(issueKey, DONE);

      await expect(conflicts(board.id)).resolves.toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(done);
    });
  });

  describe('a move queued while Jira is unreachable (outbox)', () => {
    const outboxRow = async (cardId: string) =>
      (
        await dataSource.query<Array<{ status: string; result: Record<string, unknown> | null }>>(
          `SELECT status, result FROM sync_outbox WHERE card_id = $1 ORDER BY sequence DESC LIMIT 1`,
          [cardId],
        )
      )[0];

    const waitForRowStatus = async (cardId: string, status: string) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if ((await outboxRow(cardId))?.status === status) return;
        await sleep(100);
      }
      throw new Error(`Outbox row of card ${cardId} did not reach ${status}`);
    };

    /** Jira down: the user's move is queued and its first attempt fails. */
    const queuedMoveDuringOutage = async () => {
      const linked = await linkedCard();
      jira.getIssueError = new JiraServerError(503, 1, 1);
      await move(linked.card.id, linked.done);
      await waitForLogs(linked.card.id, 1);
      expect(jira.doTransitionCalls).toHaveLength(0);
      return linked;
    };

    it('logs the conflict and sends nothing when Jira changed the issue within 5 s of the move', async () => {
      const { board, card, issueKey, doing, done } = await queuedMoveDuringOutage();

      jira.statuses.set(issueKey, DOING);
      await deliver(issueKey, DOING); // someone set In Progress in Jira during the outage
      jira.getIssueError = null; // Jira is back
      await waitForRowStatus(card.id, 'SENT');

      expect(jira.doTransitionCalls).toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(doing);
      const items = await conflicts(board.id);
      expect(items).toHaveLength(1); // seen by the webhook and by the retry, logged once
      expect(items[0]).toMatchObject({
        boardColumnId: done,
        jiraColumnId: doing,
        resolution: 'jira',
      });
      const rows = await logsFor(card.id);
      expect(rows[rows.length - 1]).toMatchObject({
        status: SyncStatus.CONFLICT,
        payload: expect.objectContaining({ outcome: 'conflict' }) as unknown,
      });
      expect(notificationEvents.filter((e) => e.boardId === board.id)).toHaveLength(1);
    });

    it('drops a stale move that a much later Jira change overtook (Jira wins)', async () => {
      const { board, card, issueKey, doing, done } = await queuedMoveDuringOutage();

      jira.statuses.set(issueKey, DOING);
      await deliver(issueKey, DOING, Date.now() + 60_000); // far outside the 5 s window
      await expect(conflicts(board.id)).resolves.toHaveLength(0);
      jira.getIssueError = null;
      await waitForRowStatus(card.id, 'SENT');

      expect(jira.doTransitionCalls).toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(doing);
      const items = await conflicts(board.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ boardColumnId: done, jiraColumnId: doing });
      expect(await outboxRow(card.id)).toMatchObject({
        status: 'SENT',
        result: expect.objectContaining({ outcome: 'conflict' }) as unknown,
      });
    });

    it('still sends the move after the outage when Jira did not change meanwhile', async () => {
      const { board, card, issueKey, done } = await queuedMoveDuringOutage();

      jira.getIssueError = null;
      await waitForRowStatus(card.id, 'SENT');

      expect(jira.doTransitionCalls).toHaveLength(1);
      expect(jira.statuses.get(issueKey)).toBe(DONE);
      await expect(columnOf(card.id)).resolves.toBe(done);
      await expect(conflicts(board.id)).resolves.toHaveLength(0);
    });
  });

  describe('admin notification', () => {
    it('notifies every board admin, and only admins, with notification.created', async () => {
      const { board, card } = await conflictByLateUserMove();
      const [conflict] = await conflicts(board.id);

      const inbox = async (user: TestUser) =>
        (
          (await request(server).get(`${PREFIX}/notifications`).set(bearer(user)).expect(200))
            .body as { items: Array<{ type: string; payload: Record<string, unknown> }> }
        ).items.filter((n) => n.type === 'jira.conflict' && n.payload.conflictId === conflict.id);

      const [notification] = await inbox(admin);
      expect(notification.payload).toMatchObject({
        conflictId: conflict.id,
        boardId: board.id,
        cardId: card.id,
        jiraIssueKey: conflict.jiraIssueKey,
        boardStatus: 'Done',
        jiraStatus: 'In Progress',
      });
      await expect(inbox(member)).resolves.toHaveLength(0);
      const events = notificationEvents.filter((e) => e.boardId === board.id);
      expect(events).toHaveLength(1);
      expect(events[0].payload.recipientId).toBe(admin.id);
    });
  });

  describe('list', () => {
    it('lists conflicts newest first with cursor pages; members get 403, strangers 404', async () => {
      const first = await conflictByLateUserMove();
      await conflictByLateUserMove(first.board);

      const items = await conflicts(first.board.id);
      expect(items).toHaveLength(2);
      expect(Date.parse(items[0].detectedAt)).toBeGreaterThanOrEqual(
        Date.parse(items[1].detectedAt),
      );

      const page = (
        await request(server)
          .get(`${PREFIX}/jira/conflicts`)
          .query({ boardId: first.board.id, limit: 1 })
          .set(bearer(admin))
          .expect(200)
      ).body as { items: ConflictBody[]; nextCursor: string | null };
      expect(page.items.map((c) => c.id)).toEqual([items[0].id]);
      const next = (
        await request(server)
          .get(`${PREFIX}/jira/conflicts`)
          .query({ boardId: first.board.id, limit: 1, cursor: page.nextCursor })
          .set(bearer(admin))
          .expect(200)
      ).body as { items: ConflictBody[]; nextCursor: string | null };
      expect(next).toEqual({ items: [items[1]], nextCursor: null });

      await request(server)
        .get(`${PREFIX}/jira/conflicts`)
        .query({ boardId: first.board.id })
        .set(bearer(member))
        .expect(403);
      await request(server)
        .get(`${PREFIX}/jira/conflicts`)
        .query({ boardId: first.board.id })
        .set(bearer(stranger))
        .expect(404);
    });
  });

  describe('resolve', () => {
    it("keeps the Jira version: the card follows Jira's current status, nothing is sent", async () => {
      const { board, card, issueKey, done } = await conflictByLateUserMove();
      const [conflict] = await conflicts(board.id);
      jira.statuses.set(issueKey, DONE); // Jira moved on since the conflict

      const response = await resolve(conflict.id, 'jira').expect(200);

      expect(response.body).toMatchObject({
        id: conflict.id,
        resolution: 'jira',
        resolvedById: admin.id,
      });
      expect((response.body as ConflictBody).resolvedAt).not.toBeNull();
      expect(jira.doTransitionCalls).toHaveLength(0);
      await expect(columnOf(card.id)).resolves.toBe(done);
    });

    it('pushes the BoardSync version through the status sync, then refuses a second resolve', async () => {
      const { board, card, issueKey, done } = await conflictByLateUserMove();
      const [conflict] = await conflicts(board.id);

      const response = await resolve(conflict.id, 'boardsync').expect(200);

      expect(response.body).toMatchObject({ resolution: 'boardsync', resolvedById: admin.id });
      expect(jira.doTransitionCalls).toEqual([
        expect.objectContaining({ issueIdOrKey: issueKey, transitionId: transition(DONE).id }),
      ]);
      expect(jira.statuses.get(issueKey)).toBe(DONE);
      await expect(columnOf(card.id)).resolves.toBe(done);
      const rows = await logsFor(card.id);
      expect(rows[rows.length - 1]).toMatchObject({
        status: SyncStatus.SUCCESS,
        payload: expect.objectContaining({ outcome: 'transitioned' }) as unknown,
      });

      await resolve(conflict.id, 'jira').expect(409);
    });

    it('answers 502 and keeps the conflict open when Jira rejects the push', async () => {
      const { board, card, doing } = await conflictByLateUserMove();
      const [conflict] = await conflicts(board.id);
      jira.doTransitionError = new JiraServerError(503, 1, 1);

      await resolve(conflict.id, 'boardsync').expect(502);

      await expect(columnOf(card.id)).resolves.toBe(doing);
      const [after] = await conflicts(board.id);
      expect(after).toMatchObject({ resolution: 'jira', resolvedAt: null });
    });

    it('lets only admins resolve and validates the resolution', async () => {
      const { board } = await conflictByLateUserMove();
      const [conflict] = await conflicts(board.id);

      await resolve(conflict.id, 'jira', member).expect(403);
      await resolve(conflict.id, 'jira', stranger).expect(404);
      await resolve(conflict.id, 'both').expect(400);
      await resolve('00000000-0000-4000-8000-000000000000', 'jira').expect(404);
    });
  });
});
