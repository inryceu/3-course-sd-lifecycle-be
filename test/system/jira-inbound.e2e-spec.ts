import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { OUTBOX_CONFIG, OutboxConfig } from '@common/outbox/outbox.config';
import { OutboxWorker } from '@common/outbox/outbox.worker';
import { JiraStub, JiraStatus } from '../component/jira-sync/support/jira-stub';
import { SeedContext, seedBoard } from '../component/jira-sync/support/seed';
import { bearer, BoardBody, PREFIX, registerUser, TestUser } from '../helpers';
import { assertWithinBudget, record } from './support/latency';
import { createStatusFactory } from './support/status-factory';

const CLOUD_ID = 'cloud-inbound-test';
const BUDGET_MS = 5000;
const SIGNATURE_HEADER = 'X-Hub-Signature'; // VERIFY against test/jira-webhook.e2e-spec.ts
const MOVE_EVENT = 'card.moved'; // VERIFY against test/realtime.e2e-spec.ts
const JOIN_EVENT = 'board:join'; // VERIFY against test/realtime.e2e-spec.ts

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

describe('jira-inbound (system, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  const { TODO, DOING, DONE, ALL_STATUSES, makeTransition } = createStatusFactory();
  const webhookSecret = process.env.WEBHOOK_SECRET ?? '';
  const issueIds = new Map<string, string>();

  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let worker: OutboxWorker;
  let admin: TestUser;
  let baseUrl: string;
  const sockets: Socket[] = [];

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
    issueIds.clear();
    for (let i = 1; i <= count; i++) {
      const key = `INB-${i}`;
      const id = String(80000 + i);
      issueIds.set(key, id);
      stub.seedIssue({
        id,
        key,
        summary: `Inbound issue ${i}`,
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
    const seeded = await seedBoard(ctx, 'Inbound board', 'INB', ALL_STATUSES);
    return seeded.board;
  };

  const importBoard = async (boardId: string): Promise<void> => {
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId, projectKey: 'INB' })
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

  const buildPayload = (issueKey: string, to: JiraStatus, changelogId: string): string => {
    const issueId = issueIds.get(issueKey);
    const selfUrl = `https://stub.atlassian.net/rest/api/3/issue/${issueId}`;
    return JSON.stringify({
      webhookEvent: 'jira:issue_updated',
      timestamp: Date.now(),
      issue: {
        id: issueIds.get(issueKey),
        key: issueKey,
        self: selfUrl,
        fields: { status: to },
      },
      changelog: {
        id: changelogId,
        items: [
          {
            field: 'status',
            fieldtype: 'jira',
            from: TODO.id,
            fromString: TODO.name,
            to: to.id,
            toString: to.name,
          },
        ],
      },
    });
  };

  const sign = (raw: string): string =>
    `sha256=${createHmac('sha256', webhookSecret).update(raw).digest('hex')}`;

  const deliver = (raw: string, signature: string) =>
    request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set(SIGNATURE_HEADER, signature)
      .send(raw);

  const connectSocket = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(`${baseUrl}/realtime`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });

  const joinBoard = async (s: Socket, boardId: string): Promise<void> => {
    await s.emitWithAck(JOIN_EVENT, { boardId });
  };

  // Registered BEFORE the webhook is sent; resolves with the arrival time.
  const waitForMove = (s: Socket, timeoutMs = BUDGET_MS): Promise<number> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${MOVE_EVENT} not received`)), timeoutMs);
      s.once(MOVE_EVENT, () => {
        clearTimeout(timer);
        resolve(Date.now());
      });
    });

  const transitionCalls = () =>
    stub.findCalls((c) => c.method === 'POST' && c.path.includes('/transitions'));

  beforeAll(async () => {
    process.env.OUTBOX_POLL_INTERVAL_SECONDS = '0';
    await stub.start();
    process.env.JIRA_AUTH_BASE_URL = stub.url;
    process.env.JIRA_API_BASE_URL = stub.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true }); // VERIFY: how other webhook e2e creates the app
    configureApp(app);
    await app.init();
    await app.listen(0); // VERIFY: same as realtime.e2e-spec.ts
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    worker = app.get(OutboxWorker);
    expect(app.get<OutboxConfig>(OUTBOX_CONFIG).pollIntervalSeconds).toBe(0);

    admin = await registerUser(app, 'inbound-admin');
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
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
    stub.seedProject({ id: '50000', key: 'INB', name: 'Inbound Project', statuses: ALL_STATUSES });
  });

  it('webhook status change -> card moves and socket event arrives (FR-07)', async () => {
    seedIssues(3);
    const board = await linkedBoard();
    await importBoard(board.id);

    const view = await getBoardView(board.id);
    const card = column(view, 'TODO').cards[0];
    const target = column(view, 'IN_PROGRESS');
    const issueKey = card.jiraIssueKey;
    if (!issueKey) {
      throw new Error('Imported card has no jiraIssueKey');
    }

    const socket = await connectSocket(admin.token); // VERIFY: token field on TestUser
    await joinBoard(socket, board.id);
    const moved = waitForMove(socket);

    const raw = buildPayload(issueKey, DOING, 'chg-1');
    const tStart = Date.now();
    await deliver(raw, sign(raw)).expect(200); // VERIFY: expected status from spec
    const dbMs = Date.now() - tStart;

    const after = await getBoardView(board.id);
    expect(column(after, 'IN_PROGRESS').cards.map((c) => c.id)).toContain(card.id);
    expect(column(after, 'TODO').cards.map((c) => c.id)).not.toContain(card.id);
    expect(target.id).toBe(column(after, 'IN_PROGRESS').id);

    const socketMs = (await moved) - tStart;

    record('webhook->db', dbMs);
    record('webhook->socket', socketMs);
    assertWithinBudget('webhook->db', BUDGET_MS);
    assertWithinBudget('webhook->socket', BUDGET_MS);

    // Loop guard: an inbound (origin jira) move must not produce an outbound transition.
    await worker.drain();
    expect(transitionCalls()).toHaveLength(0);
  });

  it('invalid signature -> 401 and card unchanged', async () => {
    seedIssues(1);
    const board = await linkedBoard();
    await importBoard(board.id);

    const view = await getBoardView(board.id);
    const card = column(view, 'TODO').cards[0];
    const issueKey = card.jiraIssueKey;
    if (!issueKey) {
      throw new Error('Imported card has no jiraIssueKey');
    }

    const raw = buildPayload(issueKey, DOING, 'chg-bad');
    await deliver(raw, `sha256=${'0'.repeat(64)}`).expect(401);

    const after = await getBoardView(board.id);
    expect(column(after, 'TODO').cards.map((c) => c.id)).toContain(card.id);
  });
});
