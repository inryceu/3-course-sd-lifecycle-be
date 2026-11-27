import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { DataSource } from 'typeorm';
import { JiraStub } from '../component/jira-sync/support/jira-stub';
import { SeedContext, seedBoard } from '../component/jira-sync/support/seed';
import { bearer, BoardBody, createCard, PREFIX, registerUser, TestUser } from '../helpers';
import { assertWithinBudget, record } from './support/latency';
import { createStatusFactory } from './support/status-factory';

const CLOUD_ID = 'cloud-outbound-test';
const BUDGET_MS = 5000;

interface BoardCard {
  id: string;
  jiraIssueKey: string | null;
}

interface BoardColumn {
  id: string;
  type: string;
  cards: BoardCard[];
}

interface BoardView {
  columns: BoardColumn[];
}

describe('jira-outbound (system, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  const { TODO, DOING, DONE, ALL_STATUSES, makeTransition } = createStatusFactory();

  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;

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

  const seedIssues = (count: number): void => {
    for (let i = 1; i <= count; i++) {
      const key = `OUT-${i}`;
      stub.seedIssue({
        id: String(70000 + i),
        key,
        summary: `Outbound issue ${i}`,
        status: i % 3 === 0 ? DONE : i % 3 === 1 ? TODO : DOING,
        assignee: null,
        reporter: { accountId: 'stub-user', displayName: 'Stub User', active: true },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      stub.seedTransitions(key, ALL_STATUSES.map(makeTransition));
    }
  };

  const linkedBoard = async (): Promise<BoardBody> => {
    const seeded = await seedBoard(ctx, 'Outbound board', 'OUT', ALL_STATUSES);
    return seeded.board;
  };

  const importBoard = async (boardId: string): Promise<void> => {
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId, projectKey: 'OUT' })
      .expect(200);
  };

  const getBoardView = async (boardId: string): Promise<BoardView> => {
    const resp = await request(server)
      .get(`${PREFIX}/boards/${boardId}`)
      .set(bearer(admin))
      .expect(200);
    return resp.body as BoardView;
  };

  const column = (view: BoardView, type: string): BoardColumn => {
    const found = view.columns.find((c) => c.type === type);
    if (!found) {
      throw new Error(`Column of type ${type} not found`);
    }
    return found;
  };

  const moveCard = (cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 })
      .expect(200);

  const transitionCalls = () =>
    stub.findCalls((c) => c.method === 'POST' && c.path.includes('/transitions'));

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

    expect(app.get<OutboxConfig>(OUTBOX_CONFIG).pollIntervalSeconds).toBe(0);

    admin = await registerUser(app, 'outbound-admin');
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
    stub.seedProject({ id: '40000', key: 'OUT', name: 'Outbound Project', statuses: ALL_STATUSES });
  });

  it('move linked card to another column -> stub receives transition (FR-06)', async () => {
    seedIssues(3);
    const board = await linkedBoard();
    await importBoard(board.id);

    const view = await getBoardView(board.id);
    const card = column(view, 'TODO').cards[0];
    const target = column(view, 'IN_PROGRESS');
    expect(card.jiraIssueKey).toBeTruthy();

    const tStart = Date.now();
    await moveCard(card.id, target.id);
    // Poll interval is 0 in tests: drain() stands in for the periodic worker.
    // Production adds up to OUTBOX_POLL_INTERVAL_SECONDS to this figure.
    await worker.drain();

    const calls = transitionCalls();
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.path).toContain(`/issue/${card.jiraIssueKey}/transitions`);
    expect(call.body).toHaveProperty('transition.id', makeTransition(DOING).id);

    record('move->stub', call.receivedAt - tStart);
    assertWithinBudget('move->stub', BUDGET_MS);

    // TODO(agent): assert the sync-log entry via GET /jira/sync-logs (see notes).
  });

  it('same-column move does NOT call Jira', async () => {
    seedIssues(1);
    const board = await linkedBoard();
    await importBoard(board.id);

    const view = await getBoardView(board.id);
    const todo = column(view, 'TODO');
    await moveCard(todo.cards[0].id, todo.id);
    await worker.drain();

    expect(transitionCalls()).toHaveLength(0);
  });

  it('manually created card on a linked board does NOT call Jira', async () => {
    const board = await linkedBoard();
    const view = await getBoardView(board.id);
    const todo = column(view, 'TODO');
    const inProgress = column(view, 'IN_PROGRESS');

    const card = await createCard(app, admin, todo.id, 'Manual card');
    await moveCard(card.id, inProgress.id);
    await worker.drain();

    expect(transitionCalls()).toHaveLength(0);
  });
});
