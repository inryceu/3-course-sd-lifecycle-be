# Design

## Board resolution

The board comes from the site that sent the delivery, not from the issue key alone. `issue.self` is parsed and compared with every connection: same origin as `siteUrl`, or a `/ex/jira/<cloudId>/` path. Matching connections give the candidate boards; the card link is then looked up by `(boardId, jiraIssueKey)` on the existing unique index. Each board is processed independently and gets its own outcome in the log.

`matchedWebhookIds` is not used. If Jira sends one delivery per matching webhook, the content-derived dedup key (below) makes the second copy a duplicate, so filtering by webhook id would leave the second board unchanged; resolving by site updates every linked board from the first copy. Webhook ids are also not unique across sites.

A board is skipped (`unlinked`) when its project key differs from the mapping's project key, and it never becomes a candidate without a connection, so a disconnected board ignores deliveries even while the remote webhook lives on.

## Deduplication

The key is `sha256(event|issueId|changelogId)`, else `sha256(rawBody)`. Both are covered by the HMAC; the identifier header is not, so it is dropped. The reclaim `UPDATE … RETURNING` runs inside a CTE so TypeORM returns rows rather than `[rows, rowCount]`.

## Watermark

`jira_issue_mappings.last_jira_event_at bigint` holds the payload `timestamp` (ms) last applied. Before the move one statement advances it only when the delivery is newer and returns the previous value; if no row comes back the outcome is `stale`. If the move throws, the previous value is written back only where the column still holds this delivery's timestamp. A delivery without a timestamp skips the watermark.

Limit: two deliveries for the same issue that both pass the watermark concurrently can still finish their moves in reverse order. Closing that needs the move and the watermark in one transaction across the boards module boundary.

## Remote webhooks on disconnect

The gateway still has no delete operation, so the remote webhook outlives a disconnect until it expires. Its deliveries are now ignored by board resolution.
