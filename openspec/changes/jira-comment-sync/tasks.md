# Tasks

## 1. Spec-first RED tests

- [x] 1.1 Add gateway tests for `AddCommentInput.timeBudgetMs`: a caller budget caps the request timeout, retries and waits; an omitted budget uses the configured default; a larger caller value is capped by the configured default; add a test that the non-idempotent POST is not retried on 5xx or timeout; verify `pnpm test -- jira-gateway.http-client.spec.ts` fails for the intended missing behavior before implementation
- [x] 1.2 Add `JiraCommentSyncService` unit tests for: only `user` origin proceeds; mapping is read by `boardId` + `cardId`; an unmapped card makes no gateway call and writes no log; a known author produces `[BoardSync] <name>: <text>` in ADF; blank, null and failed author lookups use `Unknown user` but still post; success marks the comment and writes one `SUCCESS` row with `jiraCommentId`; Jira 404 becomes `issue not found`; other gateway errors become `jira error`; invalid issue keys become `invalid issue key`; an exhausted budget makes no call and logs `deadline exceeded`; unexpected errors become `sync failed`; failures leave the flag false and do not retry; verify `pnpm test -- jira-comment-sync.service.spec.ts` fails for the intended missing behavior
- [x] 1.3 Add `JiraCommentSyncListener` unit tests for the `user`-only filter, fire-and-forget return, service invocation and unexpected-rejection logging; verify `pnpm test -- jira-comment-sync.listener.spec.ts` fails for the intended missing behavior
- [x] 1.4 Add `test/jira-comment-sync.e2e-spec.ts` with a stubbed `JIRA_GATEWAY` and real Postgres covering: a mapped user comment posts the prefixed ADF body exactly once, sets `syncedToJira` and writes one `TO_JIRA`/`SUCCESS` row; a Jira-origin comment posts nothing; an unmapped card posts nothing and writes no row; a gateway failure leaves `syncedToJira` false and writes one `FAILED` row with `commentId`, `cardId`, `issueKey` and a stable reason; verify `pnpm test:e2e -- jira-comment-sync.e2e-spec.ts` fails for the intended missing behavior

## 2. Boards facade synced-state boundary

- [x] 2.1 Add `markCommentSynced(cardId, commentId): Promise<void>` (both ids typed `string`) to `BoardsFacade`, expose the type through the boards public index, and implement it by updating the comment only when both ids match; add focused unit tests in `boards-services.spec.ts` proving that a matching `cardId` + `commentId` updates the flag and that a comment with the same `commentId` under a different `cardId` is not updated; verify `pnpm test -- boards-services.spec.ts`

## 3. Gateway add-comment budget

- [x] 3.1 Add optional `timeBudgetMs` to `AddCommentInput`, thread it through the add-comment `RequestSpec`, and cap the effective budget with `Math.min(requested, configured)`; keep the POST non-idempotent with no 5xx/timeout retries beyond the existing connection-phase exception; verify the 1.1 tests pass with `pnpm test -- jira-gateway.http-client.spec.ts`

## 4. Comment sync service

- [x] 4.1 Implement the mapping lookup and skip path: read `jira_issue_mappings` by `boardId` + `cardId`, debug-log and return when no mapping exists, and validate the mapped issue key; verify the mapping and invalid-key tests in `jira-comment-sync.service.spec.ts`
- [x] 4.2 Implement author attribution: inject `AUTH_FACADE`, resolve the author's display name, use `Unknown user` for null/blank/failed lookups without blocking, prepend the exact `[BoardSync] <name>: ` prefix and build the body with `plainTextToAdf`; verify the authorship tests in `jira-comment-sync.service.spec.ts`
- [x] 4.3 Implement the five-second budget and gateway call: measure from `occurredAt`, clamp to five seconds, skip the call below the minimum budget, pass the remaining `timeBudgetMs` to `addComment`, and map 404, gateway, deadline and unexpected failures to the stable reasons; verify the budget and failure tests in `jira-comment-sync.service.spec.ts`
- [x] 4.4 Implement the success and failure log shapes: one `TO_JIRA` row per Jira attempt with `mappingId`, `commentId`, `cardId`, `issueKey`, `jiraCommentId` on success, `reason`/`errorMessage` on failure and `latencyMs` in every row; mark the comment synced only after Jira accepts, leave it false on failure, log at the specified levels, and never log comment text; verify all outcomes and the no-retry test in `jira-comment-sync.service.spec.ts`

## 5. Listener and module wiring

- [x] 5.1 Add the `card.commented` listener that ignores non-user origins, starts `syncComment` fire-and-forget, and logs unexpected rejections; verify all `jira-comment-sync.listener.spec.ts` tests pass
- [x] 5.2 Register the comment sync service/listener in `JiraSyncModule`, keep `AUTH_FACADE` and `BOARDS_FACADE` as the only cross-module collaborators, and add no new module imports beyond the existing `AuthModule` and `BoardsModule`; verify `pnpm typecheck`, `pnpm lint` and the focused unit suites

## 6. Integration behavior

- [x] 6.1 Run the 1.4 E2E suite against real Postgres and fix the implementation until all four required cases pass; verify `pnpm test:e2e -- jira-comment-sync.e2e-spec.ts`
- [x] 6.2 Extend the E2E suite so the stubbed `JIRA_GATEWAY.addComment` returns a manually controlled deferred promise; assert that `POST /cards/{cardId}/comments` returns 201 while that promise is still pending, then resolve it and verify the sync completes; also assert a rejected `addComment` does not change the 201 result; verify the same E2E suite
- [x] 6.3 Run the existing `test/labels-comments.e2e-spec.ts` regression suite to confirm comment creation, paging and deletion still behave as before; verify `pnpm test:e2e -- labels-comments.e2e-spec.ts`

## 7. Documentation

- [ ] 7.1 Create `src/modules/jira-sync/README.md` (it does not exist yet) documenting comment mirroring, the `user`-origin filter, the exact `[BoardSync] <name>: <text>` prefix and `Unknown user` fallback, unmapped-card skips, the five-second budget convention, success/failure sync-log payloads, no retry/ordering, the T-49/T-35 outbox handoff, and the risk that a comment deleted before the mirror runs can still appear in Jira; verify the document matches `design.md`
- [ ] 7.2 Update `docs/api/openapi.yaml` only if needed so `POST /cards/{cardId}/comments` and `Comment.syncedToJira` accurately describe mirroring and asynchronous state; verify `pnpm api:validate` and confirm no unrelated API diff

## 8. Verification

- [ ] 8.1 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm api:validate` and `openspec validate "jira-comment-sync" --strict`; all must pass

## Workflow follow-up

- Confirm no migration is created and no `jiraCommentId` column or REST endpoint is added.
- Flag the asynchronous `syncedToJira` behavior and the T-49/T-35 outbox handoff to the reviewer.
- Archive the change after review approval and verify the archived `jira-comment-sync` spec plus the modified `jira-gateway` requirement.
