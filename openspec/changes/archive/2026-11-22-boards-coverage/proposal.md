## Why

The boards module is the biggest in the product (FR-03, FR-04, FR-08, FR-09, FR-10) but its unit-level coverage is uneven: on `dev` the backend `src/modules/boards/**` sits at 70.7 % lines (59.7 % branches), with `notifications.service` at 29 %, `columns.service` at 33 %, `labels.service` at 49 % and `cards.service` at 62 %. In the frontend, `BoardHeader` has 60 % and `ColumnView` 82 % of its lines covered. The repo-wide 70 % gate (KAN-51) cannot catch a regression inside this module, because the rest of the code base carries the average. T-55 (KAN-66) closes the gaps with behaviour tests and adds a per-module bar for boards and cards that is printed in the CI log.

## What Changes

- New backend unit specs for `CardsService`, `LabelsService`, `CommentsService`, `ColumnsService`, `BoardsService` and `NotificationsService` covering permission branches (Viewer refused before any write), boundaries (position `count - 1` / `count`, cursor validation, minimum column count) and error paths; the reminder scheduler keeps its fake-timer specs, now listed as scenarios.
- New frontend tests for `BoardHeader`, `ColumnView`, the `BoardPage` move guards, `move-card.ts` boundaries and `card-utils.ts`.
- Backend `scripts/check-service-coverage.mjs` gets a rule table: auth/jira-sync services 85 % each (unchanged), boards services 80 % each, the whole boards module 90 %; the per-rule result is printed in the `pnpm test:cov` log. The global Jest threshold goes from 70 % to 75 %.
- Frontend `scripts/check-module-coverage.mjs` (chained into `pnpm test:coverage`): `src/features/boards` 95 % lines / 90 % branches and `src/features/cards` 95 % lines / 85 % branches, printed as a table in the CI log and on the run summary page. The global Vitest line threshold goes from 70 % to 75 %.
- Bug found by the new tests and fixed: dropping a card on itself moved it to the end of its column (`dropPosition`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `repo-workflow`: the coverage-threshold requirement names the boards rules and says the per-module result is printed in the CI log.
- `deadline-reminders`: the scheduler requirement gets scenarios for the skipped overlapping run, a failing run and shutdown.
- `web-client`: the move requirement gets the drop-on-itself and Viewer scenarios.

## Impact

- Backend: `scripts/check-service-coverage.mjs`, `jest.config.js`, `CONTRIBUTING.md`, new `*.spec.ts` under `src/modules/boards/application/`. No application code change.
- Frontend: `src/features/boards/move-card.ts` (bug fix), `vitest.config.ts`, `scripts/check-module-coverage.mjs`, `package.json` (`test:coverage`), `.github/workflows/ci.yml`, `CONTRIBUTING.md`, new tests. No API or dependency change.
