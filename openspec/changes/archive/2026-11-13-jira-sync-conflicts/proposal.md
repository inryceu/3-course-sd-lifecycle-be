## Why

FR-13 (ticket T-34 / KAN-45): when the same card is moved in BoardSync and its issue changes status in Jira at almost the same time, the two sync directions (KAN-36 outbound, KAN-37 webhooks) currently race and the last writer silently wins. The sequence diagram (`03-sequence-jira-sync.puml`, conflict branch) and the `ConflictDetected` state (`04-state.puml`) require such conflicts to be detected, logged, resolved with Jira as the source of truth by default, and reported to the board admins for a manual decision.

## What Changes

- Detect a **sync conflict**: a BoardSync user move of a linked card and a Jira-originated status change of the same issue on the same board within **5 seconds** of each other (either order) that put the card in different columns. Echoes of BoardSync's own transitions never count as Jira changes.
- Apply the default resolution **Jira wins**: the card ends in the column of the Jira status, and a user move that lost is not sent to Jira (`CONFLICT` row in `sync_logs`).
- Store each conflict in a new `sync_conflict_log` table (new entity + TypeORM migration; the migration also adds the "last change" columns to `jira_issue_mappings` used for detection).
- Notify every Board Admin with an in-app `jira.conflict` notification; each one publishes `notification.created` (already delivered to the user's socket room by realtime).
- New endpoints (Admin only): `GET /jira/conflicts?boardId=` (cursor page, newest first) and `POST /jira/conflicts/{conflictId}/resolve` with `resolution: jira | boardsync`. `jira` aligns the card with Jira's current status; `boardsync` pushes the BoardSync column to Jira through the existing status-sync path and moves the card back.
- OpenAPI: implement the sketched `listJiraConflicts` (remove `x-implemented-in: T-34`), extend `JiraConflict`, add `resolveJiraConflict`.

## Capabilities

### New Capabilities
- `jira-sync-conflicts`: conflict window, default resolution, conflict log, admin notification, list and resolve operations.

### Modified Capabilities
- `jira-status-sync`: an outbound attempt that loses a conflict is recorded as `CONFLICT` and sends no transition.
- `api-contract`: conflict operations are described and implemented.

## Impact

- Code: `src/modules/jira-sync` (new conflict detector/service/controller/entity; hooks in `JiraStatusSyncService` and `JiraWebhookService`), `src/modules/boards` (facade method to notify board admins).
- DB: migration `JiraSyncConflicts` (new table `sync_conflict_log`, five nullable columns on `jira_issue_mappings`).
- API: `docs/api/openapi.yaml`; frontend regenerates `api.generated.ts` (no UI here; T-37 builds it).
- Realtime: no new event types; `notification.created` and `card.moved` (origin `jira`) are already broadcast.
