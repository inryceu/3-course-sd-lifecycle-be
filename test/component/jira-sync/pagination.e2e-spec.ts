import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { JiraStub, JiraStatus, JiraTransition } from './support/jira-stub';
import { SeedContext, seedBoard } from './support/seed';
import { bearer, BoardBody, PREFIX, registerUser, TestUser } from '../../helpers';

const CLOUD_ID = 'cloud-pagination-test';

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

describe('jira-sync pagination (component, real gateway + stub)', () => {
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
    const seeded = await seedBoard(ctx, 'Pagination board', 'PAGE', ALL_STATUSES);
    return seeded.board;
  };

  const seedIssues = (count: number) => {
    for (let i = 1; i <= count; i++) {
      const issueKey = `PAGE-${i}`;
      const issueId = String(60000 + i);
      stub.seedIssue({
        id: issueId,
        key: issueKey,
        summary: `Pagination issue ${i}`,
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

    admin = await registerUser(app, 'pagination-admin');
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
      id: '30000',
      key: 'PAGE',
      name: 'Pagination Project',
      statuses: ALL_STATUSES,
    });
  });

  it('search returns 55 unique issues across exactly 2 pages (page size 50)', async () => {
    // 1. Seed 55 issues in the stub
    seedIssues(55);

    // 2. Link a board to the Jira project via OAuth
    const board = await linkedBoard();

    // 3. Call the search endpoint directly via the gateway (through import)
    const importResp = await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'PAGE' })
      .expect(200);

    // 4. Verify the stub received exactly 2 search calls
    const searchCalls = stub.findCalls((c) => c.method === 'GET' && c.path.includes('/search/jql'));
    expect(searchCalls.length).toBe(2);

    // 5. Verify first page has 50 issues, second page has 5 issues
    type SearchResponse = {
      issues: Array<{ key: string }>;
      nextPageToken: string | null;
      isLast: boolean;
    };
    const page1Response = searchCalls[0].responseBody as SearchResponse;
    const page2Response = searchCalls[1].responseBody as SearchResponse;
    const page1Issues = page1Response.issues;
    const page2Issues = page2Response.issues;
    expect(page1Issues.length).toBe(50);
    expect(page2Issues.length).toBe(5);

    // 6. Verify all 55 issues are unique (no duplicates by key)
    const allIssueKeys = [...page1Issues, ...page2Issues].map((i) => i.key);
    const uniqueKeys = new Set(allIssueKeys);
    expect(uniqueKeys.size).toBe(55);
    expect(allIssueKeys.length).toBe(55);

    // 7. Verify pagination tokens
    expect(page1Response.nextPageToken).toBe('50');
    expect(page1Response.isLast).toBe(false);
    expect(page2Response.nextPageToken).toBeNull();
    expect(page2Response.isLast).toBe(true);

    // 8. Verify import processed exactly 55 issues (no duplicates)
    expect(importResp.body.imported).toBe(55);
    expect(importResp.body.created).toBe(55);
    expect(importResp.body.updated).toBe(0);
    expect(importResp.body.skipped).toBe(0);
  });
});
