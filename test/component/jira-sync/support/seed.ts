import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { SyncOutboxEntity } from '@common/outbox/infrastructure/persistence/sync-outbox.entity';
import { BoardEntity } from '@/modules/boards/infrastructure/persistence/board.entity';
import { CardEntity } from '@/modules/boards/infrastructure/persistence/card.entity';
import { JiraConnectionEntity } from '@/modules/jira-sync/infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '@/modules/jira-sync/infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStub, JiraStatus, JiraTransition } from './jira-stub';
import {
  bearer,
  BoardBody,
  CardBody,
  createBoard,
  createCard,
  PREFIX,
  TestUser,
} from '../../../helpers';

const CLOUD_ID = 'cloud-component-test';

export interface SeededBoard {
  board: BoardBody;
  projectKey: string;
  cloudId: string;
}

export interface SeededCard {
  card: CardBody;
  issueKey: string;
  issueId: string;
}

export interface SeedContext {
  app: INestApplication;
  server: ReturnType<INestApplication['getHttpServer']>;
  dataSource: DataSource;
  stub: JiraStub;
  admin: TestUser;
}

/** Create a board with a Jira connection via the real OAuth flow (stubbed). */
export async function seedBoard(
  ctx: SeedContext,
  boardName: string,
  projectKey: string,
  statuses: JiraStatus[],
): Promise<SeededBoard> {
  const { app, server, dataSource, stub, admin } = ctx;

  const board = await createBoard(app, admin, boardName);
  await dataSource.getRepository(BoardEntity).update(board.id, { jiraProjectKey: projectKey });

  // OAuth start
  const startResp = await request(server)
    .get(`${PREFIX}/jira/oauth/start`)
    .query({ boardId: board.id })
    .set(bearer(admin));
  if (startResp.status !== 200) {
    console.log('OAuth start failed', startResp.status, startResp.body);
  }
  if (startResp.status !== 200) throw new Error(`OAuth start failed: ${startResp.status}`);

  const authUrl = startResp.body.authorizeUrl as string;
  const state = new URL(authUrl).searchParams.get('state');
  if (!state) throw new Error('No state in OAuth URL');

  // OAuth callback with good code
  await request(server)
    .get(`${PREFIX}/jira/oauth/callback`)
    .query({ code: 'good-code', state })
    .set(bearer(admin))
    .expect(200);

  // Verify connection
  const conn = await dataSource
    .getRepository(JiraConnectionEntity)
    .findOne({ where: { boardId: board.id } });
  if (!conn) throw new Error('Jira connection not created');

  stub.seedProject({
    id: '10000',
    key: projectKey,
    name: `${projectKey} Project`,
    statuses,
  });

  return { board, projectKey, cloudId: CLOUD_ID };
}

/** Create a card linked to a Jira issue via the public API / services. */
export async function seedCard(
  ctx: SeedContext,
  board: SeededBoard,
  columnId: string,
  title: string,
  issueKey: string,
  issueId: string,
  status: JiraStatus,
  transitions: JiraTransition[],
): Promise<SeededCard> {
  const { app, dataSource, stub, admin } = ctx;

  const card = await createCard(app, admin, columnId, title);
  await dataSource.getRepository(CardEntity).update(card.id, { jiraIssueKey: issueKey });

  await dataSource.getRepository(JiraIssueMappingEntity).save({
    boardId: board.board.id,
    cardId: card.id,
    jiraIssueKey: issueKey,
    jiraIssueId: issueId,
    jiraProjectKey: board.projectKey,
    createdById: admin.id,
  });

  stub.seedIssue({
    id: issueId,
    key: issueKey,
    summary: title,
    status,
    assignee: null,
    reporter: { accountId: 'stub-user', displayName: 'Stub User', active: true },
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  });
  stub.seedTransitions(issueKey, transitions);

  return { card, issueKey, issueId };
}

/** Wait for an outbox row to reach SENT status. */
export async function waitForOutboxSent(
  dataSource: DataSource,
  boardId: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await dataSource
      .getRepository(SyncOutboxEntity)
      .find({ where: { boardId }, order: { sequence: 'ASC' } });
    if (rows.length > 0 && rows.every((r) => r.status === 'SENT')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Outbox not SENT within ${timeoutMs}ms`);
}

/** Wait for a condition with real timers. */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Wait for a specific stub call and return it. */
export async function waitForCall(
  stub: JiraStub,
  predicate: (call: { method: string; path: string; receivedAt: number }) => boolean,
  timeoutMs: number,
): Promise<{ method: string; path: string; receivedAt: number; body: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const calls = stub.findCalls(predicate);
    if (calls.length > 0) return calls[calls.length - 1];
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitForCall timed out after ${timeoutMs}ms`);
}
