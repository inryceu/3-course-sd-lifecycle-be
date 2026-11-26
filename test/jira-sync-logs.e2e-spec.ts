import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JiraIssueMappingEntity } from '../src/modules/jira-sync/infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../src/modules/jira-sync/infrastructure/persistence/sync-log.entity';
import { bearer, createBoard, createTestApp, PREFIX, registerUser, TestUser } from './helpers';

interface Page {
  items: { id: string; status: string; boardId: string }[];
  nextCursor: string | null;
}

/** `GET /jira/sync-logs` against real Postgres: the keyset SQL and the status filter. */
describe('Jira sync logs (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: TestUser;
  let member: TestUser;
  let stranger: TestUser;
  let boardId: string;
  const ids: string[] = []; // newest first

  const list = (user: TestUser, query: string) =>
    request(app.getHttpServer()).get(`${PREFIX}/jira/sync-logs?${query}`).set(bearer(user));

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    admin = await registerUser(app, 'logs-admin');
    member = await registerUser(app, 'logs-member');
    stranger = await registerUser(app, 'logs-stranger');
    const board = await createBoard(app, admin, 'Logs board');
    boardId = board.id;
    await request(app.getHttpServer())
      .post(`${PREFIX}/boards/${boardId}/members`)
      .set(bearer(admin))
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    const mapping = await dataSource.getRepository(JiraIssueMappingEntity).save({
      boardId,
      jiraIssueKey: 'LOG-1',
      jiraIssueId: '1',
      jiraProjectKey: 'LOG',
    });
    // Five rows one minute apart, statuses alternate FAILED / SUCCESS.
    const statuses = [
      SyncStatus.FAILED,
      SyncStatus.SUCCESS,
      SyncStatus.FAILED,
      SyncStatus.SUCCESS,
      SyncStatus.SUCCESS,
    ];
    const base = Date.now() - 3_600_000;
    for (const [index, status] of statuses.entries()) {
      const saved = await dataSource.getRepository(SyncLogEntity).save({
        direction: SyncDirection.TO_JIRA,
        status,
        payload: { issueKey: 'LOG-1' },
        errorMessage: null,
        mappingId: mapping.id,
      });
      await dataSource
        .getRepository(SyncLogEntity)
        .update(saved.id, { createdAt: new Date(base + index * 60_000) });
      ids.unshift(saved.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('pages newest first with a cursor and ends with nextCursor null', async () => {
    const first = (await list(admin, `boardId=${boardId}&limit=2`).expect(200)).body as Page;
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).toBe(ids[1]);
    const second = (
      await list(admin, `boardId=${boardId}&limit=2&cursor=${first.nextCursor}`).expect(200)
    ).body as Page;
    expect(second.items.map((i) => i.id)).toEqual(ids.slice(2, 4));
    const last = (
      await list(admin, `boardId=${boardId}&limit=2&cursor=${second.nextCursor}`).expect(200)
    ).body as Page;
    expect(last.items.map((i) => i.id)).toEqual(ids.slice(4));
    expect(last.nextCursor).toBeNull();
  });

  it('filters by status on the server', async () => {
    const page = (await list(admin, `boardId=${boardId}&status=FAILED`).expect(200)).body as Page;
    expect(page.items.map((i) => i.status)).toEqual(['FAILED', 'FAILED']);
    expect(page.items.every((i) => i.boardId === boardId)).toBe(true);
  });

  it('is Admin only: 403 for a member, 403 for a non-member', async () => {
    await list(member, `boardId=${boardId}`).expect(403);
    await list(stranger, `boardId=${boardId}`).expect(403);
  });

  it('rejects a malformed query with 400 and a missing token with 401', async () => {
    await list(admin, `boardId=${boardId}&status=NOPE`).expect(400);
    await list(admin, `boardId=${boardId}&limit=0`).expect(400);
    await list(admin, `boardId=${boardId}&cursor=not-a-uuid`).expect(400);
    await request(app.getHttpServer())
      .get(`${PREFIX}/jira/sync-logs?boardId=${randomUUID()}`)
      .expect(401);
  });

  it('does not expose another board logs', async () => {
    const other = await createBoard(app, admin, 'Other');
    const page = (await list(admin, `boardId=${other.id}`).expect(200)).body as Page;
    expect(page.items).toEqual([]);
  });
});
