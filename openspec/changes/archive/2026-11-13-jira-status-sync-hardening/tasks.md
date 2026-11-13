## 1. Tests first

- [x] 1.1 Unit: two overlapping moves of one card leave Jira in the later status (fails without per-issue ordering)
- [x] 1.2 Unit: a database error while resolving the board is `sync failed`, and the board summary is read once
- [x] 1.3 Unit: a timed-out transition records `outcome: "unknown"` and logs "outcome unknown"
- [x] 1.4 Unit: the success log line carries the latency
- [x] 1.5 E2E: the loop-guard test fails when the `origin` guards are removed (checked by mutation)

## 2. Implementation

- [x] 2.1 Per-issue promise chain in `JiraStatusSyncService` (`ponytail:` in-process only, T-35 per-card ordering)
- [x] 2.2 `resolveLinkedBoard` maps only `NotFound`/`Conflict`/`BadRequest` to `board not linked`; drop the duplicate board read
- [x] 2.3 Timed-out `doTransition` → `outcome: "unknown"`; success log with latency

## 3. Docs

- [x] 3.1 `docs/jira-status-sync.md`: ordering, reasons table, unknown outcome, what "surfaced" means for T-25 and the follow-up
