# Tasks

## 1. Failing tests first

- [x] 1.1 Unit `jira-sync-conflict.detector.spec.ts`: window math (≤ 5000 ms either order, > 5000 ms none, same column none), echo rule, conflict row + admin notification on detection.
- [x] 1.2 Unit `jira-status-sync.service.spec.ts`: a move that loses writes `CONFLICT`, sends no transition and moves the card back; a pending transition stops when a conflicting Jira change was recorded; `push()` bypasses the check and returns the attempt status.
- [x] 1.3 Unit `jira-sync-conflicts.service.spec.ts`: resolve `jira` / `boardsync`, 409 when resolved, 502 and claim undone when Jira fails.
- [x] 1.4 e2e `jira-conflicts.e2e-spec.ts` (fake Jira gateway, signed deliveries): Jira change 1 s after a user move, user move 1 s after a Jira change, 10 s apart (no conflict), echo after a double move (no conflict), admin notified and member not, list + 403 for member, resolve both ways, 409 twice, 502 on push failure.
- [x] 1.5 Run the new tests and record that they fail.

## 2. Implementation

- [x] 2.1 Entity `SyncConflictLogEntity` + five columns on `JiraIssueMappingEntity`; TypeORM-generated migration `JiraSyncConflicts`.
- [x] 2.2 Boards: `BoardsFacade.notifyBoardAdmins` (notifications for every Admin + `notification.created`).
- [x] 2.3 `JiraSyncConflictDetector`: `noteBoardMove`, `noteJiraChange`, `hasConflictingJiraChange`, record + notify.
- [x] 2.4 `JiraStatusSyncService`: note the move, `CONFLICT` outcome, pre-transition check, `push()` for resolutions.
- [x] 2.5 `JiraWebhookService`: note the Jira change after the watermark, log a conflict after the move.
- [x] 2.6 `JiraSyncConflictsService` + controller `GET /jira/conflicts`, `POST /jira/conflicts/{id}/resolve`.

## 3. Contract and docs

- [x] 3.1 `docs/api/openapi.yaml`: implement `listJiraConflicts` (remove `x-implemented-in: T-34`), add `resolveJiraConflict`, extend `JiraConflict`, add `ResolveJiraConflictRequest`.
- [x] 3.2 `docs/jira-status-sync.md`: conflict section (window, Jira wins, known limit). The PlantUML conflict branch (`03-sequence-jira-sync.puml`) is left as drawn: it shows the same outcome (log, notify admin, Jira wins) at diagram level; detection lives in jira-sync, not as a `ConflictError` from boards.

## 4. Verification

- [x] 4.1 typecheck, lint (no new warnings), unit, e2e, `pnpm api:validate`, `openspec validate --specs --strict`.
- [x] 4.2 Frontend: regenerate `api.generated.ts` from the new contract.
