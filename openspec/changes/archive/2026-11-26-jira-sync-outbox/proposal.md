## Why

T-35 (NFR-REL-2) requires a user card move to reach Jira even when Jira or this process is
temporarily unavailable. Today `JiraStatusSyncListener` starts `JiraStatusSyncService.syncCardMove`
from a process-local event after the card move commits. A crash, restart, Jira outage, or failed
attempt loses the outbound change. There is no retry, no cross-process ordering, no dead-letter or
operator surface, and `sync_logs` has no read API. The five-second deadline is also measured from the
original event, so a delayed retry would have no budget left.

## What Changes

- **Durable outbox.** Every eligible user status move (linked card, linked board, different column)
  persists one generic `sync_outbox` intent in the same transaction as the card move, inserting a row
  or coalescing into an existing `PENDING` row. A background worker claims and executes it, so a crash
  or Jira outage leaves the row for a later attempt. No Jira call is made in the HTTP request, and the
  request does not need to resolve Jira status mappings.
- **Generic operation model.** The row carries `operation`, jsonb `payload`, card and board ids and
  a monotonic sequence. A handler registry dispatches `TRANSITION_ISSUE`; KAN-44 and KAN-45 can add
  handlers later without schema changes.
- **Status move semantics.** The handler re-reads the current Jira status. If it maps to the target
  column it marks the row `SENT` as a no-op. Otherwise it selects one direct transition; when no
  available direct transition reaches the target column it fails permanently with
  `no_transition_path`. Multi-step paths are out of scope.
- **Ordering and coalescing.** `PENDING` rows for the same operation and card coalesce to the latest
  target. The worker claims the head-of-line row per card with `FOR UPDATE SKIP LOCKED` and a final
  `PENDING` re-check, so two workers cannot process one card out of order. `IN_PROGRESS`, `SENT` and
  `DEAD` rows are never coalesced.
- **Retry and rate limiting.** Transient network, timeout, 5xx and 429 failures use capped full-jitter
  exponential backoff: 1s base, 45s cap, dead-lettered once a row has kept failing for 24 hours
  (`OUTBOX_MAX_AGE_HOURS`; `OUTBOX_MAX_ATTEMPTS=10000` is only a safety cap). The cap is bounded by the
  one-minute drain target, the 24 hours are what lets a multi-hour Jira outage survive. A 429 honours
  `Retry-After` clamped to the 45s cap and consumes an attempt. Permanent failures (401 after refresh,
  403, 404, no transition path) dead-letter immediately. A 400 or 409 from the transition POST
  re-reads the issue status to tell a race from a rejection.
- **Dead-letter and Admin surface.** After the 24-hour retry window a row is `DEAD` and blocks later rows
  for the same card. Board Admins can list outbox rows, requeue one row and requeue every dead row of a
  board (`POST /jira/sync/outbox/requeue-dead`). A dead-lettered
  transition notifies all board Admins and the mover, deduplicated, with type `jira.sync.failed`.
- **Timing and stale recovery.** The 5s budget starts at each attempt, not at event time. Stale
  `IN_PROGRESS` rows are reclaimed after 30s on every poll. With the defaults and the documented
  sizing assumption (guaranteed for up to 100 rows across distinct cards, Jira latency up to 200ms per call, concurrency 5; larger backlogs are best-effort and need a higher OUTBOX_CONCURRENCY)
  a recovered backlog drains within 60s; the component test covers at least 100 rows.
- **Contract and documentation.** OpenAPI gains the outbox list and single-requeue operations, outbox
  schemas, `jira.sync.failed` and error fields. Architecture docs, the environment example and the
  OpenSpec specs are updated.

### Non-goals

- Comment mirroring (KAN-44).
- Conflict detection and resolution (KAN-45).
- Multi-step Jira transition paths.
- A system-wide Admin role; all outbox administration is board-scoped.
- Exactly-once notification delivery; notifications are best-effort and the Admin API is
  authoritative.
- Changing KAN-44 or KAN-45 business logic.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jira-status-sync`: durable outbox, direct-only transition execution, coalescing, head-of-line
  ordering, retry and backoff, dead-letter blocking, stale recovery, Admin requeue and dead-letter
  notifications.
- `api-contract`: Jira sync outbox list/single-requeue operations and the `jira.sync.failed`
  notification contract.

## Impact

- Modules: new `src/common/outbox`; `src/modules/boards` (`CardsService`, notifications and facade);
  `src/modules/jira-sync` (handler, outbox worker, admin API); `src/app.module.ts` and `src/main.ts`.
- Database: new `sync_outbox` table with PENDING and IN_PROGRESS partial unique indexes, a monotonic
  sequence, and claim/admin indexes; a new migration. The migration timestamp must be greater than
  `1794591351977`, and greater than `1794596054264` if KAN-45 lands first (`JiraSyncConflicts.ts`).
  Coordinate the migration timestamp and expected tables with that merge order. Update
  `src/config/database-config.ts` so the CLI discovers the common outbox entity, and add
  `sync_outbox` to `test/migrations.e2e-spec.ts`.
- Configuration: `OUTBOX_POLL_INTERVAL_SECONDS=5`, `OUTBOX_BATCH_SIZE=20`, `OUTBOX_CONCURRENCY=5`,
  `OUTBOX_MAX_ATTEMPTS=10000`, `OUTBOX_MAX_AGE_HOURS=24`, `OUTBOX_BASE_DELAY_MS=1000`,
  `OUTBOX_MAX_DELAY_MS=45000`,
  `OUTBOX_LOCK_STALE_MS=30000`, `OUTBOX_SENT_RETENTION_DAYS=7`. `test/setup-env.ts` sets the poll
  interval to 0.
- API and OpenAPI: `GET /jira/sync/outbox`, `POST /jira/sync/outbox/{outboxId}/requeue`,
  `POST /jira/sync/outbox/requeue-dead?boardId=`;
  403/404/409 semantics; `jira.sync.failed`.
- Tests: unit, DB/e2e and component outage/throughput tests (at least 100 rows, 60s simulated
  recovery).
- Documentation: `docs/jira-status-sync.md`, `docs/api/openapi.yaml`,
  `docs/architecture/module-structure.md`, `.env.example`, `README.md` and the verification record.
- Dependencies: none. No tokens or secrets in `last_error`, logs or Admin responses.
- Risk: KAN-45 also changes `JiraStatusSyncService`, notifications and migrations. Coordinate the
  merge order.
- KAN-45 conflicts: the outbox handler runs the same conflict detection as the former direct sync, so
  a queued move that a Jira change overtook while Jira was unreachable is dropped (Jira wins), logged
  as a conflict and notified. Comment mirroring (KAN-44) stays a direct call; routing it through the
  outbox needs a duplicate-safe marker and is a follow-up.
