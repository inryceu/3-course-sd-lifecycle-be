import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { SyncConflictLogEntity } from '../infrastructure/persistence/sync-conflict-log.entity';
import { SyncLogEntity } from '../infrastructure/persistence/sync-log.entity';

/** Two changes of one card at most this far apart, in either order, can conflict (FR-13). */
export const CONFLICT_WINDOW_MS = 5_000;

/** The card-issue link both changes are about. */
export interface ConflictRef {
  readonly linkId: string;
  readonly boardId: string;
  readonly cardId: string;
  readonly issueKey: string;
}

/** A BoardSync user move: destination column and the event's `occurredAt`. */
export interface BoardChange {
  readonly columnId: string;
  readonly at: Date;
}

/** A Jira status change: the column it maps to, the status name and Jira's change time. */
export interface JiraChange {
  readonly columnId: string;
  readonly statusName: string;
  readonly at: Date;
}

export interface DetectedConflict extends ConflictRef {
  readonly board: BoardChange;
  readonly jira: JiraChange;
}

export function isConflict(board: BoardChange | null, jira: JiraChange | null): boolean {
  return (
    board !== null &&
    jira !== null &&
    board.columnId !== jira.columnId &&
    Math.abs(board.at.getTime() - jira.at.getTime()) <= CONFLICT_WINDOW_MS
  );
}

interface Row {
  at: Date | null;
  columnId: string | null;
  statusName?: string | null;
}

/**
 * Remembers the latest change on each side per card-issue link and reports a conflict when the
 * other side changed within the window. Each side writes its change and reads the other's in one
 * statement holding the link's row lock, so of two concurrent changes exactly the second one
 * sees the first.
 */
@Injectable()
export class JiraSyncConflictDetector {
  private readonly logger = new Logger(JiraSyncConflictDetector.name);

  constructor(
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    @InjectRepository(SyncLogEntity)
    private readonly logs: Repository<SyncLogEntity>,
    @InjectRepository(SyncConflictLogEntity)
    private readonly conflicts: Repository<SyncConflictLogEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  /** Records a user move; returns the conflict when a recent Jira change disagrees with it. */
  async noteBoardMove(ref: ConflictRef, board: BoardChange): Promise<DetectedConflict | null> {
    const [previous] = await this.links.query<Row[]>(
      `WITH cur AS (
         SELECT id, last_jira_change_at, last_jira_column_id, last_jira_status_name
           FROM jira_issue_mappings WHERE id = $1 FOR UPDATE
       ), noted AS (
         UPDATE jira_issue_mappings AS m
            SET last_board_move_at = $2, last_board_column_id = $3
           FROM cur WHERE m.id = cur.id
         RETURNING cur.last_jira_change_at AS "at", cur.last_jira_column_id AS "columnId",
                   cur.last_jira_status_name AS "statusName"
       )
       SELECT * FROM noted`,
      [ref.linkId, board.at, board.columnId],
    );
    const jira =
      previous?.at && previous.columnId
        ? {
            columnId: previous.columnId,
            statusName: previous.statusName ?? previous.columnId,
            at: new Date(previous.at),
          }
        : null;
    return jira && isConflict(board, jira) ? { ...ref, board, jira } : null;
  }

  /**
   * Records a Jira status change; returns the conflict when a recent user move disagrees with it.
   * An echo of BoardSync's own transition is not a Jira change and is not recorded.
   */
  async noteJiraChange(
    ref: ConflictRef,
    change: JiraChange & { readonly statusId: string },
  ): Promise<DetectedConflict | null> {
    if (await this.isEcho(ref.linkId, change.statusId, change.at)) return null;

    const [previous] = await this.links.query<Row[]>(
      `WITH cur AS (
         SELECT id, last_board_move_at, last_board_column_id
           FROM jira_issue_mappings WHERE id = $1 FOR UPDATE
       ), noted AS (
         UPDATE jira_issue_mappings AS m
            SET last_jira_change_at = $2, last_jira_column_id = $3, last_jira_status_name = $4
           FROM cur WHERE m.id = cur.id
         RETURNING cur.last_board_move_at AS "at", cur.last_board_column_id AS "columnId"
       )
       SELECT * FROM noted`,
      [ref.linkId, change.at, change.columnId, change.statusName],
    );
    const board =
      previous?.at && previous.columnId
        ? { columnId: previous.columnId, at: new Date(previous.at) }
        : null;
    const jira = { columnId: change.columnId, statusName: change.statusName, at: change.at };
    return board && isConflict(board, jira) ? { ...ref, board, jira } : null;
  }

  /** True when a Jira change recorded for the link conflicts with this (still unsent) move. */
  async hasConflictingJiraChange(linkId: string, board: BoardChange): Promise<boolean> {
    const link = await this.links.findOne({
      where: { id: linkId },
      select: { id: true, lastJiraChangeAt: true, lastJiraColumnId: true },
    });
    if (!link?.lastJiraChangeAt || !link.lastJiraColumnId) return false;
    return isConflict(board, {
      columnId: link.lastJiraColumnId,
      statusName: '',
      at: new Date(link.lastJiraChangeAt),
    });
  }

  /** Stores the conflict (resolution `jira`, unresolved) and notifies the board admins. */
  async record(conflict: DetectedConflict): Promise<SyncConflictLogEntity> {
    const summary = await this.boards.getBoardSummary(conflict.boardId);
    const title = (columnId: string) =>
      summary?.columns.find((column) => column.id === columnId)?.title ?? columnId;

    const row = await this.conflicts.save({
      boardId: conflict.boardId,
      cardId: conflict.cardId,
      mappingId: conflict.linkId,
      jiraIssueKey: conflict.issueKey,
      boardColumnId: conflict.board.columnId,
      boardStatus: title(conflict.board.columnId),
      boardChangedAt: conflict.board.at,
      jiraColumnId: conflict.jira.columnId,
      jiraStatus: conflict.jira.statusName,
      jiraChangedAt: conflict.jira.at,
      resolution: 'jira',
      resolvedAt: null,
      resolvedById: null,
    });
    this.logger.warn(
      `Sync conflict ${row.id} on board ${row.boardId} for ${row.jiraIssueKey}: BoardSync "${row.boardStatus}" vs Jira "${row.jiraStatus}", Jira wins`,
    );
    await this.boards.notifyBoardAdmins(conflict.boardId, 'jira.conflict', {
      conflictId: row.id,
      boardId: row.boardId,
      cardId: row.cardId,
      jiraIssueKey: row.jiraIssueKey,
      boardStatus: row.boardStatus,
      jiraStatus: row.jiraStatus,
    });
    return row;
  }

  /** A successful own transition to this status, logged no earlier than 5 s before the change. */
  private async isEcho(linkId: string, statusId: string, at: Date): Promise<boolean> {
    const rows = await this.logs.query<unknown[]>(
      `SELECT 1 AS echo FROM sync_logs
        WHERE mapping_id = $1 AND direction = 'TO_JIRA' AND status = 'SUCCESS'
          AND payload->>'outcome' = 'transitioned' AND payload->>'targetStatusId' = $2
          AND "createdAt" >= $3
        LIMIT 1`,
      [linkId, statusId, new Date(at.getTime() - CONFLICT_WINDOW_MS)],
    );
    return rows.length > 0;
  }
}
