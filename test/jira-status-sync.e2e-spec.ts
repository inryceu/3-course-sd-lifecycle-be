import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { BOARDS_FACADE, BoardsFacade } from '../src/modules/boards';
import { BoardEntity } from '../src/modules/boards/infrastructure/persistence/board.entity';
import { CardEntity } from '../src/modules/boards/infrastructure/persistence/card.entity';
import {
  JIRA_GATEWAY,
  DoTransitionInput,
  GetIssueInput,
  GetIssueResult,
  JiraStatus,
  JiraTransition,
  ListTransitionsInput,
} from '../src/modules/jira-sync/application/jira-gateway.port';
import {
  JiraClientError,
  JiraServerError,
} from '../src/modules/jira-sync/domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../src/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import {
  BoardBody,
  bearer,
  CardBody,
  ColumnBody,
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
const DONE = status('9', 'Done', 'done');

const transition = (id: string, to: JiraStatus): JiraTransition => ({
  id,
  name: `Transition ${id}`,
  to,
  hasScreen: false,
  isGlobal: true,
  isInitial: false,
  isConditional: false,
  isAvailable: true,
});

class FakeJira {
  currentStatus: JiraStatus = TODO;
  transitions: JiraTransition[] = [transition('31', DONE)];
  getIssueError: Error | null = null;
  doTransitionError: Error | null = null;
  getIssueGate: Promise<void> | null = null;
  readonly getIssueCalls: GetIssueInput[] = [];
  readonly listTransitionsCalls: ListTransitionsInput[] = [];
  readonly doTransitionCalls: DoTransitionInput[] = [];

  reset(): void {
    this.currentStatus = TODO;
    this.transitions = [transition('31', DONE)];
    this.getIssueError = null;
    this.doTransitionError = null;
    this.getIssueGate = null;
    this.getIssueCalls.length = 0;
    this.listTransitionsCalls.length = 0;
    this.doTransitionCalls.length = 0;
  }

  blockGetIssue(): () => void {
    let release: () => void = () => undefined;
    this.getIssueGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.getIssueGate = null;
      release();
    };
  }

  async getIssue(input: GetIssueInput): Promise<GetIssueResult> {
    this.getIssueCalls.push(input);
    if (this.getIssueGate !== null) {
      await this.getIssueGate;
    }
    if (this.getIssueError !== null) {
      throw this.getIssueError;
    }
    return { id: '10001', key: input.issueIdOrKey, status: this.currentStatus };
  }

  listTransitions(
    input: ListTransitionsInput,
  ): Promise<{ transitions: readonly JiraTransition[] }> {
    this.listTransitionsCalls.push(input);
    return Promise.resolve({ transitions: this.transitions });
  }

  doTransition(input: DoTransitionInput): Promise<void> {
    this.doTransitionCalls.push(input);
    return this.doTransitionError === null
      ? Promise.resolve()
      : Promise.reject(this.doTransitionError);
  }
}

interface LinkedCard {
  board: BoardBody;
  card: CardBody;
  issueKey: string;
  todo: ColumnBody;
  doing: ColumnBody;
  done: ColumnBody;
  mappingId: string;
}

describe('Jira status sync (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let admin: TestUser;
  let facade: BoardsFacade;
  let issueCounter = 0;
  const jira = new FakeJira();

  const move = (cardId: string, columnId: string) =>
    request(server)
      .patch(`${PREFIX}/cards/${cardId}/move`)
      .set(bearer(admin))
      .send({ columnId, position: 0 });

  const logsFor = async (cardId: string): Promise<SyncLogEntity[]> => {
    const rows = await dataSource.getRepository(SyncLogEntity).find({
      order: { createdAt: 'ASC' },
    });
    return rows.filter((row) => (row.payload as { cardId?: string } | null)?.cardId === cardId);
  };

  const waitForLog = async (cardId: string): Promise<SyncLogEntity> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await logsFor(cardId);
      if (rows.length > 0) return rows[0];
      await sleep(25);
    }
    throw new Error(`No sync log was written for card ${cardId}`);
  };

  const linkedCard = async (): Promise<LinkedCard> => {
    const board = await createBoard(app, admin, 'Jira status sync');
    const [todo, doing, done] = board.columns;
    const card = await createCard(app, admin, todo.id, 'Linked card');
    const issueKey = `KAN-${++issueCounter}`;

    await dataSource.getRepository(BoardEntity).update(board.id, { jiraProjectKey: 'KAN' });
    await dataSource.getRepository(CardEntity).update(card.id, { jiraIssueKey: issueKey });
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId: board.id,
      connectedById: admin.id,
      cloudId: `cloud-${board.id}`,
      siteUrl: 'https://team.atlassian.net',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      connectedAt: new Date(),
    });
    const mapping = await dataSource.getRepository(JiraIssueMappingEntity).save({
      boardId: board.id,
      cardId: card.id,
      jiraIssueKey: issueKey,
      jiraIssueId: String(issueCounter + 10_000),
      jiraProjectKey: 'KAN',
      createdById: admin.id,
    });

    return { board, card, issueKey, todo, doing, done, mappingId: mapping.id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JIRA_GATEWAY)
      .useValue(jira)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    facade = app.get<BoardsFacade>(BOARDS_FACADE);
    admin = await registerUser(app, 'status-sync-admin');
  });

  beforeEach(() => jira.reset());

  afterAll(() => app.close());

  it('writes a TO_JIRA/SUCCESS row for a user move', async () => {
    const { card, issueKey, done } = await linkedCard();

    await move(card.id, done.id).expect(200);

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      errorMessage: null,
      payload: {
        cardId: card.id,
        issueKey,
        fromColumnId: card.columnId,
        toColumnId: done.id,
        outcome: 'transitioned',
        targetStatusId: DONE.id,
        targetStatusName: DONE.name,
        transitionId: '31',
      },
    });
    expect(jira.doTransitionCalls).toHaveLength(1);
  });

  it('writes no row for a Jira-originated move', async () => {
    const { board, card, issueKey, done } = await linkedCard();

    await expect(
      facade.moveCardFromExternal({
        boardId: board.id,
        jiraIssueKey: issueKey,
        columnId: done.id,
        position: 0,
      }),
    ).resolves.toBe('moved');

    expect(jira.getIssueCalls).toHaveLength(0);
    await expect(logsFor(card.id)).resolves.toHaveLength(0);
  });

  it('writes a successful no-op when Jira already has the destination status', async () => {
    const { card, done } = await linkedCard();
    jira.currentStatus = DONE;

    await move(card.id, done.id).expect(200);

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      payload: { outcome: 'no-op', targetStatusId: DONE.id },
    });
    expect(jira.listTransitionsCalls).toHaveLength(0);
    expect(jira.doTransitionCalls).toHaveLength(0);
  });

  it('records a rejected transition as FAILED and executes it once', async () => {
    const { card, done } = await linkedCard();
    jira.doTransitionError = new JiraClientError(400, 'transition rejected');

    await move(card.id, done.id).expect(200);

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.FAILED,
      payload: { reason: 'jira error' },
      errorMessage: expect.stringContaining('transition rejected'),
    });
    expect(jira.doTransitionCalls).toHaveLength(1);
  });

  it('returns the move response before the pending Jira read completes', async () => {
    const { card, done } = await linkedCard();
    const release = jira.blockGetIssue();
    const moveRequest = move(card.id, done.id);

    try {
      const response = await Promise.race([moveRequest, sleep(1_000).then(() => null)]);
      expect(response).not.toBeNull();
      if (response === null) return;
      expect(response.status).toBe(200);

      const deadline = Date.now() + 1_000;
      while (jira.getIssueCalls.length === 0 && Date.now() < deadline) {
        await sleep(10);
      }
      expect(jira.getIssueCalls).toHaveLength(1);
      expect(jira.getIssueGate).not.toBeNull();
    } finally {
      release();
    }

    const row = await waitForLog(card.id);
    expect(row.status).toBe(SyncStatus.SUCCESS);
  });

  it('does not change the move result when synchronization fails', async () => {
    const { card, done } = await linkedCard();
    jira.getIssueError = new JiraServerError(503, 3, 3);

    const response = await move(card.id, done.id).expect(200);
    expect(response.body).toMatchObject({ columnId: done.id });

    const current = await request(server)
      .get(`${PREFIX}/cards/${card.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(current.body).toMatchObject({ columnId: done.id });

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.FAILED,
      payload: { reason: 'jira error' },
    });
  });
});
