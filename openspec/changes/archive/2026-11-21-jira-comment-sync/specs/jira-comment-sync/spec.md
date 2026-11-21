# Spec Delta

## Purpose

Mirrors user-authored card comments to the linked Jira issue with explicit BoardSync attribution, a bounded Jira call, local synced state and durable sync-log records.

## ADDED Requirements

### Requirement: Mirror only user comments on linked cards

The system SHALL mirror a `card.commented` event only when its origin is `user` and the card has a `jira_issue_mappings` row for its board. Jira-originated events SHALL NOT call Jira. A card without a mapping SHALL be skipped without a Jira call or sync-log row.

#### Scenario: User comments on a linked card

- **WHEN** a user creates a comment on a card linked to a Jira issue
- **THEN** exactly one add-comment request is sent to that issue

#### Scenario: Jira-originated event

- **WHEN** a `card.commented` event has origin `jira`
- **THEN** no Jira call is made and no sync-log row is written

#### Scenario: Card without a Jira mapping

- **WHEN** a user comments on a card that has no Jira issue mapping
- **THEN** no Jira call is made, no sync-log row is written, and a debug message is logged

### Requirement: Preserve the comment author in Jira

The Jira body SHALL be an ADF document containing `[BoardSync] <display name>: <text>`, using the comment author's display name. A missing, blank, or unavailable display name SHALL use `Unknown user`. A failed name lookup SHALL NOT prevent the comment from being posted. Each line of the text SHALL become its own ADF paragraph, so Jira shows the line breaks.

#### Scenario: Multi-line comment

- **WHEN** a comment text contains line breaks
- **THEN** the Jira body has one paragraph per line, with the prefix on the first

#### Scenario: Known author

- **WHEN** user `Ada Lovelace` comments `Looks good`
- **THEN** the Jira comment body text is `[BoardSync] Ada Lovelace: Looks good`

#### Scenario: Missing user

- **WHEN** the author id no longer resolves to a user
- **THEN** the Jira comment body text is `[BoardSync] Unknown user: <text>`

#### Scenario: Author lookup fails

- **WHEN** resolving the author's display name throws
- **THEN** a warning is logged, the body uses `Unknown user`, and the Jira comment is still posted

### Requirement: Mark the comment synced only after Jira accepts it

The system SHALL set the source comment's `syncedToJira` flag to true through `BOARDS_FACADE.markCommentSynced(cardId, commentId): Promise<void>` only after Jira returns a successful add-comment response. A failed or skipped attempt SHALL leave the flag false.

#### Scenario: Jira accepts the comment

- **WHEN** the add-comment call succeeds
- **THEN** the source comment's `syncedToJira` flag becomes true

#### Scenario: Jira rejects the comment

- **WHEN** the add-comment call fails
- **THEN** the source comment's `syncedToJira` flag remains false

### Requirement: Record every outbound comment attempt

The system SHALL write exactly one `TO_JIRA` sync-log row per Jira add-comment attempt: `SUCCESS` when Jira accepts, `FAILED` otherwise. Success payloads SHALL include `commentId`, `cardId`, `issueKey`, the returned `jiraCommentId` and `latencyMs`; failure payloads SHALL include `commentId`, `cardId`, `issueKey`, `reason` and `latencyMs`, plus `errorMessage`. `mappingId` SHALL identify the card-issue mapping.

#### Scenario: Successful attempt is logged

- **WHEN** Jira accepts a mirrored comment
- **THEN** one `TO_JIRA`/`SUCCESS` row contains the comment, card, issue, Jira comment id and latency

#### Scenario: Failed attempt is logged

- **WHEN** the add-comment call fails
- **THEN** one `TO_JIRA`/`FAILED` row contains the comment, card, issue, failure reason, error message and latency

#### Scenario: Skipped cards are not attempts

- **WHEN** no Jira mapping exists for the card
- **THEN** no `TO_JIRA` row is written

### Requirement: Use stable failure reasons for recovery

Every failed attempt SHALL record one of `invalid issue key`, `issue not found`, `missing scope`, `not connected`, `deadline exceeded`, `jira error` or `sync failed` in `payload.reason`, so later recovery can classify the failure without parsing messages. When the add-comment request timed out after it was sent, the payload SHALL also carry `outcome: 'unknown'` (Jira may have stored the comment), the same marker the status sync uses; recovery SHALL NOT blindly re-post such rows.

#### Scenario: Unknown issue

- **WHEN** Jira answers 404 for the mapped issue key
- **THEN** the failure reason is `issue not found`

#### Scenario: Missing scope

- **WHEN** the connection lacks `write:jira-work` (403 `missing_scope`)
- **THEN** the failure reason is `missing scope`

#### Scenario: Not connected

- **WHEN** the board has no Jira connection or it must be reconnected
- **THEN** the failure reason is `not connected`

#### Scenario: Timeout after the request was sent

- **WHEN** the add-comment request times out
- **THEN** the failure reason is `deadline exceeded` and the payload has `outcome: 'unknown'`

#### Scenario: Gateway failure

- **WHEN** the add-comment call fails with a typed Jira or network error
- **THEN** the failure reason is `jira error`

#### Scenario: Unexpected local failure

- **WHEN** a non-Jira error occurs while building or recording the attempt
- **THEN** the failure reason is `sync failed`

### Requirement: Bound comment mirroring to five seconds

The system SHALL measure from the event's `occurredAt` and give the Jira add-comment call only the time remaining in a five-second budget. When the remaining budget is below the minimum needed, it SHALL not start the call and SHALL record `deadline exceeded`. It SHALL warn when a completed attempt exceeds 5000 ms.

#### Scenario: Budget exhausted before the call

- **WHEN** less than the minimum remaining budget is left before the add-comment call
- **THEN** the call is not started and the attempt is logged as `FAILED` with reason `deadline exceeded`

#### Scenario: Slow call is aborted

- **WHEN** the add-comment call runs longer than the remaining budget
- **THEN** the gateway aborts it and the attempt is logged as `FAILED`

#### Scenario: Slow but successful attempt

- **WHEN** a mirrored comment succeeds after more than 5000 ms
- **THEN** a warning is logged and the success row records the measured latency

### Requirement: Do not block comment creation

The system SHALL start comment mirroring without making the comment-create request wait for Jira. A mirroring failure SHALL NOT fail or roll back the local comment.

#### Scenario: Slow Jira does not delay comment creation

- **WHEN** Jira takes longer to respond than the comment-create request
- **THEN** the local comment is created before the Jira mirror finishes

#### Scenario: Mirroring failure does not fail creation

- **WHEN** the Jira mirror throws
- **THEN** the local comment remains created and a failure is logged

### Requirement: Attempt each comment at most once

The system SHALL make at most one Jira add-comment call per event and SHALL NOT retry a rejected, timed-out, or failed call in this change. It SHALL NOT store a local `jiraCommentId` column; the returned id is recorded only in the success sync-log payload.

#### Scenario: Jira server error

- **WHEN** the add-comment call returns a server error
- **THEN** exactly one call is made and one `FAILED` row is written

#### Scenario: Timeout after sending

- **WHEN** the add-comment request times out after being sent
- **THEN** no retry is made, the comment stays unsynced, and the failure is logged

#### Scenario: No local Jira comment id

- **WHEN** Jira accepts a comment
- **THEN** the returned id is stored only in the sync-log payload and no schema change is required
