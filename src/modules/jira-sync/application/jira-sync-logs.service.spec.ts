import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole, BoardsFacade } from '../../boards';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStatusSyncService } from './jira-status-sync.service';
import { JiraCommentSyncService } from './jira-comment-sync.service';
import { JiraSyncLogsService } from './jira-sync-logs.service';

const NOW = new Date('2026-10-03T10:00:00.000Z');

function makeLog(overrides: Partial<SyncLogEntity> = {}): SyncLogEntity {
  return {
    id: 'log-1',
    direction: SyncDirection.TO_JIRA,
    status: SyncStatus.SUCCESS,
    payload: {},
    errorMessage: null,
    mappingId: null,
    mapping: undefined,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SyncLogEntity;
}

function makeMapping(overrides: Partial<JiraIssueMappingEntity> = {}): JiraIssueMappingEntity {
  return {
    id: 'mapping-1',
    boardId: 'board-1',
    jiraIssueKey: 'KAN-1',
    jiraIssueId: '10001',
    jiraProjectKey: 'KAN',
    cardId: 'card-1',
    createdById: 'user-1',
    lastJiraEventAt: null,
    ...overrides,
  } as JiraIssueMappingEntity;
}

function setup() {
  const logs: SyncLogEntity[] = [];
  const mappings: JiraIssueMappingEntity[] = [];

  const logsRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(logs.find((l) => l.id === where.id) ?? null),
    ),
    save: jest.fn((entity: SyncLogEntity) => {
      const idx = logs.findIndex((l) => l.id === entity.id);
      if (idx >= 0) logs[idx] = entity;
      else logs.push(entity);
      return Promise.resolve(entity);
    }),
    createQueryBuilder: jest.fn(() => {
      let filterBoardId: string | null = null;
      let filterStatus: SyncStatus | null = null;
      let filterCursor: string | null = null;
      let limitVal = 51;

      const query = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn((condition: string, params?: Record<string, unknown>) => {
          if (condition.includes('m.boardId = :boardId') && params) {
            filterBoardId = params['boardId'] as string;
          }
          return query;
        }),
        andWhere: jest.fn((condition: string, params?: Record<string, unknown>) => {
          if (condition.includes('l.status = :status') && params) {
            filterStatus = params['status'] as SyncStatus;
          }
          if (condition.includes('p.id = :cursor') && params) {
            filterCursor = params['cursor'] as string;
          }
          return query;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn((n: number) => {
          limitVal = n;
          return query;
        }),
        getMany: jest.fn(() => {
          const filtered = logs.filter((l) => {
            const mapping = mappings.find((m) => m.id === l.mappingId);
            const boardId = mapping?.boardId ?? (l.payload?.['boardId'] as string);
            if (filterBoardId && boardId !== filterBoardId) return false;
            if (filterStatus && l.status !== filterStatus) return false;
            if (filterCursor) {
              const cursorLog = logs.find((cl) => cl.id === filterCursor);
              if (cursorLog) {
                const cmp = l.createdAt.getTime() - cursorLog.createdAt.getTime();
                if (cmp > 0) return false;
                if (cmp === 0 && l.id >= filterCursor) return false;
              }
            }
            return true;
          });
          filtered.sort((a, b) => {
            const cmp = b.createdAt.getTime() - a.createdAt.getTime();
            if (cmp !== 0) return cmp;
            return b.id.localeCompare(a.id);
          });
          return filtered.slice(0, limitVal);
        }),
      };
      return query;
    }),
  } as unknown as jest.Mocked<Repository<SyncLogEntity>>;

  const mappingsRepo = {
    findOne: jest.fn(({ where }: { where: { boardId: string; jiraIssueKey: string } }) =>
      Promise.resolve(
        mappings.find(
          (m) => m.boardId === where.boardId && m.jiraIssueKey === where.jiraIssueKey,
        ) ?? null,
      ),
    ),
  } as unknown as jest.Mocked<Repository<JiraIssueMappingEntity>>;

  const boardsFacade = {
    getMemberRole: jest.fn(),
  } as unknown as jest.Mocked<BoardsFacade>;

  const statusSync = {
    push: jest.fn(),
  } as unknown as jest.Mocked<JiraStatusSyncService>;

  const commentSync = {
    syncComment: jest.fn(),
  } as unknown as jest.Mocked<JiraCommentSyncService>;

  const service = new JiraSyncLogsService(
    logsRepo,
    mappingsRepo,
    statusSync,
    commentSync,
    boardsFacade,
  );

  return {
    service,
    logsRepo,
    mappingsRepo,
    boardsFacade,
    statusSync,
    commentSync,
    logs: () => logs,
    mappings: () => mappings,
  };
}

describe('JiraSyncLogsService', () => {
  beforeEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('returns logs with cursor pagination', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      mappings().push(makeMapping({ id: 'mapping-1', boardId: 'board-1' }));
      logs().push(
        makeLog({
          id: 'log-1',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:00.000Z'),
        }),
        makeLog({
          id: 'log-2',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:01.000Z'),
        }),
        makeLog({
          id: 'log-3',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:02.000Z'),
        }),
        makeLog({
          id: 'log-4',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:03.000Z'),
        }),
        makeLog({
          id: 'log-5',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:04.000Z'),
        }),
      );

      const result = await service.list('user-1', 'board-1', 3);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe('log-5');
      expect(result.items[2].id).toBe('log-3');
      expect(result.nextCursor).toBe('log-3');
    });

    it('returns next page when using cursor', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      mappings().push(makeMapping({ id: 'mapping-1', boardId: 'board-1' }));
      logs().push(
        makeLog({
          id: 'log-1',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:00.000Z'),
        }),
        makeLog({
          id: 'log-2',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:01.000Z'),
        }),
        makeLog({
          id: 'log-3',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:02.000Z'),
        }),
        makeLog({
          id: 'log-4',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:03.000Z'),
        }),
        makeLog({
          id: 'log-5',
          mappingId: 'mapping-1',
          createdAt: new Date('2026-10-03T10:00:04.000Z'),
        }),
      );

      const page1 = await service.list('user-1', 'board-1', 2);
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].id).toBe('log-5');
      const cursor1 = page1.nextCursor;

      const page2 = await service.list('user-1', 'board-1', 2, cursor1);
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].id).toBe('log-3');
      expect(page2.nextCursor).toBe('log-2');
    });

    it('filters by status', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      mappings().push(makeMapping({ id: 'mapping-1', boardId: 'board-1' }));
      logs().push(
        makeLog({ id: 'log-1', mappingId: 'mapping-1', status: SyncStatus.SUCCESS }),
        makeLog({ id: 'log-2', mappingId: 'mapping-1', status: SyncStatus.FAILED }),
        makeLog({ id: 'log-3', mappingId: 'mapping-1', status: SyncStatus.SUCCESS }),
        makeLog({ id: 'log-4', mappingId: 'mapping-1', status: SyncStatus.FAILED }),
      );

      const result = await service.list('user-1', 'board-1', 50, undefined, SyncStatus.FAILED);

      expect(result.items).toHaveLength(2);
      expect(result.items.every((i) => i.status === SyncStatus.FAILED)).toBe(true);
    });

    it('rejects non-admin access with ForbiddenException', async () => {
      const { service, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.MEMBER);

      await expect(service.list('user-1', 'board-1')).rejects.toThrow(ForbiddenException);
      await expect(service.list('user-1', 'board-1')).rejects.toThrow(
        'Only board admins can view sync logs',
      );
    });

    it('rejects non-member access with ForbiddenException', async () => {
      const { service, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(null);

      await expect(service.list('user-1', 'board-1')).rejects.toThrow(ForbiddenException);
    });

    it('uses boardId from mapping when available', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      logs().push(
        makeLog({
          id: 'log-1',
          mappingId: 'mapping-1',
          mapping,
          createdAt: new Date('2026-10-03T10:00:00.000Z'),
        }),
      );

      const result = await service.list('user-1', 'board-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].boardId).toBe('board-1');
    });

    it('uses boardId from payload when mapping not available', async () => {
      const { service, logs, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      logs().push(
        makeLog({
          id: 'log-1',
          mappingId: null,
          payload: { boardId: 'board-1' },
          createdAt: new Date('2026-10-03T10:00:00.000Z'),
        }),
      );

      const result = await service.list('user-1', 'board-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].boardId).toBe('board-1');
    });
  });

  describe('retry', () => {
    it('retries failed status sync log with fromColumnId and toColumnId', async () => {
      const { service, logs, mappings, boardsFacade, statusSync } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);
      statusSync.push.mockResolvedValue({ status: SyncStatus.SUCCESS, reason: null });

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: {
          issueKey: 'KAN-1',
          cardId: 'card-1',
          fromColumnId: 'col-todo',
          toColumnId: 'col-doing',
          outcome: 'failed', // not 'unknown'
        },
      });
      logs().push(log);

      const result = await service.retry('user-1', 'log-1');

      expect(result).toEqual({ status: SyncStatus.SUCCESS, reason: null });
      expect(statusSync.push).toHaveBeenCalledWith({
        boardId: 'board-1',
        cardId: 'card-1',
        issueKey: 'KAN-1',
        fromColumnId: 'col-todo',
        toColumnId: 'col-doing',
      });
    });

    it('retries failed comment sync log', async () => {
      const { service, logs, mappings, boardsFacade, commentSync } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);
      commentSync.syncComment.mockResolvedValue(undefined);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: {
          issueKey: 'KAN-1',
          cardId: 'card-1',
          commentId: 'comment-1',
          outcome: 'failed', // not 'unknown'
          text: 'test comment',
          createdAt: NOW.toISOString(),
        },
      });
      logs().push(log);

      const result = await service.retry('user-1', 'log-1');

      expect(result).toEqual({ status: SyncStatus.SUCCESS, reason: null });
      expect(commentSync.syncComment).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'card.commented',
          boardId: 'board-1',
          actorId: 'user-1',
          payload: expect.objectContaining({
            id: 'comment-1',
            cardId: 'card-1',
            text: 'test comment',
          }),
        }),
      );
    });

    it('rejects non-admin access with ForbiddenException', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.MEMBER);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: { issueKey: 'KAN-1', cardId: 'card-1', outcome: 'failed' },
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'Only board admins can retry sync logs',
      );
    });

    it('throws NotFoundException when log does not exist', async () => {
      const { service, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      await expect(service.retry('user-1', 'non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.retry('user-1', 'non-existent')).rejects.toThrow('Sync log not found');
    });

    it('throws ForbiddenException when log is not FAILED', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.SUCCESS,
        mappingId: 'mapping-1',
        mapping,
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'Only failed sync logs can be retried',
      );
    });

    it('throws ForbiddenException when log is missing board reference', async () => {
      const { service, logs, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: null,
        mapping: undefined,
        payload: {},
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(NotFoundException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'Sync log is missing board reference',
      );
    });

    it('throws ForbiddenException when status sync log missing required data', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: {
          outcome: 'failed',
          // missing issueKey and cardId
        },
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'Sync log is missing required data for retry',
      );
    });

    it('throws ForbiddenException when comment sync log missing required data', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: {
          issueKey: 'KAN-1',
          cardId: 'card-1',
          // missing commentId and fromColumnId/toColumnId
          outcome: 'failed',
        },
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'This sync log cannot be retried',
      );
    });

    it('throws ForbiddenException when direction is FROM_JIRA', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.FROM_JIRA,
        payload: {
          issueKey: 'KAN-1',
          cardId: 'card-1',
          outcome: 'failed',
        },
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(
        'This sync log cannot be retried',
      );
    });

    it('throws ForbiddenException when outcome is unknown but fromColumnId or toColumnId missing', async () => {
      const { service, logs, mappings, boardsFacade } = setup();
      boardsFacade.getMemberRole.mockResolvedValue(BoardRole.ADMIN);

      const mapping = makeMapping({ id: 'mapping-1', boardId: 'board-1' });
      mappings().push(mapping);
      const log = makeLog({
        id: 'log-1',
        status: SyncStatus.FAILED,
        mappingId: 'mapping-1',
        mapping,
        direction: SyncDirection.TO_JIRA,
        payload: {
          issueKey: 'KAN-1',
          cardId: 'card-1',
          fromColumnId: 'col-todo',
          // missing toColumnId
          outcome: 'unknown',
        },
      });
      logs().push(log);

      await expect(service.retry('user-1', 'log-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
