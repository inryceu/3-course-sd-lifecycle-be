# Design

## Context

See `proposal.md` — Why. The relevant existing pieces are:

- `card.moved` carries `boardId`, `origin`, `occurredAt` and `{ card, fromColumnId, toColumnId, position }`; the envelope timestamp is always present (`src/common/events/domain-events.ts`).
- `EventEmitterPublisher` awaits every registered listener, so an `async` `@OnEvent` handler would delay the move request (`src/common/events/event-emitter.publisher.ts`).
- `JIRA_GATEWAY` already exposes `searchIssues`, `listTransitions` and `doTransition`; T-25 adds `getIssue` for a strongly consistent current-status read. The default per-call budget is 45 s and the default per-request timeout is 10 s (`src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts`).
- `JiraStatusMappingService` already resolves status → column with stored rows and category defaults, but its `resolve()` method is private and `columnsByStatus()` loses `isDefault` (`src/modules/jira-sync/application/jira-status-mapping.service.ts`).
- `sync_logs` and `jira_issue_mappings` already exist; `SyncLogEntity` has `direction`, `status`, `payload`, `errorMessage` and nullable `mappingId`.
- Module rule: `jira-sync` uses boards only through `BOARDS_FACADE`; no cross-module repository access.

## Goals / Non-Goals

**Goals:**

- A user card move triggers exactly one outbound Jira synchronization attempt.
- Target selection is deterministic and reuses the existing status mapping.
- The move request never waits for Jira.
- Every attempt that passes the filters leaves a trace in `sync_logs`.
- The complete attempt is bounded by five seconds from `occurredAt`.

**Non-Goals:**

- `POST /jira/mappings` or any other HTTP/API change; the OpenAPI `x-implemented-in: T-25` marker is left in place for reviewer follow-up.
- Inbound/webhook sync (T-26), conflict resolution (T-34), retries, durable queues/outbox, multi-step transition paths, or serialization of concurrent moves for one card.
- New database tables, columns or migrations.

## Decisions

### 1. Listener is synchronous and fire-and-forget

Create `JiraStatusSyncListener` in `jira-sync/application`, registered in `JiraSyncModule.providers`, with:

```ts
@OnEvent('card.moved')
onCardMoved(event: DomainEventOf<'card.moved'>): void {
  // filters + debug logs
  void this.sync.syncCardMove(event).catch((error) => this.logger.error(...));
}
```

The handler returns `void`, so `EventEmitterPublisher` does not await it. The service owns expected failure handling and logging; the listener catch is a last resort for unexpected failures (for example, a database error while writing the log). This keeps the move response independent of Jira without changing the global event bus.

Alternative considered: making the global publisher not await listeners. Rejected because realtime delivery currently relies on awaited listeners and changing the bus would affect every module.

### 2. Filters live in the listener; no trace for intentional skips

The listener skips immediately when:

- `event.origin !== 'user'` (prevents the Jira → board → Jira loop),
- `event.payload.fromColumnId === event.payload.toColumnId` (reorders),
- `event.payload.card.jiraIssueKey` is null (debug log only).

These are intentional no-ops, not sync failures, so no `sync_logs` row is written. The service defensively re-checks the same conditions.

### 3. Read current status with `getIssue`, then select one direct transition

Resolve the linked board first: `BOARDS_FACADE.getBoardSummary(boardId)` supplies the columns and project key, and a missing board or missing `jiraProjectKey` fails with reason `board not linked`. The existing mapping service still enforces the Jira connection and project-link checks. The sync service never reads board tables directly.

The service then reads the issue's current status with `getIssue({ boardId, issueIdOrKey, timeBudgetMs })`, which calls `GET /rest/api/3/issue/{issueIdOrKey}?fields=status`:

- Validate `jiraIssueKey` against the Jira issue-key shape before calling the gateway; reject invalid keys with reason `invalid issue key`.
- A gateway 404 maps to failure `issue not found`.
- Use the returned status directly; do not use JQL search for this read.

Then:

1. Resolve the current status to a column through the same mapping used by import. If that column is the destination column, return a successful `no-op` without listing transitions.
2. Call `listTransitions` with `includeUnavailableTransitions: false` and filter to transitions whose `to` status maps to the destination column.
3. Sort candidates by:
   - explicit stored mapping first (`isDefault === false` before `true`),
   - lowest `jiraStatusId` (numeric comparison when both ids are numeric, lexical otherwise),
   - lowest transition id (same comparison).
4. If no candidate remains, fail with reason `no valid transition`.
5. Execute the chosen transition once with `doTransition`.

To distinguish explicit mappings from defaults, make the existing mapping resolution available to the sync service, for example a public `resolveMappings(linked, statuses): StatusMappingView[]`; keep `columnsByStatus()` as a thin wrapper so import behavior is unchanged. The sync service passes only the current status and the unique transition target statuses, so it does not need another `listProjectStatuses` call.

Alternatives considered:

- Use `searchIssues` with `key = "<KEY>"`: rejected because the enhanced JQL search index is eventually consistent and can return the previous status immediately after a recent transition, which would make the no-op/transition decision stale. `getIssue` reads the issue resource directly.
- Infer the current status from `listTransitions`: rejected because an already-target status normally has no transition to itself, so “already there” and “no path” would be indistinguishable.
- Use `listProjectStatuses` for target resolution: rejected because every transition already carries `to`, and the extra project-status call would add latency without adding information.

### 4. Deadline and gateway budget

Use a single `SYNC_BUDGET_MS = 5000` measured from `Date.parse(event.occurredAt)`; if the timestamp is invalid, use the listener's receipt time. Clamp the remaining budget to `SYNC_BUDGET_MS` so a future timestamp cannot extend it.

Before each Jira call, compute `remaining = deadline - Date.now()`. Require a small minimum (`MIN_CALL_BUDGET_MS = 250`); otherwise stop and fail with reason `deadline exceeded`. Pass `timeBudgetMs: remaining` to `getIssue`, `listTransitions` and `doTransition`. Recompute before the next call, so the three calls share one five-second wall-clock budget rather than three independent budgets.

The gateway gains an optional `timeBudgetMs` on those three inputs. Internally `RequestSpec` carries it, `requestJson`/`requestNoContent` set:

```ts
const budgetMs = Math.min(spec.timeBudgetMs ?? this.timeBudgetMs, this.timeBudgetMs);
```

and pass it to `execute` so `JiraTimeBudgetExceededError` reports the effective budget. This preserves the 45 s default for every existing caller and caps each request timeout/retry/wait by the caller's remaining time. `doTransition` remains non-idempotent; the gateway's existing safe connection-phase retry is allowed because the request was never sent.

### 5. Sync-log payloads and error reasons

Write exactly one row after the filters:

- `direction: TO_JIRA`
- `status: SUCCESS` for transition or no-op; `FAILED` otherwise
- `mappingId`: lookup `jira_issue_mappings` by the unique `(boardId, jiraIssueKey)`; null when absent
- success payload: `cardId`, `issueKey`, `fromColumnId`, `toColumnId`, `outcome` (`transitioned` or `no-op`), `targetStatusId`, `targetStatusName`, `transitionId` when present, `latencyMs`
- failure payload: `cardId`, `issueKey`, `fromColumnId`, `toColumnId`, `reason`, `latencyMs`; `errorMessage` carries the underlying message

Stable failure reasons: `invalid issue key`, `issue not found`, `board not linked`, `no valid transition`, `deadline exceeded`, `jira error`, `sync failed`. `latencyMs` is measured at logging time from `occurredAt`. Log success at `info`/`debug`, failures at `error`, and a warning when `latencyMs > 5000`.

Expected errors (board not linked, gateway errors, no transition, deadline) are caught by the service, written as `FAILED`, and do not propagate. If writing the log itself fails, the listener catch logs it; the move is still unaffected.

### 6. No ordering guarantee

Two rapid moves of the same card start two independent fire-and-forget attempts. Jira applies whichever reaches it last. This is accepted for T-25; a per-card queue or outbox is a later reliability ticket.

## Risks / Trade-offs

- **Lost delivery on process crash** → at-most-once is inherited from the in-process event bus; no outbox is added. The sync log records only attempts that started.
- **Jira rejects a valid-looking transition** (conditions, screens, field requirements) → recorded as `jira error`; there is no retry or screen-field filling.
- **Ambiguous mappings** are resolved deterministically by the documented preference order; an admin who wants a different target must configure an explicit mapping for that status.
- **`getIssue` for current status adds a call** → it is required to distinguish no-op from no-path without the eventual-consistency lag of JQL search, and it shares the same five-second budget.
- **Clock skew in `occurredAt`** → remaining budget is clamped to 5000 ms; a past timestamp can make the attempt fail fast with `deadline exceeded`.
- **No API visibility of sync logs** → T-25 only writes them; a later ticket can add read endpoints.

## Migration Plan

No database migration. Deploy the backend change; existing linked cards with `jiraIssueKey` start syncing on their next user move. Rollback is a normal revert; new `sync_logs` rows remain and are harmless.

## Open Questions

None.
