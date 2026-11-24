import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createEvent } from '../src/common/events';
import {
  AddCommentInput,
  AddCommentResult,
  JIRA_GATEWAY,
} from '../src/modules/jira-sync/application/jira-gateway.port';
import { plainTextToAdf } from '../src/modules/jira-sync/application/helpers/plain-text-to-adf';
import { JiraServerError } from '../src/modules/jira-sync/domain/jira-gateway.errors';
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
  createBoard,
  createCard,
  PREFIX,
  registerUser,
  sleep,
  TestUser,
} from './helpers';

const ADMIN_NAME = 'comment-sync-admin';

interface CommentView {
  id: string;
  text: string;
  syncedToJira: boolean;
}

interface DeferredComment {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

class FakeJira {
  readonly addCommentCalls: AddCommentInput[] = [];
  addCommentError: Error | null = null;
  private nextId = 1;
  private deferred: DeferredComment | null = null;

  reset(): void {
    this.addCommentCalls.length = 0;
    this.addCommentError = null;
    this.nextId = 1;
    this.deferred = null;
  }

  deferNext(): DeferredComment {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const deferred = { promise, resolve, reject };
    this.deferred = deferred;
    return deferred;
  }

  async addComment(input: AddCommentInput): Promise<AddCommentResult> {
    this.addCommentCalls.push(input);
    const deferred = this.deferred;
    this.deferred = null;
    if (deferred !== null) {
      await deferred.promise;
    }
    if (this.addCommentError !== null) {
      throw this.addCommentError;
    }
    const id = String(20_000 + this.nextId++);
    return {
      id,
      self: `https://example.test/rest/api/3/issue/10001/comment/${id}`,
      author: { accountId: 'bot', displayName: 'BoardSync', active: true },
      body: input.body,
      created: '2026-10-01T10:00:00.000Z',
      updated: '2026-10-01T10:00:00.000Z',
    };
  }
}

interface LinkedCard {
  board: BoardBody;
  card: CardBody;
  issueKey: string;
  mappingId: string;
}

describe('Jira comment sync (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  let emitter: EventEmitter2;
  let admin: TestUser;
  let issueCounter = 0;
  const jira = new FakeJira();

  const postComment = (user: TestUser, cardId: string, text: string) =>
    request(server).post(`${PREFIX}/cards/${cardId}/comments`).set(bearer(user)).send({ text });

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

  const waitForAddCommentCall = async (count: number): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (jira.addCommentCalls.length >= count) return;
      await sleep(10);
    }
    throw new Error(`Expected ${count} addComment calls, got ${jira.addCommentCalls.length}`);
  };

  const waitForCommentFlag = async (
    cardId: string,
    commentId: string,
    expected: boolean,
  ): Promise<void> => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await request(server)
        .get(`${PREFIX}/cards/${cardId}/comments`)
        .set(bearer(admin))
        .expect(200);
      const items = (response.body as { items: CommentView[] }).items;
      if (items.find((item) => item.id === commentId)?.syncedToJira === expected) return;
      await sleep(25);
    }
    throw new Error(`Comment ${commentId} did not reach syncedToJira=${expected}`);
  };

  const linkedCard = async (): Promise<LinkedCard> => {
    const board = await createBoard(app, admin, 'Jira comment sync');
    const card = await createCard(app, admin, board.columns[0].id, 'Linked card');
    const issueKey = `KAN-${++issueCounter}`;
    const mapping = await dataSource.getRepository(JiraIssueMappingEntity).save({
      boardId: board.id,
      cardId: card.id,
      jiraIssueKey: issueKey,
      jiraIssueId: String(10_000 + issueCounter),
      jiraProjectKey: 'KAN',
      createdById: admin.id,
    });
    return { board, card, issueKey, mappingId: mapping.id };
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
    emitter = app.get(EventEmitter2);
    admin = await registerUser(app, ADMIN_NAME);
  });

  beforeEach(() => jira.reset());

  afterAll(() => app.close());

  it('mirrors a mapped user comment once, marks it synced and writes a success row', async () => {
    const { card, issueKey, mappingId } = await linkedCard();
    const text = 'Please mirror this comment';

    const response = await postComment(admin, card.id, text).expect(201);
    const commentId = (response.body as CommentView).id;
    expect((response.body as CommentView).syncedToJira).toBe(false);

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      mappingId,
      errorMessage: null,
      payload: {
        commentId,
        cardId: card.id,
        issueKey,
        jiraCommentId: '20001',
        latencyMs: expect.any(Number),
      },
    });
    expect(jira.addCommentCalls).toHaveLength(1);
    expect(jira.addCommentCalls[0]).toMatchObject({
      boardId: card.boardId,
      issueIdOrKey: issueKey,
    });
    expect(jira.addCommentCalls[0].body).toEqual(
      plainTextToAdf(`[BoardSync] ${ADMIN_NAME}: ${text}`),
    );
    await waitForCommentFlag(card.id, commentId, true);
  });

  it('returns 201 before Jira finishes and completes the mirror afterward', async () => {
    const { card, issueKey, mappingId } = await linkedCard();
    const text = 'Slow but eventually mirrored';
    const deferred = jira.deferNext();

    const response = await postComment(admin, card.id, text).expect(201);
    const commentId = (response.body as CommentView).id;
    expect((response.body as CommentView).syncedToJira).toBe(false);

    await waitForAddCommentCall(1);
    expect(jira.addCommentCalls[0].body).toEqual(
      plainTextToAdf(`[BoardSync] ${ADMIN_NAME}: ${text}`),
    );
    await expect(logsFor(card.id)).resolves.toHaveLength(0);

    deferred.resolve();

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      mappingId,
      errorMessage: null,
      payload: {
        commentId,
        cardId: card.id,
        issueKey,
        jiraCommentId: '20001',
        latencyMs: expect.any(Number),
      },
    });
    await waitForCommentFlag(card.id, commentId, true);
  });

  it('keeps the 201 response when the deferred mirror rejects', async () => {
    const { card, issueKey, mappingId } = await linkedCard();
    const deferred = jira.deferNext();

    const response = await postComment(admin, card.id, 'Deferred failure').expect(201);
    const commentId = (response.body as CommentView).id;

    await waitForAddCommentCall(1);
    jira.addCommentError = new JiraServerError(503, 3, 3);
    deferred.reject(jira.addCommentError);

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.FAILED,
      mappingId,
      errorMessage: expect.stringContaining('Jira server error'),
      payload: {
        commentId,
        cardId: card.id,
        issueKey,
        reason: 'jira error',
        latencyMs: expect.any(Number),
      },
    });
    expect(jira.addCommentCalls).toHaveLength(3);
    await waitForCommentFlag(card.id, commentId, false);
  });

  it('does not mirror a Jira-originated comment', async () => {
    const { board, card } = await linkedCard();

    emitter.emit(
      'card.commented',
      createEvent('card.commented', {
        boardId: board.id,
        origin: 'jira',
        payload: {
          id: 'jira-origin-comment',
          cardId: card.id,
          authorId: admin.id,
          text: 'From Jira',
          syncedToJira: true,
          createdAt: new Date().toISOString(),
        },
      }),
    );
    await sleep(250);

    expect(jira.addCommentCalls).toHaveLength(0);
    await expect(logsFor(card.id)).resolves.toHaveLength(0);
  });

  it('does not mirror a comment on an unmapped card', async () => {
    const board = await createBoard(app, admin, 'Unmapped comment sync');
    const card = await createCard(app, admin, board.columns[0].id, 'Unmapped card');

    await postComment(admin, card.id, 'No Jira issue').expect(201);
    await sleep(250);

    expect(jira.addCommentCalls).toHaveLength(0);
    await expect(logsFor(card.id)).resolves.toHaveLength(0);
  });

  it('keeps the comment unsynced and writes a failed row when Jira rejects it', async () => {
    jira.addCommentError = new JiraServerError(503, 3, 3);
    const { card, issueKey, mappingId } = await linkedCard();

    const response = await postComment(admin, card.id, 'This one fails').expect(201);
    const commentId = (response.body as CommentView).id;

    const row = await waitForLog(card.id);
    expect(row).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.FAILED,
      mappingId,
      errorMessage: expect.stringContaining('Jira server error'),
      payload: {
        commentId,
        cardId: card.id,
        issueKey,
        reason: 'jira error',
        latencyMs: expect.any(Number),
      },
    });
    expect(jira.addCommentCalls).toHaveLength(3);
    await waitForCommentFlag(card.id, commentId, false);
  });
});
