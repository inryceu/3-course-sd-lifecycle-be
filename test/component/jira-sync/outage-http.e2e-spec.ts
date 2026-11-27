import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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
import { SeedContext, seedBoard, seedCard } from './support/seed';
import { bearer, BoardBody, PREFIX, registerUser, TestUser } from '../../helpers';

const CLOUD_ID = 'cloud-outage-test';
const PROJECT_KEY = 'OUT';
const RETRY_BUDGET_MS = 60_000;
const DEFAULT_MAX_DELAY_MS = 45_000;

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

describe('jira-sync HTTP outage recovery (component, real gateway + stub)', () => {
  const stub = new JiraStub({ baseUrl: '', cloudId: CLOUD_ID });
  const clock = new MutableClock();
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
    const seeded = await seedBoard(ctx, 'Outage board', PROJECT_KEY, ALL_STATUSES);
    return seeded.board;
  };

  const linkedCard = async (boardId: string, columnId: string, index: number) => {
    const issueKey = `${PROJECT_KEY}-${index}`;
    const issueId = String(40000 + index);
    const seeded = await seedCard(
      ctx,
      { board: { id: boardId } as BoardBody, projectKey: PROJECT_KEY, cloudId: CLOUD_ID },
      columnId,
      `Outage card ${index}`,
      issueKey,
      issueId,
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

  const outboxRows = (boardId: string) =>
    dataSource
      .getRepository(SyncOutboxEntity)
      .find({ where: { boardId }, order: { sequence: 'ASC' } });

  const transitionKeys = () =>
    stub
      .findCalls((call) => call.method === 'POST' && call.path.endsWith('/transitions'))
      .map((call) =>
        decodeURIComponent(
          call.path.slice(
            call.path.indexOf('/issue/') + '/issue/'.length,
            call.path.lastIndexOf('/transitions'),
          ),
        ),
      );

  beforeAll(async () => {
    await stub.start();
    process.env.JIRA_AUTH_BASE_URL = stub.url;
    process.env.JIRA_API_BASE_URL = stub.url;

    const config: OutboxConfig = {
      ...loadOutboxConfig(),
      pollIntervalSeconds: 0,
      batchSize: 1,
      concurrency: 1,
    };
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
    admin = await registerUser(app, 'outage-admin');

    const configuredMaxDelay = Number(
      app.get(ConfigService).get<number>('OUTBOX_MAX_DELAY_MS') ?? DEFAULT_MAX_DELAY_MS,
    );
    expect(configuredMaxDelay).toBeLessThanOrEqual(RETRY_BUDGET_MS);
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

  it('3 moves survive a Jira outage, retry within 60 s and arrive once each, in order', async () => {
    const b = await linkedBoard();
    const cards = [];
    for (let index = 1; index <= 3; index += 1) {
      cards.push(await linkedCard(b.id, b.columns[0].id, index));
    }

    stub.setMode('down');
    for (const { card } of cards) {
      await moveCard(card.id, b.columns[1].id);
    }

    const queued = await outboxRows(b.id);
    expect(queued).toHaveLength(3);
    expect(queued.every((row) => row.status === 'PENDING' && row.attempts === 0)).toBe(true);
    expect(transitionKeys()).toHaveLength(0);
    for (const { issueKey } of cards) {
      expect(stub.issues.get(issueKey)?.status.id).toBe(TODO.id);
    }

    await worker.drain();

    const retrying = await outboxRows(b.id);
    expect(retrying).toHaveLength(3);
    expect(retrying.every((row) => row.status === 'PENDING' && row.attempts > 0)).toBe(true);
    expect(transitionKeys()).toHaveLength(0);
    for (const { issueKey } of cards) {
      expect(stub.issues.get(issueKey)?.status.id).toBe(TODO.id);
    }

    // Connectivity is back; the retry budget (<= 60 s) covers the configured max delay.
    stub.setMode('normal');
    stub.clearCalls();
    clock.advance(RETRY_BUDGET_MS);
    await worker.drain();

    const delivered = await outboxRows(b.id);
    expect(delivered).toHaveLength(3);
    expect(delivered.every((row) => row.status === 'SENT')).toBe(true);

    const keys = transitionKeys();
    expect(keys).toEqual(['OUT-1', 'OUT-2', 'OUT-3']);
    for (const key of keys) {
      expect(stub.issues.get(key)?.status.id).toBe(DOING.id);
    }
  });
});
