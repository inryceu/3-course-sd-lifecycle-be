import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import {
  loadOutboxConfig,
  OUTBOX_CLOCK,
  OUTBOX_CONFIG,
  OutboxClock,
  OutboxConfig,
} from '@common/outbox/outbox.config';
import { SyncOutboxEntity } from '@common/outbox/infrastructure/persistence/sync-outbox.entity';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { JiraStub, JiraStatus, JiraTransition } from './support/jira-stub';
import { SeededBoard, SeedContext, seedBoard, seedCard } from './support/seed';
import { bearer, CardBody, PREFIX, registerUser, TestUser } from '../../helpers';

const CLOUD_ID = 'cloud-conflict-test';
const SITE = 'https://stub.atlassian.net';
const PROJECT_KEY = 'CNF';

function makeStatus(id: string, name: string, key: string): JiraStatus {
  return {
    id,
    name,
    statusCategory: { id: key === 'done' ? 3 : key === 'indeterminate' ? 2 : 1, key, name: key },
  };
}

const TODO = makeStatus('1', 'To Do', 'new');
const DOING = makeStatus('3', 'In Progress', 'indeterminate');
const DONE = makeStatus('9', 'Done', 'done');
const ALL_STATUSES = [TODO, DOING, DONE];

function makeTransition(to: JiraStatus): JiraTransition {
  return {
    id: `${to.id}1`,
    name: `To ${to.name}`,
    to,
    hasScreen: false,
    isGlobal: true,
    isInitial: false,
    isConditional: false,
    isAvailable: true,
  };
}

interface WebhookPayload {
  webhookEvent: string;
  timestamp: number;
  issue: {
    id: string;
    self: string;
    key: string;
    fields: { status: JiraStatus };
  };
  changelog: {
    id: string;
    items: Array<Record<string, string>>;
  };
}

interface ConflictPageBody {
  items: Array<{
    id: string;
    resolution: string;
    boardStatus: string;
    jiraStatus: string;
    jiraIssueKey: string;
  }>;
}

interface NotificationPageBody {
  items: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
}

class MutableClock implements OutboxClock {
  private current: Date;

  constructor(start: Date = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('jira-sync conflict resolution (component, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  const clock = new MutableClock();
  const webhookSecret = process.env.WEBHOOK_SECRET ?? '';
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let issueCounter = 0;
  let boardCounter = 0;

  const ctx: SeedContext = {
    get app() {
      return app;
    },
    get server() {
      return server;
    },
    get dataSource() {
      return dataSource;
    },
    get stub() {
      return stub;
    },
    get admin() {
      return admin;
    },
  };

  const linkedBoard = (): Promise<SeededBoard> =>
    seedBoard(ctx, `Conflict board ${++boardCounter}`, PROJECT_KEY, ALL_STATUSES);

  const linkedCard = async (
    seeded: SeededBoard,
    columnId: string,
  ): Promise<{ card: CardBody; issueKey: string; issueId: string }> => {
    const issueKey = `${PROJECT_KEY}-${++issueCounter}`;
    const issueId = String(30000 + issueCounter);
    const result = await seedCard(
      ctx,
      seeded,
      columnId,
      `Conflict card ${issueCounter}`,
      issueKey,
      issueId,
      TODO,
      ALL_STATUSES.map(makeTransition),
    );
    return { card: result.card, issueKey, issueId };
  };

  const buildPayload = (
    issueKey: string,
    issueId: string,
    status: JiraStatus,
    timestamp: number,
    changelogId: string,
  ): WebhookPayload => ({
    webhookEvent: 'jira:issue_updated',
    timestamp,
    issue: {
      id: issueId,
      self: `${SITE}/rest/api/2/issue/${issueId}`,
      key: issueKey,
      fields: { status },
    },
    changelog: {
      id: changelogId,
      items: [
        {
          field: 'status',
          fieldtype: 'jira',
          from: TODO.id,
          fromString: TODO.name,
          to: status.id,
          toString: status.name,
        },
      ],
    },
  });

  const sign = (raw: string): string =>
    `sha256=${createHmac('sha256', webhookSecret).update(raw).digest('hex')}`;

  const deliver = (payload: WebhookPayload) => {
    const raw = JSON.stringify(payload);
    return request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', sign(raw))
      .send(raw);
  };

  const moveCard = (cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 })
      .expect(200);

  const getCard = async (cardId: string): Promise<CardBody> => {
    const response = await request(server)
      .get(`${PREFIX}/cards/${cardId}`)
      .set(bearer(admin))
      .expect(200);
    return response.body as CardBody;
  };

  const outboxRows = (boardId: string) =>
    dataSource
      .getRepository(SyncOutboxEntity)
      .find({ where: { boardId }, order: { sequence: 'ASC' } });

  const transitionPosts = () =>
    stub.findCalls((c) => c.method === 'POST' && c.path.endsWith('/transitions'));

  beforeAll(async () => {
    expect(webhookSecret.length).toBeGreaterThanOrEqual(32);

    await stub.start();
    process.env.JIRA_AUTH_BASE_URL = stub.url;
    process.env.JIRA_API_BASE_URL = stub.url;

    const config: OutboxConfig = { ...loadOutboxConfig(), pollIntervalSeconds: 0 };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OUTBOX_CONFIG)
      .useValue(config)
      .overrideProvider(OUTBOX_CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    worker = app.get(OutboxWorker);
    admin = await registerUser(app, 'conflict-admin');
  });

  afterAll(async () => {
    await worker.stop();
    await app.close();
    await stub.stop();
    delete process.env.JIRA_AUTH_BASE_URL;
    delete process.env.JIRA_API_BASE_URL;
  });

  beforeEach(() => {
    stub.reset();
  });

  it('local move then Jira webhook within 5 s -> Jira wins without a transition', async () => {
    const seeded = await linkedBoard();
    const b = seeded.board;
    const { card, issueKey, issueId } = await linkedCard(seeded, b.columns[0].id);
    const warn = jest.spyOn(Logger.prototype, 'warn');

    try {
      // Spec order: the user moves first...
      await moveCard(card.id, b.columns[1].id);

      const queued = await outboxRows(b.id);
      expect(queued).toHaveLength(1);
      expect(queued[0].status).toBe('PENDING');
      const moveAt = new Date(String(queued[0].payload['occurredAt'])).getTime();

      // ...and Jira reports the issue in another status 2 s later (same clock the detector reads).
      const issue = stub.issues.get(issueKey);
      expect(issue).toBeTruthy();
      stub.seedIssue({ ...issue, status: DONE });
      await deliver(
        buildPayload(issueKey, issueId, DONE, moveAt + 2_000, 'chg-local-first'),
      ).expect(200);

      // The inbound sync moves the card to Done; the pending outbound move must not be sent.
      expect((await getCard(card.id)).columnId).toBe(b.columns[2].id);

      await worker.drain();

      expect((await getCard(card.id)).columnId).toBe(b.columns[2].id);
      expect(transitionPosts()).toHaveLength(0);
      expect(stub.issues.get(issueKey)?.status.id).toBe(DONE.id);

      const sent = await outboxRows(b.id);
      expect(sent).toHaveLength(1);
      expect(sent[0].status).toBe('SENT');

      const conflicts = await request(server)
        .get(`${PREFIX}/jira/conflicts`)
        .query({ boardId: b.id })
        .set(bearer(admin))
        .expect(200);
      const conflictItems = (conflicts.body as ConflictPageBody).items;
      expect(conflictItems).toHaveLength(1);
      expect(conflictItems[0].resolution).toBe('jira');
      expect(conflictItems[0].boardStatus).toBe(b.columns[1].title);
      expect(conflictItems[0].jiraStatus).toBe(DONE.name);
      expect(conflictItems[0].jiraIssueKey).toBe(issueKey);

      const notifications = await request(server)
        .get(`${PREFIX}/notifications`)
        .set(bearer(admin))
        .expect(200);
      const conflictNotification = (notifications.body as NotificationPageBody).items.find(
        (item) => item.type === 'jira.conflict',
      );
      expect(conflictNotification).toBeTruthy();
      expect(conflictNotification.payload['conflictId']).toBe(conflictItems[0].id);

      const logged = warn.mock.calls.map((call) => String(call[0]));
      expect(logged.some((line) => /Sync conflict .* Jira wins/.test(line))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('Jira webhook first, local move within 5 s -> Jira wins without a transition', async () => {
    const seeded = await linkedBoard();
    const b = seeded.board;
    const { card, issueKey, issueId } = await linkedCard(seeded, b.columns[0].id);

    const jiraAt = Date.now();
    const issue = stub.issues.get(issueKey);
    expect(issue).toBeTruthy();
    stub.seedIssue({ ...issue, status: DONE });
    await deliver(buildPayload(issueKey, issueId, DONE, jiraAt, 'chg-jira-first')).expect(200);
    expect((await getCard(card.id)).columnId).toBe(b.columns[2].id);

    await moveCard(card.id, b.columns[1].id);

    const queued = await outboxRows(b.id);
    expect(queued).toHaveLength(1);
    const moveAt = new Date(String(queued[0].payload['occurredAt'])).getTime();
    expect(Math.abs(moveAt - jiraAt)).toBeLessThanOrEqual(5_000);

    await worker.drain();

    expect((await getCard(card.id)).columnId).toBe(b.columns[2].id);
    expect(transitionPosts()).toHaveLength(0);
    expect(stub.issues.get(issueKey)?.status.id).toBe(DONE.id);

    const sent = await outboxRows(b.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe('SENT');

    const conflicts = await request(server)
      .get(`${PREFIX}/jira/conflicts`)
      .query({ boardId: b.id })
      .set(bearer(admin))
      .expect(200);
    const conflictItems = (conflicts.body as ConflictPageBody).items;
    expect(conflictItems).toHaveLength(1);
    expect(conflictItems[0].resolution).toBe('jira');
    expect(conflictItems[0].boardStatus).toBe(b.columns[1].title);
    expect(conflictItems[0].jiraStatus).toBe(DONE.name);
    expect(conflictItems[0].jiraIssueKey).toBe(issueKey);
  });
});
