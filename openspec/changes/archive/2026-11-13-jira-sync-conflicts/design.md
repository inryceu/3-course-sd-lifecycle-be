## Context

Two sync directions already exist and both run inside `jira-sync`:

- **Outbound (KAN-36)**: `card.moved` with origin `user` → `JiraStatusSyncListener` → `JiraStatusSyncService` (per-issue in-process promise chain, 5 s budget from `occurredAt`, one `sync_logs` row per attempt).
- **Inbound (KAN-37)**: signed `jira:issue_updated` delivery → `JiraWebhookService.applyToBoard` → watermark (`jira_issue_mappings.last_jira_event_at`) → `BoardsFacade.moveCardFromExternal` (publishes `card.moved` with origin `jira`, which the outbound listener ignores).

In-app notifications (KAN-43) live in the boards module (`notifications` table, `notification.created` routed by realtime to `user:{id}`). The notification type `jira.conflict` and the `JiraConflict`/`JiraConflictPage` schemas were already sketched in the contract.

## Goals / Non-Goals

**Goals:** a concrete, testable 5-second conflict window; Jira wins by default; a durable conflict log; admin notification; list/resolve endpoints that reuse the existing sync paths.

**Non-Goals:** conflicts on fields other than status/column (title, description, assignee are not synchronized yet); a frontend UI (T-37); cross-process ordering of outbound attempts (T-35 outbox); new realtime event types.

## Decisions

### D1. The window

A conflict is a pair of changes of one linked card on one board:

- **user move** U: a `card.moved` with origin `user` that changes the column (exactly the events the outbound sync handles). Time `tU` = event `occurredAt` (server clock). Column `cU` = destination column.
- **Jira change** J: a status delivery accepted by the webhook path (passed signature, dedup and the watermark) whose status resolves to a column of the board. Time `tJ` = delivery `timestamp` (Jira clock, ms) or receipt time if missing. Column `cJ` = mapped column, status name `sJ`.

U and J conflict when `|tU − tJ| ≤ 5000 ms` and `cU ≠ cJ`. Either order counts. If `cU = cJ` both sides agree and nothing is logged.

**Echoes.** BoardSync's own transition comes back as a delivery. A delivery is an echo when `sync_logs` has a `TO_JIRA`/`SUCCESS` row for the same mapping with `outcome = transitioned`, `targetStatusId` = the delivered status id and `createdAt ≥ tJ − 5000 ms`. Echoes are applied to the board as before but are not recorded as Jira changes, so a user who moves a card twice within a second (A→B→D) does not get a false conflict when the echo of B arrives after the move to D.

*Alternative considered:* comparing against the card's `updatedAt` — rejected, any edit (title, labels) would count as a change and the column of the change is unknown.

### D2. Where the "last change" lives and how it is made atomic

Five nullable columns on `jira_issue_mappings`: `last_board_move_at`, `last_board_column_id`, `last_jira_change_at`, `last_jira_column_id`, `last_jira_status_name`. Each side writes its own pair and reads the other's in **one statement** that locks the mapping row (`WITH cur AS (SELECT … FOR UPDATE) UPDATE … RETURNING cur.*`, the same pattern as the watermark). Postgres serializes the two writers on the row lock, so the side that runs second always sees the first one, and exactly one side records a given pair. Works across processes, unlike an in-memory map.

### D3. Jira wins

- **J processed second** (webhook sees a recent U): the webhook moves the card to `cJ` as it always does, then logs the conflict. If the outbound attempt for U is still waiting (in the chain, or between `listTransitions` and `doTransition`), it re-reads the mapping right before `doTransition`; a recorded Jira change within the window of `tU` with a different column makes it stop with a `CONFLICT` row (outcome `conflict`, no transition).
- **U processed second** (the outbound attempt sees a recent J when it notes the move): no Jira call is made, a `CONFLICT` row is written, the card is moved back to `cJ` through `moveCardFromExternal` (origin `jira`, so realtime clients see it and no loop starts), and the conflict is logged.

Known limit: if BoardSync's transition was already sent before the Jira change was delivered, Jira's own ordering decides the final status (the later of the two Jira writes); the conflict is still logged and the admin can choose. Documented in `docs/jira-status-sync.md`.

### D4. `sync_conflict_log`

One row per conflict: `board_id`, `card_id`, `mapping_id` (FK to `jira_issue_mappings`, `ON DELETE SET NULL` so history survives an unlink), `jira_issue_key`, `board_column_id`, `board_status` (column title), `board_changed_at`, `jira_column_id`, `jira_status` (status name), `jira_changed_at`, `resolution` (`jira` default | `boardsync`), `resolved_at`, `resolved_by_id`; index `(board_id, createdAt, id)` for the page. "Detected at" is `createdAt`. An unresolved conflict is one with `resolved_at IS NULL` — Jira already won, the admin has not confirmed or overridden it.

### D5. Notification

`BoardsFacade.notifyBoardAdmins(boardId, type, payload)` (boards owns `notifications` and memberships) inserts one row per Admin and publishes `notification.created` after the insert, like the deadline reminders. jira-sync never touches those tables.

### D6. Resolution

`POST /jira/conflicts/{id}/resolve` first **claims** the row (`UPDATE … SET resolved_at = now(), resolved_by_id, resolution WHERE id = $1 AND resolved_at IS NULL RETURNING`); no row → 409. Then:

- `jira`: `getIssue` → map status → `moveCardFromExternal`. Nothing is written to Jira.
- `boardsync`: `JiraStatusSyncService.push()` runs the same attempt as a user move (same chain, same 5 s budget, same `sync_logs` row) with the conflict check off, target = the conflict's BoardSync column. On `SUCCESS` the card moves to that column (origin `jira`; the echo of the transition is recognized by D1).

If the action fails the claim is undone (`resolved_at = NULL`, resolution `jira`) and the answer is 502 (`toHttpError` for gateway errors; a `FAILED` push maps to 502 with its reason). Claim-first keeps two admins clicking at once from both running the action.

### D7. API

`GET /jira/conflicts` follows the notifications page (cursor = id of the last item, `(createdAt, id) <` comparison). `JiraConflict` gets `boardColumnId`, `jiraColumnId`, `boardChangedAt`, `jiraChangedAt`, `resolvedAt`, `resolvedById`, and `resolution` becomes an enum; the existing fields keep their names so the sketch stays compatible. Role checks reuse `JiraStatusMappingService.requireRole` (404 non-member, 403 non-admin).

## Risks / Trade-offs

- [Clock skew between Jira and BoardSync] → `tJ` comes from Jira. Skew of a second or two only widens/narrows the window slightly; acceptable for a 5 s heuristic.
- [Late delivery of the echo row] → the outbound `sync_logs` row is written right after the transition returns; a delivery processed in the few ms between would be treated as a Jira change. Its column equals the user's destination, so it cannot conflict with that move. ponytail: an outbox (T-35) would close this.
- [A user who deliberately re-moves a card 3 s after seeing a Jira change] → counted as a conflict (Jira wins, admin decides). That is the window's definition in FR-13.
- [Extra write per outbound attempt and delivery] → one row-locked update on `jira_issue_mappings`; negligible.

## Migration Plan

Migration `JiraSyncConflicts` (generated with TypeORM) creates `sync_conflict_log` and adds the five columns; `down` drops them. No backfill: empty "last change" columns simply mean no recent change.
