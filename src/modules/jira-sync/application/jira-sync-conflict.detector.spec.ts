import { Logger } from '@nestjs/common';
import { ColumnType } from '../../boards';
import {
  CONFLICT_WINDOW_MS,
  isConflict,
  JiraSyncConflictDetector,
} from './jira-sync-conflict.detector';

const T0 = new Date('2026-11-13T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const REF = { linkId: 'link-1', boardId: 'board-1', cardId: 'card-1', issueKey: 'KAN-1' };
const BOARD = {
  id: 'board-1',
  jiraProjectKey: 'KAN',
  columns: [
    { id: 'col-doing', title: 'In Progress', type: ColumnType.IN_PROGRESS, position: 1 },
    { id: 'col-done', title: 'Done', type: ColumnType.DONE, position: 2 },
  ],
};

function setup() {
  const links = { query: jest.fn().mockResolvedValue([]) };
  const logs = { query: jest.fn().mockResolvedValue([]) };
  const conflicts = {
    save: jest.fn((row: Record<string, unknown>) => Promise.resolve({ id: 'conflict-1', ...row })),
  };
  const boards = {
    getBoardSummary: jest.fn().mockResolvedValue(BOARD),
    notifyBoardAdmins: jest.fn().mockResolvedValue(1),
  };
  const detector = new JiraSyncConflictDetector(
    links as never,
    logs as never,
    conflicts as never,
    boards as never,
  );
  return { detector, links, logs, conflicts, boards };
}

describe('isConflict (5-second window)', () => {
  const board = (ms: number, columnId = 'col-done') => ({ columnId, at: at(ms) });
  const jira = (ms: number, columnId = 'col-doing') => ({ columnId, statusName: 'X', at: at(ms) });

  it('is a conflict when the Jira change follows the user move within 5 s', () => {
    expect(isConflict(board(0), jira(2_000))).toBe(true);
  });

  it('is a conflict when the user move follows the Jira change within 5 s', () => {
    expect(isConflict(board(2_000), jira(0))).toBe(true);
  });

  it('includes the 5000 ms boundary and excludes 5001 ms', () => {
    expect(CONFLICT_WINDOW_MS).toBe(5_000);
    expect(isConflict(board(0), jira(5_000))).toBe(true);
    expect(isConflict(board(5_001), jira(0))).toBe(false);
  });

  it('is not a conflict when both sides end in the same column', () => {
    expect(isConflict(board(0, 'col-done'), jira(1_000, 'col-done'))).toBe(false);
  });

  it('is not a conflict when one side has no recent change', () => {
    expect(isConflict(null, jira(0))).toBe(false);
    expect(isConflict(board(0), null)).toBe(false);
  });
});

describe('JiraSyncConflictDetector', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the conflict when a Jira change meets a recent user move to another column', async () => {
    const ctx = setup();
    ctx.links.query.mockResolvedValue([{ at: at(0), columnId: 'col-done' }]);

    const conflict = await ctx.detector.noteJiraChange(REF, {
      columnId: 'col-doing',
      statusId: '3',
      statusName: 'In Progress',
      at: at(1_500),
    });

    expect(conflict).toEqual({
      ...REF,
      board: { columnId: 'col-done', at: at(0) },
      jira: { columnId: 'col-doing', statusName: 'In Progress', at: at(1_500) },
    });
    // the echo check looked for an own transition to status 3 since 5 s before the change
    expect(ctx.logs.query.mock.calls[0][1]).toEqual(['link-1', '3', at(1_500 - 5_000)]);
  });

  it('ignores an echo of an own transition and records nothing', async () => {
    const ctx = setup();
    ctx.logs.query.mockResolvedValue([{ echo: 1 }]);

    const conflict = await ctx.detector.noteJiraChange(REF, {
      columnId: 'col-doing',
      statusId: '3',
      statusName: 'In Progress',
      at: at(0),
    });

    expect(conflict).toBeNull();
    expect(ctx.links.query).not.toHaveBeenCalled();
  });

  it('returns the conflict when a user move meets a recent Jira change to another column', async () => {
    const ctx = setup();
    ctx.links.query.mockResolvedValue([
      { at: at(0), columnId: 'col-doing', statusName: 'In Progress' },
    ]);

    const conflict = await ctx.detector.noteBoardMove(REF, { columnId: 'col-done', at: at(1_000) });

    expect(conflict?.jira).toEqual({ columnId: 'col-doing', statusName: 'In Progress', at: at(0) });
    expect(ctx.links.query.mock.calls[0][1]).toEqual(['link-1', at(1_000), 'col-done']);
  });

  it('returns null for a user move with no recent Jira change', async () => {
    const ctx = setup();
    ctx.links.query.mockResolvedValue([{ at: null, columnId: null, statusName: null }]);

    await expect(
      ctx.detector.noteBoardMove(REF, { columnId: 'col-done', at: at(0) }),
    ).resolves.toBeNull();
  });

  it('stores the conflict with resolution jira and notifies the board admins', async () => {
    const ctx = setup();

    await ctx.detector.record({
      ...REF,
      board: { columnId: 'col-done', at: at(0) },
      jira: { columnId: 'col-doing', statusName: 'In Progress', at: at(1_000) },
    });

    expect(ctx.conflicts.save).toHaveBeenCalledWith({
      boardId: 'board-1',
      cardId: 'card-1',
      mappingId: 'link-1',
      jiraIssueKey: 'KAN-1',
      boardColumnId: 'col-done',
      boardStatus: 'Done',
      boardChangedAt: at(0),
      jiraColumnId: 'col-doing',
      jiraStatus: 'In Progress',
      jiraChangedAt: at(1_000),
      resolution: 'jira',
      resolvedAt: null,
      resolvedById: null,
    });
    expect(ctx.boards.notifyBoardAdmins).toHaveBeenCalledWith('board-1', 'jira.conflict', {
      conflictId: 'conflict-1',
      boardId: 'board-1',
      cardId: 'card-1',
      jiraIssueKey: 'KAN-1',
      boardStatus: 'Done',
      jiraStatus: 'In Progress',
    });
  });
});
