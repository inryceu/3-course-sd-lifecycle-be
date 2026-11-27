import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { CardEntity } from '@/modules/boards/infrastructure/persistence/card.entity';
import { JiraStub, JiraStatus, JiraTransition } from '../component/jira-sync/support/jira-stub';
import { SeedContext, seedBoard } from '../component/jira-sync/support/seed';
import { bearer, BoardBody, PREFIX, registerUser, TestUser } from '../helpers';
import { measure } from './support/latency';

const CLOUD_ID = 'cloud-system-test';

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

describe('jira-import (system, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
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

  const linkedBoard = async (): Promise<BoardBody> => {
    const seeded = await seedBoard(ctx, 'Import board', 'IMP', ALL_STATUSES);
    return seeded.board;
  };

  const seedIssues = (count: number) => {
    for (let i = 1; i <= count; i++) {
      const issueKey = `IMP-${i}`;
      const issueId = String(50000 + i);
      stub.seedIssue({
        id: issueId,
        key: issueKey,
        summary: `Import issue ${i}`,
        status: i % 3 === 0 ? DONE : i % 3 === 1 ? TODO : DOING,
        assignee: null,
        reporter: { accountId: 'stub-user', displayName: 'Stub User', active: true },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      stub.seedTransitions(issueKey, ALL_STATUSES.map(makeTransition));
    }
  };

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
    expect(outboxConfig.pollIntervalSeconds).toBe(0);

    admin = await registerUser(app, 'import-admin');
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
      id: '20000',
      key: 'IMP',
      name: 'Import Project',
      statuses: ALL_STATUSES,
    });
  });

  it('imports 55 issues (more than page size 50) and maps statuses to columns; re-import is idempotent', async () => {
    // 1. Seed 55 issues in the stub
    seedIssues(55);

    // 2. Link a board to the Jira project via OAuth (seedBoard does this)
    const board = await linkedBoard();

    // 3. Perform the import and measure latency (no budget assertion)
    const importResp = await measure('jira-import', async () => {
      return request(server)
        .post(`${PREFIX}/jira/import`)
        .set(bearer(admin))
        .send({ boardId: board.id, projectKey: 'IMP' })
        .expect(200);
    });

    const searchCalls = stub.findCalls((c) => c.method === 'GET' && c.path.includes('/search/jql'));

    // Per spec: first import processes 55 issues, all created
    expect(importResp.body).toEqual({
      imported: 55,
      created: 55,
      updated: 0,
      skipped: 0,
    });

    // Prove pagination: exactly 2 search calls (55 issues, page size 50)
    expect(searchCalls.length).toBe(2);

    // 4. Assert cards and columns via public API
    const boardsResp = await request(server)
      .get(`${PREFIX}/boards/${board.id}`)
      .set(bearer(admin))
      .expect(200);

    const boardWithColumns = boardsResp.body as BoardBody & {
      columns: Array<{
        id: string;
        title: string;
        type: string;
        cards: Array<{ id: string; jiraIssueKey: string }>;
      }>;
    };
    expect(boardWithColumns.columns).toHaveLength(3);

    // Find columns by type
    const todoCol = boardWithColumns.columns.find((c) => c.type === 'TODO');
    const inProgressCol = boardWithColumns.columns.find((c) => c.type === 'IN_PROGRESS');
    const doneCol = boardWithColumns.columns.find((c) => c.type === 'DONE');

    expect(todoCol).toBeDefined();
    expect(inProgressCol).toBeDefined();
    expect(doneCol).toBeDefined();

    // Count cards in each column based on status mapping
    // Issues with status TODO (new) -> TODO column
    // Issues with status DOING (indeterminate) -> IN_PROGRESS column
    // Issues with status DONE (done) -> DONE column
    const todoCards = todoCol?.cards ?? [];
    const inProgressCards = inProgressCol?.cards ?? [];
    const doneCards = doneCol?.cards ?? [];

    expect(todoCards.length).toBe(19);
    expect(inProgressCards.length).toBe(18);
    expect(doneCards.length).toBe(18);

    // Verify each card has a jiraIssueKey and matches the seeded keys
    const allCards = [...todoCards, ...inProgressCards, ...doneCards];
    expect(allCards.length).toBe(55);
    const issueKeys = new Set(allCards.map((c) => c.jiraIssueKey));
    expect(issueKeys.size).toBe(55);

    // 5. Run import again, assert idempotency (no duplicates)
    const importResp2 = await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'IMP' })
      .expect(200);

    // Per spec: re-import finds all 55 already exist, skips them
    expect(importResp2.body).toEqual({
      imported: 0,
      created: 0,
      updated: 0,
      skipped: 55,
    });

    // Verify no duplicate cards in DB
    const cardsInDb = await dataSource
      .getRepository(CardEntity)
      .find({ where: { boardId: board.id } });
    expect(cardsInDb.length).toBe(55);
  });
});
