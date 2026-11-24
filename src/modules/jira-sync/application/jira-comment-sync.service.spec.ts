import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthFacade } from '../../auth';
import { BoardsFacade } from '../../boards';
import { CommentSnapshot, DomainEventOf } from '../../../common/events/domain-events';
import {
  JiraClientError,
  JiraServerError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { plainTextToAdf } from './helpers/plain-text-to-adf';
import { AddCommentInput, AddCommentResult, JiraGateway } from './jira-gateway.port';
import { JiraRetryService } from './jira-retry.service';
import { JiraCommentSyncService } from './jira-comment-sync.service';

const CREATED: AddCommentResult = {
  id: 'jira-comment-1',
  self: 'https://example.test/rest/api/3/issue/10001/comment/20001',
  author: { accountId: 'bot', displayName: 'BoardSync', active: true },
  body: plainTextToAdf('[BoardSync] Ada Lovelace: Looks good'),
  created: '2026-10-01T10:00:00.000Z',
  updated: '2026-10-01T10:00:00.000Z',
};

interface SavedLog {
  direction: SyncDirection;
  status: SyncStatus;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  mappingId: string | null;
}

type AuthorResult = { displayName: string } | null | Error;

function makeEvent(
  options: {
    boardId?: string;
    cardId?: string;
    commentId?: string;
    authorId?: string;
    text?: string;
    origin?: 'user' | 'jira';
    occurredAt?: string;
  } = {},
): DomainEventOf<'card.commented'> {
  const commentId = options.commentId ?? 'comment-1';
  const cardId = options.cardId ?? 'card-1';
  const authorId = options.authorId ?? 'user-1';
  const payload: CommentSnapshot = {
    id: commentId,
    cardId,
    authorId,
    text: options.text ?? 'Looks good',
    syncedToJira: false,
    createdAt: '2026-10-01T10:00:00.000Z',
  };
  return {
    type: 'card.commented',
    boardId: options.boardId ?? 'board-1',
    actorId: authorId,
    origin: options.origin ?? 'user',
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload,
  };
}

function setup(
  options: {
    link?: { id: string; jiraIssueKey: string } | null;
    author?: AuthorResult;
    result?: AddCommentResult;
    addCommentError?: Error;
  } = {},
) {
  const link =
    options.link === undefined ? { id: 'mapping-1', jiraIssueKey: 'KAN-1' } : options.link;
  const links = {
    findOne: jest.fn().mockResolvedValue(link),
  };
  const gateway = {
    addComment: jest.fn(),
  } as unknown as jest.Mocked<JiraGateway>;
  if (options.addCommentError !== undefined) {
    gateway.addComment.mockRejectedValue(options.addCommentError);
  } else {
    gateway.addComment.mockResolvedValue(options.result ?? CREATED);
  }
  const retry = {
    execute: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
  } as unknown as jest.Mocked<JiraRetryService>;
  const author = options.author === undefined ? { displayName: 'Ada Lovelace' } : options.author;
  const auth = {
    getUserById: jest.fn(),
  };
  if (author instanceof Error) {
    auth.getUserById.mockRejectedValue(author);
  } else {
    auth.getUserById.mockResolvedValue(
      author === null
        ? null
        : { id: 'user-1', email: 'ada@example.test', displayName: author.displayName },
    );
  }
  const boards = {
    markCommentSynced: jest.fn().mockResolvedValue(undefined),
  };
  const logs = {
    save: jest.fn().mockResolvedValue(undefined),
  };
  const service = new JiraCommentSyncService(
    links as unknown as Repository<JiraIssueMappingEntity>,
    gateway,
    auth as unknown as AuthFacade,
    boards as unknown as BoardsFacade,
    logs as unknown as Repository<SyncLogEntity>,
    retry,
  );
  return { service, links, gateway, retry, auth, boards, logs };
}

const firstLog = (logs: { save: jest.Mock }): SavedLog => logs.save.mock.calls[0][0] as SavedLog;

describe('JiraCommentSyncService', () => {
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('ignores non-user events without reading the mapping', async () => {
    const { service, links, gateway, auth, boards, logs } = setup();

    await service.syncComment(makeEvent({ origin: 'jira' }));

    expect(links.findOne).not.toHaveBeenCalled();
    expect(auth.getUserById).not.toHaveBeenCalled();
    expect(gateway.addComment).not.toHaveBeenCalled();
    expect(boards.markCommentSynced).not.toHaveBeenCalled();
    expect(logs.save).not.toHaveBeenCalled();
  });

  it('reads the mapping by board and card and posts the attributed ADF body', async () => {
    const { service, links, gateway, auth, boards, logs } = setup();

    await service.syncComment(makeEvent({ text: 'Looks good' }));

    expect(links.findOne).toHaveBeenCalledWith({
      where: { boardId: 'board-1', cardId: 'card-1' },
      select: { id: true, jiraIssueKey: true },
    });
    expect(auth.getUserById).toHaveBeenCalledWith('user-1');
    expect(gateway.addComment).toHaveBeenCalledTimes(1);
    const input = gateway.addComment.mock.calls[0][0] as AddCommentInput & {
      timeBudgetMs?: number;
    };
    expect(input).toMatchObject({ boardId: 'board-1', issueIdOrKey: 'KAN-1' });
    expect(input.body).toEqual(plainTextToAdf('[BoardSync] Ada Lovelace: Looks good'));
    expect(input.timeBudgetMs).toBeGreaterThanOrEqual(250);
    expect(input.timeBudgetMs).toBeLessThanOrEqual(5_000);
    expect(boards.markCommentSynced).toHaveBeenCalledWith('card-1', 'comment-1');

    expect(logs.save).toHaveBeenCalledTimes(1);
    expect(firstLog(logs)).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      mappingId: 'mapping-1',
      errorMessage: null,
      payload: {
        commentId: 'comment-1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        jiraCommentId: 'jira-comment-1',
        latencyMs: expect.any(Number),
      },
    });
    expect(firstLog(logs).payload).not.toHaveProperty('reason');

    const loggerText = [debugSpy, warnSpy, errorSpy, logSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join(' ');
    expect(loggerText).not.toContain('Looks good');
  });

  it('skips an unmapped card with a debug message and no attempt', async () => {
    const { service, gateway, boards, logs } = setup({ link: null });

    await service.syncComment(makeEvent());

    expect(debugSpy).toHaveBeenCalled();
    expect(gateway.addComment).not.toHaveBeenCalled();
    expect(boards.markCommentSynced).not.toHaveBeenCalled();
    expect(logs.save).not.toHaveBeenCalled();
  });

  it.each<[string, { displayName: string } | null]>([
    ['missing', null],
    ['blank', { displayName: '   ' }],
  ])('uses Unknown user for a %s display name', async (_label, author) => {
    const { service, gateway } = setup({ author });

    await service.syncComment(makeEvent({ text: 'Still posted' }));

    expect(gateway.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: plainTextToAdf('[BoardSync] Unknown user: Still posted'),
      }),
    );
  });

  it('uses Unknown user when the author lookup fails and still posts', async () => {
    const { service, gateway } = setup({ author: new Error('auth unavailable') });

    await service.syncComment(makeEvent({ text: 'Fallback text' }));

    expect(warnSpy).toHaveBeenCalled();
    expect(gateway.addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: plainTextToAdf('[BoardSync] Unknown user: Fallback text'),
      }),
    );
  });

  it('maps a 404 to issue not found and leaves the comment unsynced', async () => {
    const { service, gateway, boards, logs } = setup({
      addCommentError: new JiraClientError(404, 'Issue does not exist'),
    });
    const event = makeEvent();

    await service.syncComment(event);

    expect(gateway.addComment).toHaveBeenCalledTimes(1);
    expect(boards.markCommentSynced).not.toHaveBeenCalled();
    expect(event.payload.syncedToJira).toBe(false);
    expect(logs.save).toHaveBeenCalledTimes(1);
    expect(firstLog(logs)).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.FAILED,
      mappingId: 'mapping-1',
      errorMessage: expect.stringContaining('Issue does not exist'),
      payload: {
        commentId: 'comment-1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        reason: 'issue not found',
        latencyMs: expect.any(Number),
      },
    });
  });

  it('maps a typed gateway failure to jira error without retrying or marking', async () => {
    const text = 'Do not log this comment text';
    const { service, gateway, boards, logs } = setup({
      addCommentError: new JiraServerError(503, 1, 1),
    });
    const event = makeEvent({ text });

    await service.syncComment(event);

    expect(gateway.addComment).toHaveBeenCalledTimes(1);
    expect(boards.markCommentSynced).not.toHaveBeenCalled();
    expect(event.payload.syncedToJira).toBe(false);
    expect(logs.save).toHaveBeenCalledTimes(1);
    expect(firstLog(logs)).toMatchObject({
      status: SyncStatus.FAILED,
      payload: {
        commentId: 'comment-1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        reason: 'jira error',
        latencyMs: expect.any(Number),
      },
      errorMessage: expect.stringContaining('Jira server error'),
    });
    const loggerText = [debugSpy, warnSpy, errorSpy, logSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join(' ');
    expect(loggerText).not.toContain(text);
  });

  it.each([
    ['missing scope', new JiraClientError(403, 'missing_scope'), undefined],
    ['not connected', new JiraUnauthorizedError('connection not found'), undefined],
    ['deadline exceeded', new JiraTimeoutError(1, 1), 'unknown'],
  ])('records %s as its own reason', async (reason, addCommentError, outcome) => {
    const { service, boards, logs } = setup({ addCommentError });

    await service.syncComment(makeEvent());

    expect(boards.markCommentSynced).not.toHaveBeenCalled();
    expect(firstLog(logs)).toMatchObject({ status: SyncStatus.FAILED, payload: { reason } });
    expect(firstLog(logs).payload['outcome']).toBe(outcome);
  });

  it('does not mark a plain 403 or 5xx as outcome unknown', async () => {
    const { service, logs } = setup({ addCommentError: new JiraClientError(403, 'forbidden') });

    await service.syncComment(makeEvent());

    expect(firstLog(logs).payload).toMatchObject({ reason: 'jira error' });
    expect(firstLog(logs).payload['outcome']).toBeUndefined();
  });

  it('sends a multi-line comment as one ADF paragraph per line', async () => {
    const { service, gateway } = setup();

    await service.syncComment(makeEvent({ text: 'first\nsecond\r\n\nfourth' }));

    expect(gateway.addComment.mock.calls[0][0].body.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '[BoardSync] Ada Lovelace: first' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'fourth' }] },
    ]);
  });

  it('rejects an invalid issue key before calling Jira', async () => {
    const { service, gateway, logs } = setup({
      link: { id: 'mapping-1', jiraIssueKey: 'not-a-key' },
    });

    await service.syncComment(makeEvent());

    expect(gateway.addComment).not.toHaveBeenCalled();
    expect(firstLog(logs)).toMatchObject({
      status: SyncStatus.FAILED,
      mappingId: 'mapping-1',
      payload: {
        issueKey: 'not-a-key',
        reason: 'invalid issue key',
        latencyMs: expect.any(Number),
      },
    });
  });

  it('does not call Jira when the five-second budget is already exhausted', async () => {
    const { service, gateway, logs } = setup();
    const occurredAt = new Date(Date.now() - 10_000).toISOString();

    await service.syncComment(makeEvent({ occurredAt }));

    expect(gateway.addComment).not.toHaveBeenCalled();
    expect(firstLog(logs)).toMatchObject({
      status: SyncStatus.FAILED,
      payload: {
        commentId: 'comment-1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        reason: 'deadline exceeded',
        latencyMs: expect.any(Number),
      },
    });
  });

  it('maps unexpected errors to sync failed', async () => {
    const { service, logs } = setup({ addCommentError: new Error('boom') });

    await service.syncComment(makeEvent());

    expect(firstLog(logs)).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'sync failed', latencyMs: expect.any(Number) },
      errorMessage: 'boom',
    });
    expect(errorSpy).toHaveBeenCalled();
  });
});
