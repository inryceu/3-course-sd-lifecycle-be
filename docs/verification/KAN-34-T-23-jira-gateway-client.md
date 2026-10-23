# Verification: T-23 Jira Gateway Client

Date: 2026-10-22  
Change: `openspec/changes/archive/2026-10-22-jira-gateway-client`  
Ticket: KAN-34 (T-23)  
Branch: `KAN-34`

## Delivered

- `src/modules/jira-sync/application/jira-gateway.port.ts` — `JIRA_GATEWAY` port, DTOs, `DEFAULT_SEARCH_FIELDS`
- `src/modules/jira-sync/domain/jira-gateway.errors.ts` — typed gateway errors
- `src/modules/jira-sync/application/helpers/plain-text-to-adf.ts`
- `src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts` — HTTP adapter, refresh, retry, budget
- `src/modules/jira-sync/infrastructure/jira-gateway.http-client.spec.ts` — 48 stub-server tests
- `src/modules/jira-sync/application/atlassian-oauth.port.ts` — `refreshAccessToken`
- `src/modules/jira-sync/infrastructure/atlassian-oauth.http-client.ts` — refresh-token grant
- `src/modules/jira-sync/infrastructure/atlassian-oauth.http-client.spec.ts` — 6 refresh tests
- `src/modules/jira-sync/jira-sync.module.ts` — `JIRA_GATEWAY` provider wiring
- `src/modules/jira-sync/application/jira-oauth.service.spec.ts` — mock updated for the new port method
- `docs/jira-gateway.md`
- `design.md`, `spec.md`, `proposal.md`, `tasks.md` updated

No database migrations or OpenAPI changes.

## Commands and results

| Command | Result |
|---|---|
| `pnpm test` | PASS, 19 suites, 286 tests |
| `pnpm test jira-gateway.http-client.spec.ts` | PASS, 48 tests |
| `pnpm test:e2e` (PostgreSQL 16) | PASS, 5 suites, 79 tests |
| `pnpm api:validate` | PASS, OpenAPI OK, 44 operations |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, 0 errors, 2 pre-existing warnings |
| `pnpm build` | PASS |
| `openspec validate jira-gateway-client --json` | PASS |

Warnings from Jest: pre-existing Node `url.parse()` deprecation notices only.

## Scope decision

`JIRA_SCOPES` and `.env.*` were **not** modified. The console app already lists `manage:jira-webhook`, but existing boards must reconnect after the backend scope list changes. This is a **T-26 follow-up**, documented in `design.md` and `docs/jira-gateway.md`. Until then, webhook calls fail fast with `JiraClientError(403, 'missing_scope')` before any HTTP request (Jira itself answers 401 for a missing scope).

## Deviations / clarifications

- Added the requested non-`invalid_grant` refresh behavior: only `invalid_grant` clears `refreshTokenEnc`; 5xx/network failures surface as `JiraServerError`/`JiraTimeoutError`; other rejections surface as `JiraUnauthorizedError`. Covered by tests.
- Network retry exhaustion is typed as `JiraServerError(503, attempts, maxAttempts)` (previously unspecified). Recorded in design/spec.
- `JiraGatewayOptions` is provided through the `JIRA_GATEWAY_OPTIONS` token; production uses `{}` and tests inject fake `now`, `sleep`, and `random`.
- Conditional reconnect marking remains best-effort: a failed clear is logged without secrets, and the caller still receives `JiraUnauthorizedError`.
- Optional webhook filters (`fieldIdsFilter`, `issuePropertyKeysFilter`) remain deferred.
- Multi-instance refresh remains unsupported; single-flight is in-process only.

| Acceptance criterion | Evidence | Result |
|---|---|---|
| `JIRA_GATEWAY` port: search issues (JQL, pagination), list/perform transitions, get/add comment, register/list/extend webhooks | `jira-gateway.port.ts`; tests for `searchIssues`, `listTransitions`/`doTransition`, `getComments`/`addComment`, `registerWebhook`/`listWebhooks`/`refreshWebhooks` in `jira-gateway.http-client.spec.ts` | Met |
| Automatic access-token refresh (single-flight, no duplicate refreshes under concurrency) | `refreshOnce`/`doRefresh` in `jira-gateway.http-client.ts`; concurrent-401 test asserts exactly one refresh request | Met |
| Handles 401, 429 (honours Retry-After) and 5xx with timeouts and bounded retries | Retry policy in `docs/jira-gateway.md`; tests for 401 refresh+retry, 429 (seconds and HTTP-date), 5xx backoff, timeout, 45s time budget | Met |
| Unit tests with a stub HTTP server | 48 tests in `jira-gateway.http-client.spec.ts` against a local `http.createServer` stub | Met |

## Review fixes

- Added an OAuth scope preflight against `JiraConnectionEntity.scopes` (a string array). Webhook operations require `manage:jira-webhook`, `doTransition`/`addComment` require `write:jira-work`, and the read operations require `read:jira-work`. When the stored scopes are non-empty and the required scope is missing, the gateway throws `JiraClientError(403, 'missing_scope')` before any HTTP request or token refresh; empty/unknown scopes are not blocked. Jira reports a missing scope as 401, so the spec and docs now describe the gateway's early 403 instead.
- Made the success-path token persistence a compare-and-set on `boardId` + `refreshTokenEnc`, matching the reconnect-marking update. A zero-row update is neither retried nor treated as `JiraPersistenceError`; the gateway logs without secrets, re-reads the connection, and returns the newer stored access token so a concurrent reconnect is preserved.

## Not verified here

- Read operations (search with paging, transitions, comments), token refresh with rotation and concurrent calls were checked live by the reviewer against `kanban-proj.atlassian.net`.
- Not verified live: write operations (`doTransition`, `addComment`, `registerWebhook`, `refreshWebhooks`) and the `invalid_grant` path; they are covered by stub tests only.
- Webhook calls were not verified with a granted scope: `manage:jira-webhook` is not yet in `JIRA_SCOPES` (T-26 follow-up).