# Proposal

## Why

The review of PR #61/#62 (KAN-36, T-25) found that two quick moves of one card can leave Jira in the older status, because nothing orders two outbound runs for the same issue. Once inbound sync (KAN-37) is live, Jira's webhooks then move the card back on the board, silently undoing the user's last move. The review also found an e2e loop-guard test that passes with the guard removed, every `requireLinkedBoard` error labelled `board not linked` (a database failure included), a timed-out transition logged as a definite failure, a success log line without latency, a duplicated board-summary read, and an open question on what "surfaced" means in AC4.

## What Changes

- **Per-issue ordering.** `JiraStatusSyncService` chains runs per `boardId:issueKey`, so a later move reads Jira only after the earlier transition finished. In-process only; the T-35 outbox/per-card ordering replaces it.
- **Honest failure labels.** Only the not-found, not-connected and not-linked cases of `requireLinkedBoard` become `board not linked`; any other error is `sync failed`. The board summary is read once per move.
- **Unknown outcome.** A `doTransition` that timed out after the request was sent is recorded as `deadline exceeded` with `payload.outcome: "unknown"` and logged as "outcome unknown".
- **Latency in the success log.** The success line is logged at `log` level with the latency.
- **"Surfaced" for T-25.** The PM decided that for T-25 a failure is surfaced by `Logger.error` plus a `FAILED` `sync_logs` row. A user-facing surface is a follow-up (T-34/T-35). `board_id` on `sync_logs` is not added here (needs a migration and backfill; T-34/T-35 own the read API).
- **Loop-guard e2e.** The test waits on a barrier (a user move of a second card on the same board) before asserting, so it fails when the guard is removed.

## Capabilities

### Modified Capabilities

- `jira-status-sync`: per-issue ordering, board-link failure labelling, unknown transition outcome, latency in the success log, the definition of "surfaced".

## Impact

- Backend: `src/modules/jira-sync/application/jira-status-sync.service.ts`.
- Tests: `jira-status-sync.service.spec.ts`, `test/jira-status-sync.e2e-spec.ts`.
- Docs: `docs/jira-status-sync.md`.
- API, database, dependencies: no change.
