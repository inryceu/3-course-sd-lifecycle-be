# Proposal: jira-webhook-hardening

## Why

The review of KAN-37 (PR #63, comment 6860158152) found that the Jira → board webhook receiver can change the wrong board, reorders cards on its own echo, lets replays through, keeps moving cards on disconnected boards and lets an older delivery overwrite a newer one. While fixing it, the deduplication claim turned out to accept every duplicate: TypeORM returns `[rows, rowCount]` for an `UPDATE … RETURNING`, so the reclaim branch always looked successful.

## What Changes

- Resolve the boards from the delivery's Jira site (`issue.self` against each connection's `siteUrl`/`cloudId`), then the card by `(boardId, jiraIssueKey)`. A delivery from another site never touches a board; every board on the same site linked to the issue's project is updated.
- A board without a connection, or linked to another project than the issue mapping, ignores the delivery.
- An external move into the card's current column without an explicit position is `unchanged`: no reorder, no event.
- The delivery key is derived from signed content only (`event|issueId|changelogId`, else the raw body); `X-Atlassian-Webhook-Identifier` is no longer used.
- The dedup reclaim reads the `UPDATE` result correctly, so a stored delivery is reported as a duplicate. `claim()` no longer deletes expired rows (the sweep does).
- Each issue mapping keeps a watermark (`last_jira_event_at`, the delivery `timestamp`); a delivery not newer than it is dropped as `stale`, and a failed move gives the watermark back.
- Status → column resolution reuses `JiraStatusMappingService.columnsByStatus`; the duplicate `columnForStatus` is removed.
- Receive logs name the board(s) and per-board outcomes.

## Impact

- Code: `jira-webhook.service.ts`, `jira-webhook-payload.ts`, `jira-webhook-delivery.service.ts`, `jira-status-mapping.service.ts`, `cards.service.ts`, `jira-issue-mapping.entity.ts`.
- Database: new migration adding `jira_issue_mappings.last_jira_event_at bigint NULL`.
- Specs: `jira-webhook-sync` (modified requirements).
- API: none.
