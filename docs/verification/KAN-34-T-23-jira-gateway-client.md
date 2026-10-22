# Verification: T-23 Jira Gateway Client

Date: 2026-10-22  
Change: `openspec/changes/jira-gateway-client`  
Ticket: T-23 (rename to `KAN-<n>-...` when imported)

## Delivered

- `src/modules/jira-sync/application/jira-gateway.port.ts` — `JIRA_GATEWAY` port, DTOs, `DEFAULT_SEARCH_FIELDS`
- `src/modules/jira-sync/domain/jira-gateway.errors.ts` — typed gateway errors
- `src/modules/jira-sync/application/helpers/plain-text-to-adf.ts`
- `src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts` — HTTP adapter, refresh, retry, budget
- `src/modules/jira-sync/infrastructure/jira-gateway.http-client.spec.ts` — 41 stub-server tests
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
| `pnpm test` | PASS, 19 suites, 279 tests |
| `pnpm test jira-gateway.http-client.spec.ts` | PASS, 41 tests |
| `pnpm test:e2e` (PostgreSQL 16) | PASS, 5 suites, 79 tests |
| `pnpm api:validate` | PASS, OpenAPI OK, 44 operations |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, 0 errors, 2 pre-existing warnings |
| `pnpm build` | PASS |
| `openspec validate jira-gateway-client --json` | PASS |

Warnings from Jest: pre-existing Node `url.parse()` deprecation notices only.

## Scope decision

`JIRA_SCOPES` and `.env.*` were **not** modified. The console app already lists `manage:jira-webhook`, but existing boards must reconnect after the backend scope list changes. This is a **T-26 follow-up**, documented in `design.md` and `docs/jira-gateway.md`. Webhook calls will return 403 until then.

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
| Unit tests with a stub HTTP server | 41 tests in `jira-gateway.http-client.spec.ts` against a local `http.createServer` stub | Met |

## Not verified here

- The gateway was tested against a local stub server only, not a real Atlassian site (needs the sandbox from T-14). Response shapes were checked against the Jira Cloud docs, not against live responses.
- Webhook calls were not verified live: `manage:jira-webhook` is not yet in `JIRA_SCOPES` (T-26 follow-up).