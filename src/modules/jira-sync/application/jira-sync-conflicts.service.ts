import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import {
  ConflictResolution,
  SyncConflictLogEntity,
} from '../infrastructure/persistence/sync-conflict-log.entity';
import { SyncStatus } from '../infrastructure/persistence/sync-log.entity';
import { toHttpError } from './jira-errors.mapper';
import { JIRA_GATEWAY, JiraGateway } from './jira-gateway.port';
import { JiraStatusMappingService } from './jira-status-mapping.service';
import { JiraStatusSyncService } from './jira-status-sync.service';

const JIRA_CALL_BUDGET_MS = 5_000;

export interface ConflictView {
  id: string;
  boardId: string;
  cardId: string;
  jiraIssueKey: string;
  boardColumnId: string;
  boardStatus: string;
  boardChangedAt: string;
  jiraColumnId: string;
  jiraStatus: string;
  jiraChangedAt: string;
  detectedAt: string;
  resolution: ConflictResolution;
  resolvedAt: string | null;
  resolvedById: string | null;
}

export interface ConflictPageView {
  items: ConflictView[];
  nextCursor: string | null;
}

const toView = (row: SyncConflictLogEntity): ConflictView => ({
  id: row.id,
  boardId: row.boardId,
  cardId: row.cardId,
  jiraIssueKey: row.jiraIssueKey,
  boardColumnId: row.boardColumnId,
  boardStatus: row.boardStatus,
  boardChangedAt: row.boardChangedAt.toISOString(),
  jiraColumnId: row.jiraColumnId,
  jiraStatus: row.jiraStatus,
  jiraChangedAt: row.jiraChangedAt.toISOString(),
  detectedAt: row.createdAt.toISOString(),
  resolution: row.resolution,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  resolvedById: row.resolvedById,
});

/** Lists and resolves logged sync conflicts (board admins only). */
@Injectable()
export class JiraSyncConflictsService {
  constructor(
    @InjectRepository(SyncConflictLogEntity)
    private readonly conflicts: Repository<SyncConflictLogEntity>,
    private readonly statusMappings: JiraStatusMappingService,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    private readonly statusSync: JiraStatusSyncService,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  /** Newest first; the cursor is the id of the last item of the previous page. */
  async list(
    userId: string,
    boardId: string,
    limit = 50,
    cursor?: string,
  ): Promise<ConflictPageView> {
    await this.statusMappings.requireRole(userId, boardId, true);
    const query = this.conflicts
      .createQueryBuilder('c')
      .where('c.boardId = :boardId', { boardId })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .limit(limit + 1);
    if (cursor) {
      query.andWhere(
        `(c.createdAt, c.id) < (SELECT p."createdAt", p.id FROM sync_conflict_log p
            WHERE p.id = :cursor AND p.board_id = :boardId)`,
        { cursor },
      );
    }
    const rows = await query.getMany();
    const items = rows.slice(0, limit).map(toView);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  /**
   * `jira` aligns the card with Jira's current status; `boardsync` sends the BoardSync column to
   * Jira and moves the card back to it. The conflict is claimed first so it is resolved once.
   */
  async resolve(
    userId: string,
    conflictId: string,
    resolution: ConflictResolution,
  ): Promise<ConflictView> {
    const conflict = await this.conflicts.findOne({ where: { id: conflictId } });
    if (!conflict) throw new NotFoundException('Conflict not found');
    await this.statusMappings.requireRole(userId, conflict.boardId, true);

    const claimed = await this.conflicts.update(
      { id: conflictId, resolvedAt: IsNull() },
      { resolution, resolvedAt: new Date(), resolvedById: userId },
    );
    if (!claimed.affected) throw new ConflictException('The conflict is already resolved');

    try {
      if (resolution === 'jira') {
        await this.keepJira(conflict);
      } else {
        await this.pushBoardSync(conflict);
      }
    } catch (error) {
      await this.conflicts.update(
        { id: conflictId },
        { resolution: 'jira', resolvedAt: null, resolvedById: null },
      );
      throw toHttpError(error);
    }
    const resolved = await this.conflicts.findOne({ where: { id: conflictId } });
    return toView(resolved ?? conflict);
  }

  private async keepJira(conflict: SyncConflictLogEntity): Promise<void> {
    const linked = await this.statusMappings.requireLinkedBoard(conflict.boardId);
    const issue = await this.gateway.getIssue({
      boardId: conflict.boardId,
      issueIdOrKey: conflict.jiraIssueKey,
      timeBudgetMs: JIRA_CALL_BUDGET_MS,
    });
    const columns = await this.statusMappings.columnsByStatus(linked, [issue.status]);
    const columnId = columns.get(issue.status.id);
    if (!columnId) throw new BadGatewayException('Jira returned a status with no column');
    await this.boards.moveCardFromExternal({
      boardId: conflict.boardId,
      jiraIssueKey: conflict.jiraIssueKey,
      columnId,
    });
  }

  private async pushBoardSync(conflict: SyncConflictLogEntity): Promise<void> {
    const result = await this.statusSync.push({
      boardId: conflict.boardId,
      cardId: conflict.cardId,
      issueKey: conflict.jiraIssueKey,
      fromColumnId: conflict.jiraColumnId,
      toColumnId: conflict.boardColumnId,
    });
    if (result.status !== SyncStatus.SUCCESS) {
      throw new BadGatewayException(
        `Jira did not take the BoardSync version: ${result.reason ?? 'sync failed'}`,
      );
    }
    await this.boards.moveCardFromExternal({
      boardId: conflict.boardId,
      jiraIssueKey: conflict.jiraIssueKey,
      columnId: conflict.boardColumnId,
    });
  }
}
