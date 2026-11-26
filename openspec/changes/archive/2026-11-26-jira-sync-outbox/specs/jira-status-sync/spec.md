## MODIFIED Requirements

### Requirement: Synchronize only user column moves

The system SHALL persist exactly one `sync_outbox` intent for a `card.moved` event only when its origin is `user`, the card changed columns, the card has a `jiraIssueKey`, and the board has a `jiraProjectKey`. It SHALL insert one row, or coalesce into an existing `PENDING` row for the same card and operation, in the same database transaction as the card move, without a Jira call. Events with origin `jira`, same-column reorders, cards without an issue key, and boards without a linked project SHALL NOT create an outbox row or change Jira. The handler SHALL resolve a destination with no direct Jira transition later as a permanent `no_transition_path`, not at request time.

#### Scenario: User moves a linked card

- **WHEN** a user moves a card with a `jiraIssueKey` on a linked board to a different column
- **THEN** exactly one `PENDING` `TRANSITION_ISSUE` row is inserted in the same transaction as the move, and the request makes no Jira call

#### Scenario: Jira-originated event

- **WHEN** a `card.moved` event has origin `jira`
- **THEN** no outbox row is inserted and no sync log is written

#### Scenario: Same-column reorder

- **WHEN** a user reorders a linked card inside its current column
- **THEN** no outbox row is inserted and no sync log is written

#### Scenario: Unlinked card

- **WHEN** a user moves a card without a `jiraIssueKey`
- **THEN** no outbox row is inserted, no sync log is written, and a debug message is logged

#### Scenario: Board is not linked to a Jira project

- **WHEN** a user moves a linked card on a board without a `jiraProjectKey`
- **THEN** no outbox row is inserted and no Jira call is made

### Requirement: No-op when the issue already matches the destination

The system SHALL read the issue's current Jira status at attempt time and SHALL mark the outbox row `SENT` with outcome `no-op` when that status maps to the destination board column under the board's stored or default mapping, before listing transitions. A coalesced row whose latest target already matches the current status SHALL also be `SENT` as a no-op.

#### Scenario: Already in a mapped status

- **WHEN** the issue's current status maps to the destination column
- **THEN** no transition is listed or executed, and the outbox row is `SENT` with outcome `no-op`

#### Scenario: Coalesced target already reached

- **WHEN** two user moves coalesce to a target that Jira already shows
- **THEN** the row is `SENT` with outcome `no-op` and no transition is executed

### Requirement: Select one direct transition for the destination column

The system SHALL consider only currently available transitions whose target status maps to the destination column. It SHALL prefer a candidate with an explicit stored mapping; otherwise it SHALL choose the lowest `jiraStatusId`. Several transitions to the chosen status SHALL be resolved by the lowest transition id. It SHALL NOT perform multi-step transition paths. When no available direct transition targets the destination column, the handler SHALL fail permanently with `no_transition_path`.

#### Scenario: Explicit mapping wins

- **WHEN** one candidate status has an explicit stored mapping to the destination column and another candidate has no explicit mapping
- **THEN** the explicitly mapped status is selected

#### Scenario: Lowest status id breaks a tie

- **WHEN** no candidate has an explicit mapping and several candidate statuses map to the destination column
- **THEN** the candidate with the lowest `jiraStatusId` is selected

#### Scenario: Only an indirect path exists

- **WHEN** the target is reachable only through an intermediate status
- **THEN** no transition is executed and the row becomes `DEAD` with `no_transition_path`

#### Scenario: No direct transition

- **WHEN** no available transition reaches the destination column directly
- **THEN** the attempt fails with `no_transition_path` and no transition is executed

### Requirement: Execute exactly one transition

The system SHALL execute at most one Jira workflow transition per handler attempt. It SHALL retry transient failures only as a new outbox attempt and SHALL NOT retry a permanent Jira rejection. On a 400 or 409 from `doTransition`, the handler SHALL re-read the issue status: a changed status means the failure is transient, an unchanged status means it is permanent. A timeout or abort after the transition request was sent SHALL be treated as an unknown outcome; the next attempt SHALL re-read the status and SHALL NOT repeat a transition that already landed.

#### Scenario: Transition succeeds

- **WHEN** a transition is selected and Jira accepts it
- **THEN** the transition is executed once and the outbox row is `SENT`

#### Scenario: Transient failure is retried

- **WHEN** the attempt fails with a network error, timeout or Jira 5xx
- **THEN** the row returns to `PENDING` with a later `available_at` and is attempted again

#### Scenario: Jira rejects the transition

- **WHEN** Jira rejects the selected transition with a non-retryable 4xx and the re-read status is unchanged
- **THEN** the row becomes `DEAD` and no further transition is attempted

#### Scenario: Transition request times out after sending

- **WHEN** `doTransition` times out after the request was sent
- **THEN** the row records outcome `unknown` and is retried, and the next attempt re-reads the status before deciding whether to transition

#### Scenario: A transition that landed is not repeated

- **WHEN** the previous attempt timed out but Jira applied the transition
- **THEN** the next attempt sees the target status and marks the row `SENT` as a no-op

### Requirement: Record every outbound attempt in the sync log

The system SHALL write exactly one `TO_JIRA` sync-log row per `TRANSITION_ISSUE` handler attempt, including a no-op: `SUCCESS` for a transition or no-op, `CONFLICT` when the move lost a sync conflict and no transition was sent, `FAILED` otherwise. The payload SHALL include `outboxId`, `attempt`, card id, issue key, source and destination columns, outcome or reason, the chosen status and transition when known, `retryable`, `errorCode` and `latencyMs`; failure rows SHALL include a sanitized `errorMessage`. `mappingId` SHALL be set when a card-issue mapping exists, otherwise null. Moves that coalesce without a handler attempt SHALL NOT write a sync-log row.

#### Scenario: Successful transition is logged

- **WHEN** a transition succeeds
- **THEN** one `TO_JIRA`/`SUCCESS` row contains the outbox id, attempt, card, issue, columns, transition, outcome and latency

#### Scenario: No-op is logged

- **WHEN** the issue already maps to the destination column
- **THEN** one `TO_JIRA`/`SUCCESS` row records outcome `no-op`, the outbox id and the attempt

#### Scenario: Conflict is logged

- **WHEN** the move lost a sync conflict
- **THEN** one `TO_JIRA`/`CONFLICT` row records outcome `conflict` and no transition is sent

#### Scenario: Failure is logged

- **WHEN** synchronization fails
- **THEN** one `TO_JIRA`/`FAILED` row contains the reason, the target column, `retryable`, `errorCode` and a sanitized `errorMessage`

#### Scenario: Coalesced move is not logged

- **WHEN** a second move updates a `PENDING` row before the worker claims it
- **THEN** no additional sync-log row is written for the coalesced move

#### Scenario: Missing card-issue mapping

- **WHEN** no `jira_issue_mappings` row matches the card and issue key
- **THEN** the log row is written with `mappingId` null

#### Scenario: Board not linked

- **WHEN** the board has no Jira connection or no linked Jira project
- **THEN** one `TO_JIRA`/`FAILED` row records reason `board not linked`

### Requirement: Bound synchronization to five seconds from the event

The system SHALL give each handler attempt a five-second budget measured from the start of that attempt, not from the event's `occurredAt`, and SHALL give every Jira gateway call only the time remaining in that budget. When the budget is exhausted, it SHALL stop, record a timed-out failure, and start no further call. It SHALL warn when a completed attempt takes longer than 5000 ms. The original event time SHALL remain only for audit.

#### Scenario: A stale event still gets a full budget

- **WHEN** a row is claimed 30 seconds after the card move
- **THEN** its first Jira call receives up to 5000 ms, not a negative or expired budget

#### Scenario: Budget exhausted before a call

- **WHEN** less than the minimum remaining budget is left before a Jira call
- **THEN** that call is not started and the attempt is logged as `FAILED` with a retryable timeout

#### Scenario: Slow call is aborted

- **WHEN** a Jira call runs longer than the remaining budget
- **THEN** the gateway aborts it and the attempt is recorded as `FAILED`

#### Scenario: Slow but successful synchronization

- **WHEN** an attempt completes successfully after more than 5000 ms
- **THEN** a warning is logged and the success row records the measured latency

### Requirement: Do not block the card move

The system SHALL commit the card move and its outbox row in one database transaction and SHALL return the move response without waiting for Jira. An outbound failure SHALL NOT fail or roll back the move. If the outbox insert fails, the card move SHALL roll back. A committed row SHALL be retried after a process restart.

#### Scenario: Slow Jira does not delay the move

- **WHEN** Jira takes longer than the move request to respond
- **THEN** the move response completes before the Jira synchronization finishes

#### Scenario: Synchronization failure does not fail the move

- **WHEN** the outbound attempt throws
- **THEN** the move remains committed and the row is retried or dead-lettered

#### Scenario: Outbox insert failure rolls back the move

- **WHEN** the outbox insert fails inside the transaction
- **THEN** the card move is not committed

#### Scenario: Restart preserves the move

- **WHEN** the process stops after the move commits and before the Jira call
- **THEN** the row remains `PENDING` and is processed after the worker starts again

### Requirement: Order synchronization runs per Jira issue

The system SHALL process outbox rows for the same card one at a time, in increasing `sequence` order, across processes. Rows for different cards SHALL be processed concurrently. A `DEAD` row SHALL block later rows for that card until an Admin requeues it. A coalesced move SHALL keep the card's original sequence position. A transient failure SHALL leave the row as the head until it succeeds or dead-letters.

#### Scenario: Two quick moves of one card

- **WHEN** the issue is in `To Do` and the user moves its card to *In Progress* and then, before the first transition reaches Jira, to *Done*
- **THEN** Jira ends in the status mapped to *Done*, and the second attempt reads the issue after the first transition completed

#### Scenario: A failed attempt does not block the next one

- **WHEN** the first attempt for a card fails transiently
- **THEN** the same row is retried after backoff while a later move waits behind it

#### Scenario: A transient failure does not let the next move overtake

- **WHEN** the first attempt for a card fails transiently and a later move for the same card is queued
- **THEN** the later row waits behind the retried first row

#### Scenario: A dead row blocks later moves

- **WHEN** a row for a card is `DEAD` and a later row for the same card is `PENDING`
- **THEN** the later row is not claimed until an Admin requeues the dead row

#### Scenario: Different cards run concurrently

- **WHEN** two cards have due `PENDING` heads
- **THEN** two workers may process them at the same time

### Requirement: Surface outbound failures to operators

For a dead-lettered `TRANSITION_ISSUE` row, the failure SHALL be surfaced by the board Admin outbox list and by a `jira.sync.failed` notification, together with the `FAILED` `TO_JIRA` sync-log row and the row's sanitized `last_error`. A transient failure that remains retryable SHALL NOT notify users. The Admin API SHALL be the authoritative view of dead letters.

#### Scenario: Dead letter is listed

- **WHEN** a row becomes `DEAD`
- **THEN** a board Admin can find it through `GET /jira/sync/outbox` with its attempts, error code and sanitized error

#### Scenario: Transient failure does not notify

- **WHEN** a row returns to `PENDING` after a transient failure
- **THEN** no `jira.sync.failed` notification is created

#### Scenario: No valid transition is surfaced

- **WHEN** a user move has no direct Jira transition to the destination column
- **THEN** the row is `DEAD` with `no_transition_path`, one `FAILED` row is written, and the dead-letter notification is sent

### Requirement: Report a timed-out transition as an unknown outcome

When the transition request was sent and then timed out, the system SHALL record reason `deadline exceeded` with `payload.outcome` `unknown` and SHALL log that the outcome is unknown, because Jira may have applied the transition. The row SHALL be retried within the retry window; when the window or the attempts cap is exhausted it SHALL become `DEAD`. The retry SHALL NOT send the transition again before it re-reads the issue status.

#### Scenario: Transition request times out

- **WHEN** `doTransition` times out after the request was sent
- **THEN** the `FAILED` row has reason `deadline exceeded` and outcome `unknown`, and the error log says "outcome unknown"

#### Scenario: Timed-out row is retried

- **WHEN** the timed-out row is still under the attempt limit
- **THEN** the next attempt re-reads the issue status before any new transition

#### Scenario: Timed-out transition that landed is not sent twice

- **WHEN** a timed-out `doTransition` was applied by Jira and the next attempt reads the issue
- **THEN** the issue already maps to the destination, the row is `SENT` with outcome `no-op` and no second transition is sent

#### Scenario: Timed-out row exhausts the retry window

- **WHEN** the row keeps failing until the retry window has passed
- **THEN** it becomes `DEAD` with `attempts_exhausted`

## ADDED Requirements

### Requirement: Store outbound work in a durable outbox

The system SHALL persist every eligible outbound operation in a `sync_outbox` table before any Jira call. The table SHALL store board, card and actor ids, `operation`, jsonb `payload`, status, attempts, availability, lock time, locking worker id, sanitized last error and stable error code, sanitized result, sent/dead timestamps, and a monotonic `sequence`. A committed row SHALL survive a process restart, and a rolled-back card move SHALL leave no row.

#### Scenario: Committed move leaves one row

- **WHEN** a valid user move commits
- **THEN** exactly one `PENDING` row exists for that move

#### Scenario: Rolled-back move leaves no row

- **WHEN** the card-move transaction rolls back
- **THEN** no outbox row exists for that move

#### Scenario: Row survives a restart

- **WHEN** the process stops after commit and starts again
- **THEN** the worker finds and processes the row

### Requirement: Use a generic outbox operation registry

The system SHALL dispatch outbox rows through a handler registry keyed by `operation`. It SHALL implement `TRANSITION_ISSUE` in this change, SHALL dead-letter an unknown operation with `handler_missing`, and SHALL allow a new operation to be added without changing the outbox table.

#### Scenario: Transition operation is dispatched

- **WHEN** a `TRANSITION_ISSUE` row is claimed
- **THEN** the status transition handler runs

#### Scenario: Unknown operation is dead-lettered

- **WHEN** a row names an operation with no registered handler
- **THEN** it becomes `DEAD` with `handler_missing` and is not retried

#### Scenario: A new operation needs only a handler

- **WHEN** a later ticket adds a handler for a new operation
- **THEN** it uses the existing table and registry without a schema change

### Requirement: Coalesce a move into a pending row

The system SHALL coalesce a new move for the same card and operation into an existing `PENDING` row by updating its payload and actor to the latest values while preserving `sequence`, `created_at` and `available_at`.

#### Scenario: Second move while pending

- **WHEN** a second move for the same card arrives while the first row is `PENDING`
- **THEN** one `PENDING` row carries the latest target and the original sequence

#### Scenario: Latest actor replaces the earlier actor

- **WHEN** a different user makes the second move while the first row is `PENDING`
- **THEN** the coalesced row stores the latest actor, sequence and availability

### Requirement: Reset the retry budget when a coalesced target changes

The system SHALL reset `attempts` to 0 when a coalesced move changes the target column, and SHALL preserve `attempts` when the target column is unchanged.

#### Scenario: Changed target resets attempts

- **WHEN** a `PENDING` row has accumulated attempts and a coalesced move changes the target column
- **THEN** `attempts` is 0 and `available_at` is unchanged

#### Scenario: Same target keeps attempts

- **WHEN** a coalesced move keeps the same target column
- **THEN** `attempts` is preserved

### Requirement: Never coalesce non-pending rows

The system SHALL NOT coalesce with an `IN_PROGRESS`, `SENT` or `DEAD` row; a new move SHALL create a new `PENDING` row.

#### Scenario: Move while in progress

- **WHEN** a move arrives while the current row is `IN_PROGRESS`
- **THEN** a new `PENDING` row is inserted behind the in-progress row

#### Scenario: Move after sent

- **WHEN** a move arrives after the previous row is `SENT`
- **THEN** a new `PENDING` row is inserted

#### Scenario: Move after dead

- **WHEN** a move arrives after the previous row is `DEAD`
- **THEN** a new `PENDING` row is inserted behind the dead row

### Requirement: Allow one pending row per card and operation

The system SHALL enforce at most one `PENDING` row per card and operation with a partial unique index.

#### Scenario: Different operations do not coalesce

- **WHEN** a move for a different operation targets the same card
- **THEN** it gets its own row and unique sequence

### Requirement: Claim the head-of-line outbox row per card

The system SHALL claim only the lowest-sequence `PENDING` head for a card among its `PENDING`, `IN_PROGRESS` and `DEAD` rows; `SENT` rows SHALL be ignored. It SHALL use `FOR UPDATE SKIP LOCKED`, SHALL re-check `status = 'PENDING'` in the claim update, and SHALL allow at most one `IN_PROGRESS` row per card. A locked head SHALL NOT allow a worker to claim its successor.

#### Scenario: Two claimers take different cards

- **WHEN** two workers claim due work for two cards
- **THEN** each card gets one `IN_PROGRESS` row and both proceed

#### Scenario: Locked head is not overtaken

- **WHEN** one worker holds the head row and a second worker claims concurrently
- **THEN** the second worker does not claim the next row for that card

#### Scenario: A row cannot be claimed twice

- **WHEN** two workers try to claim the same due row
- **THEN** the `PENDING` re-check lets only one set it to `IN_PROGRESS`

#### Scenario: Successor waits for the head

- **WHEN** a card has a `PENDING` or `DEAD` head and a later `PENDING` row
- **THEN** the later row is not claimable

### Requirement: Retry transient failures within a bounded backoff

The system SHALL retry network errors, timeouts, Jira 5xx, 429 and time-budget exhaustion with capped full-jitter exponential backoff: a 1000 ms base (`OUTBOX_BASE_DELAY_MS`), a 45000 ms cap (`OUTBOX_MAX_DELAY_MS`), a retry window of 24 hours from the time the row was queued (`OUTBOX_MAX_AGE_HOURS`) and a safety cap of 10000 retryable failures (`OUTBOX_MAX_ATTEMPTS`). The cap keeps a recovered Jira drained within the one-minute target, the window lets the queue survive a multi-hour outage. It SHALL increment `attempts` only when a failure or stale lock returns a row to `PENDING`, not when claiming. It SHALL dead-letter 401 after refresh, 403, 404, invalid keys, unlinked boards and a destination with no direct transition without retrying.

#### Scenario: Jira 5xx is retried

- **WHEN** the attempt fails with a Jira 5xx
- **THEN** the row returns to `PENDING` with `attempts + 1` and a jittered delay

#### Scenario: A permanent 4xx is not retried

- **WHEN** the attempt fails with 403 or 404
- **THEN** the row becomes `DEAD` immediately and no second attempt is made

#### Scenario: Backoff respects the cap

- **WHEN** the computed exponential delay exceeds 45000 ms or a jitter value exceeds it
- **THEN** the stored delay is at most 45000 ms

#### Scenario: 400 or 409 is re-read

- **WHEN** `doTransition` answers 400 or 409
- **THEN** the handler re-reads the issue status and treats a changed status as transient and an unchanged status as permanent

#### Scenario: A 429 is retried as transient

- **WHEN** Jira answers 429
- **THEN** `attempts` increases and the row is retried after a delay within the 45000 ms cap

#### Scenario: Retry-After is honoured

- **WHEN** Jira answers 429 with a `Retry-After` of 120 seconds
- **THEN** the row's delay is clamped to 45 seconds

#### Scenario: A Jira outage of several hours does not lose the move

- **WHEN** Jira is unreachable for three hours after a move was queued
- **THEN** the row is still `PENDING` and is sent once Jira is back

#### Scenario: A row failing past the retry window dead-letters

- **WHEN** a retryable failure is recorded for a row queued 24 hours or more ago
- **THEN** it becomes `DEAD` with `attempts_exhausted`

#### Scenario: A requeued row gets a fresh window

- **WHEN** an Admin requeues a dead row, or a move with a new destination coalesces into a pending row
- **THEN** the row's attempts and retry window start again

### Requirement: Recover stale in-progress rows within the recovery target

The system SHALL reclaim an `IN_PROGRESS` row whose `locked_at` is older than 30 seconds on every poll. In one conditional statement it SHALL mark the row `SENT`/`superseded` when a later `PENDING` row for the same card and operation exists, otherwise increment `attempts` and either return it to `PENDING` with backoff or dead-letter it when attempts are exhausted. A crash after claim SHALL be recovered within 60 seconds with the default timings.

#### Scenario: Crash after claim is recovered

- **WHEN** a worker crashes after setting a row `IN_PROGRESS`
- **THEN** a later poll reclaims it and Jira eventually reaches the target

#### Scenario: A newer pending row supersedes the stale row

- **WHEN** the stale row has a later `PENDING` row for the same operation
- **THEN** the stale row becomes `SENT`/`superseded` and the later row is not blocked

#### Scenario: A stale row exhausts its attempts

- **WHEN** reclaiming would make the attempt count reach the attempts cap or the row is past its retry window
- **THEN** the row becomes `DEAD` with `attempts_exhausted`

#### Scenario: Recovery stays under 60 seconds

- **WHEN** a crash happens and Jira is healthy
- **THEN** the row is reclaimed and processed within 30s stale + 5s poll + 5s handler = 40s, leaving 20s of the 60s target

### Requirement: Dead-letter exhausted outbound work

The system SHALL mark a row `DEAD` after a permanent failure, a retryable failure past the 24-hour retry window (or the attempts cap), or exhausted stale recovery, with a stable error code. A `DEAD` row SHALL block later rows for the same card and SHALL not be processed until an Admin requeues it. Notification failure SHALL NOT change the row.

#### Scenario: Permanent failure dead-letters

- **WHEN** the handler cannot find a direct transition to the destination column
- **THEN** the row is `DEAD` with `no_transition_path`

#### Scenario: Retry window exhaustion dead-letters

- **WHEN** a retryable failure is recorded for a row older than the retry window
- **THEN** the row is `DEAD` with `attempts_exhausted`

#### Scenario: Dead letter blocks successors

- **WHEN** a `DEAD` head and a later `PENDING` row share a card
- **THEN** the worker does not process the later row

#### Scenario: Only an Admin requeue unblocks the card

- **WHEN** an Admin requeues the dead row
- **THEN** it returns to `PENDING` and the card can proceed

### Requirement: Drain recovered outbound work within one minute

After Jira becomes reachable, the system SHALL drain a recovered non-dead backlog of up to 100 rows across distinct cards within 60 seconds with concurrency 5 and Jira latency up to 200 ms per call. Rows already `DEAD` before recovery SHALL be excluded from the bound. A ~500-row backlog is best-effort and requires `OUTBOX_CONCURRENCY >= 10`; it is not covered by the guaranteed 60s bound.

#### Scenario: Recovered backlog drains

- **WHEN** Jira recovers after a short outage and the non-dead backlog is at most 100 rows across distinct cards
- **THEN** every row is processed within 60 seconds, in per-card order and without duplicate transitions

#### Scenario: A 500-row backlog is best-effort

- **WHEN** the recovered backlog is about 500 rows
- **THEN** it is processed as a best-effort workload requiring `OUTBOX_CONCURRENCY >= 10`, not under the guaranteed 60s bound

#### Scenario: Three-call component case

- **WHEN** at least 100 rows across distinct cards each need `getIssue`, `listTransitions` and `doTransition` at 200 ms per call
- **THEN** the component test drains them within the simulated 60 seconds

#### Scenario: Already-dead rows are excluded

- **WHEN** a row was `DEAD` before recovery
- **THEN** it is not counted as drained and remains for Admin action

### Requirement: List outbox rows for board Admins

The system SHALL provide `GET /jira/sync/outbox` restricted to board Admins. The list SHALL require `boardId`, default to `DEAD`, support `limit` and `cursor`, and return the board's rows newest first with status, attempts, error code and sanitized last error. It SHALL answer 400 for a missing board, 403 for a non-Admin member and 404 for an unknown or inaccessible board.

#### Scenario: Admin lists dead letters

- **WHEN** a board Admin requests the default list
- **THEN** the response contains that board's `DEAD` rows, newest first, with status, attempts, error code and sanitized last error

#### Scenario: Non-admin list is forbidden

- **WHEN** a board Member requests the list
- **THEN** the response is 403

#### Scenario: Unknown list board is not found

- **WHEN** the board is unknown or the caller is not a member
- **THEN** the response is 404

#### Scenario: Missing list board id is invalid

- **WHEN** the list is called without `boardId`
- **THEN** the response is 400

### Requirement: Requeue a dead outbox row

The system SHALL provide `POST /jira/sync/outbox/{outboxId}/requeue` restricted to board Admins. It SHALL answer 404 for an unknown row, 403 for a non-Admin, and 409 when the row is not `DEAD` or an earlier non-`SENT` row blocks it. An eligible row SHALL become `PENDING` with attempts reset, its error cleared and its lock released. A later `PENDING` same-operation row SHALL be merged into it and marked `SENT`/`superseded`. Requeue SHALL NOT call Jira or expose secrets.

#### Scenario: Single requeue resets the row

- **WHEN** an Admin requeues an unblocked `DEAD` row
- **THEN** its attempts are reset, its error is cleared and it becomes `PENDING`

#### Scenario: Single requeue rejects an invalid row

- **WHEN** the row is not `DEAD` or an earlier non-`SENT` row blocks it
- **THEN** the response is 409 and the row is unchanged

#### Scenario: Unknown row is not found

- **WHEN** the outbox id does not exist
- **THEN** the response is 404

#### Scenario: Non-admin requeue is forbidden

- **WHEN** a board Member calls the single requeue
- **THEN** the response is 403

#### Scenario: Later pending row is merged

- **WHEN** a later `PENDING` row for the same card and operation exists
- **THEN** its payload is merged into the requeued row and the later row is `SENT`/`superseded`

### Requirement: Notify dead-letter recipients

When a `TRANSITION_ISSUE` row becomes terminal `DEAD`, the system SHALL notify every board Admin and the latest mover after any coalescing when that mover is not an Admin, with type `jira.sync.failed`. It SHALL deduplicate recipients so each unique user receives at most one notification for that dead row. `notifyUser` SHALL treat a mover who has left the board as a no-op and SHALL NOT fail the handler.

#### Scenario: Admins and mover are notified

- **WHEN** a non-Admin moves a card and its transition dead-letters
- **THEN** every board Admin and the mover receive one `jira.sync.failed` notification each

#### Scenario: Mover is an Admin

- **WHEN** the mover is a board Admin
- **THEN** the mover receives one admin notification and no duplicate actor notification

#### Scenario: Mover is absent

- **WHEN** the dead row has no `actorId`
- **THEN** only the board Admins are notified

#### Scenario: Mover has left the board

- **WHEN** the latest mover is no longer a board member
- **THEN** `notifyUser` is a no-op and the dead-letter handling does not fail

### Requirement: Deliver dead-letter notifications best-effort

The system SHALL use `notifyBoardAdmins` for Admins and `notifyUser` for a non-Admin mover. Delivery SHALL NOT change the outbox state. No notification SHALL be sent for a retryable failure or a superseded row. The payload SHALL be sanitized.

#### Scenario: Retryable failure does not notify

- **WHEN** a row is still retrying
- **THEN** no notification is created

#### Scenario: Notification failure does not change the row

- **WHEN** creating a notification throws
- **THEN** the dead row remains `DEAD` and the failure is logged

#### Scenario: Payload has no secrets

- **WHEN** the notification is created
- **THEN** its payload contains the outbox, card, issue and error code but no token, raw Jira body or unsanitized error

### Requirement: Sanitize outbound errors and logs

The system SHALL store a stable error code and a sanitized message in `last_error`, logs and Admin responses. It SHALL NOT expose OAuth tokens, refresh tokens, encryption keys, raw Jira response bodies or request headers.

#### Scenario: Unauthorized failure is sanitized

- **WHEN** Jira rejects a token with 401
- **THEN** the stored and returned error names `jira_unauthorized` without the token value

#### Scenario: Admin list is safe

- **WHEN** a board Admin lists dead rows
- **THEN** no token, secret or raw provider body appears in any field

### Requirement: Let Jira win over a queued move it overtook

Before it sends a `TRANSITION_ISSUE`, the handler SHALL record the move for conflict detection (`noteBoardMove`, with the move's `occurredAt`) and, again right before it calls Jira, SHALL check whether a Jira status change of the issue to another column overtook the move: one at most five seconds before the move, or any later one. A move that lost SHALL NOT be sent: the card goes to the column of Jira's status, a `sync_conflict_log` row with resolution `jira` is stored once (the webhook and the retry see the same conflict), the Admins get a `jira.conflict` notification, one `TO_JIRA`/`CONFLICT` sync-log row is written and the outbox row finishes `SENT` with outcome `conflict`. A conflict that an Admin resolves with `boardsync` still overrides Jira through the direct status sync.

#### Scenario: Jira changed the issue while the move was queued

- **WHEN** Jira is unreachable, a user moves a linked card, someone sets the issue to another status in Jira, and Jira becomes reachable again
- **THEN** no transition is sent, one conflict is logged with a `jira.conflict` notification, the card shows Jira's column and the outbox row is `SENT` with outcome `conflict`

#### Scenario: A much later Jira change still wins

- **WHEN** a Jira change to another column was recorded hours after the queued move
- **THEN** the move is dropped as a conflict

#### Scenario: Nothing changed in Jira meanwhile

- **WHEN** Jira has no newer status change of the issue
- **THEN** the move is sent as usual

#### Scenario: Conflict seen twice is logged once

- **WHEN** the inbound webhook already logged the conflict and the queued move is then dropped for the same move time
- **THEN** no second conflict row and no second notification are created

### Requirement: Requeue all dead rows of a board

The system SHALL provide `POST /jira/sync/outbox/requeue-dead?boardId=` restricted to board Admins. It SHALL requeue the board's `DEAD` rows oldest first, at most 500 per call, with the same rules as the single requeue, and answer `{ requeued, skipped }`, where `skipped` counts rows that an earlier row of the same card still blocks. It SHALL answer 400 for a missing board id, 403 for a non-Admin and 404 for an unknown or inaccessible board.

#### Scenario: Admin requeues after an outage

- **WHEN** an Admin calls the bulk requeue for a board with three dead rows of different cards
- **THEN** the response is `{ requeued: 3, skipped: 0 }` and the rows are `PENDING`

#### Scenario: A blocked row is skipped

- **WHEN** a card has two dead rows
- **THEN** the older one is requeued and the newer one is counted in `skipped`

#### Scenario: Non-admin bulk requeue is forbidden

- **WHEN** a board Member calls the bulk requeue
- **THEN** the response is 403
