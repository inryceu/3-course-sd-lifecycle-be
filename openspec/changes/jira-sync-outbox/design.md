## Context

`CardsService.move` commits the card move and then publishes `card.moved`. Today
`JiraStatusSyncListener` starts `JiraStatusSyncService.syncCardMove` directly. The Jira call is not
durable, the in-process `chains` map is the only ordering, and the five-second deadline is measured
from `event.occurredAt`. After a restart, a Jira outage, or a crashed attempt there is nothing to
retry from.

The outbox replaces that path. The card move and the outbound intent commit atomically; a background
worker performs the Jira calls. T-35 is generic enough for later comment and conflict operations, but
this change implements only `TRANSITION_ISSUE`. The direct-only transition rule is intentional: the
product maps a board column to a Jira status and applies one available transition to that status.
There is no multi-step path, no BFS and no maximum-step constant.

KAN-45 is not merged into this branch. Its exact notification API is known:
`BoardsFacade.notifyBoardAdmins(boardId, type, payload): Promise<number>`, backed by
`NotificationsService.notifyAdmins(...)`. T-35 must use that facade method, not a new
`notifyAdmins` on the facade.

## Decisions

### 1. Transactional outbox in the card-move transaction

`CardsService.move` loads the target column and card, validates access and position, and then, in the
same `dataSource.transaction` that moves the card, inserts one `sync_outbox` row through the common
outbox helper when all of these hold:

- the move is a user move (the service method is only called for user moves; the check stays explicit),
- `fromColumnId !== toColumnId`,
- the card has a `jiraIssueKey`,
- the board has a `jiraProjectKey` (it is linked to a Jira project).

`boards` does not import `jira-sync`; it writes the shared `sync_outbox` infrastructure under
`src/common/outbox`, which is cross-cutting like `src/common/events` and is not owned by either
business module. The insert uses the transaction's `EntityManager`, so it joins the card-move
transaction. A database failure while inserting rolls the move back with a clear error.

The mapping check deliberately does not happen here. Resolving whether a destination column has a
Jira status requires the project's statuses from Jira, and a Jira call inside the card-move
transaction would block the request and fail the move when Jira is down. The handler resolves the
mapping later from the available transitions; a destination with no direct transition is a
permanent `no_transition_path` dead letter, not a request-time failure. This is a deliberate change
from a request-time mapping filter: the trade-off is a row that dead-letters instead of a
request-time Jira dependency or a materialised mapping cache.

The row is `operation = 'TRANSITION_ISSUE'`, `status = 'PENDING'`, with board, card, actor, a payload
containing the card id, issue key, from/to column ids and the target column id, and a monotonic
`sequence` from a database identity. `sequence` is global and gap-tolerant; per-card order is what
matters, so a per-board sequence table is unnecessary complexity.

The `card.moved` event is still published after commit for realtime and other listeners. The Jira
listener no longer calls `JiraStatusSyncService`; it kicks the worker. If the card move rolls back,
the outbox insert rolls back with it. If the insert fails, the move fails. The HTTP request never
calls Jira.

### 2. Generic operation registry

The outbox entity lives under `src/common/outbox/infrastructure/persistence/` and is owned by
`src/common/outbox`. A handler registry maps
`operation: string` to an `OutboxHandler` that receives the row and a per-attempt context. The
registry starts with `TRANSITION_ISSUE`; an unknown operation is a permanent `handler_missing`
failure and is dead-lettered, not retried. Adding KAN-44 or KAN-45 only adds a handler and a
payload type, not a schema change.

`src/config/database-config.ts` currently discovers only
`src/modules/*/infrastructure/**/*.entity.ts`. Because the outbox entity lives under `src/common`,
the DataSource glob (used by the TypeORM CLI and migration runner) must include
`src/common/**/*.entity.ts` as well; Nest's `autoLoadEntities` covers the application side.
`test/migrations.e2e-spec.ts` must include `sync_outbox` in its expected tables.

The table is `id uuid PK`, `sequence bigint identity unique`, `operation varchar(64)`, `board_id
uuid`, `card_id uuid`, `actor_id uuid null`, `payload jsonb`, `status
enum(PENDING, IN_PROGRESS, SENT, DEAD)`, `attempts int default 0`, `available_at timestamptz`,
nullable `locked_at`, `locked_by varchar(128)`, `last_error text` (sanitized), `error_code
varchar(64)` (nullable), `result jsonb` (sanitized handler summary), nullable `sent_at` and
`dead_at`, `created_at` and `updated_at`. `board_id`, `card_id` and `actor_id` have no cross-module foreign keys. Indexes:
partial unique `(card_id, operation) WHERE status = 'PENDING'`, partial unique `(card_id) WHERE
status = 'IN_PROGRESS'`, claim `(status, available_at, sequence)`, `(card_id, sequence)`, and the
Admin listing `(board_id, status, created_at DESC, id DESC)`, matching the documented cursor order.

### 3. Direct-only Jira transition

The handler receives `targetColumnId` in the payload and:

1. `getIssue(boardId, issueKey, budget)`.
2. Resolves the current Jira status through `JiraStatusMappingService`. If it maps to
   `targetColumnId`, mark `SENT` with `outcome = 'no-op'` and do not call `listTransitions` or
   `doTransition`.
3. `listTransitions(boardId, issueKey, budget)` and keeps only available transitions whose target
   status maps to `targetColumnId`.
4. Chooses one candidate: an explicitly mapped transition first, then lowest target status id, then
   lowest transition id. This preserves the existing deterministic choice.
5. Calls `doTransition` exactly once.
6. If there is no direct candidate, fails permanently with `no_transition_path`. It does not walk
   through intermediate statuses and does not make an extra project-status call.

The old in-process `chains` map and the old direct listener path are removed. Ordering now comes from
the outbox.

### 4. Outbox states and coalescing

```
PENDING -> IN_PROGRESS -> SENT
                      \-> PENDING  (transient failure, attempts += 1)
                      \-> DEAD     (permanent, attempts exhausted)
DEAD    -> PENDING                 (board Admin requeue)
```

`SENT` rows set `sent_at`; `DEAD` rows set `dead_at`; requeue clears both.

A new user move for the same `(card_id, operation)` coalesces only with a `PENDING` row: update its
payload and actor to the latest target, and preserve `sequence`, `created_at` and `available_at`. If
the target column changes, reset `attempts` to 0 because the new target is a new intent and must not
inherit a nearly exhausted retry budget; if the target column is unchanged, preserve the counter.
The preserved availability means a move during backoff does not reset the
backoff and hammer Jira. `IN_PROGRESS`, `SENT` and `DEAD` rows are never coalesced; a new move
creates a new `PENDING` row, which the head-of-line rule holds behind the earlier row.

A partial unique index on `(card_id, operation) WHERE status = 'PENDING'` enforces the one-PENDING
rule. The claim takes `FOR UPDATE SKIP LOCKED`, and the `UPDATE` re-checks `status = 'PENDING'`, so a
row that another worker or a requeue changed cannot be claimed twice.

### 5. Head-of-line claim per card

For each card the head is the row with the lowest `sequence` among `PENDING`, `IN_PROGRESS` and
`DEAD`. Only `PENDING` heads that are due (`available_at <= now`) are claimable. `SENT` rows are
ignored. The query is effectively:

```sql
WITH heads AS (
  SELECT DISTINCT ON (card_id) id
  FROM sync_outbox
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'DEAD')
  ORDER BY card_id, sequence
)
SELECT o.id
FROM sync_outbox o
JOIN heads h ON h.id = o.id
WHERE o.status = 'PENDING' AND o.available_at <= :now
ORDER BY o.sequence
LIMIT :batch
FOR UPDATE OF o SKIP LOCKED
```

The selected ids are then claimed in one `UPDATE ... WHERE id = ANY(:ids) AND status = 'PENDING'`,
setting `locked_by` to a stable worker id. A partial unique index on
`(card_id) WHERE status = 'IN_PROGRESS'` makes a double claim fail loudly. Requeue and stale reclaim
clear `locked_by`. A different card can be processed concurrently.

The scheduler claims at most `min(OUTBOX_BATCH_SIZE, freeSlots)` due heads, starts them, and refills a
freed slot as soon as a handler finishes while any due head remains. `OUTBOX_POLL_INTERVAL_SECONDS`
is the fallback wake-up when nothing is due and the cadence of the separate stale-reclaim maintenance
tick; it is not a one-batch-per-five-seconds throttle. Without immediate refill, even the 100-row
guaranteed backlog at batch 20 would need five polls, or 25s, consuming most of the margin; a
500-row best-effort backlog would take 125s.

A naive `NOT EXISTS (earlier row)` plus `SKIP LOCKED` is not enough: while worker A holds the head
row uncommitted, worker B can skip the locked head and claim its successor if the existence check
does not also treat the locked head as an earlier non-SENT row. The head-of-line query above avoids
that: the successor is not a head, so worker B gets nothing for that card.

### 6. Retry and backoff

The worker classifies failures:

| Failure | Retry budget | Result |
| --- | --- | --- |
| Network error, timeout, `JiraServerError`, `JiraTimeBudgetExceededError`, 429 | Consumes one attempt | `PENDING` with delay; 429 honours `Retry-After` |
| 401 after token refresh, 403, 404, invalid key/board, `no_transition_path` | No retry | `DEAD` immediately |
| 400 or 409 from `doTransition` | Re-read issue status | Changed: transient. Unchanged: permanent |
| Timeout or abort after `doTransition` was sent | Consumes one attempt | Outcome unknown; next attempt re-reads status |
| Unknown operation / handler missing | No retry | `DEAD` with `handler_missing` |

`attempts` is not incremented at claim time. It is incremented only when a failure (or an
expired stale lock) sends the row back to `PENDING`. This is what makes "20 attempts" mean 20
retryable failures, not 20 claims. The gateway's own bounded HTTP retries (for 5xx, timeouts and
network errors) happen inside one handler attempt and inside the same five-second budget; the
outbox `attempts` count is not the HTTP attempt count.

For a retryable failure with attempt number `n` (1-based), the delay is full jitter with a floor:

```
cap_n = min(OUTBOX_MAX_DELAY_MS, OUTBOX_BASE_DELAY_MS * 2^(n-1))
delay = random_between(OUTBOX_BASE_DELAY_MS, max(OUTBOX_BASE_DELAY_MS, cap_n))
```

The jitter result never exceeds the 30s cap. A 429 uses
`clamp(Retry-After, OUTBOX_BASE_DELAY_MS, OUTBOX_MAX_DELAY_MS)`; without the header, the same
exponential formula applies. A 429 consumes one attempt like any other transient failure, so
`OUTBOX_MAX_ATTEMPTS = 20` bounds it; there is no separate throttle counter or throttle cap.

### 7. Dead-letter, blocking and notifications

A row that receives a permanent failure, exhausts 20 attempts, or exhausts
attempts during stale reclaim becomes `DEAD` with a stable `error_code` and a sanitized `last_error`
(for example `no_transition_path`, `jira_unauthorized`, `jira_forbidden`, `jira_not_found`,
`attempts_exhausted`, `handler_missing`). `DEAD` is a head-of-line state,
so later rows for that card are not processed until an Admin requeues the dead row.

A dead-lettered `TRANSITION_ISSUE` notifies:

1. every board Admin via
   `notifyBoardAdmins(boardId: string, type: NotificationType, payload: Record<string, unknown>): Promise<number>`,
   and
2. the latest mover (`actor_id` after any coalescing) via a new
   `notifyUser(userId: string, boardId: string, type: NotificationType, payload: Record<string, unknown>): Promise<number>`
   when that mover's role is not `BoardRole.ADMIN`.

After coalescing, only the latest actor is notified as mover. `notifyUser` MUST treat a user who has
left the board as a no-op and MUST NOT throw; delivery remains best-effort. The admin list and the
actor are deduplicated, so each
unique recipient gets at most one notification per dead-lettered outbox row. Notification delivery is
best-effort: a failure is logged
and does not change the row. `NotificationType` gains `'jira.sync.failed'`; the `notifications.type`
column is already `varchar(50)`, so there is no notification-table migration. The payload is minimal
and sanitized: `outboxId`, `boardId`, `cardId`, `jiraIssueKey`, `operation`, `attempts`,
`errorCode`. It never contains tokens, raw provider bodies or `last_error`.

### 8. Stale recovery and the 30s lock

An `IN_PROGRESS` row whose `locked_at` is older than `OUTBOX_LOCK_STALE_MS = 30000` is reclaimed on
every poll, not only when the queue is empty. Reclaim is a single conditional update:

- if a later `PENDING` row for the same `(card_id, operation)` exists, the stale row becomes `SENT`
  with `superseded`, so the newer row can run;
- otherwise, if `attempts + 1 >= 20`, the stale row becomes `DEAD` with `attempts_exhausted`;
- otherwise, it becomes `PENDING`, `attempts += 1`, `locked_at = null`, and a new backoff
  `available_at`.

Because reclaim changes the status in the same statement, the partial unique `IN_PROGRESS` index is
not violated. A crash between claim and completion is therefore recovered within
`30s stale + 5s poll + 5s handler = 40s`, leaving 20s of the 60s recovery budget.

### 9. Attempt timing and throughput

The five-second handler budget starts at attempt start, not at the original `card.moved` time. The
handler computes `deadline = attemptStart + 5000` and passes
`timeBudgetMs = min(deadline - now, 5000)` to each `getIssue`, `listTransitions` and
`doTransition`. The existing gateway clamps a per-call budget to 45s; the
handler's own five seconds is always stricter. A stale event can therefore still get a full attempt. The original
event time remains in the payload only for audit.

The guaranteed 60s drain AC is for a normal backlog of at most 100 rows across distinct cards, Jira
latency up to 200ms per call, and worker concurrency 5. The component test uses at least 100 rows
across distinct cards and includes the three-call path: `100 * 3 * 0.2s / 5 = 12s`, plus the worst
normal stale/retry allowance of `30s + 5s + 5s = 40s`, or 52s total, leaving 8s of margin. A 500-row
backlog is best-effort and requires
`OUTBOX_CONCURRENCY >= 10`; it is not covered by the guaranteed 60s bound, and no zero-margin claim
is made for it. This limit is documented rather than hidden.

### 10. Board Admin API

All operations are board-scoped and require `BoardRole.ADMIN`:

- `GET /api/v1/jira/sync/outbox?boardId=...&status=DEAD&limit=50&cursor=...`
  - `boardId` is required; a missing value is 400.
  - `status` defaults to `DEAD`; `PENDING`, `IN_PROGRESS`, `SENT` and `DEAD` are accepted.
  - Newest first by `(created_at DESC, id DESC)`, backed by the
    `(board_id, status, created_at DESC, id DESC)` index and using the same cursor pattern as
    notifications.
  - Unknown board or non-member is 404; a member who is not an Admin is 403.
  - Never returns tokens, raw Jira bodies or unsanitized errors.
- `POST /api/v1/jira/sync/outbox/{outboxId}/requeue`
  - An unknown row or a caller who is not a board member is 404; a member who is not an Admin is
    403; a row that is not `DEAD`, or that has an earlier non-`SENT` row for the same card, is 409.
  - Resets `status = PENDING`, `attempts = 0`, `error_code = null`,
    `last_error = null`, `result = null`, `sent_at = null`, `dead_at = null`, `locked_at = null`,
    `locked_by = null`, `available_at = now`.
  - If a later `PENDING` row for the same operation exists, its payload/actor are merged into the
    requeued row and the later row is marked `SENT`/`superseded`.
  - Returns the requeued row.

The single-row route is `POST /outbox/{outboxId}/requeue`. Requeue does not call Jira; the worker
does.

### 11. Testing strategy

- Unit tests: failure classification, backoff/jitter bounds, 429 `Retry-After` handling, direct
  transition choice, no direct candidate as `no_transition_path`, coalescing rules,
  notification recipient selection, payload redaction.
- DB/e2e tests: atomic enqueue and rollback, partial unique indexes, claim concurrency (two
  claimers, no two `IN_PROGRESS`, no successor claim while the head is locked), stale reclaim,
  single requeue and 403/404/409/400, migration.
- Component tests: `test/component/jira-outbox-outage-recovery.component-spec.ts` runs the real
  worker loop with production timings and an injectable clock/scheduler. At least 100 rows across
  distinct cards are enqueued while a fake Jira returns fast 503s; Jira then recovers and the test
  advances the clock, asserting drain within the simulated 60s, per-card order and no duplicate
  transitions. A separate case covers a timeout. Another component test keeps Jira permanently
  failing to 20 attempts and asserts one `jira.sync.failed` notification per unique Admin and mover.
- Contract/verification: `pnpm api:validate`, `pnpm typecheck`, `pnpm lint`, the relevant unit/e2e
  suites and strict OpenSpec validation.

## Risks / Trade-offs

- The outbox adds one insert per eligible move and one poll query every 5s. The partial indexes and
  the claim index keep both bounded; the poll is deliberately small.
- `DEAD` head-of-line blocking is intentional but can hold a card until an Admin requeues it. The
  single requeue is the escape hatch; a silent skip would violate ordering.
- The guaranteed 60s recovery bound is for at most 100 rows across distinct cards at up to 200ms
  per call and concurrency 5. A 500-row backlog is best-effort and requires
  `OUTBOX_CONCURRENCY >= 10`; the component test proves the normal path, not an unbounded queue.
- A move that dead-letters with `no_transition_path` is not replayed automatically; an Admin can
  requeue it after the Jira workflow or mapping changes. Only a new card move creates new outbox
  intent otherwise.
- KAN-45 also edits `JiraStatusSyncService`, notifications and migrations. Merge KAN-45 first if
  possible; otherwise port its exact `notifyBoardAdmins`/`notifyAdmins` API and coordinate the
  migration timestamp. Do not invent a facade method.
- Notification fan-out is best-effort. A failed notification is logged but does not retry and does
  not change the outbox state; the Admin API is the authoritative view of dead letters.
