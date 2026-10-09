# Tasks

## 1. Create Jira-Sync Event Listener

- [ ] 1.1 Create `src/modules/jira-sync/application/board-events.listener.ts` with `@OnEvent` handlers for `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated` — verify file exists and compiles
- [ ] 1.2 Inject `JiraConnectionService` and `ATLASSIAN_OAUTH` port; implement `origin === 'jira'` filter at handler entry — verify TypeScript compiles (`pnpm build`)
- [ ] 1.3 Implement `boardId` → Jira connection lookup using `JiraConnectionService.getConnection(boardId)` — verify unit test passes
- [ ] 1.4 Implement outbound sync calls per event type (create issue, update issue, transition issue, add comment, update project) — verify unit test passes
- [ ] 1.5 Handle missing Jira connection gracefully (log warning, skip) — verify unit test passes

## 2. Register Listener in Module

- [ ] 2.1 Add `BoardEventsListener` to `providers` array in `src/modules/jira-sync/jira-sync.module.ts` — verify `pnpm build` succeeds
- [ ] 2.2 Ensure `EventBusModule` is available (already global) — verify no circular dependency errors

## 3. Unit Tests

- [ ] 3.1 Create `src/modules/jira-sync/application/board-events.listener.spec.ts` — verify test file exists
- [ ] 3.2 Test `origin: 'jira'` filter: verify handler returns early without calling Jira API — verify test passes
- [ ] 3.3 Test `origin: 'user'` with valid connection: verify correct Jira API method called — verify test passes
- [ ] 3.4 Test missing connection: verify warning logged, no crash — verify test passes
- [ ] 3.5 Test error from Jira API: verify error logged, handler doesn't throw — verify test passes

## 4. Verification

- [ ] 4.1 Run full test suite: `pnpm test` — verify all tests pass
- [ ] 4.2 Run lint: `pnpm lint` — verify no lint errors
- [ ] 4.3 Run typecheck: `pnpm typecheck` — verify no type errors
- [ ] 4.4 Run build: `pnpm build` — verify production build succeeds

## Workflow follow-up

- Archive the change after implementation is complete and reviewed.