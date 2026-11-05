# Tasks

## 1. Configuration and raw-body foundation

- [x] 1.1 Add `JIRA_WEBHOOK_URL` to `AppConfig`/`JiraConfig`, its factory and the Joi schema (URI, HTTPS required in production, optional elsewhere), and add `manage:jira-webhook` to the default `JIRA_SCOPES`; verify with a schema unit test covering valid HTTP locally, valid HTTPS in production, rejected HTTP in production and the new default scope.
- [x] 1.2 List `JIRA_WEBHOOK_URL` and the updated scope default in `.env.example` and `.env.full.example`; verify `JIRA_WEBHOOK_URL=http://localhost:3000/api/v1/jira/webhook` passes schema validation.
- [x] 1.3 Enable `rawBody: true` in `src/main.ts` and in `test/helpers.ts` `createTestApp()`; verify an integration request exposes the unmodified raw body (a body re-encoded after signing must fail verification in task 7.1).
- [x] 1.4 Add the webhook URL and scope to `test/setup-env.ts` so CI and local e2e runs boot without a tunnel; verify `pnpm exec jest --config ./test/jest-e2e.json --listTests` discovers the suite and the environment file loads without missing-variable errors.

## 2. Persistence and delivery deduplication

- [x] 2.1 Add `JiraWebhookDeliveryEntity` (`delivery_key`, `status`, `attempts`, `claimed_at`, `expires_at`) and `JiraWebhookEntity` (`board_id` unique, `project_key`, `webhook_id`, `url`, `events`, `jql_filter`, `expires_at`, `last_refreshed_at`), register them in `JiraSyncModule`, and generate/verify the migration with `pnpm migration:run` followed by `pnpm migration:revert` on the test database.
- [x] 2.2 Implement the dedup service: derive the key from `X-Atlassian-Webhook-Identifier` (fallback SHA-256 of event + issue id + changelog id, then raw body), claim with insert-on-conflict, release on any failure, reclaim claims older than 5 minutes, and delete rows older than 7 days; verify with unit tests for first claim, duplicate, concurrent duplicate, failed claim release, a failure injected immediately after the claim but before the move, stale reclaim and retention cleanup.

## 3. Webhook authenticity and endpoint

- [x] 3.1 Implement the authenticity verifier: HMAC-SHA256 over the raw body with `WEBHOOK_SECRET` using constant-time comparison, plus Bearer JWT verification with `JIRA_CLIENT_SECRET` restricted to HS256/HS512, issuer equal to `JIRA_CLIENT_ID` and a future numeric `exp`; fixed precedence means an invalid HMAC never falls through to JWT. Verify with unit tests for valid HMAC, valid JWT, invalid/missing proof, wrong algorithm, wrong issuer, expired token, and invalid HMAC plus valid JWT.
- [x] 3.2 Add `JiraWebhookController` at `POST /jira/webhook` with `@Public()`, raw-body access, a 1 MB body limit and no business logic; return 401 for failed authenticity and 200 for accepted deliveries. Verify with supertest that the global JWT guard does not block the route, unsigned requests get 401, and the response body remains the documented shape.
- [x] 3.3 Define the webhook payload parser/validator for `jira:issue_updated` changelog entries (event type, issue key/id, status item, target status id/name and category) and reject malformed JSON with 400; verify with unit tests for a valid status payload and malformed or unrelated payloads.

## 4. Card move and event publication

- [x] 4.1 Extend `ExternalCardMove.position` to be optional and make `CardsService.moveFromExternal` append to the end of the target column when it is absent, preserving the existing explicit-position behavior and the `origin: "jira"` event; verify with a component test for append, explicit position, `unchanged` and `not-found`.
- [x] 4.2 Implement the status handler: detect the status changelog item, take the destination from the `issue.fields.status` snapshot (id/name/category) as the source of truth, resolve board/card from `jira_issue_mappings`, resolve the column from `JiraStatusMappingEntity` or the category default (`new`/`indeterminate`/`done`), call `moveCardFromExternal`, and log outcome/latency without secrets. Verify tests for mapped status, unmapped status, deleted mapped column, non-status changelog, unknown issue, missing card, out-of-order deliveries using the payload snapshot, and no outbound Jira call on a successful move.
- [x] 4.3 Wire claim, parsing, handler and response inside one `try/finally`: duplicates and ignored events answer 200, and any failure after the claim (including between claim and move) releases it and answers 5xx. Verify with unit tests that a failure injected between claim and move releases the claim, a failed move is retryable, and a duplicate does not publish a second event.

## 5. Webhook registration and refresh lifecycle

- [x] 5.1 Implement `JiraWebhookLifecycleService.registerForBoard(boardId)`: skip unlinked boards or an unset `JIRA_WEBHOOK_URL`, call `registerWebhook` for `jira:issue_updated` with `project = "<KEY>"`, read the created webhook's `expirationDate` via `listWebhooks` (fallback `now + 30 days`, the documented lifetime, when the lookup fails), upsert the `jira_webhooks` row, and log failures without failing the caller. Verify with a stubbed `JIRA_GATEWAY` for successful registration with persisted expiration, expiration-lookup fallback, skipped unlinked board, skipped unset URL, and `missing_scope` failure.
- [x] 5.2 Call registration from the OAuth callback when a project key already exists, from `JiraImportService.import` after the key is stored, and remove the local `jira_webhooks` row on disconnect. Verify the connect-with-existing-key, connect-then-import, missed-registration and disconnect cases with component tests.
- [x] 5.3 Implement `sweep()`: acquire a Postgres advisory lock; refresh rows expiring within 7 days via `refreshWebhooks` and persist the returned `expirationDate` (each refresh resets the life to 30 days); also refresh rows already expired but still within Atlassian's 3-month grace period; for rows whose expiration is more than 3 months in the past, register a replacement webhook and replace the row; register missing webhooks for connected+linked boards; start the 6-hour unref'd timer and clear it on shutdown, but do not create the timer when `NODE_ENV=test`. Verify with a fake clock and stub gateway for near-expiry refresh, expired-within-grace refresh, beyond-grace re-registration, far-from-expiry skip, missing registration, refresh failure retry, single-runner locking and no timer under the test environment.

## 6. Contract and documentation

- [x] 6.1 Update `docs/api/openapi.yaml`: `POST /jira/webhook` becomes public with 200, 400 (malformed JSON) and 401, documents `X-Hub-Signature`, `X-Atlassian-Webhook-Identifier` and `X-Atlassian-Webhook-Retry`, and loses `x-implemented-in`; verify with `pnpm api:validate`.
- [x] 6.2 Update `README.md`, `docs/jira-sandbox.md` and `docs/jira-gateway.md` for the receiver URL, the new default scope/reconnection requirement, header-based secret verification instead of `?secret=`, and the HMAC-vs-JWT delivery modes; verify every documented command and URL is consistent with the schema and OpenAPI file.

## 7. End-to-end verification

- [x] 7.1 Add an e2e test with real Postgres and a stubbed `JIRA_GATEWAY` that imports a board, registers a webhook, posts a valid HMAC delivery, observes the card in the new column and the `card.moved` event with `origin: "jira"`, posts the duplicate and sees 200 with no second event, sends an invalid signature and sees 401, re-encodes a signed body and sees 401, and asserts the move/event completed within 5 seconds.
- [x] 7.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `openspec validate jira-webhook-board-sync --strict`; all must pass.

## Workflow follow-up

- Archive the change after review and human approval; do not merge the PR.
- Verify the archived spec set contains `jira-webhook-sync` and the updated `api-contract`.
