import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade, BoardRole } from '../../boards';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStatusSyncService } from './jira-status-sync.service';
import { JiraCommentSyncService } from './jira-comment-sync.service';

export interface SyncLogView {
  id: string;
  boardId: string;
  direction: SyncDirection;
  status: SyncStatus;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  mappingId: string | null;
  createdAt: string;
}

export interface SyncLogPageView {
  items: SyncLogView[];
  nextCursor: string | null;
}

export interface RetryResult {
  status: SyncStatus;
  reason: string | null;
}

const toView = (row: SyncLogEntity): SyncLogView => ({
  id: row.id,
  boardId: row.mapping?.boardId ?? (row.payload['boardId'] as string) ?? '',
  direction: row.direction,
  status: row.status,
  payload: row.payload ?? {},
  errorMessage: row.errorMessage,
  mappingId: row.mappingId,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class JiraSyncLogsService {
  constructor(
    @InjectRepository(SyncLogEntity)
    private readonly logs: Repository<SyncLogEntity>,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly mappings: Repository<JiraIssueMappingEntity>,
    private readonly statusSync: JiraStatusSyncService,
    private readonly commentSync: JiraCommentSyncService,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  async list(
    userId: string,
    boardId: string,
    limit = 50,
    cursor?: string,
    status?: SyncStatus,
  ): Promise<SyncLogPageView> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (role !== BoardRole.ADMIN) {
      throw new ForbiddenException('Only board admins can view sync logs');
    }
    const query = this.logs
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.mapping', 'm')
      .where('m.boardId = :boardId', { boardId })
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .limit(limit + 1);
    if (status) {
      query.andWhere('l.status = :status', { status });
    }
    if (cursor) {
      query.andWhere(
        `(l.createdAt, l.id) < (SELECT p."createdAt", p.id FROM sync_logs p
            WHERE p.id = :cursor)`,
        { cursor },
      );
    }
    const rows = await query.getMany();
    const items = rows.slice(0, limit).map(toView);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async retry(userId: string, logId: string): Promise<RetryResult> {
    const log = await this.logs.findOne({
      where: { id: logId },
      relations: ['mapping'],
    });
    if (!log) {
      throw new NotFoundException('Sync log not found');
    }
    const boardId = log.mapping?.boardId ?? (log.payload['boardId'] as string);
    if (!boardId) {
      throw new NotFoundException('Sync log is missing board reference');
    }
    const role = await this.boards.getMemberRole(boardId, userId);
    if (role !== BoardRole.ADMIN) {
      throw new ForbiddenException('Only board admins can retry sync logs');
    }

    if (log.status !== SyncStatus.FAILED) {
      throw new ForbiddenException('Only failed sync logs can be retried');
    }

    const outcome = log.payload['outcome'] as string | undefined;
    const issueKey = log.payload['issueKey'] as string | undefined;
    const cardId = log.payload['cardId'] as string | undefined;
    const fromColumnId = log.payload['fromColumnId'] as string | undefined;
    const toColumnId = log.payload['toColumnId'] as string | undefined;

    if (!issueKey || !cardId) {
      throw new ForbiddenException('Sync log is missing required data for retry');
    }

    if (log.direction === SyncDirection.TO_JIRA) {
      if (outcome !== 'unknown' && fromColumnId && toColumnId) {
        const result = await this.statusSync.push({
          boardId,
          cardId,
          issueKey,
          fromColumnId,
          toColumnId,
        });
        return { status: result.status, reason: result.reason };
      }
      if (log.payload['commentId'] && outcome !== 'unknown') {
        await this.commentSync.syncComment({
          type: 'card.commented',
          boardId,
          actorId: userId,
          origin: 'user',
          occurredAt: new Date().toISOString(),
          payload: {
            id: log.payload['commentId'] as string,
            cardId,
            authorId: userId,
            text: (log.payload['text'] as string) ?? '',
            syncedToJira: false,
            createdAt: (log.payload['createdAt'] as string) ?? new Date().toISOString(),
          },
        });
        return { status: SyncStatus.SUCCESS, reason: null };
      }
    }

    throw new ForbiddenException('This sync log cannot be retried');
  }
}
