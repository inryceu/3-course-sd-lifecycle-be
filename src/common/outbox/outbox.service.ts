import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  OutboxOperation,
  OutboxStatus,
  SyncOutboxEntity,
} from './infrastructure/persistence/sync-outbox.entity';
import { backoffDelayMs, clampDelayMs } from './outbox-backoff';
import { OutboxFailure } from './outbox-handler';
import { OUTBOX_CLOCK, OUTBOX_CONFIG, OutboxClock, OutboxConfig } from './outbox.config';
import { OUTBOX_ERROR_CODES, OUTBOX_SUPERSEDED_OUTCOME } from './outbox.constants';
import { OutboxOperationError, sanitizeErrorMessage } from './outbox.errors';

interface RawOutboxRow {
  id: string;
  sequence: string | number;
  operation: OutboxOperation;
  board_id: string;
  card_id: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  error_code: string | null;
  result: Record<string, unknown> | null;
  sent_at: Date | null;
  dead_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** Runs a query and returns `unknown`, so callers must narrow the result explicitly. */
function q(runner: Queryable, sql: string, params?: unknown[]): Promise<unknown> {
  return runner.query(sql, params);
}

/** TypeORM returns `[rows, count]` for UPDATE/DELETE and plain rows for SELECT/INSERT. */
function rowsOf(raw: unknown): RawOutboxRow[] {
  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    typeof raw[1] === 'number'
  ) {
    return raw[0] as RawOutboxRow[];
  }
  return raw as RawOutboxRow[];
}

function toEntity(r: RawOutboxRow): SyncOutboxEntity {
  const e = new SyncOutboxEntity();
  e.id = r.id;
  e.sequence = String(r.sequence);
  e.operation = r.operation;
  e.boardId = r.board_id;
  e.cardId = r.card_id;
  e.actorId = r.actor_id;
  e.payload = r.payload;
  e.status = r.status;
  e.attempts = r.attempts;
  e.availableAt = r.available_at;
  e.lockedAt = r.locked_at;
  e.lockedBy = r.locked_by;
  e.lastError = r.last_error;
  e.errorCode = r.error_code;
  e.result = r.result;
  e.sentAt = r.sent_at;
  e.deadAt = r.dead_at;
  e.createdAt = r.created_at;
  e.updatedAt = r.updated_at;
  return e;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

export interface EnqueueInput {
  operation: OutboxOperation;
  boardId: string;
  cardId: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
  /** Payload key that identifies the intent; when it changes on coalescing, attempts reset. */
  intentField?: string;
  now?: Date;
}

export interface EnqueueResult {
  id: string;
  coalesced: boolean;
}

export type FailOutcome = 'RETRY' | 'SUPERSEDED' | 'DEAD' | 'LOST';

export interface FailResult {
  outcome: FailOutcome;
  row?: SyncOutboxEntity;
}

const ENQUEUE_SQL = `
INSERT INTO sync_outbox (operation, board_id, card_id, actor_id, payload, status, available_at)
VALUES ($1::text, $2::uuid, $3::uuid, $4::uuid, $5::jsonb, 'PENDING', $6::timestamptz)
ON CONFLICT (card_id, operation) WHERE status = 'PENDING'
DO UPDATE SET
  payload = EXCLUDED.payload,
  actor_id = EXCLUDED.actor_id,
  attempts = CASE
    WHEN sync_outbox.payload ->> $7::text IS DISTINCT FROM EXCLUDED.payload ->> $7::text THEN 0
    ELSE sync_outbox.attempts
  END,
  -- a changed target is a new intent with a fresh retry budget (attempts and age)
  created_at = CASE
    WHEN sync_outbox.payload ->> $7::text IS DISTINCT FROM EXCLUDED.payload ->> $7::text THEN now()
    ELSE sync_outbox.created_at
  END,
  updated_at = now()
RETURNING id, (xmax = 0) AS inserted`;

const CLAIM_SQL = `
WITH heads AS (
  SELECT DISTINCT ON (card_id) id
  FROM sync_outbox
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'DEAD')
  ORDER BY card_id, sequence
),
due AS (
  SELECT o.id
  FROM sync_outbox o
  JOIN heads h ON h.id = o.id
  WHERE o.status = 'PENDING' AND o.available_at <= $1::timestamptz
  ORDER BY o.sequence
  LIMIT $2::int
  FOR UPDATE OF o SKIP LOCKED
)
UPDATE sync_outbox s
SET status = 'IN_PROGRESS', locked_at = $1::timestamptz, locked_by = $3::text, updated_at = now()
FROM due
WHERE s.id = due.id AND s.status = 'PENDING'
RETURNING s.*`;

const COMPLETE_SQL = `
UPDATE sync_outbox
SET status = 'SENT', sent_at = $3::timestamptz, result = $4::jsonb,
    last_error = NULL, error_code = NULL, locked_at = NULL, locked_by = NULL, updated_at = now()
WHERE id = $1::uuid AND status = 'IN_PROGRESS' AND locked_by = $2::text
RETURNING id`;

const DEAD_SQL = `
UPDATE sync_outbox
SET status = 'DEAD', dead_at = $3::timestamptz, error_code = $4::text, last_error = $5::text,
    attempts = $6::int, locked_at = NULL, locked_by = NULL, updated_at = now()
WHERE id = $1::uuid AND status = 'IN_PROGRESS' AND locked_by = $2::text
RETURNING *`;

/** Retry, or supersede when a newer PENDING row for the same card/operation already exists. */
const RETRY_SQL = `
WITH cur AS (
  SELECT card_id, operation FROM sync_outbox WHERE id = $1::uuid
),
later AS (
  SELECT EXISTS (
    SELECT 1 FROM sync_outbox n JOIN cur c ON n.card_id = c.card_id AND n.operation = c.operation
    WHERE n.status = 'PENDING'
  ) AS yes
)
UPDATE sync_outbox o
SET status = CASE WHEN later.yes THEN 'SENT'::sync_outbox_status_enum
                  ELSE 'PENDING'::sync_outbox_status_enum END,
    attempts = $3::int,
    available_at = $4::timestamptz,
    sent_at = CASE WHEN later.yes THEN $5::timestamptz ELSE NULL END,
    result = CASE WHEN later.yes THEN $8::jsonb ELSE o.result END,
    last_error = $6::text,
    error_code = $7::text,
    locked_at = NULL, locked_by = NULL, updated_at = now()
FROM later
WHERE o.id = $1::uuid AND o.status = 'IN_PROGRESS' AND o.locked_by = $2::text
RETURNING o.*`;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(OUTBOX_CONFIG) private readonly config: OutboxConfig,
    @Inject(OUTBOX_CLOCK) private readonly clock: OutboxClock,
  ) {}

  /**
   * Inserts the intent with the CALLER's EntityManager so it joins the caller's transaction.
   * A PENDING row for the same card/operation is coalesced atomically by the partial unique index.
   */
  async enqueue(manager: EntityManager, input: EnqueueInput): Promise<EnqueueResult> {
    const now = input.now ?? this.clock.now();
    const raw = (await q(manager, ENQUEUE_SQL, [
      input.operation,
      input.boardId,
      input.cardId,
      input.actorId ?? null,
      JSON.stringify(input.payload),
      now,
      input.intentField ?? 'targetColumnId',
    ])) as Array<{ id: string; inserted: boolean }>;
    return { id: raw[0].id, coalesced: !raw[0].inserted };
  }

  /** Claims due head-of-line rows (one per card) for `workerId`. */
  async claim(
    workerId: string,
    limit: number,
    now = this.clock.now(),
  ): Promise<SyncOutboxEntity[]> {
    if (limit <= 0) return [];
    try {
      const raw = await q(this.dataSource, CLAIM_SQL, [now, limit, workerId]);
      return rowsOf(raw)
        .map(toEntity)
        .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn('Claim hit the IN_PROGRESS unique index; will retry on the next tick');
        return [];
      }
      throw error;
    }
  }

  /** Marks the row SENT; returns false when the worker no longer holds the lock. */
  async complete(
    id: string,
    workerId: string,
    result: Record<string, unknown> | null,
    now = this.clock.now(),
  ): Promise<boolean> {
    const raw = await q(this.dataSource, COMPLETE_SQL, [
      id,
      workerId,
      now,
      result === null ? null : JSON.stringify(result),
    ]);
    return rowsOf(raw).length > 0;
  }

  /** Applies a failed attempt: retry with backoff, supersede, or dead-letter. */
  async fail(
    row: SyncOutboxEntity,
    workerId: string,
    failure: OutboxFailure,
    now = this.clock.now(),
  ): Promise<FailResult> {
    const nextAttempts = row.attempts + 1;
    const error = sanitizeErrorMessage(failure.error);
    const exhausted =
      nextAttempts >= this.config.maxAttempts ||
      now.getTime() - row.createdAt.getTime() >= this.config.maxAgeMs;

    if (!failure.retryable || exhausted) {
      const code = failure.retryable ? OUTBOX_ERROR_CODES.attemptsExhausted : failure.errorCode;
      const raw = await q(this.dataSource, DEAD_SQL, [
        row.id,
        workerId,
        now,
        code,
        error,
        nextAttempts,
      ]);
      const dead = rowsOf(raw)[0];
      return dead ? { outcome: 'DEAD', row: toEntity(dead) } : { outcome: 'LOST' };
    }

    const policy = { baseDelayMs: this.config.baseDelayMs, maxDelayMs: this.config.maxDelayMs };
    const delay =
      failure.delayMs !== undefined
        ? clampDelayMs(failure.delayMs, policy)
        : backoffDelayMs(nextAttempts, policy);
    const availableAt = new Date(now.getTime() + delay);
    const params: unknown[] = [
      row.id,
      workerId,
      nextAttempts,
      availableAt,
      now,
      error,
      failure.errorCode,
      JSON.stringify({ outcome: OUTBOX_SUPERSEDED_OUTCOME }),
    ];

    for (let attempt = 0; ; attempt++) {
      try {
        const updated = rowsOf(await q(this.dataSource, RETRY_SQL, params))[0];
        if (!updated) return { outcome: 'LOST' };
        return {
          outcome: updated.status === 'SENT' ? 'SUPERSEDED' : 'RETRY',
          row: toEntity(updated),
        };
      } catch (e) {
        // A concurrent enqueue created a newer PENDING row between our check and write: re-run once.
        if (!isUniqueViolation(e) || attempt >= 1) throw e;
      }
    }
  }

  /**
   * Returns rows whose lock is older than `lockStaleMs` to the queue (or supersedes/dead-letters
   * them) through the same `fail` path. Returns the rows that became DEAD.
   */
  async reclaimStale(now = this.clock.now()): Promise<SyncOutboxEntity[]> {
    const cutoff = new Date(now.getTime() - this.config.lockStaleMs);
    const stale = rowsOf(
      await q(
        this.dataSource,
        `SELECT * FROM sync_outbox
         WHERE status = 'IN_PROGRESS' AND locked_at < $1::timestamptz
         ORDER BY sequence LIMIT 100`,
        [cutoff],
      ),
    ).map(toEntity);

    const dead: SyncOutboxEntity[] = [];
    for (const row of stale) {
      if (!row.lockedBy) continue;
      const result = await this.fail(
        row,
        row.lockedBy,
        {
          status: 'FAILED',
          retryable: true,
          errorCode: 'lock_expired',
          error: 'Worker lock expired before the attempt completed',
        },
        now,
      );
      if (result.outcome === 'DEAD' && result.row) dead.push(result.row);
    }
    return dead;
  }

  /**
   * Admin requeue. One transaction: a later PENDING row is superseded FIRST (and its intent merged
   * into the dead row), only then is the dead row set to PENDING, so the PENDING unique index holds.
   */
  async requeue(id: string, now = this.clock.now()): Promise<SyncOutboxEntity> {
    return this.dataSource.transaction(async (m) => {
      const found = rowsOf(
        await q(m, `SELECT * FROM sync_outbox WHERE id = $1::uuid FOR UPDATE`, [id]),
      )[0];
      if (!found) throw new OutboxOperationError('not_found', 'Outbox row not found');
      const row = toEntity(found);
      if (row.status !== 'DEAD') throw new OutboxOperationError('not_dead', 'Row is not DEAD');

      const blocked = rowsOf(
        await q(
          m,
          `SELECT id FROM sync_outbox
           WHERE card_id = $1::uuid AND sequence < $2::bigint
             AND status IN ('PENDING', 'IN_PROGRESS', 'DEAD') LIMIT 1`,
          [row.cardId, row.sequence],
        ),
      );
      if (blocked.length > 0) {
        throw new OutboxOperationError('blocked', 'An earlier row for this card blocks requeue');
      }

      let payload = row.payload;
      let actorId = row.actorId;
      const laterRow = rowsOf(
        await q(
          m,
          `SELECT * FROM sync_outbox
           WHERE card_id = $1::uuid AND operation = $2::text AND status = 'PENDING' FOR UPDATE`,
          [row.cardId, row.operation],
        ),
      )[0];
      if (laterRow) {
        const later = toEntity(laterRow);
        payload = later.payload;
        actorId = later.actorId;
        await q(
          m,
          `UPDATE sync_outbox
           SET status = 'SENT', sent_at = $2::timestamptz, result = $3::jsonb, updated_at = now()
           WHERE id = $1::uuid`,
          [later.id, now, JSON.stringify({ outcome: OUTBOX_SUPERSEDED_OUTCOME })],
        );
      }

      const updated = rowsOf(
        await q(
          m,
          `UPDATE sync_outbox
           SET status = 'PENDING', attempts = 0, payload = $2::jsonb, actor_id = $3::uuid,
               last_error = NULL, error_code = NULL, result = NULL, sent_at = NULL, dead_at = NULL,
               locked_at = NULL, locked_by = NULL, available_at = $4::timestamptz,
               created_at = $4::timestamptz, updated_at = now()
           WHERE id = $1::uuid
           RETURNING *`,
          [row.id, JSON.stringify(payload), actorId, now],
        ),
      )[0];
      return toEntity(updated);
    });
  }

  /** Retention: deletes old SENT rows only; DEAD rows are never purged. */
  async purgeSent(now = this.clock.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.sentRetentionDays * 86_400_000);
    const raw = await q(
      this.dataSource,
      `DELETE FROM sync_outbox WHERE status = 'SENT' AND sent_at < $1::timestamptz RETURNING id`,
      [cutoff],
    );
    return rowsOf(raw).length;
  }
}
