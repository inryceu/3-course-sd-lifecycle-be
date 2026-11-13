import { BadGatewayException, ConflictException, ForbiddenException } from '@nestjs/common';
import { JiraServerError } from '../domain/jira-gateway.errors';
import { SyncStatus } from '../infrastructure/persistence/sync-log.entity';
import { JiraSyncConflictsService } from './jira-sync-conflicts.service';

const CREATED = new Date('2026-11-13T10:00:05.000Z');
const ROW = {
  id: 'conflict-1',
  boardId: 'board-1',
  cardId: 'card-1',
  mappingId: 'link-1',
  jiraIssueKey: 'KAN-1',
  boardColumnId: 'col-done',
  boardStatus: 'Done',
  boardChangedAt: new Date('2026-11-13T10:00:01.000Z'),
  jiraColumnId: 'col-doing',
  jiraStatus: 'In Progress',
  jiraChangedAt: new Date('2026-11-13T10:00:00.000Z'),
  resolution: 'jira',
  resolvedAt: null as Date | null,
  resolvedById: null as string | null,
  createdAt: CREATED,
  updatedAt: CREATED,
};
const LINKED = { board: { id: 'board-1', jiraProjectKey: 'KAN', columns: [] }, projectKey: 'KAN' };
const DONE = { id: '9', name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } };

function setup() {
  let current = { ...ROW };
  const conflicts = {
    findOne: jest.fn(() => Promise.resolve({ ...current })),
    update: jest.fn((_where: unknown, values: Partial<typeof ROW>) => {
      current = { ...current, ...values };
      return Promise.resolve({ affected: 1 });
    }),
  };
  const statusMappings = {
    requireRole: jest.fn().mockResolvedValue('ADMIN'),
    requireLinkedBoard: jest.fn().mockResolvedValue(LINKED),
    columnsByStatus: jest.fn().mockResolvedValue(new Map([['9', 'col-done']])),
  };
  const gateway = { getIssue: jest.fn().mockResolvedValue({ id: '1', key: 'KAN-1', status: DONE }) };
  const statusSync = {
    push: jest.fn().mockResolvedValue({ status: SyncStatus.SUCCESS, reason: null }),
  };
  const boards = { moveCardFromExternal: jest.fn().mockResolvedValue('moved') };
  const service = new JiraSyncConflictsService(
    conflicts as never,
    statusMappings as never,
    gateway as never,
    statusSync as never,
    boards as never,
  );
  return { service, conflicts, statusMappings, gateway, statusSync, boards };
}

describe('JiraSyncConflictsService.resolve', () => {
  it('keeps the Jira version: moves the card to the column of the current Jira status', async () => {
    const ctx = setup();

    const view = await ctx.service.resolve('admin-1', 'conflict-1', 'jira');

    expect(ctx.statusMappings.requireRole).toHaveBeenCalledWith('admin-1', 'board-1', true);
    expect(ctx.gateway.getIssue).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'board-1', issueIdOrKey: 'KAN-1' }),
    );
    expect(ctx.boards.moveCardFromExternal).toHaveBeenCalledWith({
      boardId: 'board-1',
      jiraIssueKey: 'KAN-1',
      columnId: 'col-done',
    });
    expect(ctx.statusSync.push).not.toHaveBeenCalled();
    expect(view).toMatchObject({ resolution: 'jira', resolvedById: 'admin-1' });
    expect(view.resolvedAt).not.toBeNull();
  });

  it('pushes the BoardSync version through the status sync, then moves the card', async () => {
    const ctx = setup();

    const view = await ctx.service.resolve('admin-1', 'conflict-1', 'boardsync');

    expect(ctx.statusSync.push).toHaveBeenCalledWith({
      boardId: 'board-1',
      cardId: 'card-1',
      issueKey: 'KAN-1',
      fromColumnId: 'col-doing',
      toColumnId: 'col-done',
    });
    expect(ctx.boards.moveCardFromExternal).toHaveBeenCalledWith({
      boardId: 'board-1',
      jiraIssueKey: 'KAN-1',
      columnId: 'col-done',
    });
    expect(view).toMatchObject({ resolution: 'boardsync', resolvedById: 'admin-1' });
  });

  it('claims the conflict once; a resolved conflict answers 409', async () => {
    const ctx = setup();
    ctx.conflicts.update.mockResolvedValueOnce({ affected: 0 });

    await expect(ctx.service.resolve('admin-1', 'conflict-1', 'jira')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ctx.gateway.getIssue).not.toHaveBeenCalled();
  });

  it('answers 502, leaves the card and reopens the conflict when the push fails', async () => {
    const ctx = setup();
    ctx.statusSync.push.mockResolvedValue({ status: SyncStatus.FAILED, reason: 'jira error' });

    await expect(
      ctx.service.resolve('admin-1', 'conflict-1', 'boardsync'),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.conflicts.update).toHaveBeenLastCalledWith(
      { id: 'conflict-1' },
      { resolution: 'jira', resolvedAt: null, resolvedById: null },
    );
  });

  it('maps a Jira failure while keeping the Jira version to 502 and reopens the conflict', async () => {
    const ctx = setup();
    ctx.gateway.getIssue.mockRejectedValue(new JiraServerError(503, 1, 1));

    await expect(ctx.service.resolve('admin-1', 'conflict-1', 'jira')).rejects.toMatchObject({
      status: 502,
    });
    expect(ctx.conflicts.update).toHaveBeenCalledTimes(2);
  });

  it('refuses a non-admin before claiming', async () => {
    const ctx = setup();
    ctx.statusMappings.requireRole.mockRejectedValue(new ForbiddenException());

    await expect(ctx.service.resolve('member-1', 'conflict-1', 'jira')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.conflicts.update).not.toHaveBeenCalled();
  });
});
