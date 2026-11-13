# Tasks

## 1. Failing tests first

- [x] 1.1 e2e: cross-site board is untouched, two boards on one site both move, a disconnected board is untouched, an older delivery does not regress the card, a replay with a new identifier header is ignored, a stored key is refused by `claim()` against Postgres, the duplicate test asserts the first move happened.
- [x] 1.2 unit: same-column external move without position is `unchanged`; delivery key ignores the header; `claim()` issues no `DELETE`; relinked board is skipped; failed move restores the watermark; log line names the board.

## 2. Fix

- [x] 2.1 `cards.service.ts`: same-column external move without position returns `unchanged`.
- [x] 2.2 `jira-webhook-payload.ts`: key from signed content only; parse `issue.self`; one shared `headerValue`.
- [x] 2.3 `jira-webhook-delivery.service.ts`: reclaim through a CTE; no `deleteExpired` in `claim()`.
- [x] 2.4 `jira-webhook.service.ts`: resolve boards by site, check project link, watermark, per-board log; reuse `columnsByStatus` and remove `columnForStatus`.
- [x] 2.5 Migration adding `jira_issue_mappings.last_jira_event_at`.

## 3. Docs

- [x] 3.1 Correct the archived `jira-webhook-board-sync` design claims (convergence, orphaned webhooks, malformed JSON order, log fields).
