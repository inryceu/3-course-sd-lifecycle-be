# Design

## Context

See `proposal.md` - Why. The existing pieces that shape this design are:

- `CommentsService.create` saves the comment and then publishes `card.commented` with a `CommentSnapshot` containing `id`, `cardId`, `authorId`, `text`, `syncedToJira` and `createdAt`. The event has no issue key or board summary.
- `EventEmitterPublisher` awaits every listener, so an `async` handler would delay the comment response. `JiraStatusSyncListener` already returns `void` and starts its service fire-and-forget.
- `jira_issue_mappings` contains `id`, `boardId`, `cardId`, `jiraIssueKey`, `jiraIssueId` and `jiraProjectKey`. Imported cards have a row; the link is the authoritative card-to-issue relation.
- `AUTH_FACADE.getUserById` returns `{ id, email, displayName }` or null; `jira-sync` already imports `AuthModule` and may use only that public port.
- `JiraGateway.addComment` sends `POST /issue/{issueIdOrKey}/comment` with an ADF body. It is non-idempotent and currently has no per-call budget; the gateway default is 45 seconds.
- Status sync already uses a five-second wall-clock budget, `MIN_CALL_BUDGET_MS = 250`, a fire-and-forget listener and `sync_logs` for every attempt. T-33 follows the same conventions.
- `CommentEntity` already has `syncedToJira` and `markSynced()`, but `BOARDS_FACADE` exposes no comment update.
- `SyncLogEntity` supports `direction`, `status`, `payload`, `errorMessage` and nullable `mappingId`.
- Module rules allow `jira-sync` to use boards only through `BOARDS_FACADE`; no cross-module entity or repository access.

## Goals / Non-Goals

**Goals:**

- A user comment on a linked card produces exactly one Jira add-comment attempt.
- Jira shows who wrote the local comment through an explicit prefix.
- The comment-create request never waits for Jira.
- Every Jira attempt leaves a `TO_JIRA` sync-log row that a later outbox can consume.
- The local `syncedToJira` flag reflects a successful Jira post.

**Non-Goals:**

- Retries, a durable outbox, or ordering guarantees; T-49/T-35 own resilience and outbox behavior.
- Inbound Jira comments, comment edits/deletes, or comment webhook subscriptions.
- A new REST endpoint, `jiraCommentId` column, migration, or backfill of existing comments.
- Conflict handling or duplicate prevention beyond the gateway's existing non-idempotent POST policy.
- Additional board reads when the mapping already identifies the issue.

## Decisions

### 1. Listener is fire-and-forget and filters only the origin

Create `JiraCommentSyncListener` in `jira-sync/application` and register it in `JiraSyncModule.providers`:

```ts
@OnEvent('card.commented')
onCardCommented(event: DomainEventOf<'card.commented'>): void {
  if (event.origin !== 'user') return;
  void this.sync.syncComment(event).catch((error) => this.logger.error(...));
}
```

The handler returns `void`, so the comment-create response is independent of Jira. The service defensively repeats the `origin !== 'user'` check. The link check needs the database, so it lives in the service rather than the listener. The listener catch is a last resort for unexpected failures such as a failed sync-log write.

Alternative considered: make the listener `async` and await the Jira call. Rejected because `EventEmitterPublisher` awaits listeners and the card-comment API would become dependent on Jira latency.

### 2. Resolve the issue from the card mapping and skip unlinked cards

The service reads one `jira_issue_mappings` row by `boardId` and `cardId`:

```ts
const link = await this.links.findOne({
  where: { boardId: event.boardId, cardId: event.payload.cardId },
  select: { id: true, jiraIssueKey: true },
});
```

If no row exists, the card is not linked: log a debug message and return without a Jira call or sync-log row. This mirrors the status-sync behavior for unlinked cards and keeps intentional no-ops out of the failure stream.

Use the mapping's `jiraIssueKey` as the authoritative issue. Do not call `BOARDS_FACADE.getBoardSummary`: the mapping already proves the card-issue link, and the gateway loads the board connection itself. A missing connection or revoked token naturally becomes a failed attempt with reason `jira error`. Validate the issue key with the same shape used by status sync before calling the gateway; an invalid stored key fails with reason `invalid issue key`.

Alternative considered: require a board summary and project link first. Rejected because it adds a board read to every comment and duplicates the mapping's information. The mapping row is created only for a linked project.

### 3. Resolve the author through `AUTH_FACADE` and prefix the ADF body

Inject `AUTH_FACADE` into the comment sync service. Resolve `event.payload.authorId` with `getUserById`. The call is best-effort:

- if it returns a non-blank `displayName`, use it;
- if it returns null or a blank name, use `Unknown user`;
- if it throws, catch the error, log a warning without failing the sync, and use `Unknown user`.

Build exactly `[BoardSync] ${displayName}: ${event.payload.text}` and pass it to `plainTextToAdf`. The ADF text node handles the user text, so no HTML escaping is added and the required prefix is literal.

Alternative considered: resolve the author through a boards-owned user relation or import the auth user entity. Rejected by the module-boundary rules; `AUTH_FACADE` is the intended public port. Alternative considered: omit the prefix. Rejected because Jira posts as the connected account and the local author would be lost.

### 4. Use the remaining five-second budget for `addComment`

Use `SYNC_BUDGET_MS = 5000` and `MIN_CALL_BUDGET_MS = 250`, measured from `Date.parse(event.occurredAt)` with the listener's receipt time as fallback. Clamp the remaining budget to five seconds so a future timestamp cannot extend it. Recompute the remaining budget immediately before the add-comment call; if it is below the minimum, do not call Jira and record `deadline exceeded`.

Extend `AddCommentInput` with optional `timeBudgetMs`. Thread it through `RequestSpec`, `requestJson` and `execute` exactly like `getIssue`, `listTransitions` and `doTransition`:

```ts
const budgetMs = Math.min(spec.timeBudgetMs ?? this.timeBudgetMs, this.timeBudgetMs);
```

`addComment` remains a non-idempotent POST, so the existing gateway policy sends it once and does not retry 5xx or timeouts. The safe connection-phase retry remains acceptable because the request was never sent. The five-second value is a project convention copied from status sync, not a T-33 acceptance criterion; it prevents a slow Jira call from lingering for the 45-second gateway default and keeps outbound behavior consistent.

Alternative considered: rely on the gateway default budget. Rejected because it would make comment mirroring behave differently from status sync and hold resources far longer than the rest of outbound sync.

### 5. Mark the local comment and write one log row after the Jira attempt

After `addComment` resolves, the service:

1. Calls `BOARDS_FACADE.markCommentSynced(cardId, commentId): Promise<void>`. The facade implementation updates the comment only when both ids match, so a comment from another card cannot be touched.
2. Writes one `TO_JIRA`/`SUCCESS` sync-log row with `commentId`, `cardId`, `issueKey`, the returned `jiraCommentId` and `latencyMs`.

Marking is not attempted when Jira fails. If the local flag update fails after Jira accepted the comment, the service logs that local error but still writes the success row: Jira already holds the comment, and the row's `jiraCommentId` is the evidence a later reconciliation/outbox can use instead of posting again.

If `addComment` or the preceding mapping/validation steps fail, the service writes one `TO_JIRA`/`FAILED` row and leaves `syncedToJira` false. Every attempt row sets `mappingId` to the mapping id. Failure payloads carry `commentId`, `cardId`, `issueKey`, `reason`, `latencyMs` and `errorMessage`; success payloads carry `commentId`, `cardId`, `issueKey`, `jiraCommentId` and `latencyMs`. Comment text is never written to logs.

There is no `jiraCommentId` column and no migration. The returned id is only part of the success log payload, which is enough for T-49/T-35 without expanding the comments schema.

Alternative considered: add a `jira_comment_id` column. Rejected by T-33 scope; it would require a migration and a broader reconciliation model that belongs to the outbox ticket.

### 6. Failure reasons are stable and the flag remains false

Map failures to one of:

| Reason | Condition |
| --- | --- |
| `invalid issue key` | The mapping's issue key fails the Jira key shape |
| `issue not found` | `addComment` returns `JiraClientError` with status 404 |
| `deadline exceeded` | The five-second budget is exhausted or the request times out |
| `jira error` | Any other typed gateway failure, including authentication/connection errors |
| `sync failed` | Any unexpected local error after the mapping was resolved |

Failed attempts are logged at `error` level with the board, issue and reason. Successful attempts are logged at `log` level with their latency; an attempt over 5000 ms produces a warning. This gives operators immediate visibility and gives the future outbox a stable `payload.reason` rather than a parsed message.

The `FAILED` rows, including the false `syncedToJira` state, are the handoff point for the T-49/T-35 outbox. T-33 does not consume them.

### 7. At-most-once, no ordering

Each event starts one independent attempt. There is no per-card or per-comment chain, so two comments may reach Jira in a different order than they were created locally. This is accepted for T-33; ordering and retry are outbox concerns.

The gateway does not retry the non-idempotent comment POST on a server error or timeout. A timeout after the request was sent may still have created the Jira comment while the local row says `FAILED`; a later outbox must treat that as an unknown outcome rather than blindly posting again. The success log's `jiraCommentId` helps reconciliation when the response was received.

## Risks / Trade-offs

- **At-most-once delivery** -> A process crash after the comment event leaves no retry; the local comment stays unsynced until a future outbox. Accepted for T-33.
- **Timeout after send is ambiguous** -> Jira may contain the comment although BoardSync records `FAILED`. T-49/T-35 must resolve this instead of retrying blindly.
- **Author lookup failure** -> Jira shows `Unknown user`; the comment is still posted so attribution loss never blocks synchronization.
- **Local mark failure after Jira success** -> `syncedToJira` can remain false while Jira holds the comment; the success log with `jiraCommentId` is the reconciliation source and a retry must not repost it.
- **No ordering** -> Jira comment order can differ from local creation order. Accepted; the outbox ticket owns ordering.
- **Comment deleted before the mirror runs** -> The Jira comment can still be posted because deletion is out of scope and the event was already published.
- **No `jiraCommentId` column** -> Correlation relies on `sync_logs`; this is intentional to avoid a migration.

## Migration Plan

No database migration. Deploy the backend change and new user comments on linked cards start mirroring; existing comments are not backfilled. Rollback is a normal revert: comments already posted to Jira and their sync-log rows remain, new local comments stop mirroring, and the persisted `syncedToJira` values remain harmless.

## Open Questions

None.
