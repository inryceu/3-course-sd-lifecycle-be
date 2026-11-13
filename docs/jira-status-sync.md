# Jira Status Sync (Outbound)

Turns a user card move into one Jira workflow transition and records the attempt in `sync_logs`.

- Listener: `src/modules/jira-sync/application/jira-status-sync.listener.ts`
- Service: `src/modules/jira-sync/application/jira-status-sync.service.ts`
- Mapping: `src/modules/jira-sync/application/jira-status-mapping.service.ts`
- Gateway: `src/modules/jira-sync/application/jira-gateway.port.ts`

## Listener and filters

`JiraStatusSyncListener` subscribes to `card.moved`. It ignores:

| Condition | Result |
|---|---|
| `event.origin !== 'user'` | No attempt; prevents the Jira → board → Jira loop |
| `event.payload.fromColumnId === event.payload.toColumnId` | No attempt; this is a same-column reorder |
| `event.payload.card.jiraIssueKey === null` | No attempt; only a debug message is logged |

Intentional skips do **not** create a `sync_logs` row. The service re-checks the same conditions defensively.

The listener returns `void` and starts `JiraStatusSyncService.syncCardMove()` fire-and-forget. Although the global event publisher awaits listeners, it does not await the service promise. The move response therefore never waits for Jira. The listener still catches an unexpected service rejection and logs it with `Logger.error`.

## Ordering per issue

Attempts for the same board and issue run one after another inside the service (a promise chain keyed by `boardId:issueKey`). A second quick move of one card reads Jira only after the first transition finished, so Jira ends in the status of the last move. Attempts for different issues do not wait for each other. A failed attempt does not block the next one. The waiting time counts against the waiting attempt's own five-second budget.

The chain is in-process only. With more than one API instance, two moves of one card handled by different instances are still unordered; per-card ordering through an outbox is T-35.

## Five-second budget

The synchronization budget is **5000 ms**, measured from the event's `occurredAt`. If that timestamp is invalid, receipt time is used. Remaining time is clamped to 5000 ms so a future timestamp cannot extend the attempt.

Before each Jira call the service computes the remaining budget. If less than **250 ms** remains, the call is not started and the attempt fails with `deadline exceeded`. The remaining budget is passed to `getIssue`, `listTransitions` and `doTransition`, so all three share one wall-clock budget instead of three independent ones. A completed attempt over 5000 ms also logs a warning. A successful attempt logs `Jira status sync for <key> on board <id> completed in <n>ms` at `log` level.

## Target selection

1. Resolve the linked board with `JiraStatusMappingService.requireLinkedBoard` (one board-summary read); the board must exist, have a Jira connection and a valid linked project key.
2. Validate the issue key against `^[A-Z][A-Z0-9_]{1,9}-\d+$`.
3. Read the current status with `getIssue` (`GET /issue/{issueIdOrKey}?fields=status`). JQL search is not used for this read.
4. Resolve the current status through the board's status mapping. If it maps to the destination column, the attempt succeeds as a `no-op` without listing transitions.
5. Call `listTransitions` with `includeUnavailableTransitions: false` and keep only currently available transitions whose target status maps to the destination column.
6. Choose one candidate in this order:
   - explicit stored mapping before a category default (`isDefault === false` first),
   - lowest `jiraStatusId` (numeric comparison when both are numeric, lexical otherwise),
   - lowest transition id (same comparison).
7. Execute the chosen transition exactly once. A rejected transition is not retried.

Multi-step transition paths are out of scope. Only a direct transition is considered.

**REVIEW columns:** Jira status categories are `new`, `indeterminate` and `done`. There is no category default for a board `REVIEW` column, so a Jira status only reaches a REVIEW column through an explicit stored mapping. Without that configuration, the destination has no valid candidate and synchronization fails with `no valid transition`.

## Stable failure reasons

The exact `reason` values written by the service are:

| Reason | When it is used |
|---|---|
| `invalid issue key` | The card's key does not match the Jira issue-key shape; checked before `getIssue` |
| `issue not found` | `getIssue` returns HTTP 404 |
| `board not linked` | The board is missing, has no Jira connection, or has no valid `jiraProjectKey` (`NotFound`/`Conflict`/`BadRequest` from `requireLinkedBoard`). A database error while checking is `sync failed` |
| `no valid transition` | No available transition targets a status mapped to the destination column |
| `deadline exceeded` | Less than 250 ms remains before a Jira call, or a call exhausts its time budget/times out. When the `doTransition` request was sent and then timed out, the row also has `payload.outcome: "unknown"` and the error log says "outcome unknown": Jira may have applied the transition |
| `jira error` | Any other typed `JiraGatewayError`, including a transition rejected by Jira |
| `sync failed` | An unexpected non-gateway error, including a database error while resolving the board |

Expected failures are caught by the service, written as `FAILED`, and do not propagate to the move request.

## How failures are surfaced (AC4)

For T-25, "surfaced" means two things, and nothing more:

1. a `Logger.error` line `Jira status sync failed for <key> on board <id>: <reason>` (or `outcome unknown` for a timed-out transition) with the error message, and
2. the `FAILED` `TO_JIRA` row in `sync_logs` with the stable `reason`.

This was the PM's decision on the PR #61 review. Nothing in the product reads these rows yet, so a board user is not told when Jira did not follow a move. A user-facing surface for failures (a read API or a notification to the mover) is a follow-up for T-35; T-34 covers conflicts only. `sync_logs` has no `board_id`; failed rows are found through `payload->>'cardId'` and `payload->>'issueKey'` until that follow-up adds the column.

## `sync_logs` rows

Every attempt that passes the listener filters writes exactly one row with `direction: TO_JIRA`.

Common row fields:

- `mappingId`: id from `jira_issue_mappings` for `(boardId, jiraIssueKey)`, or `null` when no mapping exists
- `errorMessage`: `null` for success/no-op; the underlying error message for a failure
- `payload.latencyMs`: measured from `occurredAt` at logging time

### Successful transition

```json
{
  "direction": "TO_JIRA",
  "status": "SUCCESS",
  "mappingId": "<jira_issue_mappings.id or null>",
  "errorMessage": null,
  "payload": {
    "cardId": "<card id>",
    "issueKey": "KAN-1",
    "fromColumnId": "<source column id>",
    "toColumnId": "<destination column id>",
    "outcome": "transitioned",
    "targetStatusId": "31",
    "targetStatusName": "Done",
    "transitionId": "41",
    "latencyMs": 812
  }
}
```

### No-op (Jira already matches the destination)

```json
{
  "direction": "TO_JIRA",
  "status": "SUCCESS",
  "mappingId": "<jira_issue_mappings.id or null>",
  "errorMessage": null,
  "payload": {
    "cardId": "<card id>",
    "issueKey": "KAN-1",
    "fromColumnId": "<source column id>",
    "toColumnId": "<destination column id>",
    "outcome": "no-op",
    "targetStatusId": "31",
    "targetStatusName": "Done",
    "latencyMs": 204
  }
}
```

### Failure

```json
{
  "direction": "TO_JIRA",
  "status": "FAILED",
  "mappingId": "<jira_issue_mappings.id or null>",
  "errorMessage": "Jira client error: transition rejected (HTTP 400)",
  "payload": {
    "cardId": "<card id>",
    "issueKey": "KAN-1",
    "fromColumnId": "<source column id>",
    "toColumnId": "<destination column id>",
    "reason": "jira error",
    "latencyMs": 515
  }
}
```

### Conflict (the move lost a sync conflict)

```json
{
  "direction": "TO_JIRA",
  "status": "CONFLICT",
  "mappingId": "<jira_issue_mappings.id>",
  "errorMessage": null,
  "payload": {
    "cardId": "<card id>",
    "issueKey": "KAN-1",
    "fromColumnId": "<source column id>",
    "toColumnId": "<destination column id>",
    "outcome": "conflict",
    "jiraColumnId": "<column of the Jira status>",
    "jiraStatusName": "In Progress",
    "latencyMs": 35
  }
}
```

`jiraColumnId`/`jiraStatusName` are present when this attempt detected the conflict; they are absent when the webhook path detected it while the transition was still pending.

## Sync conflicts (T-34, FR-13)

Code: `jira-sync-conflict.detector.ts` (detection), `jira-sync-conflicts.service.ts` + `presentation/jira-conflicts.controller.ts` (list/resolve). Design: `openspec/changes/archive/2026-11-13-jira-sync-conflicts/design.md`.

**Window.** A *user move* (`card.moved`, origin `user`, column change; time = `occurredAt`) and a *Jira change* (accepted status delivery; time = webhook `timestamp`, or receipt time) of the same linked card conflict when they are at most **5000 ms** apart, in either order, and the Jira status maps to a different column than the user's destination. A delivery whose status BoardSync itself transitioned the issue to (a `SUCCESS`/`transitioned` row for that status logged no earlier than 5 s before the change) is an echo and never counts.

Each side records its latest change on `jira_issue_mappings` (`last_board_move_at`/`last_board_column_id`, `last_jira_change_at`/`last_jira_column_id`/`last_jira_status_name`) and reads the other side's in one row-locked statement, so exactly the side processed second detects the conflict.

**Jira wins.**

| Processed second | What happens |
|---|---|
| Jira change (webhook) | The card moves to the Jira column as for any delivery; the conflict is logged. A transition for the user move that has not been sent yet is skipped (`CONFLICT` row). |
| User move (outbound attempt) | No Jira call; the card is moved back to the Jira column (`card.moved`, origin `jira`); `CONFLICT` row; the conflict is logged. |

Every conflict is a `sync_conflict_log` row (resolution `jira`, `resolved_at` null) and one `jira.conflict` notification per board Admin (`notification.created`, delivered to `user:{id}`).

**Resolution** (`POST /jira/conflicts/{id}/resolve`, Admin): `jira` reads the issue's current status and moves the card to its column (no Jira write); `boardsync` runs `JiraStatusSyncService.push()` to the conflict's BoardSync column (same chain, budget and `sync_logs` row as a user move, without the conflict check) and on success moves the card there. The conflict is claimed first, so it resolves once (409 afterwards); a Jira failure answers 502 and reopens it.

**Known limit.** If BoardSync's transition reached Jira *before* a concurrent Jira edit was delivered, Jira's own order decides its final status (the later write); the conflict is still logged and the admin decides.

## Known limitations

- **At-most-once delivery.** The in-process event bus does not provide an outbox. A process crash after the move commits can lose the attempt; only attempts that start are recorded.
- **Ordering is per process.** Moves of one card are ordered inside one process only (see *Ordering per issue*). Across instances Jira applies whichever request reaches it last, and once inbound sync (KAN-37) is live the resulting webhooks move the card back on the board. T-35 owns cross-process per-card ordering.
- **A failed log write leaves only an error log.** The move has already succeeded. The service rejects when `sync_logs.save()` fails, and the listener reports it with `Logger.error`; no `sync_logs` row remains.
- **No read API for sync logs yet.** Failures reach only the server log and `sync_logs` (see *How failures are surfaced*). T-34 surfaces conflicts only (see *Sync conflicts*); failed attempts remain a T-35 follow-up.
- **No transition retries and no multi-step paths.** A rejected transition is recorded and left for a later attempt triggered by another move.
