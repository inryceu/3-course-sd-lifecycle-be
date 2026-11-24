import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OutboxOperationError } from '../../../common/outbox/outbox.errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { OutboxWorker } from '../../../common/outbox/outbox.worker';
import { JiraStatusMappingService } from './jira-status-mapping.service';

export interface OutboxRowView {
  id: string;
  sequence: string;
  operation: string;
  cardId: string;
  jiraIssueKey: string | null;
  targetColumnId: string | null;
  status: string;
  attempts: number;
  errorCode: string | null;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  deadAt: Date | null;
}

export interface OutboxPageView {
  items: OutboxRowView[];
  nextCursor: string | null;
}

interface RawRow {
  id: string;
  sequence: string;
  operation: string;
  board_id: string;
  card_id: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  error_code: string | null;
  last_error: string | null;
  available_at: Date;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  dead_at: Date | null;
}

/** Runs a query and returns `unknown`, so callers must narrow the result explicitly. */
function q(ds: DataSource, sql: string, params: unknown[]): Promise<unknown> {
  return ds.query(sql, params);
}

const toView = (r: RawRow): OutboxRowView => ({
  id: r.id,
  sequence: String(r.sequence),
  operation: r.operation,
  cardId: r.card_id,
  jiraIssueKey: (r.payload['jiraIssueKey'] as string | undefined) ?? null,
  targetColumnId: (r.payload['targetColumnId'] as string | undefined) ?? null,
  status: r.status,
  attempts: r.attempts,
  errorCode: r.error_code,
  lastError: r.last_error,
  availableAt: r.available_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  sentAt: r.sent_at,
  deadAt: r.dead_at,
});

/** Board Admin view of the sync outbox: list rows and requeue a dead one. */
@Injectable()
export class JiraOutboxAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly worker: OutboxWorker,
    private readonly statusMappings: JiraStatusMappingService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    status = 'DEAD',
    limit = 50,
    cursor?: string,
  ): Promise<OutboxPageView> {
    await this.statusMappings.requireRole(userId, boardId, true);
    const params: unknown[] = [boardId, status, limit + 1];
    let cursorSql = '';
    if (cursor) {
      params.push(cursor);
      cursorSql = `AND (created_at, id) < (SELECT created_at, id FROM sync_outbox
                                           WHERE id = $4::uuid AND board_id = $1::uuid)`;
    }
    const rows = (await q(
      this.dataSource,
      `SELECT * FROM sync_outbox
        WHERE board_id = $1::uuid AND status = $2::sync_outbox_status_enum ${cursorSql}
        ORDER BY created_at DESC, id DESC LIMIT $3::int`,
      params,
    )) as RawRow[];
    const items = rows.slice(0, limit).map(toView);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async requeue(userId: string, outboxId: string): Promise<OutboxRowView> {
    const found = (await q(
      this.dataSource,
      `SELECT board_id FROM sync_outbox WHERE id = $1::uuid`,
      [outboxId],
    )) as Array<{ board_id: string }>;
    if (found.length === 0) throw new NotFoundException('Outbox row not found');
    await this.statusMappings.requireRole(userId, found[0].board_id, true);

    try {
      const row = await this.outbox.requeue(outboxId);
      this.worker.kick();
      return toView({
        id: row.id,
        sequence: row.sequence,
        operation: row.operation,
        board_id: row.boardId,
        card_id: row.cardId,
        payload: row.payload,
        status: row.status,
        attempts: row.attempts,
        error_code: row.errorCode,
        last_error: row.lastError,
        available_at: row.availableAt,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        sent_at: row.sentAt,
        dead_at: row.deadAt,
      });
    } catch (error) {
      if (error instanceof OutboxOperationError) {
        if (error.refusal === 'not_found') throw new NotFoundException('Outbox row not found');
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
