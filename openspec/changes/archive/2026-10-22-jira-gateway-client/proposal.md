## Why

The `jira-sync` module currently only handles OAuth 2.0 (3LO) flows with Atlassian. To enable bidirectional Jira synchronization (FR-03, FR-04, FR-05, FR-06, FR-07), we need a typed HTTP adapter for the **Jira REST API v3** that:
- Searches issues via JQL with cursor pagination (`/search/jql` + `nextPageToken`, returns `isLast`)
- Manages issue transitions (`/issue/{id}/transitions` GET + POST)
- Reads and adds comments (`/issue/{id}/comment` GET + POST with ADF body)
- Registers, lists, and refreshes webhooks per Jira Cloud API (`/webhook` POST with `{url, webhooks:[{events, jqlFilter}]}`, `/webhook/refresh` PUT with `webhookIds:number[]`)
- Automatically refreshes expired access tokens using the stored refresh token (single-flight per board, in-process only; the refresh re-reads the connection and skips the network if another refresh already won)
- Handles retries with proper policies: 401 → refresh once + retry once; 429 → honour `Retry-After` (seconds or HTTP-date, cap 60s, no retry above the cap); 5xx → bounded exponential backoff + jitter for GET (POST never retries on 5xx); timeout → GET retries, POST does not; network errors → GET retries, POST retries once only for connection-phase `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`; all retries share a 45s per-call budget
- Provides typed errors (`JiraUnauthorizedError`, `JiraRateLimitedError`, `JiraServerError`, `JiraClientError`, `JiraTimeoutError`, `JiraTimeBudgetExceededError`, `JiraPersistenceError`) and response DTOs (no `any`)
- Marks a connection as needing reconnect on `invalid_grant` with a conditional update of the existing nullable `refreshTokenEnc` (does not overwrite a concurrent reconnect; no schema change)
- Retries token persistence once; if it still fails, logs without secrets and surfaces `JiraPersistenceError` (the board may need reconnection)
- Reuses the existing token storage from T-16 (`jira-token-vault` / `JiraConnectionEntity`); requires `offline_access`, `read:jira-work`, `write:jira-work`, and `manage:jira-webhook` (the last is missing from T-16 defaults and is deferred to T-26; `JIRA_SCOPES` is not changed here)
- Base URL: `${jira.apiBaseUrl}/ex/jira/{cloudId}/rest/api/3` using `cloudId` from `JiraConnectionEntity`; token URL from `jira.authBaseUrl`

## What Changes

### New Capabilities
- **Port**: `JiraGateway` interface in `jira-sync/application` defining all Jira REST API v3 operations needed for sync
- **Adapter**: `JiraGatewayHttpClient` in `jira-sync/infrastructure` implementing the port with `fetch`, automatic token refresh, and retry logic
- **Token Refresh**: Single-flight refresh per board using `Map<boardId, Promise<string>>`, entry removed in `finally`; after a 401 the connection is re-read and the stored access token compared with the one used before refreshing; `doRefresh` repeats the comparison and skips the network if another refresh already won
- **DTOs**: Typed request/response DTOs for all Jira REST API v3 endpoints used; search fields are the union of caller fields and the typed defaults
- **Errors**: Typed error classes including `JiraTimeoutError`, `JiraTimeBudgetExceededError`, and `JiraPersistenceError`
- **Helper**: `plainTextToAdf` utility for converting plain text to Atlassian Document Format
- **Tests**: Unit tests against a stub HTTP server covering all scenarios (success/2xx, 401 refresh, 429 retry, 5xx backoff, timeout, network errors, non-idempotent POST no-retry on 5xx, conditional `invalid_grant`, persistence retry, 45s budget)
- **Docs**: `docs/jira-gateway.md` and a verification record in `docs/verification/`

### Modified Capabilities
- `jira-oauth-connection` — **additive**: `ATLASSIAN_OAUTH` gains `refreshAccessToken(refreshToken)`; the authorization/callback flow is unchanged (no new endpoints)

## Impact

### Affected Files
- New: `src/modules/jira-sync/application/jira-gateway.port.ts` (port + DTOs)
- New: `src/modules/jira-sync/domain/jira-gateway.errors.ts`
- New: `src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts`
- New: `src/modules/jira-sync/infrastructure/jira-gateway.http-client.spec.ts`
- New: `src/modules/jira-sync/application/helpers/plain-text-to-adf.ts`
- New: `docs/jira-gateway.md`
- New: `docs/verification/T-23-jira-gateway-client.md` (same directory as T-16's records; rename to `KAN-<n>-...` when imported)
- Update: `src/modules/jira-sync/application/atlassian-oauth.port.ts` (add refresh)
- Update: `src/modules/jira-sync/infrastructure/atlassian-oauth.http-client.ts` (add refresh)
- Update: `src/modules/jira-sync/infrastructure/atlassian-oauth.http-client.spec.ts` (refresh tests)
- Update: `src/modules/jira-sync/jira-sync.module.ts` (register adapter)
- No OpenAPI changes (no HTTP endpoints exposed by this change)

### Dependencies
- Depends on T-16 (`jira-token-vault` / `jira-oauth-connection`) — reuses `JiraConnectionEntity`, `TokenCipher`, and extends `ATLASSIAN_OAUTH`
- No new external dependencies (uses global `fetch`)

### No Breaking Changes
- No API contract changes
- No database migrations
- The authorization flow and existing `ATLASSIAN_OAUTH` members are unchanged; only a new method is added

## Open Questions

- Should the proactive refresh window (60s) be configurable? (Deferred)
- Should the 45s per-call budget be configurable through config instead of constructor options? (Deferred)
- `manage:jira-webhook` scope: resolved as a **T-26 follow-up**; `JIRA_SCOPES` is unchanged in this change, so webhook calls return 403 until existing boards reconnect with the added scope.
- Should the gateway support multiple Jira cloud IDs per board (multi-site)? Currently one connection per board.

## Non-Goals

- Single-flight refresh is **in-process only** — multiple instances refreshing the same connection are unsupported
- Recovering tokens after a failed persistence retry is out of scope; the board must reconnect
- Implement sync logic (separate change)
- Modify the OAuth authorization flow or token storage schema
- Add new database tables or migrations