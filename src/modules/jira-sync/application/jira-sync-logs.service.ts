import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade, BoardRole } from '../../boards';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';

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
}
