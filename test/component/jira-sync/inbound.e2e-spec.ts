import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { SyncOutboxEntity } from '@common/outbox/infrastructure/persistence/sync-outbox.entity';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { BoardEntity } from '@/modules/boards/infrastructure/persistence/board.entity';
import { CardEntity } from '@/modules/boards/infrastructure/persistence/card.entity';
import { JiraConnectionEntity } from '@/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '@/modules/jira-sync/infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStub, JiraStatus } from './support/jira-stub';
import {
  bearer,
  BoardBody,
  CardBody,
  createBoard,
  createCard,
  PREFIX,
  registerUser,
  TestUser,
} from '../../helpers';

const CLOUD_ID = 'cloud-inbound-test';
const SITE = 'https://inbound.atlassian.net';
const PROJECT_KEY = 'INB';

function makeStatus(id: string, name: string, key: string): JiraStatus {
  return {
    id,
    name,
    statusCategory: { id: key === 'done' ? 3 : key === 'indeterminate' ? 2 : 1, key, name: key },
  };
}

const TODO = makeStatus('1', 'To Do', 'new');
const DOING = makeStatus('3', 'In Progress', 'indeterminate');

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

interface MovedEvent {
  origin?: string;
  payload?: { card?: { id?: string } };
}

describe('jira-sync inbound webhooks (component, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  const webhookSecret = process.env.WEBHOOK_SECRET ?? '';
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let movedEvents: MovedEvent[] = [];
  let issueCounter = 0;

  const linkedBoard = async (): Promise<BoardBody> => {
    const b = await createBoard(app, admin, 'Inbound board');
    await dataSource.getRepository(BoardEntity).update(b.id, { jiraProjectKey: PROJECT_KEY });
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId: b.id,
      connectedById: admin.id,
      cloudId: CLOUD_ID,
      siteUrl: SITE,
      accessTokenEnc: 'enc-access',
      refreshTokenEnc: 'enc-refresh',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'manage:jira-webhook', 'offline_access'],
      connectedAt: new Date(),
    });
    return b;
  };

  const linkedCard = async (
    boardId: string,
    columnId: string,
  ): Promise<{ card: CardBody; issueKey: string; issueId: string }> => {
    const card = await createCard(app, admin, columnId, `Inbound card ${++issueCounter}`);
    const issueKey = `${PROJECT_KEY}-${issueCounter}`;
    const issueId = String(20000 + issueCounter);
    await dataSource.getRepository(CardEntity).update(card.id, { jiraIssueKey: issueKey });
    await dataSource.getRepository(JiraIssueMappingEntity).save({
      boardId,
      cardId: card.id,
      jiraIssueKey: issueKey,
      jiraIssueId: issueId,
      jiraProjectKey: PROJECT_KEY,
    });
    return { card, issueKey, issueId };
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

  const deliver = (payload: WebhookPayload, signature?: string) => {
    const raw = JSON.stringify(payload);
    return request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature ?? sign(raw))
      .send(raw);
  };

  const getCard = async (cardId: string): Promise<CardBody> => {
    const response = await request(server)
      .get(`${PREFIX}/cards/${cardId}`)
      .set(bearer(admin))
      .expect(200);
    return response.body as CardBody;
  };

  const outboxRows = (boardId: string) =>
    dataSource.getRepository(SyncOutboxEntity).find({ where: { boardId } });

  const movedFor = (cardId: string) =>
    movedEvents.filter((event) => event.origin === 'jira' && event.payload?.card?.id === cardId);

  beforeAll(async () => {
    expect(webhookSecret.length).toBeGreaterThanOrEqual(32);

    await stub.start();
    process.env.JIRA_AUTH_BASE_URL = stub.url;
    process.env.JIRA_API_BASE_URL = stub.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    worker = app.get(OutboxWorker);
    app.get(EventEmitter2).on('card.moved', (event: MovedEvent) => movedEvents.push(event));
    admin = await registerUser(app, 'inbound-admin');
  });

  afterAll(async () => {
    await app.close();
    await stub.stop();
    delete process.env.JIRA_AUTH_BASE_URL;
    delete process.env.JIRA_API_BASE_URL;
  });

  beforeEach(() => {
    stub.reset();
    movedEvents = [];
  });

  it('status changelog moves the synced card and writes no outbound intent', async () => {
    const b = await linkedBoard();
    const { card, issueKey, issueId } = await linkedCard(b.id, b.columns[0].id);

    await deliver(buildPayload(issueKey, issueId, DOING, Date.now(), 'chg-move-1')).expect(200);

    const moved = await getCard(card.id);
    expect(moved.columnId).toBe(b.columns[1].id);
    expect(moved.jiraIssueKey).toBe(issueKey);
    expect(await outboxRows(b.id)).toHaveLength(0);
  });

  it('rejects a delivery with a bad HMAC signature without touching the card', async () => {
    const b = await linkedBoard();
    const { card, issueKey, issueId } = await linkedCard(b.id, b.columns[0].id);

    await deliver(
      buildPayload(issueKey, issueId, DOING, Date.now(), 'chg-bad-signature'),
      `sha256=${'0'.repeat(64)}`,
    ).expect(401);

    const unchanged = await getCard(card.id);
    expect(unchanged.columnId).toBe(b.columns[0].id);
    expect(movedFor(card.id)).toHaveLength(0);
    expect(await outboxRows(b.id)).toHaveLength(0);
  });

  it('applies a duplicate delivery once', async () => {
    const b = await linkedBoard();
    const { card, issueKey, issueId } = await linkedCard(b.id, b.columns[0].id);
    const payload = buildPayload(issueKey, issueId, DOING, Date.now(), 'chg-duplicate-1');

    await deliver(payload).expect(200);
    await deliver(payload).expect(200);

    const moved = await getCard(card.id);
    expect(moved.columnId).toBe(b.columns[1].id);
    expect(movedFor(card.id)).toHaveLength(1);
  });

  it('loop guard: an inbound move never produces an outbound transition', async () => {
    const b = await linkedBoard();
    const { card, issueKey, issueId } = await linkedCard(b.id, b.columns[0].id);

    await deliver(buildPayload(issueKey, issueId, DOING, Date.now(), 'chg-loop-guard')).expect(200);
    await worker.drain();

    expect((await getCard(card.id)).columnId).toBe(b.columns[1].id);
    expect(
      stub.findCalls((c) => c.method === 'POST' && c.path.endsWith('/transitions')),
    ).toHaveLength(0);
    expect(await outboxRows(b.id)).toHaveLength(0);
  });
});
