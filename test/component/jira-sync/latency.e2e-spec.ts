import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import {
  SyncLogEntity,
  SyncStatus,
} from '@/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import { JiraStub, JiraStatus, JiraTransition } from './support/jira-stub';
import { SeedContext, seedBoard, seedCard, waitFor, waitForCall } from './support/seed';
import { bearer, BoardBody, PREFIX, registerUser, TestUser } from '../../helpers';

const CLOUD_ID = 'cloud-latency-test';
const RUNS = 5;
const BUDGET_MS = 5_000;

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

describe('jira-sync latency (component, real gateway + stub, real timers)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let board: BoardBody;
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

  const linkedCard = async () => {
    const issueKey = `LAT-${++issueCounter}`;
    const seeded = await seedCard(
      ctx,
      { board, projectKey: 'LAT', cloudId: CLOUD_ID },
      board.columns[0].id,
      `Latency card ${issueCounter}`,
      issueKey,
      String(20_000 + issueCounter),
      TODO,
      ALL_STATUSES.map(makeTransition),
    );
    return { card: seeded.card, issueKey };
  };

  const moveCard = (cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 })
      .expect(200);

  const addComment = (cardId: string, text: string) =>
    request(server)
      .post(`${PREFIX}/cards/${cardId}/comments`)
      .set(bearer(admin))
      .send({ text })
      .expect(201);

  beforeAll(async () => {
    process.env.OUTBOX_POLL_INTERVAL_SECONDS = '1';
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

    const outbox = app.get<OutboxConfig>(OUTBOX_CONFIG);
    expect(outbox.pollIntervalSeconds).toBe(1);

    admin = await registerUser(app, 'latency-admin');
    const seeded = await seedBoard(ctx, 'Latency board', 'LAT', ALL_STATUSES);
    board = seeded.board;
  });

  beforeEach(() => {
    stub.reset();
    stub.seedProject({
      id: '20000',
      key: 'LAT',
      name: 'Latency Project',
      statuses: ALL_STATUSES,
    });
  });

  afterAll(async () => {
    await worker.stop();
    await app.close();
    await stub.stop();
    delete process.env.JIRA_AUTH_BASE_URL;
    delete process.env.JIRA_API_BASE_URL;
    delete process.env.OUTBOX_POLL_INTERVAL_SECONDS;
  });

  it('jira-status-sync: move reaches Jira in under 5s on the kick path (5 runs)', async () => {
    const latencies: number[] = [];

    for (let run = 1; run <= RUNS; run++) {
      const { card, issueKey } = await linkedCard();
      const t0 = Date.now();

      await moveCard(card.id, board.columns[1].id);

      const call = await waitForCall(
        stub,
        (c) => c.method === 'POST' && c.path.endsWith(`/issue/${issueKey}/transitions`),
        BUDGET_MS,
      );
      latencies.push(call.receivedAt - t0);

      expect(call.body).toHaveProperty('transition.id', makeTransition(DOING).id);
      expect(stub.issues.get(issueKey)?.status.id).toBe(DOING.id);
    }

    console.log(`move -> Jira transition latency (ms): ${latencies.join(', ')}`);
    expect(Math.max(...latencies)).toBeLessThan(BUDGET_MS);
  });

  it('jira-comment-sync: comment reaches Jira in under 5s (5 runs)', async () => {
    const latencies: number[] = [];

    for (let run = 1; run <= RUNS; run++) {
      const { card, issueKey } = await linkedCard();
      const t0 = Date.now();

      await addComment(card.id, `Latency comment ${run}`);

      const call = await waitForCall(
        stub,
        (c) => c.method === 'POST' && c.path.endsWith(`/issue/${issueKey}/comment`),
        BUDGET_MS,
      );
      latencies.push(call.receivedAt - t0);

      await waitFor(async () => {
        const logs = await dataSource.getRepository(SyncLogEntity).find({
          where: { mapping: { cardId: card.id } },
        });
        return logs.some((log) => log.status === SyncStatus.SUCCESS);
      }, BUDGET_MS);
    }

    console.log(`comment -> Jira comment POST latency (ms): ${latencies.join(', ')}`);
    expect(Math.max(...latencies)).toBeLessThan(BUDGET_MS);
  });
});
