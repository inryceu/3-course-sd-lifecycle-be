import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole, BoardsFacade } from '../../boards';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
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

  const service = new JiraSyncLogsService(logsRepo, mappingsRepo, boardsFacade);

  return {
    service,
    logsRepo,
    mappingsRepo,
    boardsFacade,
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
});
