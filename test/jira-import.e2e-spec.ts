import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  JIRA_GATEWAY,
  JiraIssue,
  JiraStatus,
  SearchIssuesInput,
} from '../src/modules/jira-sync/application/jira-gateway.port';
import {
  JiraClientError,
  JiraUnauthorizedError,
} from '../src/modules/jira-sync/domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { BoardBody, bearer, createBoard, PREFIX, registerUser, TestUser } from './helpers';

/**
 * Component test for T-24: real HTTP, real Postgres, a stubbed `JIRA_GATEWAY` standing in for
 * Jira Cloud. The fake serves two result pages so pagination is exercised.
 */
const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const DONE = status('9', 'Done', 'done');

class FakeJira {
  issues: JiraIssue[] = [];
  failWith: Error | null = null;
  searches: SearchIssuesInput[] = [];

  set(key: string, summary: string, st: JiraStatus, description = `About ${key}`): void {
    const existing = this.issues.findIndex((i) => i.key === key);
    const issue: JiraIssue = {
      id: key.replace(/\D/g, ''),
      key,
      self: `https://jira.test/${key}`,
      fields: {
        summary,
        status: st,
        assignee: null,
        reporter: null,
        created: '',
        updated: '',
        ...({
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
          },
        } as object),
      },
    };
    if (existing >= 0) this.issues[existing] = issue;
    else this.issues.push(issue);
  }

  listProjectStatuses({ projectKey }: { projectKey: string }) {
    if (this.failWith) return Promise.reject(this.failWith);
    if (projectKey !== 'SBX') {
      return Promise.reject(new JiraClientError(404, 'not found'));
    }
    return Promise.resolve([TODO, DOING, DONE]);
  }

  searchIssues(input: SearchIssuesInput) {
    this.searches.push(input);
    if (this.failWith) return Promise.reject(this.failWith);
    const open = this.issues.filter((i) => i.fields.status.statusCategory.key !== 'done');
    const start = input.nextPageToken ? Number(input.nextPageToken) : 0;
    const page = open.slice(start, start + 2);
    const next = start + 2 < open.length ? String(start + 2) : null;
    return Promise.resolve({ issues: page, nextPageToken: next, isLast: next === null });
  }
}

describe('Jira import (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dataSource: DataSource;
  const jira = new FakeJira();
  let admin: TestUser;
  let viewer: TestUser;
  let board: BoardBody;

  const connect = (boardId: string, userId: string) =>
    dataSource.getRepository(JiraConnectionEntity).save({
      boardId,
      connectedById: userId,
      cloudId: 'cloud-1',
      siteUrl: 'https://team.atlassian.net',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
      connectedAt: new Date(),
    });
  const cardsOf = async (b: BoardBody) => {
    const res = await request(server)
      .get(`${PREFIX}/boards/${b.id}`)
      .set(bearer(admin))
      .expect(200);
    const detail = res.body as BoardBody;
    return detail.columns.flatMap((c) =>
      (c.cards ?? []).map((card) => ({
        key: card.jiraIssueKey,
        title: card.title,
        column: c.title,
      })),
    );
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

    admin = await registerUser(app, 'import-admin');
    viewer = await registerUser(app, 'import-viewer');
    board = await createBoard(app, admin, 'Imported');
    await request(server)
      .post(`${PREFIX}/boards/${board.id}/members`)
      .set(bearer(admin))
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
  });

  afterAll(() => app.close());

  it('answers 409 before the board is connected to Jira', async () => {
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'SBX' })
      .expect(409);
  });

  it('imports every open issue over several pages, links the project and the cards', async () => {
    await connect(board.id, admin.id);
    jira.set('SBX-1', 'Write docs', TODO);
    jira.set('SBX-2', 'Build API', DOING);
    jira.set('SBX-3', 'Fix bug', TODO);
    jira.set('SBX-4', 'Shipped', DONE);

    const res = await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'SBX' })
      .expect(200);

    expect(res.body).toEqual({ imported: 3, created: 3, updated: 0, skipped: 0 });
    expect(jira.searches.length).toBeGreaterThanOrEqual(2);
    expect(await cardsOf(board)).toEqual(
      expect.arrayContaining([
        { key: 'SBX-1', title: 'Write docs', column: 'To Do' },
        { key: 'SBX-3', title: 'Fix bug', column: 'To Do' },
        { key: 'SBX-2', title: 'Build API', column: 'In Progress' },
      ]),
    );
    const detail = await request(server).get(`${PREFIX}/boards/${board.id}`).set(bearer(admin));
    expect((detail.body as { jiraProjectKey: string }).jiraProjectKey).toBe('SBX');

    const links = await request(server)
      .get(`${PREFIX}/jira/mappings`)
      .query({ boardId: board.id })
      .set(bearer(viewer))
      .expect(200);
    expect((links.body as { jiraIssueKey: string }[]).map((l) => l.jiraIssueKey)).toEqual([
      'SBX-1',
      'SBX-2',
      'SBX-3',
    ]);
  });

  it('re-import updates and moves cards and never duplicates them', async () => {
    jira.set('SBX-1', 'Write the docs', TODO);
    jira.set('SBX-3', 'Fix bug', DOING);

    const res = await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id })
      .expect(200);

    expect(res.body).toEqual({ imported: 2, created: 0, updated: 2, skipped: 1 });
    const cards = await cardsOf(board);
    expect(cards.filter((c) => c.key === 'SBX-1')).toEqual([
      { key: 'SBX-1', title: 'Write the docs', column: 'To Do' },
    ]);
    expect(cards.find((c) => c.key === 'SBX-3')?.column).toBe('In Progress');
    expect(cards).toHaveLength(3);
  });

  it('defaults the status mapping by category, stores a change and uses it on import', async () => {
    const list = await request(server)
      .get(`${PREFIX}/jira/status-mappings`)
      .query({ boardId: board.id })
      .set(bearer(viewer))
      .expect(200);
    const mapping = list.body as { jiraStatusId: string; columnId: string; isDefault: boolean }[];
    expect(mapping.every((m) => m.isDefault)).toBe(true);

    const done = board.columns.find((c) => c.title === 'Done');
    await request(server)
      .put(`${PREFIX}/jira/status-mappings`)
      .set(bearer(viewer))
      .send({ boardId: board.id, mappings: [{ jiraStatusId: '3', columnId: done?.id }] })
      .expect(403);
    const saved = await request(server)
      .put(`${PREFIX}/jira/status-mappings`)
      .set(bearer(admin))
      .send({ boardId: board.id, mappings: [{ jiraStatusId: '3', columnId: done?.id }] })
      .expect(200);
    expect(saved.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jiraStatusId: '3', columnId: done?.id, isDefault: false }),
      ]),
    );

    const res = await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id })
      .expect(200);
    expect(res.body).toMatchObject({ updated: 2 });
    const cards = await cardsOf(board);
    expect(
      cards
        .filter((c) => c.column === 'Done')
        .map((c) => c.key)
        .sort(),
    ).toEqual(['SBX-2', 'SBX-3']);
  });

  it('rejects a column of another board in the mapping', async () => {
    const other = await createBoard(app, admin, 'Other');
    await request(server)
      .put(`${PREFIX}/jira/status-mappings`)
      .set(bearer(admin))
      .send({ boardId: board.id, mappings: [{ jiraStatusId: '1', columnId: other.columns[0].id }] })
      .expect(400);
  });

  it('answers 400 for a project that does not exist and keeps the stored key', async () => {
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'NOPE' })
      .expect(400);
    const detail = await request(server).get(`${PREFIX}/boards/${board.id}`).set(bearer(admin));
    expect((detail.body as { jiraProjectKey: string }).jiraProjectKey).toBe('SBX');
  });

  it('keeps import to the Admin and maps Jira failures', async () => {
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(viewer))
      .send({ boardId: board.id })
      .expect(403);
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id, projectKey: 'not a key' })
      .expect(400);

    jira.failWith = new JiraUnauthorizedError('reconnect required');
    await request(server)
      .post(`${PREFIX}/jira/import`)
      .set(bearer(admin))
      .send({ boardId: board.id })
      .expect(409);
    jira.failWith = null;
  });
});
