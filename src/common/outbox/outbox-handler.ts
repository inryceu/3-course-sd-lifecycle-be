import { OutboxOperation, SyncOutboxEntity } from './infrastructure/persistence/sync-outbox.entity';

/** Everything a handler knows about the attempt it is running. */
export interface OutboxAttemptContext {
  /** 1-based attempt number: `row.attempts + 1`. */
  attempt: number;
  /** Milliseconds the handler may spend; pass it to every downstream call. */
  timeBudgetMs: number;
  /** Epoch milliseconds when the attempt budget expires (`attemptStart + timeBudgetMs`). */
  deadline: number;
}

/** The operation succeeded (or was a no-op); the row becomes `SENT`. */
export interface OutboxSuccess {
  status: 'SENT';
  /** Sanitized handler summary stored in `sync_outbox.result`. Never a provider body. */
  result?: Record<string, unknown>;
}

/** The operation failed; the worker decides between a retry and a dead letter. */
export interface OutboxFailure {
  status: 'FAILED';
  /** `false` dead-letters immediately (`no_transition_path`, `handler_missing`, ...). */
  retryable: boolean;
  /** Stable code stored in `sync_outbox.error_code`. */
  errorCode: string;
  /** Message sanitized by the worker before it reaches `sync_outbox.last_error`. */
  error: string;
  /**
   * Optional delay override for this retry (429 `Retry-After` in milliseconds). The worker
   * clamps it into `[OUTBOX_BASE_DELAY_MS, OUTBOX_MAX_DELAY_MS]` before use.
   */
  delayMs?: number;
}

export type OutboxHandlerResult = OutboxSuccess | OutboxFailure;

/**
 * A handler performs one outbound attempt for one operation. Throwing is treated as an
 * unclassified transient failure (`handler_error`); returning a result is the normal path.
 */
export interface OutboxHandler {
  readonly operation: OutboxOperation;
  handle(row: SyncOutboxEntity, context: OutboxAttemptContext): Promise<OutboxHandlerResult>;
}
