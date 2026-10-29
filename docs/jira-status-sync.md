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

## Five-second budget

The synchronization budget is **5000 ms**, measured from the event's `occurredAt`. If that timestamp is invalid, receipt time is used. Remaining time is clamped to 5000 ms so a future timestamp cannot extend the attempt.

Before each Jira call the service computes the remaining budget. If less than **250 ms** remains, the call is not started and the attempt fails with `deadline exceeded`. The remaining budget is passed to `getIssue`, `listTransitions` and `doTransition`, so all three share one wall-clock budget instead of three independent ones. A completed attempt over 5000 ms also logs a warning.

## Target selection

1. Resolve the linked board through `BOARDS_FACADE`; the board must exist, have a Jira project key and pass the existing Jira connection/project-link checks.
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
| `board not linked` | The board is missing, has no `jiraProjectKey`, has no Jira connection, or fails the linked-board checks |
| `no valid transition` | No available transition targets a status mapped to the destination column |
| `deadline exceeded` | Less than 250 ms remains before a Jira call, or a call exhausts its time budget/times out |
| `jira error` | Any other typed `JiraGatewayError`, including a transition rejected by Jira |
| `sync failed` | An unexpected non-gateway error |

Expected failures are caught by the service, written as `FAILED`, and do not propagate to the move request.

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

## Known limitations

- **At-most-once delivery.** The in-process event bus does not provide an outbox. A process crash after the move commits can lose the attempt; only attempts that start are recorded.
- **No ordering for rapid moves of one card.** Each move starts an independent attempt. If two moves are in flight, Jira applies whichever request reaches it last.
- **A failed log write leaves only an error log.** The move has already succeeded. The service rejects when `sync_logs.save()` fails, and the listener reports it with `Logger.error`; no `sync_logs` row remains.
- **No read API for sync logs yet.** This change only writes rows; a later ticket can add read endpoints.
- **No transition retries and no multi-step paths.** A rejected transition is recorded and left for a later attempt triggered by another move.
