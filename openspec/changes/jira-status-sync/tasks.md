# Tasks

## 1. Gateway getIssue and per-call budget override

- [ ] 1.1 Add `getIssue({ boardId, issueIdOrKey })` to the port and HTTP client, calling `GET /issue/{issueIdOrKey}?fields=status` and returning id, key and current status; add stub-server tests for the status response and a 404; verify `pnpm test -- jira-gateway.http-client.spec.ts`
- [ ] 1.2 Add optional `timeBudgetMs` to `GetIssueInput`, `ListTransitionsInput` and `DoTransitionInput`; thread the value through `RequestSpec`, `requestJson`, `requestNoContent` and `execute`, using `Math.min(requested, configured)`; add stub-server tests for a shortened budget, a request above the default being capped, omission using the default, and an exhausted caller budget; verify `pnpm test -- jira-gateway.http-client.spec.ts`

## 2. Mapping resolution for outbound sync

- [ ] 2.1 Expose the mapping resolution result (`columnId`, `isDefault`) to the sync service while keeping `columnsByStatus()` behavior unchanged; add `jira-status-mapping.service.spec.ts` coverage for explicit vs default rows and verify `pnpm test -- jira-status-mapping.service.spec.ts`

## 3. Outbound sync service

- [ ] 3.1 Implement the service flow: resolve the board via `BOARDS_FACADE`, validate the key, read current status with `getIssue`, no-op when it maps to the destination column, list transitions, filter by destination column, apply the explicit-mapping, lowest-`jiraStatusId`, lowest-transition-id order, and execute one transition; unit-test no-op, success, explicit preference, lowest-status tie, transition-id tie, `no valid transition`, `issue not found`, invalid key, `board not linked`, deadline and gateway failure; verify `pnpm test`
- [ ] 3.2 Implement `TO_JIRA` sync-log writes for success, no-op and failure with the specified payload, nullable `mappingId`, measured `latencyMs`, `Logger.error` on failure and a warning above 5000 ms; unit-test all three outcomes, missing mapping and a log-write failure; verify `pnpm test`

## 4. Event listener and module wiring

- [ ] 4.1 Add the `card.moved` listener that skips non-user origins, same-column reorders and cards without an issue key (debug log), delegates to the service fire-and-forget, and catches unexpected rejections; register it in `JiraSyncModule`; unit-test each filter, the non-blocking return, service invocation and rejection logging; verify `pnpm test`
- [ ] 4.2 Wire the new service, listener and repositories in `JiraSyncModule` without adding cross-module imports; verify `pnpm typecheck` and `pnpm test`

## 5. Integration behavior

- [ ] 5.1 Add a component/E2E test with real Postgres and a stubbed `JIRA_GATEWAY` (`getIssue`, `listTransitions`, `doTransition`): a user move writes a `TO_JIRA`/`SUCCESS` row, a Jira-origin move writes none, an already-mapped status produces a no-op row, and a rejected transition produces `FAILED`; verify `pnpm test:e2e`
- [ ] 5.2 Verify the move response returns while the stubbed Jira call is still pending, and that a failing sync does not change the move result; verify with the same E2E suite

## 6. Documentation

- [ ] 6.1 Working-agreement DoD: create `docs/jira-status-sync.md` documenting the `card.moved` listener filters and fire-and-forget behavior, the stable failure reasons and the success/no-op/failure `sync_logs` payload shapes; verify the examples match `design.md` and `git diff -- docs/api/openapi.yaml` is empty

## 7. Verification

- [ ] 7.1 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build` and `openspec validate "jira-status-sync" --strict`; all must pass

## Workflow follow-up

- Flag the OpenAPI `POST /jira/mappings` `x-implemented-in: T-25` marker to the reviewer; do not implement that endpoint in KAN-36.
- Archive the change after review approval.
- Verify the archived `jira-status-sync` spec and the modified `jira-gateway` spec.
