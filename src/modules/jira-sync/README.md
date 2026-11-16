# Jira Sync Module

This module links boards and cards to Jira issues and mirrors selected outbound changes.

## Comment mirroring

`JiraCommentSyncListener` subscribes to `card.commented` and starts `JiraCommentSyncService` without awaiting it, so `POST /cards/{cardId}/comments` still returns `201` while Jira is working.

The service:

1. Ignores events whose `origin` is not `user`; Jira-originated comments never loop back into Jira.
2. Finds the card's issue through `jira_issue_mappings` by `boardId` + `cardId`. A card without a mapping is skipped with a debug log and produces no Jira call and no sync-log row.
3. Resolves the author through `AUTH_FACADE.getUserById`. The Jira ADF body is exactly `[BoardSync] <displayName>: <text>`. A missing, blank, or failed lookup uses `Unknown user` and does not block mirroring.
4. Calls `JiraGateway.addComment` once with the remaining part of a five-second budget measured from `occurredAt`. The call is skipped when less than 250ms remains, and a successful attempt slower than 5000ms logs a warning.
5. On success, calls `BOARDS_FACADE.markCommentSynced(cardId, commentId)` and writes one `TO_JIRA`/`SUCCESS` row.
6. On failure, leaves `syncedToJira` false and writes one `TO_JIRA`/`FAILED` row.

The add-comment POST is non-idempotent: the gateway does not retry it on 5xx or timeout. There is no ordering guarantee between comments, and no retry or durable outbox in this change.

## Sync-log payloads

Success rows include `commentId`, `cardId`, `issueKey`, `jiraCommentId` and `latencyMs`. Failure rows include `commentId`, `cardId`, `issueKey`, a stable `reason`, `latencyMs` and the row-level `errorMessage`. Every row uses the `TO_JIRA` direction and the card-issue mapping id as `mappingId`.

Stable failure reasons are `invalid issue key`, `issue not found`, `deadline exceeded`, `jira error` and `sync failed`. Comment text is never written to application logs or sync-log payloads.

If the local synced-state update fails after Jira accepted the comment, the service logs that local error but still writes the success row: Jira already holds the comment, and `jiraCommentId` is the reconciliation source.

## Outbox handoff

`TO_JIRA`/`FAILED` rows are the handoff point for T-49/T-35 retry and outbox processing. A timeout after the request was sent is ambiguous because Jira may have created the comment despite the local failure; recovery must reconcile before posting again. T-33 itself does not consume failed rows.

A comment deleted before the asynchronous mirror runs can still appear in Jira because deletion is out of scope and the event was already published.
