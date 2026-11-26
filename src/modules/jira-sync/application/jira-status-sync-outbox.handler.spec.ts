import { NotFoundException } from '@nestjs/common';
import { SyncOutboxEntity } from '../../../common/outbox/infrastructure/persistence/sync-outbox.entity';
import { OutboxAttemptContext, OutboxHandlerResult } from '../../../common/outbox/outbox-handler';
import { OutboxHandlerRegistry } from '../../../common/outbox/outbox-handler.registry';
import { JiraClientError, JiraServerError, JiraTimeoutError } from '../domain/jira-gateway.errors';
import { JiraStatusSyncOutboxHandler } from './jira-status-sync-outbox.handler';

const status = (id: string, name: string) => ({
  id,
  name,
  statusCategory: { id: 1, key: 'new', name: 'new' },
});
const TODO = status('1', 'To Do');
const DONE = status('9', 'Done');
const COLUMN_OF: Record<string, string> = { '1': 'todo', '9': 'done' };

const transition = (id: string, to: ReturnType<typeof status>, isAvailable = true) => ({
  id,
  name: `T${id}`,
  to,
  hasScreen: false,
  isGlobal: true,
  isInitial: false,
  isConditional: false,
  isAvailable,
});

describe('JiraStatusSyncOutboxHandler', () => {
  const gateway = { getIssue: jest.fn(), listTransitions: jest.fn(), doTransition: jest.fn() };
  const statusMappings = {
    requireLinkedBoard: jest.fn(),
    resolveMappings: jest.fn(),
  };
  const logs = { save: jest.fn() };
  const links = { findOne: jest.fn() };
  const conflicts = {
    noteBoardMove: jest.fn(),
    overtakenBy: jest.fn(),
    record: jest.fn(),
  };
  const boards = { moveCardFromExternal: jest.fn() };
  const registry = { register: jest.fn() } as unknown as OutboxHandlerRegistry;

  const handler = new JiraStatusSyncOutboxHandler(
    registry,
    statusMappings as never,
    gateway as never,
    logs as never,
    links as never,
    conflicts as never,
    boards as never,
  );

  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'o1',
      boardId: 'b1',
      payload: {
        cardId: 'c1',
        jiraIssueKey: 'KAN-1',
        fromColumnId: 'todo',
        targetColumnId: 'done',
        ...overrides,
      },
    }) as unknown as SyncOutboxEntity;

  const ctx = (): OutboxAttemptContext => ({
    attempt: 1,
    timeBudgetMs: 5000,
    deadline: Date.now() + 5000,
  });

  const failure = (r: OutboxHandlerResult) => {
    if (r.status !== 'FAILED') throw new Error('expected a failure');
    return r;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    statusMappings.requireLinkedBoard.mockResolvedValue({});
    statusMappings.resolveMappings.mockImplementation((_l: unknown, statuses: { id: string }[]) =>
      Promise.resolve(
        statuses.map((s) => ({ jiraStatusId: s.id, columnId: COLUMN_OF[s.id], isDefault: false })),
      ),
    );
    gateway.getIssue.mockResolvedValue({ id: '1', key: 'KAN-1', status: TODO });
    gateway.listTransitions.mockResolvedValue({ transitions: [transition('31', DONE)] });
    gateway.doTransition.mockResolvedValue(undefined);
    links.findOne.mockResolvedValue(null);
    conflicts.noteBoardMove.mockResolvedValue(null);
    conflicts.overtakenBy.mockResolvedValue(null);
    conflicts.record.mockResolvedValue(undefined);
    boards.moveCardFromExternal.mockResolvedValue('moved');
    logs.save.mockResolvedValue(undefined);
  });

  it('registers itself for TRANSITION_ISSUE', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('is a no-op when Jira already has the target status', async () => {
    gateway.getIssue.mockResolvedValue({ id: '1', key: 'KAN-1', status: DONE });
    const result = await handler.handle(row(), ctx());
    expect(result).toMatchObject({ status: 'SENT', result: { outcome: 'no-op' } });
    expect(gateway.listTransitions).not.toHaveBeenCalled();
    expect(gateway.doTransition).not.toHaveBeenCalled();
  });

  it('executes one direct transition and writes one SUCCESS sync log', async () => {
    const result = await handler.handle(row(), ctx());
    expect(result).toMatchObject({ status: 'SENT', result: { outcome: 'transitioned' } });
    expect(gateway.doTransition).toHaveBeenCalledTimes(1);
    expect(logs.save).toHaveBeenCalledTimes(1);
  });

  it('dead-letters with no_transition_path when no direct transition exists', async () => {
    gateway.listTransitions.mockResolvedValue({ transitions: [transition('31', DONE, false)] });
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: false, errorCode: 'no_transition_path' });
    expect(gateway.doTransition).not.toHaveBeenCalled();
  });

  it('treats 400 as transient when the issue status changed meanwhile', async () => {
    gateway.doTransition.mockRejectedValue(new JiraClientError(400, 'rejected'));
    gateway.getIssue
      .mockResolvedValueOnce({ id: '1', key: 'KAN-1', status: TODO })
      .mockResolvedValueOnce({ id: '1', key: 'KAN-1', status: status('5', 'Other') });
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: true, errorCode: 'status_changed' });
  });

  it('treats 400 as permanent when the issue status is unchanged', async () => {
    gateway.doTransition.mockRejectedValue(new JiraClientError(400, 'rejected'));
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: false, errorCode: 'transition_rejected' });
  });

  it('retries a timed-out doTransition (outcome unknown)', async () => {
    gateway.doTransition.mockRejectedValue(
      Object.assign(Object.create(JiraTimeoutError.prototype) as Error, { message: 'timeout' }),
    );
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: true, errorCode: 'deadline_exceeded' });
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ outcome: 'unknown' }) }),
    );
  });

  it('dead-letters board_not_linked when the board lost its Jira link', async () => {
    statusMappings.requireLinkedBoard.mockRejectedValue(new NotFoundException('no board'));
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: false, errorCode: 'board_not_linked' });
    expect(gateway.getIssue).not.toHaveBeenCalled();
  });

  it('retries an unexpected error while resolving the board', async () => {
    statusMappings.requireLinkedBoard.mockRejectedValue(new Error('db down'));
    const result = failure(await handler.handle(row(), ctx()));
    expect(result).toMatchObject({ retryable: true, errorCode: 'jira_error' });
  });

  it('retries without calling Jira when the attempt has no time left', async () => {
    const expired = { ...ctx(), deadline: Date.now() };
    const result = failure(await handler.handle(row(), expired));
    expect(result).toMatchObject({ retryable: true, errorCode: 'deadline_exceeded' });
    expect(gateway.getIssue).not.toHaveBeenCalled();
  });

  it('prefers an explicit mapping, then the lowest status and transition id', async () => {
    const REVIEW = status('7', 'Review');
    gateway.listTransitions.mockResolvedValue({
      transitions: [transition('32', REVIEW), transition('31', DONE), transition('30', DONE)],
    });
    statusMappings.resolveMappings.mockImplementation((_l: unknown, statuses: { id: string }[]) =>
      Promise.resolve(
        statuses.map((s) => ({
          jiraStatusId: s.id,
          columnId: s.id === '1' ? 'todo' : 'done',
          isDefault: s.id === '7',
        })),
      ),
    );
    await handler.handle(row(), ctx());
    expect(gateway.doTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionId: '30' }),
    );
  });

  it('still returns the result when the sync log cannot be written', async () => {
    logs.save.mockRejectedValue(new Error('db down'));
    await expect(handler.handle(row(), ctx())).resolves.toMatchObject({ status: 'SENT' });
  });

  describe('KAN-45 conflicts', () => {
    const lost = {
      linkId: 'l1',
      boardId: 'b1',
      cardId: 'c1',
      issueKey: 'KAN-1',
      board: { columnId: 'done', at: new Date('2026-11-26T10:00:00Z') },
      jira: { columnId: 'doing', statusName: 'In Progress', at: new Date('2026-11-26T10:00:02Z') },
    };

    beforeEach(() => links.findOne.mockResolvedValue({ id: 'l1' }));

    it('notes the move with its occurredAt before sending', async () => {
      await handler.handle(row({ occurredAt: '2026-11-26T10:00:00.000Z' }), ctx());
      expect(conflicts.noteBoardMove).toHaveBeenCalledWith(
        { linkId: 'l1', boardId: 'b1', cardId: 'c1', issueKey: 'KAN-1' },
        { columnId: 'done', at: new Date('2026-11-26T10:00:00.000Z') },
      );
      expect(gateway.doTransition).toHaveBeenCalledTimes(1);
    });

    it('drops a move that lost to a Jira change seen at note time: Jira wins, no calls', async () => {
      conflicts.noteBoardMove.mockResolvedValue(lost);
      const result = await handler.handle(row(), ctx());
      expect(result).toMatchObject({ status: 'SENT', result: { outcome: 'conflict' } });
      expect(boards.moveCardFromExternal).toHaveBeenCalledWith({
        boardId: 'b1',
        jiraIssueKey: 'KAN-1',
        columnId: 'doing',
      });
      expect(conflicts.record).toHaveBeenCalledWith(lost);
      expect(gateway.getIssue).not.toHaveBeenCalled();
      expect(gateway.doTransition).not.toHaveBeenCalled();
      expect(logs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'CONFLICT',
          payload: expect.objectContaining({ outcome: 'conflict' }),
        }),
      );
    });

    it('drops a move overtaken by a Jira change right before doTransition', async () => {
      conflicts.overtakenBy.mockResolvedValueOnce(null).mockResolvedValueOnce(lost);
      const result = await handler.handle(row(), ctx());
      expect(result).toMatchObject({ status: 'SENT', result: { outcome: 'conflict' } });
      expect(gateway.doTransition).not.toHaveBeenCalled();
      expect(conflicts.record).toHaveBeenCalledWith(lost);
    });

    it('skips detection for an issue without a mapping row', async () => {
      links.findOne.mockResolvedValue(null);
      await handler.handle(row(), ctx());
      expect(conflicts.noteBoardMove).not.toHaveBeenCalled();
      expect(gateway.doTransition).toHaveBeenCalledTimes(1);
    });
  });

  it('retries 5xx and 429, dead-letters 403 and 404', async () => {
    gateway.getIssue.mockRejectedValueOnce(new JiraServerError(503, 3, 3));
    expect(failure(await handler.handle(row(), ctx()))).toMatchObject({ retryable: true });

    gateway.getIssue.mockRejectedValueOnce(new JiraClientError(429, 'slow down'));
    expect(failure(await handler.handle(row(), ctx()))).toMatchObject({
      retryable: true,
      errorCode: 'rate_limited',
    });

    gateway.getIssue.mockRejectedValueOnce(new JiraClientError(403, 'no'));
    expect(failure(await handler.handle(row(), ctx()))).toMatchObject({
      retryable: false,
      errorCode: 'jira_forbidden',
    });

    gateway.getIssue.mockRejectedValueOnce(new JiraClientError(404, 'gone'));
    expect(failure(await handler.handle(row(), ctx()))).toMatchObject({
      retryable: false,
      errorCode: 'jira_not_found',
    });
  });

  it('dead-letters an invalid issue key without calling Jira', async () => {
    const result = failure(await handler.handle(row({ jiraIssueKey: 'bad key' }), ctx()));
    expect(result).toMatchObject({ retryable: false, errorCode: 'invalid_payload' });
    expect(gateway.getIssue).not.toHaveBeenCalled();
  });
});
