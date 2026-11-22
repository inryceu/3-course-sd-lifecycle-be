import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Operations the outbox can carry. Only `TRANSITION_ISSUE` is registered in T-35. */
export type OutboxOperation = 'TRANSITION_ISSUE';

/**
 * Lifecycle of one outbound intent:
 *
 * ```
 * PENDING -> IN_PROGRESS -> SENT
 *                       \-> PENDING (transient failure, attempts += 1)
 *                       \-> DEAD     (permanent failure or attempts exhausted)
 * DEAD    -> PENDING                 (board Admin requeue)
 * ```
 */
export type OutboxStatus = 'PENDING' | 'IN_PROGRESS' | 'SENT' | 'DEAD';

export const OUTBOX_STATUSES: readonly OutboxStatus[] = ['PENDING', 'IN_PROGRESS', 'SENT', 'DEAD'];

/**
 * One queued outbound operation. `boardId`, `cardId` and `actorId` reference ids of other modules
 * by value only (no cross-module foreign keys).
 *
 * The audit columns are declared explicitly instead of `extends BaseEntity`: the table follows the
 * design's snake_case audit columns (`created_at`, `updated_at`) that back the Admin listing index,
 * and TypeORM silently keeps the parent column names when a child re-declares an inherited column.
 * The rest of the BaseEntity convention (uuid primary key, timestamptz audit columns) is kept.
 */
@Entity('sync_outbox')
@Index('UQ_sync_outbox_sequence', ['sequence'], { unique: true })
@Index('UQ_sync_outbox_card_operation_pending', ['cardId', 'operation'], {
  unique: true,
  where: "status = 'PENDING'",
})
@Index('UQ_sync_outbox_card_in_progress', ['cardId'], {
  unique: true,
  where: "status = 'IN_PROGRESS'",
})
@Index('IDX_sync_outbox_claim', ['status', 'availableAt', 'sequence'])
@Index('IDX_sync_outbox_card_sequence', ['cardId', 'sequence'])
@Index('IDX_sync_outbox_board_status_created', { synchronize: false })
export class SyncOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Monotonic, gap-tolerant ordering key; `bigint` is returned as a string by pg. */
  @Column({ type: 'bigint', generated: 'identity' })
  sequence: string;

  @Column({ type: 'varchar', length: 64 })
  operation: OutboxOperation;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId: string;

  @Column({ name: 'card_id', type: 'uuid' })
  cardId: string;

  /** Latest mover; null when the enqueue did not know the actor. */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: ['PENDING', 'IN_PROGRESS', 'SENT', 'DEAD'] })
  status: OutboxStatus;

  /** Retryable failures seen so far; incremented only when a row goes back to `PENDING`. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Earliest moment the row may be claimed; holds the backoff deadline after a failure. */
  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  /** Stable id of the worker holding the row; cleared on completion, failure and reclaim. */
  @Column({ name: 'locked_by', type: 'varchar', length: 128, nullable: true })
  lockedBy: string | null;

  /** Sanitized failure message: never contains tokens, secrets or raw provider bodies. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  /** Sanitized handler summary (`outcome`, transition id, ...); no Jira bodies. */
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'dead_at', type: 'timestamptz', nullable: true })
  deadAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
