## 1. Measure

- [x] 1.1 Measure per-file lines/branches for `src/modules/boards/**` (backend `jest --coverage`) and `src/features/boards|cards/**` (frontend `vitest --coverage`); record them in `design.md` and the PR

## 2. Backend tests

- [x] 2.1 `cards.service.spec.ts`: reads, create (label/assignee validation), update, move boundaries and neighbour shifts, remove, assign, Jira import and external move; verify with a probe that shifting a boundary fails a test
- [x] 2.2 `labels-comments-gaps.spec.ts`: label conflicts and Viewer refusal, attach/detach idempotence, comment cursor validation and paging, author/Admin delete rules
- [x] 2.3 `notifications-columns.spec.ts`: notify Admins, paging, mark read, column create/update/remove/reorder rules, boards service list/get/update/remove
- [x] 2.4 Reminder scheduler scenarios (interval, overlap, failed run, shutdown, interval 0) are covered by the existing fake-timer specs in `deadline-reminders.service.spec.ts`; verify by removing the overlap guard

## 3. Frontend tests and fix

- [x] 3.1 Tests for `BoardHeader`, `ColumnView`, `BoardPage` move guards, `move-card.ts` boundaries and `card-utils.ts`
- [x] 3.2 Fix `dropPosition` so a card dropped on itself keeps its place; the new test fails without the fix

## 4. Gates

- [x] 4.1 Backend: rule table in `scripts/check-service-coverage.mjs` (boards services 80 %, module 90 %), global Jest threshold 75 %; verify `pnpm test:cov` passes and fails when the module gate is raised above the measured value
- [x] 4.2 Frontend: `scripts/check-module-coverage.mjs` chained into `test:coverage`, summary step in `ci.yml`, global threshold 75 %; verify it passes and fails with a raised gate
- [x] 4.3 Update `CONTRIBUTING.md` in both repos

## 5. Verification

- [x] 5.1 Typecheck, lint, Prettier, unit coverage, backend e2e, `pnpm api:validate`, `openspec validate --specs --strict`; one Playwright run of `e2e/board.spec.ts` against the Docker stack
- [x] 5.2 Open PRs in both repos and confirm CI is green and the per-module table is in the log
