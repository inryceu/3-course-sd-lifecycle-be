import { createHmac } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DomainEvent } from '../src/common/events';
import {
  JIRA_GATEWAY,
  JiraIssue,
  JiraStatus,
  RegisterWebhookInput,
  SearchIssuesInput,
} from '../src/modules/jira-sync/application/jira-gateway.port';
import { JiraWebhookDeliveryService } from '../src/modules/jira-sync/application/jira-webhook-delivery.service';
import { JiraConnectionEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { BoardBody, bearer, createBoard, PREFIX, registerUser, TestUser } from './helpers';

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const DONE = status('9', 'Done', 'done');

class FakeJira {
  readonly registrations: RegisterWebhookInput[] = [];
  listCalls = 0;
  refreshCalls = 0;
  searchCalls = 0;
  private current: JiraStatus = TODO;

  private readonly issue: JiraIssue = {
    id: '10001',
    key: 'WHK-1',
    self: 'https://jira.test/WHK-1',
    fields: {
      summary: 'Webhook target',
      status: TODO,
      assignee: null,
      reporter: null,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
    },
  };

  setStatus(status: JiraStatus): void {
    this.current = status;
  }

  listProjectStatuses({ projectKey }: { projectKey: string }) {
    if (projectKey !== 'WHK') return Promise.reject(new Error('project not found'));
    return Promise.resolve([TODO, DOING, DONE]);
  }

  searchIssues(input: SearchIssuesInput) {
    this.searchCalls += 1;
    const issue = { ...this.issue, fields: { ...this.issue.fields, status: this.current } };
    return Promise.resolve(
      input.nextPageToken
        ? { issues: [], nextPageToken: null, isLast: true }
        : { issues: [issue], nextPageToken: null, isLast: true },
    );
  }

  registerWebhook(input: RegisterWebhookInput) {
    this.registrations.push(input);
    return Promise.resolve({ webhookRegistrationResult: [{ createdWebhookId: 501 }] });
  }

  listWebhooks() {
    this.listCalls += 1;
    return Promise.resolve({
      values: [
        {
          id: 501,
          url: 'https://app.test/api/v1/jira/webhook',
          jqlFilter: 'project = "WHK"',
          events: ['jira:issue_updated'],
          expirationDate: '2026-12-05T10:00:00.000Z',
        },
      ],
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    });
  }

  refreshWebhooks() {
    this.refreshCalls += 1;
    return Promise.resolve({ expirationDate: '2026-12-05T10:00:00.000Z' });
  }
}

describe('Jira webhook receiver (e2e)', () => {
  const jira = new FakeJira();
  let app: INestApplication;
  let dataSource: DataSource;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let secret: string;
  let admin: TestUser;
  let board: BoardBody;
  let events: DomainEvent[];
  let clock = Date.now();
  const SITE = 'https://team.atlassian.net';

  const payload = (
    statusId: string,
    statusName: string,
    category: string,
    options: { site?: string; timestamp?: number; changelogId?: string } = {},
  ) =>
    JSON.stringify({
      webhookEvent: 'jira:issue_updated',
      timestamp: options.timestamp ?? (clock += 1000),
      issue: {
        id: '10001',
        self: `${options.site ?? SITE}/rest/api/2/issue/10001`,
        key: 'WHK-1',
        fields: {
          status: {
            id: statusId,
            name: statusName,
            statusCategory: { id: 4, key: category, name: statusName },
          },
        },
      },
      changelog: {
        id: options.changelogId ?? `change-${statusId}`,
        items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: statusName }],
      },
    });

  const signature = (raw: string) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  const boardDetail = async (boardId = board.id) =>
    (await request(server).get(`${PREFIX}/boards/${boardId}`).set(bearer(admin)).expect(200))
      .body as BoardBody;

  /** Column type that currently holds WHK-1 on the board. */
  const columnOfIssue = async (boardId = board.id) =>
    (await boardDetail(boardId)).columns.find((column) =>
      column.cards?.some((card) => card.jiraIssueKey === 'WHK-1'),
    )?.type;

  const deliver = (raw: string, identifier: string) =>
    request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature(raw))
      .set('X-Atlassian-Webhook-Identifier', identifier)
      .send(raw)
      .expect(200);

  const connectAndImport = async (boardId: string, siteUrl: string, cloudId: string) => {
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId,
      connectedById: admin.id,
      cloudId,
      siteUrl,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'manage:jira-webhook', 'offline_access'],
      connectedAt: new Date(),
    });
    jira.setStatus(TODO);
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId, projectKey: 'WHK' })
      .expect(200);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JIRA_GATEWAY)
      .useValue(jira)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
    secret = app.get(ConfigService).getOrThrow<{ secret: string }>('webhook').secret;

    admin = await registerUser(app, 'webhook-admin');
    board = await createBoard(app, admin, 'Webhook board');
    await dataSource.getRepository(JiraConnectionEntity).save({
      boardId: board.id,
      connectedById: admin.id,
      cloudId: 'cloud-1',
      siteUrl: 'https://team.atlassian.net',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'manage:jira-webhook', 'offline_access'],
      connectedAt: new Date(),
    });
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'WHK' })
      .expect(200);

    const emitter = app.get(EventEmitter2);
    emitter.on('card.moved', (event: DomainEvent) => events.push(event));
  });

  beforeEach(() => {
    events = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the dynamic webhook during import', async () => {
    expect(jira.registrations).toHaveLength(1);
    expect(jira.registrations[0]).toMatchObject({
      boardId: board.id,
      webhooks: [{ events: ['jira:issue_updated'], jqlFilter: 'project = "WHK"' }],
    });
    const rows = await dataSource.query<unknown[]>(
      'SELECT 1 FROM jira_webhooks WHERE board_id = $1 AND webhook_id = 501',
      [board.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('moves the card, publishes one jira-origin event and completes within 5 seconds', async () => {
    const raw = payload('3', 'In Progress', 'indeterminate');
    const callsBefore = jira.searchCalls + jira.refreshCalls + jira.listCalls;
    const started = Date.now();

    const response = await request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature(raw))
      .set('X-Atlassian-Webhook-Identifier', 'delivery-1')
      .set('X-Atlassian-Webhook-Retry', '0')
      .send(raw);

    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(jira.searchCalls + jira.refreshCalls + jira.listCalls).toBe(callsBefore);

    const detail = await boardDetail();
    const inProgress = detail.columns.find((column) => column.type === 'IN_PROGRESS');
    expect(inProgress?.cards?.map((card) => card.jiraIssueKey)).toContain('WHK-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'card.moved',
      boardId: board.id,
      origin: 'jira',
      payload: { toColumnId: inProgress?.id },
    });
  });

  it('acknowledges a duplicate without moving the card or publishing again', async () => {
    const raw = payload('1', 'To Do', 'new');
    const headers = {
      'Content-Type': 'application/json',
      'X-Hub-Signature': signature(raw),
      'X-Atlassian-Webhook-Identifier': 'delivery-duplicate',
    };

    await request(server).post(`${PREFIX}/jira/webhook`).set(headers).send(raw).expect(200);
    const firstMoveCount = events.length;
    expect(firstMoveCount).toBe(1);
    await request(server).post(`${PREFIX}/jira/webhook`).set(headers).send(raw).expect(200);

    expect(events).toHaveLength(firstMoveCount);
  });

  it('refuses a second claim of a stored delivery key', async () => {
    const deliveries = app.get(JiraWebhookDeliveryService);

    await expect(deliveries.claim('e2e-stored-key')).resolves.toBe(true);
    await expect(deliveries.claim('e2e-stored-key')).resolves.toBe(false);
  });

  it('ignores a redelivered or replayed delivery after the user moved the card', async () => {
    const raw = payload('9', 'Done', 'done', { changelogId: 'change-replay' });
    await deliver(raw, 'delivery-replay-original');
    expect(await columnOfIssue()).toBe('DONE');

    const detail = await boardDetail();
    const card = detail.columns
      .flatMap((column) => column.cards ?? [])
      .find((candidate) => candidate.jiraIssueKey === 'WHK-1');
    const todo = detail.columns.find((column) => column.type === 'TODO');
    await request(server)
      .patch(`${PREFIX}/cards/${card?.id}/move`)
      .set(bearer(admin))
      .send({ columnId: todo?.id, position: 0 })
      .expect(200);
    events = [];

    await deliver(raw, 'delivery-replay-original');
    await deliver(raw, 'delivery-replay-new-identifier');

    expect(await columnOfIssue()).toBe('TODO');
    expect(events).toHaveLength(0);
  });

  it('drops an older delivery that arrives after a newer one', async () => {
    const older = payload('3', 'In Progress', 'indeterminate', {
      timestamp: (clock += 1000),
      changelogId: 'change-older',
    });
    const newer = payload('9', 'Done', 'done', {
      timestamp: (clock += 1000),
      changelogId: 'change-newer',
    });

    await deliver(newer, 'delivery-newer');
    expect(await columnOfIssue()).toBe('DONE');
    events = [];
    await deliver(older, 'delivery-older');

    expect(await columnOfIssue()).toBe('DONE');
    expect(events).toHaveLength(0);
  });

  describe('with several boards importing the same project', () => {
    let otherSite: BoardBody;
    let sameSite: BoardBody;

    beforeAll(async () => {
      otherSite = await createBoard(app, admin, 'Other site board');
      await connectAndImport(otherSite.id, 'https://other.atlassian.net', 'cloud-2');
      sameSite = await createBoard(app, admin, 'Same site board');
      await connectAndImport(sameSite.id, SITE, 'cloud-1');
    });

    it('moves only the board connected to the sending site', async () => {
      const before = await columnOfIssue();

      await deliver(
        payload('3', 'In Progress', 'indeterminate', {
          site: 'https://other.atlassian.net',
          changelogId: 'change-other-site',
        }),
        'delivery-other-site',
      );

      expect(await columnOfIssue(otherSite.id)).toBe('IN_PROGRESS');
      expect(await columnOfIssue()).toBe(before);
      expect(await columnOfIssue(sameSite.id)).toBe('TODO');
      expect(events.map((event) => event.boardId)).toEqual([otherSite.id]);
    });

    it('moves the card on every board of the sending site', async () => {
      await deliver(
        payload('3', 'In Progress', 'indeterminate', { changelogId: 'change-both-boards' }),
        'delivery-both-boards',
      );

      expect(await columnOfIssue()).toBe('IN_PROGRESS');
      expect(await columnOfIssue(sameSite.id)).toBe('IN_PROGRESS');
      expect(events.map((event) => event.boardId).sort()).toEqual([board.id, sameSite.id].sort());
    });

    it('does not move a board that was relinked to another project', async () => {
      await dataSource.query('UPDATE boards SET "jiraProjectKey" = $1 WHERE id = $2', [
        'OTHER',
        board.id,
      ]);
      try {
        await deliver(
          payload('9', 'Done', 'done', { changelogId: 'change-relinked' }),
          'delivery-relinked',
        );
      } finally {
        await dataSource.query('UPDATE boards SET "jiraProjectKey" = $1 WHERE id = $2', [
          'WHK',
          board.id,
        ]);
      }

      expect(await columnOfIssue()).toBe('IN_PROGRESS');
      expect(await columnOfIssue(sameSite.id)).toBe('DONE');
    });

    it('ignores deliveries for a board after it disconnects Jira', async () => {
      await request(server)
        .delete(`${PREFIX}/jira/connection`)
        .query({ boardId: board.id })
        .set(bearer(admin))
        .expect((response) => expect(response.status).toBeLessThan(300));

      await deliver(
        payload('1', 'To Do', 'new', { changelogId: 'change-after-disconnect' }),
        'delivery-after-disconnect',
      );

      expect(await columnOfIssue()).toBe('IN_PROGRESS');
      expect(await columnOfIssue(sameSite.id)).toBe('TODO');
    });
  });

  it('rejects an invalid signature with 401', async () => {
    const raw = payload('3', 'In Progress', 'indeterminate');

    await request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature(`${raw} `))
      .set('X-Atlassian-Webhook-Identifier', 'delivery-invalid')
      .send(raw)
      .expect(401);
  });

  it('rejects a re-encoded body signed before re-encoding with 401', async () => {
    const raw = payload('3', 'In Progress', 'indeterminate');
    const reencoded = JSON.stringify(JSON.parse(raw), null, 2);

    await request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature(raw))
      .set('X-Atlassian-Webhook-Identifier', 'delivery-reencoded')
      .send(reencoded)
      .expect(401);
  });

  it('rejects a request without any authenticity proof with 401', async () => {
    await request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Atlassian-Webhook-Identifier', 'delivery-unsigned')
      .send(payload('3', 'In Progress', 'indeterminate'))
      .expect(401);
  });

  it('rejects malformed JSON with 400', async () => {
    const raw = '{"webhookEvent":';

    await request(server)
      .post(`${PREFIX}/jira/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature', signature(raw))
      .set('X-Atlassian-Webhook-Identifier', 'delivery-malformed')
      .send(raw)
      .expect(400);
  });
});
