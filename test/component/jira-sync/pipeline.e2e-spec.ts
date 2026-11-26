import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { CardEntity } from '@/modules/boards/infrastructure/persistence/card.entity';
import { JiraConnectionEntity } from '@/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import {
  SyncLogEntity,
  SyncStatus,
} from '@/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import { SyncOutboxEntity } from '@common/outbox/infrastructure/persistence/sync-outbox.entity';
import { JiraStub, JiraStatus, JiraTransition } from './support/jira-stub';
import { SeedContext, seedBoard, seedCard, waitFor, waitForCall } from './support/seed';
import {
  bearer,
  BoardBody,
  createBoard,
  createCard,
  PREFIX,
  registerUser,
  TestUser,
} from '../../helpers';

const CLOUD_ID = 'cloud-component-test';

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

describe('jira-sync pipeline (component, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let issueCounter = 0;

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

  const linkedBoard = async (): Promise<BoardBody> => {
    const seeded = await seedBoard(ctx, 'Pipeline board', 'PIPE', ALL_STATUSES);
    return seeded.board;
  };

  const linkedCard = async (boardId: string, columnId: string, issueKey?: string) => {
    const key = issueKey ?? `PIPE-${++issueCounter}`;
    const seeded = await seedCard(
      ctx,
      { board: { id: boardId } as BoardBody, projectKey: 'PIPE', cloudId: CLOUD_ID },
      columnId,
      `Card ${issueCounter}`,
      key,
      String(10000 + issueCounter),
      TODO,
      ALL_STATUSES.map(makeTransition),
    );
    return { card: seeded.card, issueKey: seeded.issueKey };
  };

  const moveCard = (user: TestUser, cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(user))
      .send({ columnId, position: 0 })
      .expect(200);

  const addComment = (user: TestUser, cardId: string, text: string) =>
    request(server)
      .post(`${PREFIX}/cards/${cardId}/comments`)
      .set(bearer(user))
      .send({ text })
      .expect(201);

  const getOutboxRows = (boardId: string) =>
    dataSource
      .getRepository(SyncOutboxEntity)
      .find({ where: { boardId }, order: { sequence: 'ASC' } });

  const getSyncLogs = (cardId: string) =>
    dataSource.getRepository(SyncLogEntity).find({
      where: { mapping: { cardId } },
      order: { createdAt: 'ASC' },
    });

  beforeAll(async () => {
    process.env.OUTBOX_POLL_INTERVAL_SECONDS = '0';
    await stub.start();
    process.env.JIRA_AUTH_BASE_URL = stub.url;
    process.env.JIRA_API_BASE_URL = stub.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    worker = app.get(OutboxWorker);

    const outboxConfig = app.get<OutboxConfig>(OUTBOX_CONFIG);
    console.log('Outbox config pollIntervalSeconds:', outboxConfig.pollIntervalSeconds);

    admin = await registerUser(app, 'pipeline-admin');
  });

  afterAll(async () => {
    await worker.stop();
    await app.close();
    await stub.stop();
    delete process.env.JIRA_AUTH_BASE_URL;
    delete process.env.JIRA_API_BASE_URL;
    delete process.env.OUTBOX_POLL_INTERVAL_SECONDS;
  });

  beforeEach(() => {
    stub.reset();
    stub.setMode('normal');
    stub.seedProject({
      id: '10000',
      key: 'PIPE',
      name: 'Pipeline Project',
      statuses: ALL_STATUSES,
    });
    issueCounter = 0;
  });

  describe('jira-oauth-connection: OAuth connect via public API', () => {
    it('jira-oauth-connection: connect -> tokens never appear in API responses', async () => {
      stub.setMode('normal');

      const oauthBoard = await createBoard(app, admin, 'OAuth board');
      const startResp = await request(server)
        .get(`${PREFIX}/jira/oauth/start`)
        .query({ boardId: oauthBoard.id })
        .set(bearer(admin))
        .expect(200);
      expect(startResp.body).toHaveProperty('authorizeUrl');
      expect(startResp.body.authorizeUrl).toContain(stub.url);
      expect(startResp.body).not.toHaveProperty('access_token');
      expect(startResp.body).not.toHaveProperty('refresh_token');

      const state = new URL(startResp.body.authorizeUrl).searchParams.get('state');
      if (!state) throw new Error('No state in OAuth URL');

      await request(server)
        .get(`${PREFIX}/jira/oauth/callback`)
        .query({ code: 'good-code', state })
        .set(bearer(admin))
        .expect(200);

      const connResp = await request(server)
        .get(`${PREFIX}/jira/connection`)
        .query({ boardId: oauthBoard.id })
        .set(bearer(admin))
        .expect(200);
      expect(connResp.body).toHaveProperty('connected', true);
      expect(connResp.body).not.toHaveProperty('accessToken');
      expect(connResp.body).not.toHaveProperty('refreshToken');
    });
  });

  describe('jira-oauth-connection: Token refresh when access token expired', () => {
    it('jira-oauth-connection: expired access token triggers refresh then retried call', async () => {
      const b = await linkedBoard();
      const { card, issueKey } = await linkedCard(b.id, b.columns[0].id);

      const conn = await dataSource
        .getRepository(JiraConnectionEntity)
        .findOne({ where: { boardId: b.id } });
      expect(conn).toBeTruthy();
      conn.expiresAt = new Date(Date.now() - 1000);
      await dataSource.getRepository(JiraConnectionEntity).save(conn);

      await moveCard(admin, card.id, b.columns[1].id);
      await worker.drain();

      const rows = await getOutboxRows(b.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('SENT');

      const tokenCalls = stub.findCalls(
        (c) =>
          c.path === '/oauth/token' &&
          c.body &&
          (c.body as Record<string, string>).grant_type === 'refresh_token',
      );
      expect(tokenCalls.length).toBeGreaterThanOrEqual(1);
      expect(tokenCalls[0].body).toHaveProperty('refresh_token', 'refresh-from-stub');

      const transitionCalls = stub.findCalls(
        (c) => c.path.includes('/transitions') && c.method === 'POST',
      );
      expect(transitionCalls.length).toBe(1);
      expect(stub.issues.get(issueKey)?.status.id).toBe(DOING.id);
    });
  });

  describe('jira-issue-import: Link project, map statuses, import issues', () => {
    it('jira-issue-import: import N issues -> cards in mapped columns; re-import creates no duplicates', async () => {
      const b = await linkedBoard();
      stub.seedIssue({
        id: '10002',
        key: 'PIPE-2',
        summary: 'Import issue 2',
        status: DOING,
        assignee: null,
        reporter: { accountId: 'stub-user', displayName: 'Stub User', active: true },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      stub.seedTransitions('PIPE-2', ALL_STATUSES.map(makeTransition));

      const importResp = await request(server)
        .post(`${PREFIX}/jira/import`)
        .set(bearer(admin))
        .send({ boardId: b.id, projectKey: 'PIPE' })
        .expect(200);
      expect(importResp.body.imported).toBeGreaterThanOrEqual(1);

      const cardsAfterImport = await dataSource
        .getRepository(CardEntity)
        .find({ where: { boardId: b.id } });
      const initialCount = cardsAfterImport.length;

      const importResp2 = await request(server)
        .post(`${PREFIX}/jira/import`)
        .set(bearer(admin))
        .send({ boardId: b.id, projectKey: 'PIPE' })
        .expect(200);
      expect(importResp2.body.imported).toBe(0);

      const cardsAfterReimport = await dataSource
        .getRepository(CardEntity)
        .find({ where: { boardId: b.id } });
      expect(cardsAfterReimport.length).toBe(initialCount);
    });
  });

  describe('jira-status-sync: User moves a synced card', () => {
    it('jira-status-sync: move -> OutboxWorker processes transition', async () => {
      const b = await linkedBoard();
      const { card } = await linkedCard(b.id, b.columns[0].id);

      await moveCard(admin, card.id, b.columns[1].id);
      await worker.drain();

      const queued = await getOutboxRows(b.id);
      expect(queued).toHaveLength(1);
      expect(queued[0].status).toBe('SENT');

      const transitionCalls = stub.findCalls(
        (c) => c.path.includes('/transitions') && c.method === 'POST',
      );
      expect(transitionCalls.length).toBe(1);
      expect(transitionCalls[0].body).toHaveProperty('transition.id', makeTransition(DOING).id);

      const logs = await getSyncLogs(card.id);
      const sentLog = logs.find((l) => l.status === SyncStatus.SUCCESS);
      expect(sentLog).toBeTruthy();
      expect(sentLog.payload).toHaveProperty('outcome', 'transitioned');
    });
  });

  describe('jira-comment-sync: User comments on a synced card', () => {
    it('jira-comment-sync: comment -> one comment POST on the stub', async () => {
      const b = await linkedBoard();
      const { card } = await linkedCard(b.id, b.columns[0].id);

      await addComment(admin, card.id, 'Hello from BoardSync');
      await waitForCall(stub, (c) => c.path.includes('/comment') && c.method === 'POST', 5000);
      await waitFor(async () => {
        const logs = await getSyncLogs(card.id);
        return logs.some((l) => l.status === SyncStatus.SUCCESS);
      }, 5000);

      const commentCalls = stub.findCalls(
        (c) => c.path.includes('/comment') && c.method === 'POST',
      );
      expect(commentCalls.length).toBe(1);
      expect(commentCalls[0].body).toHaveProperty('body');

      const logs = await getSyncLogs(card.id);
      const successLog = logs.find((l) => l.status === SyncStatus.SUCCESS);
      expect(successLog).toBeTruthy();
      expect(successLog.payload).toHaveProperty('jiraCommentId');
    });
  });

  describe('jira-comment-sync: Card without Jira link', () => {
    it('jira-comment-sync: unlinked card -> zero stub calls', async () => {
      const b = await createBoard(app, admin, 'Unlinked board');
      const card = await createCard(app, admin, b.columns[0].id, 'Unlinked card');

      await addComment(admin, card.id, 'No Jira link');
      await new Promise((resolve) => setTimeout(resolve, 500));

      const logs = await getSyncLogs(card.id);
      expect(logs).toHaveLength(0);

      const allCalls = stub.findCalls();
      const commentCalls = allCalls.filter(
        (c) => c.path.includes('/comment') && c.method === 'POST',
      );
      expect(commentCalls.length).toBe(0);
    });
  });
});
