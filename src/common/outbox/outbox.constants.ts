/** Stable error codes written to `sync_outbox.error_code` (Admin API and notifications read them). */
export const OUTBOX_ERROR_CODES = {
  /** No handler is registered for the row's operation; always permanent. */
  handlerMissing: 'handler_missing',
  /** The retry budget (`OUTBOX_MAX_ATTEMPTS`) is used up. */
  attemptsExhausted: 'attempts_exhausted',
  /** A handler threw instead of returning a classified failure. */
  handlerError: 'handler_error',
} as const;

/** Handler outcome written when a newer row supersedes a stale one during reclaim. */
export const OUTBOX_SUPERSEDED_OUTCOME = 'superseded';

/** Per-attempt wall-clock budget handed to every handler (design section 9). */
export const OUTBOX_TIME_BUDGET_MS = 5000;

/** `last_error` is truncated to this length so one row cannot store a provider body. */
export const MAX_LAST_ERROR_LENGTH = 500;
