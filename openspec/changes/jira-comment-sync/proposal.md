# Proposal

## Why

The second half of FR-10 (T-33) requires a comment created on a card that is linked to Jira to appear on the linked Jira issue. Today `card.commented` is published and delivered to realtime clients, but only card moves reach Jira, so local comments never appear in Jira even though the REST contract advertises mirroring. The event already carries the comment and author, `jira_issue_mappings` already links cards to issues, and `JiraGateway.addComment` already exists, so the outbound comment path can be added without a schema or API change. Jira posts comments as the board's connected account, so the mirrored text needs an author prefix to preserve local attribution.

## What Changes

- **Outbound comment listener.** `jira-sync` subscribes to `card.commented` and ignores events whose origin is not `user`.
- **Linked issue resolution.** Resolve the card's issue through `jira_issue_mappings` by `boardId` and `cardId`. A card without a mapping is an intentional skip: no Jira call and no sync-log row.
- **Attributed Jira body.** Resolve the comment author's display name through `AUTH_FACADE` and post the ADF body `[BoardSync] <display name>: <text>`. A missing or failed lookup uses `Unknown user` and never blocks the sync.
- **Bounded add-comment call.** Post through `JiraGateway.addComment` with the remaining part of a five-second budget measured from the event, matching the status-sync convention. Extend `AddCommentInput` with an optional `timeBudgetMs` override.
- **Success state and sync logging.** After Jira accepts the comment, set `syncedToJira` to true through `BOARDS_FACADE` and write a `TO_JIRA`/`SUCCESS` sync-log row with the comment, card, issue, returned Jira comment id and latency.
- **Failure state for future recovery.** On any failed attempt keep `syncedToJira` false, write one `TO_JIRA`/`FAILED` row with `commentId`, `cardId`, `issueKey`, a stable error kind and `errorMessage`, and log the failure. T-49/T-35 can consume these rows for retry/outbox processing.
- **Explicitly out of scope.** No `jiraCommentId` column, no migration, no retry/outbox, no ordering guarantees, no inbound Jira comment sync, and no comment webhook subscriptions.
- **Tests and docs.** Add unit and E2E coverage for mirroring, attribution fallback, success/failure logging and filtering, and update the jira-sync module README plus any needed OpenAPI wording.

## Capabilities

### New Capabilities

- `jira-comment-sync`: listener-driven mirroring of user comments to the linked Jira issue, including author attribution, the Jira call budget, local synced state, and outbound sync-log records.

### Modified Capabilities

- `jira-gateway`: `addComment` accepts an optional per-call `timeBudgetMs`, capped by the configured gateway budget, so callers can enforce a shorter deadline.

## Impact

- Backend: `src/modules/jira-sync` (new listener and sync service, sync-log writes, mapping lookup), `BOARDS_FACADE.markCommentSynced(cardId, commentId): Promise<void>`, gateway port and HTTP client (`AddCommentInput.timeBudgetMs`), and `AUTH_FACADE` for display names.
- Tests: unit tests for filtering, attribution and fallback, mapping skips, success/failure behavior, synced-state updates and logging; gateway tests for the add-comment time budget; an E2E test with a stubbed gateway and real Postgres.
- API: no REST endpoint or response shape changes; `POST /cards/{cardId}/comments` already advertises mirroring, so only documentation wording may change.
- Database: no migration; `comments.synced_to_jira`, `jira_issue_mappings` and `sync_logs` already exist.
- Dependencies: none.
