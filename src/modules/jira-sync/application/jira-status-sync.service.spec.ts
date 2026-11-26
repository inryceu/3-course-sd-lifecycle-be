import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole, BoardsFacade, BoardSummary, ColumnType } from '../../boards';
import { CardSnapshot, DomainEventOf } from '../../../common/events/domain-events';
import { JiraClientError, JiraServerError, JiraTimeoutError } from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStatusMappingEntity } from '../infrastructure/persistence/jira-status-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JiraGateway, JiraStatus, JiraTransition } from './jira-gateway.port';
import { JiraStatusMappingService } from './jira-status-mapping.service';
import { JiraStatusSyncService } from './jira-status-sync.service';
import { JiraSyncConflictDetector } from './jira-sync-conflict.detector';

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const DONE = status('9', 'Done', 'done');

const board: BoardSummary = {
  id: 'b1',
  jiraProjectKey: 'KAN',
  columns: [
    { id: 'col-todo', title: 'To Do', type: ColumnType.TODO, position: 0 },
    { id: 'col-doing', title: 'In Progress', type: ColumnType.IN_PROGRESS, position: 1 },
    { id: 'col-done', title: 'Done', type: ColumnType.DONE, position: 2 },
  ],
};

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

function makeEvent(
  options: {
    issueKey?: string | null;
    toColumnId?: string;
    fromColumnId?: string;
    origin?: 'user' | 'jira';
    occurredAt?: string;
  } = {},
): DomainEventOf<'card.moved'> {
  const toColumnId = options.toColumnId ?? 'col-done';
  const card: CardSnapshot = {
    id: 'card-1',
    boardId: 'b1',
    columnId: toColumnId,
    title: 'Card',
    description: null,
    deadline: null,
    jiraIssueKey: options.issueKey === undefined ? 'KAN-1' : options.issueKey,
    position: 0,
    assigneeId: null,
    labelIds: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  return {
    type: 'card.moved',
    boardId: 'b1',
    actorId: 'user-1',
    origin: options.origin ?? 'user',
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload: {
      card,
      fromColumnId: options.fromColumnId ?? 'col-todo',
      toColumnId,
      position: 0,
    },
  };
}

function setup(
  options: {
    boardSummary?: BoardSummary | null;
    connected?: boolean;
    stored?: Partial<JiraStatusMappingEntity>[];
    linkId?: string | null;
  } = {},
) {
  const facade = {
    getBoardSummary: jest
      .fn()
      .mockResolvedValue(options.boardSummary === undefined ? board : options.boardSummary),
    getMemberRole: jest.fn().mockResolvedValue(BoardRole.ADMIN),
    moveCardFromExternal: jest.fn().mockResolvedValue('moved'),
  } as unknown as jest.Mocked<BoardsFacade>;
  const gateway = {
    getIssue: jest.fn().mockResolvedValue({ id: '10001', key: 'KAN-1', status: TODO }),
    listTransitions: jest.fn().mockResolvedValue({ transitions: [transition('31', DONE)] }),
    doTransition: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<JiraGateway>;
  const statusRepo = {
    find: jest.fn().mockResolvedValue(options.stored ?? []),
  };
  const connections = {
    exist: jest.fn().mockResolvedValue(options.connected ?? true),
  };
  const links = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options.linkId === undefined || options.linkId === null ? null : { id: options.linkId },
      ),
  };
  const logs = {
    save: jest.fn().mockResolvedValue(undefined),
  };
  const conflicts = {
    noteBoardMove: jest.fn().mockResolvedValue(null),
    hasConflictingJiraChange: jest.fn().mockResolvedValue(false),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const mappings = new JiraStatusMappingService(
    statusRepo as unknown as Repository<JiraStatusMappingEntity>,
    connections as unknown as Repository<JiraConnectionEntity>,
    facade,
    gateway,
  );
  const service = new JiraStatusSyncService(
    mappings,
    gateway,
    logs as unknown as Repository<SyncLogEntity>,
    links as unknown as Repository<JiraIssueMappingEntity>,
    conflicts as unknown as JiraSyncConflictDetector,
    facade,
  );
  return { service, facade, gateway, statusRepo, connections, links, logs, conflicts };
}

describe('JiraStatusSyncService', () => {
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('records a successful no-op when the current status already maps to the destination', async () => {
    const { service, gateway, logs } = setup({ linkId: 'mapping-1' });
    gateway.getIssue.mockResolvedValue({ id: '10001', key: 'KAN-1', status: DONE });

    await service.syncCardMove(makeEvent());

    expect(gateway.listTransitions).not.toHaveBeenCalled();
    expect(gateway.doTransition).not.toHaveBeenCalled();
    expect(logs.save).toHaveBeenCalledTimes(1);
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      mappingId: 'mapping-1',
      errorMessage: null,
      payload: {
        cardId: 'card-1',
        issueKey: 'KAN-1',
        fromColumnId: 'col-todo',
        toColumnId: 'col-done',
        outcome: 'no-op',
        targetStatusId: DONE.id,
        targetStatusName: DONE.name,
      },
    });
    expect(logs.save.mock.calls[0][0].payload).not.toHaveProperty('transitionId');
  });

  it('executes one transition and records a successful transition', async () => {
    const { service, gateway, logs } = setup({ linkId: null });

    await service.syncCardMove(makeEvent());

    expect(gateway.listTransitions).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        issueIdOrKey: 'KAN-1',
        includeUnavailableTransitions: false,
        timeBudgetMs: expect.any(Number),
      }),
    );
    expect(gateway.doTransition).toHaveBeenCalledTimes(1);
    expect(gateway.doTransition).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'b1', issueIdOrKey: 'KAN-1', transitionId: '31' }),
    );
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      direction: SyncDirection.TO_JIRA,
      status: SyncStatus.SUCCESS,
      mappingId: null,
      errorMessage: null,
      payload: {
        cardId: 'card-1',
        issueKey: 'KAN-1',
        fromColumnId: 'col-todo',
        toColumnId: 'col-done',
        outcome: 'transitioned',
        targetStatusId: DONE.id,
        targetStatusName: DONE.name,
        transitionId: '31',
      },
    });
    expect(typeof logs.save.mock.calls[0][0].payload.latencyMs).toBe('number');
  });

  it('prefers an explicitly mapped target status', async () => {
    const first = status('5', 'Shipped', 'done');
    const explicitlyMapped = status('9', 'Done', 'done');
    const { service, gateway, logs } = setup({
      stored: [{ jiraStatusId: explicitlyMapped.id, columnId: 'col-done' }],
    });
    gateway.listTransitions.mockResolvedValue({
      transitions: [transition('31', first), transition('20', explicitlyMapped)],
    });

    await service.syncCardMove(makeEvent());

    expect(gateway.doTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionId: '20' }),
    );
    expect(logs.save.mock.calls[0][0].payload).toMatchObject({
      targetStatusId: explicitlyMapped.id,
      transitionId: '20',
    });
  });

  it('uses the lowest status id when neither target is explicitly mapped', async () => {
    const lower = status('5', 'Shipped', 'done');
    const higher = status('9', 'Done', 'done');
    const { service, gateway, logs } = setup();
    gateway.listTransitions.mockResolvedValue({
      transitions: [transition('20', higher), transition('31', lower)],
    });

    await service.syncCardMove(makeEvent());

    expect(gateway.doTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionId: '31' }),
    );
    expect(logs.save.mock.calls[0][0].payload).toMatchObject({ targetStatusId: lower.id });
  });

  it('uses the lowest transition id when two transitions target the chosen status', async () => {
    const { service, gateway, logs } = setup();
    gateway.listTransitions.mockResolvedValue({
      transitions: [transition('31', DONE), transition('20', DONE)],
    });

    await service.syncCardMove(makeEvent());

    expect(gateway.doTransition).toHaveBeenCalledWith(
      expect.objectContaining({ transitionId: '20' }),
    );
    expect(logs.save.mock.calls[0][0].payload).toMatchObject({ transitionId: '20' });
  });

  it('fails with no valid transition and does not transition', async () => {
    const { service, gateway, logs } = setup();
    gateway.listTransitions.mockResolvedValue({ transitions: [transition('31', DOING)] });

    await service.syncCardMove(makeEvent());

    expect(gateway.doTransition).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'no valid transition' },
      errorMessage: expect.stringContaining('col-done'),
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('maps a 404 from getIssue to issue not found', async () => {
    const { service, gateway, logs } = setup();
    gateway.getIssue.mockRejectedValue(new JiraClientError(404, 'Issue does not exist'));

    await service.syncCardMove(makeEvent());

    expect(gateway.listTransitions).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'issue not found' },
      errorMessage: expect.stringContaining('Issue does not exist'),
    });
  });

  it('rejects an invalid issue key before calling Jira', async () => {
    const { service, gateway, logs } = setup();

    await service.syncCardMove(makeEvent({ issueKey: 'not-a-key' }));

    expect(gateway.getIssue).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'invalid issue key' },
    });
  });

  it('fails with board not linked when the board has no linked project', async () => {
    const { service, gateway, logs } = setup({
      boardSummary: { ...board, jiraProjectKey: null },
    });

    await service.syncCardMove(makeEvent());

    expect(gateway.getIssue).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'board not linked' },
    });
  });

  it('stops before the first call when the five-second budget is already exhausted', async () => {
    const { service, gateway, logs } = setup();
    const occurredAt = new Date(Date.now() - 10_000).toISOString();

    await service.syncCardMove(makeEvent({ occurredAt }));

    expect(gateway.getIssue).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'deadline exceeded' },
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('records a gateway failure as jira error', async () => {
    const { service, gateway, logs } = setup();
    gateway.getIssue.mockRejectedValue(new JiraServerError(503, 3, 3));

    await service.syncCardMove(makeEvent());

    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'jira error' },
      errorMessage: expect.stringContaining('Jira server error'),
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not swallow a sync-log write failure', async () => {
    const { service, logs } = setup();
    logs.save.mockRejectedValue(new Error('database unavailable'));

    await expect(service.syncCardMove(makeEvent())).rejects.toThrow('database unavailable');
  });

  it('leaves Jira in the later status after two quick moves of one card', async () => {
    const { service, gateway, logs } = setup();
    let jiraStatus = TODO;
    const all = [transition('21', DOING), transition('31', DONE)];
    gateway.getIssue.mockImplementation(() =>
      Promise.resolve({ id: '10001', key: 'KAN-1', status: jiraStatus }),
    );
    gateway.listTransitions.mockImplementation(() =>
      Promise.resolve({ transitions: all.filter((t) => t.to.id !== jiraStatus.id) }),
    );
    // The first transition reaches Jira after the second one would have.
    let calls = 0;
    gateway.doTransition.mockImplementation(async (input) => {
      const delay = ++calls === 1 ? 60 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      jiraStatus = all.filter((t) => t.id === input.transitionId)[0].to;
    });

    await Promise.all([
      service.syncCardMove(makeEvent({ fromColumnId: 'col-todo', toColumnId: 'col-doing' })),
      service.syncCardMove(makeEvent({ fromColumnId: 'col-doing', toColumnId: 'col-done' })),
    ]);

    expect(jiraStatus).toEqual(DONE);
    expect(logs.save).toHaveBeenCalledTimes(2);
  });

  it('still runs the next move of an issue after the previous log write failed', async () => {
    const { service, gateway, logs } = setup();
    logs.save.mockRejectedValueOnce(new Error('database unavailable'));

    const first = service.syncCardMove(makeEvent());
    const second = service.syncCardMove(makeEvent());

    await expect(first).rejects.toThrow('database unavailable');
    await expect(second).resolves.toBeUndefined();
    expect(gateway.getIssue).toHaveBeenCalledTimes(2);
  });

  it('records a database failure while resolving the board as sync failed, reading the board once', async () => {
    const { service, facade, connections, gateway, logs } = setup();
    connections.exist.mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await service.syncCardMove(makeEvent());

    expect(gateway.getIssue).not.toHaveBeenCalled();
    expect(facade.getBoardSummary).toHaveBeenCalledTimes(1);
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'sync failed' },
      errorMessage: 'Connection terminated unexpectedly',
    });
  });

  it('fails with board not linked when the board has no Jira connection', async () => {
    const { service, logs } = setup({ connected: false });

    await service.syncCardMove(makeEvent());

    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'board not linked' },
    });
  });

  it('records a timed-out transition as an unknown outcome', async () => {
    const { service, gateway, logs } = setup();
    gateway.doTransition.mockRejectedValue(new JiraTimeoutError(1, 1));

    await service.syncCardMove(makeEvent());

    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.FAILED,
      payload: { reason: 'deadline exceeded', outcome: 'unknown', transitionId: '31' },
    });
    expect(errorSpy.mock.calls[0][0]).toContain('outcome unknown');
  });

  it('logs a successful synchronization with its latency', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup();

    await service.syncCardMove(makeEvent());

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/KAN-1 on board b1 completed in \d+ms/),
    );
  });

  it('ignores non-user, same-column and unlinked moves without writing a log', async () => {
    const user = setup();
    const jira = setup();
    const reorder = setup();
    const unlinked = setup();

    await user.service.syncCardMove(makeEvent());
    await jira.service.syncCardMove(makeEvent({ origin: 'jira' }));
    await reorder.service.syncCardMove(makeEvent({ toColumnId: 'col-todo' }));
    await unlinked.service.syncCardMove(makeEvent({ issueKey: null }));

    expect(jira.gateway.getIssue).not.toHaveBeenCalled();
    expect(reorder.gateway.getIssue).not.toHaveBeenCalled();
    expect(unlinked.gateway.getIssue).not.toHaveBeenCalled();
    expect(jira.logs.save).not.toHaveBeenCalled();
    expect(reorder.logs.save).not.toHaveBeenCalled();
    expect(unlinked.logs.save).not.toHaveBeenCalled();
    expect(user.logs.save).toHaveBeenCalledTimes(1);
  });
});

describe('JiraStatusSyncService conflicts', () => {
  const lost = {
    linkId: 'mapping-1',
    boardId: 'b1',
    cardId: 'card-1',
    issueKey: 'KAN-1',
    board: { columnId: 'col-done', at: new Date() },
    jira: { columnId: 'col-doing', statusName: 'In Progress', at: new Date() },
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('notes every user move of a mapped card with its destination and time', async () => {
    const { service, conflicts } = setup({ linkId: 'mapping-1' });
    const event = makeEvent();

    await service.syncCardMove(event);

    expect(conflicts.noteBoardMove).toHaveBeenCalledWith(
      { linkId: 'mapping-1', boardId: 'b1', cardId: 'card-1', issueKey: 'KAN-1' },
      { columnId: 'col-done', at: new Date(event.occurredAt) },
    );
  });

  it('a move that loses sends nothing, moves the card back, records the conflict and logs CONFLICT', async () => {
    const { service, conflicts, gateway, facade, logs } = setup({ linkId: 'mapping-1' });
    conflicts.noteBoardMove.mockResolvedValue(lost);

    await service.syncCardMove(makeEvent());

    expect(gateway.getIssue).not.toHaveBeenCalled();
    expect(gateway.doTransition).not.toHaveBeenCalled();
    expect(facade.moveCardFromExternal).toHaveBeenCalledWith({
      boardId: 'b1',
      jiraIssueKey: 'KAN-1',
      columnId: 'col-doing',
    });
    expect(conflicts.record).toHaveBeenCalledWith(lost);
    expect(logs.save).toHaveBeenCalledTimes(1);
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.CONFLICT,
      mappingId: 'mapping-1',
      payload: { outcome: 'conflict', toColumnId: 'col-done', jiraColumnId: 'col-doing' },
    });
  });

  it('does not send a pending transition once a conflicting Jira change was recorded', async () => {
    const { service, conflicts, gateway, facade, logs } = setup({ linkId: 'mapping-1' });
    conflicts.hasConflictingJiraChange.mockResolvedValue(true);

    await service.syncCardMove(makeEvent());

    expect(gateway.doTransition).not.toHaveBeenCalled();
    expect(facade.moveCardFromExternal).not.toHaveBeenCalled();
    expect(conflicts.record).not.toHaveBeenCalled();
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.CONFLICT,
      payload: { outcome: 'conflict' },
    });
  });

  it('push() skips the conflict check and returns the attempt status', async () => {
    const { service, conflicts, gateway, logs } = setup({ linkId: 'mapping-1' });
    conflicts.hasConflictingJiraChange.mockResolvedValue(true);

    const result = await service.push({
      boardId: 'b1',
      cardId: 'card-1',
      issueKey: 'KAN-1',
      fromColumnId: 'col-doing',
      toColumnId: 'col-done',
    });

    expect(result).toEqual({ status: SyncStatus.SUCCESS, reason: null });
    expect(conflicts.noteBoardMove).not.toHaveBeenCalled();
    expect(gateway.doTransition).toHaveBeenCalledTimes(1);
    expect(logs.save.mock.calls[0][0]).toMatchObject({
      status: SyncStatus.SUCCESS,
      payload: { outcome: 'transitioned' },
    });
  });

  it('push() reports the failure reason', async () => {
    const { service, gateway } = setup({ linkId: 'mapping-1' });
    gateway.doTransition.mockRejectedValue(new JiraServerError(503, 1, 1));

    await expect(
      service.push({
        boardId: 'b1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        fromColumnId: 'col-doing',
        toColumnId: 'col-done',
      }),
    ).resolves.toEqual({ status: SyncStatus.FAILED, reason: 'jira error' });
  });
});
