## Context

The `jira-sync` module already implements the Atlassian OAuth 2.0 (3LO) flow via `ATLASSIAN_OAUTH` (`AtlassianOAuthHttpClient`). Tokens are stored encrypted per board in `JiraConnectionEntity` using `TokenCipher`. This change adds a typed HTTP adapter for the Jira Cloud REST API v3 (`JIRA_GATEWAY`) with automatic token refresh and retry policies.

**Entity inspection (T-16):** `JiraConnectionEntity` has `boardId`, `connectedById`, `cloudId`, `siteUrl`, `accessTokenEnc` (`select: false`), `refreshTokenEnc` (`select: false`, **nullable**), `expiresAt`, `scopes`, `connectedAt`. It has **no** status/revoked column. Therefore reconnection is marked by conditionally setting `refreshTokenEnc = NULL` (see Decisions).

## API verification

Verified against the official Jira Cloud REST API v3 docs (2026-10-22):

| Operation | Endpoint | Verified request / response |
|---|---|---|
| Search | `GET /rest/api/3/search/jql` | Query: `jql`, `nextPageToken`, `maxResults`, `fields`, `expand`. Response: `{ issues, nextPageToken?, isLast }`. **Default `fields` is `id`**, so the adapter always sends an explicit field list. |
| List transitions | `GET /rest/api/3/issue/{issueIdOrKey}/transitions` | Query: `expand`, `transitionId`, `includeUnavailableTransitions`, etc. Response: `{ transitions: [{ id, name, to, hasScreen, isGlobal, isInitial, isConditional, isAvailable, fields? }] }`. An unavailable/non-existent transition yields an **empty list**, not an error. |
| Transition issue | `POST /rest/api/3/issue/{issueIdOrKey}/transitions` | Body: `{ transition: { id }, fields?, update?, properties?, historyMetadata? }`. Response: **204 No Content**. |
| Get comments | `GET /rest/api/3/issue/{issueIdOrKey}/comment` | Query: `startAt`, `maxResults`, `orderBy`, `expand`. Response: `{ comments, startAt, maxResults, total }`. |
| Add comment | `POST /rest/api/3/issue/{issueIdOrKey}/comment` | Body: `{ body, properties?, visibility? }` (body is ADF). Response: **201 Created** with a Comment (`id`, `self`, `author`, `body`, `created`, `updated`, `updateAuthor`, `visibility?`). |
| List webhooks | `GET /rest/api/3/webhook` | Query: `startAt`, `maxResults`. Response: `{ values: [{ id, url, jqlFilter, events, expirationDate, fieldIdsFilter?, issuePropertyKeysFilter? }], startAt, maxResults, total, isLast }`. |
| Register webhooks | `POST /rest/api/3/webhook` | Body: `{ url, webhooks: [{ events, jqlFilter, fieldIdsFilter?, issuePropertyKeysFilter? }] }`; `jqlFilter` is required. Response: **200 OK** with `{ webhookRegistrationResult: [{ createdWebhookId } | { errors: string[] }] }` (one entry per requested webhook, same order; partial failures are normal). |
| Refresh webhooks | `PUT /rest/api/3/webhook/refresh` | Body: `{ webhookIds: number[] }`. Response: **200 OK** with `{ expirationDate }`. Unrecognized IDs are **ignored** (no 404). |
| Token refresh | `POST {jira.authBaseUrl}/oauth/token` | Body: `{ grant_type: "refresh_token", client_id, client_secret, refresh_token }`. Response: `{ access_token, refresh_token, expires_in (seconds), scope }`; refresh tokens **rotate**. Error: `403` with `{ error: "invalid_grant", error_description }`. Required scopes: `offline_access`, `read:jira-work`, `write:jira-work`, `manage:jira-webhook` (webhooks only). |

> Unverified detail: the webhook docs' `WebhookDetails` child-properties block is collapsed on the page. `jqlFilter` being required and the optional `fieldIdsFilter`/`issuePropertyKeysFilter` are confirmed by the API examples and Atlassian's Webhooks guide. Optional filters are **not** modeled by this change (see Open Questions).

## Goals / Non-Goals

**Goals:**
- `JiraGateway` port + `JiraGatewayHttpClient` adapter in `jira-sync`
- Automatic, single-flight (in-process), proactive token refresh using the existing encrypted store, with conditional reconnect marking
- Typed DTOs/errors, no `any`; retry/timeout policies per status, a 45s per-call budget, and documented scope prerequisites
- Stub-HTTP-server unit tests; `docs/jira-gateway.md`; verification record in `docs/verification/`

**Non-Goals:**
- Implement sync logic or change the OAuth authorization flow
- New tables/columns/migrations
- Distributed single-flight: **multiple backend instances are unsupported** for concurrent refresh of the same connection
- Expose a `needsReconnect` flag in the connection status API (follow-up, would change the API contract)

## Decisions

| Decision | Rationale |
|---|---|
| Port in `application`, adapter in `infrastructure` | Matches `ATLASSIAN_OAUTH` pattern and module boundaries |
| Every port input carries `boardId` | Base URL needs the board's `cloudId`; connection is per board |
| Base URL `${jira.apiBaseUrl}/ex/jira/{cloudId}/rest/api/3` | CloudId-based URL; both `jira.apiBaseUrl` and `jira.authBaseUrl` are config-driven and overridable in tests |
| Reconnect marking = conditional `refreshTokenEnc = NULL` | Entity has no status/revoked field and `refreshTokenEnc` is nullable. The update is guarded: `UPDATE ... WHERE board_id = :boardId AND refresh_token_enc = :previouslyReadCiphertext`, so a concurrent reconnect is not overwritten. No migration. Detection requires selecting `refreshTokenEnc` (it is `select: false`); `JiraConnectionService.getStatus()` does not expose it today. |
| Extend `ATLASSIAN_OAUTH` with `refreshAccessToken(refreshToken)` | The port does **not** support refresh today. Extending the existing port/adapter reuses config, error parsing, and the token endpoint instead of duplicating HTTP logic. `invalid_grant` is detected from `AtlassianRejectedError.providerError` (parsed from the response body). |
| Scope prerequisite | The gateway needs `offline_access`, `read:jira-work`, `write:jira-work`, and `manage:jira-webhook`. T-16 defaults are `read:jira-work,write:jira-work,read:jira-user,offline_access`: the first three gateway scopes are present, `read:jira-user` is extra but harmless, and `manage:jira-webhook` is **missing**. **Decision: do not change `JIRA_SCOPES` in this change.** `docs/jira-sandbox.md` already lists the scope in the console app and expects it when webhook registration starts; T-26 will add it and require existing boards to reconnect. Webhook calls will 403 until then. Recorded in `docs/jira-gateway.md`. |
| Refresh failures other than `invalid_grant` | Only `AtlassianRejectedError` with `providerError === 'invalid_grant'` marks reconnect. A 5xx/network failure surfaces as `JiraServerError` (HTTP status when known, otherwise 503); a timeout surfaces as `JiraTimeoutError`; any other rejection surfaces as `JiraUnauthorizedError`. In all these cases `refreshTokenEnc` is preserved. |
| Single-flight `Map<boardId, Promise<string>>`; `refreshOnce(boardId, usedAccessToken, reason)` with promise `doRefresh(...).finally(delete)` | Concurrent callers await the same promise; the entry is removed even on failure. `doRefresh` re-reads the connection and returns a token refreshed by someone else instead of calling Atlassian again. |
| Proactive refresh when `expiresAt <= now + 60s` and a refresh token exists | Avoids a guaranteed 401. `doRefresh` re-checks `expiresAt` after the re-read and skips the network call if another refresh already extended it. |
| After 401: re-read connection, compare the access token used with the stored one | If different, another refresh already happened → reuse it; otherwise single-flight refresh. The expiry-based skip in `doRefresh` applies only to proactive refreshes; a 401 always refreshes when the token is unchanged. |
| Persist rotated tokens **before** returning, retry persistence once | Atlassian disables the old refresh token on use. If both persistence attempts fail, log without secrets and throw `JiraPersistenceError`; the new tokens cannot be recovered, so the board must be reconnected. |
| `invalid_grant` → conditional null of `refreshTokenEnc`, throw `JiraUnauthorizedError` | Marks reconnect using existing fields without overwriting a concurrent reconnect; no retry |
| Search fields = caller fields ∪ `DEFAULT_SEARCH_FIELDS` | `/search/jql` returns only ids by default; the typed response requires its fields, so caller-provided fields are merged with, not substituted for, the defaults |
| 429: `Retry-After` ≤ 60s → sleep + retry once; otherwise throw immediately; second 429 also throws | Honours the server signal without long sleeps; both numeric seconds and HTTP-date are parsed |
| 5xx: GET backoff (3 attempts, 1s/2s × jitter, cap 10s); POST no retry | POST is non-idempotent; retrying may duplicate transitions/comments/webhooks. Jitter uses the injected `random` |
| Timeout: GET retries (2 attempts); POST never retries | A timeout may occur after the request was sent |
| Network: GET retries (3 attempts); POST retries once **only** for connection-phase `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` | These guarantee the request was never sent; other network errors may have sent it |
| Per-call time budget 45s | The deadline is set when the public method starts and covers token refresh plus all retries/waits. Exhaustion throws `JiraTimeBudgetExceededError` before the next attempt or sleep; the remaining budget also caps the per-request timeout |
| `requestJson<T>` accepts any 2xx; `requestNoContent` accepts 204 only | Comments return 201, transitions return 204; no status-specific success branches |
| Injected `sleep`, `now`, and `random` (constructor options) | Deterministic tests for Retry-After, proactive refresh, jitter, and the time budget |
| `JiraTimeoutError` has no status; `JiraServerError` exposes `attempts` | No fake HTTP status; base error does not define `status` (avoids duplicate `readonly status`) |

## Port interface

```typescript
// src/modules/jira-sync/application/jira-gateway.port.ts
export const JIRA_GATEWAY = Symbol('JIRA_GATEWAY');

export interface JiraGateway {
  searchIssues(input: SearchIssuesInput): Promise<SearchIssuesResult>;
  listTransitions(input: ListTransitionsInput): Promise<ListTransitionsResult>;
  doTransition(input: DoTransitionInput): Promise<void>;
  getComments(input: GetCommentsInput): Promise<GetCommentsResult>;
  addComment(input: AddCommentInput): Promise<AddCommentResult>;
  registerWebhook(input: RegisterWebhookInput): Promise<RegisterWebhookResult>;
  listWebhooks(input: ListWebhooksInput): Promise<ListWebhooksResult>;
  refreshWebhooks(input: RefreshWebhooksInput): Promise<RefreshWebhooksResult>;
}

export const DEFAULT_SEARCH_FIELDS = [
  'summary', 'status', 'assignee', 'reporter', 'created', 'updated',
] as const;

export interface SearchIssuesInput {
  readonly boardId: string;
  readonly jql: string;
  readonly nextPageToken?: string;
  readonly maxResults?: number;
  /**
   * Merged with DEFAULT_SEARCH_FIELDS (defaults always included);
   * /search/jql returns only ids when `fields` is omitted.
   */
  readonly fields?: readonly string[];
  readonly expand?: readonly string[];
}

export interface SearchIssuesResult {
  readonly issues: readonly JiraIssue[];
  readonly nextPageToken: string | null;
  readonly isLast: boolean;
}

export interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly self: string;
  readonly fields: JiraIssueFields;
}

export interface JiraIssueFields {
  readonly summary: string;
  readonly status: JiraStatus;
  readonly assignee: JiraUser | null;
  readonly reporter: JiraUser | null;
  readonly created: string;
  readonly updated: string;
}

export interface JiraStatus {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly iconUrl?: string;
  readonly self?: string;
  readonly statusCategory: JiraStatusCategory;
}

export interface JiraStatusCategory {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly colorName?: string;
  readonly self?: string;
}

export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly emailAddress?: string;
  readonly accountType?: string;
  readonly timeZone?: string;
}

export interface JiraCommentBody {
  readonly type: 'doc';
  readonly version: number;
  readonly content: readonly unknown[]; // ADF
}

export interface JiraComment {
  readonly id: string;
  readonly self?: string;
  readonly author: JiraUser;
  readonly updateAuthor?: JiraUser;
  readonly body: JiraCommentBody;
  readonly created: string;
  readonly updated: string;
}

export interface ListTransitionsInput {
  readonly boardId: string;
  readonly issueIdOrKey: string;
  readonly expand?: string; // e.g. 'transitions.fields'
  readonly transitionId?: string;
  readonly includeUnavailableTransitions?: boolean;
}

export interface ListTransitionsResult {
  readonly transitions: readonly JiraTransition[];
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to: JiraStatus;
  readonly hasScreen: boolean;
  readonly isGlobal: boolean;
  readonly isInitial: boolean;
  readonly isConditional: boolean;
  readonly isAvailable: boolean;
  readonly fields?: Readonly<Record<string, unknown>>; // only with expand
}

export interface DoTransitionInput {
  readonly boardId: string;
  readonly issueIdOrKey: string;
  readonly transitionId: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly update?: Readonly<Record<string, readonly unknown[]>>;
}

export interface GetCommentsInput {
  readonly boardId: string;
  readonly issueIdOrKey: string;
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly orderBy?: string; // Jira documents a string query parameter
  readonly expand?: string;
}

export interface GetCommentsResult {
  readonly comments: readonly JiraComment[];
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
}

export interface AddCommentInput {
  readonly boardId: string;
  readonly issueIdOrKey: string;
  readonly body: JiraCommentBody;
}

export interface AddCommentResult {
  readonly id: string;
  readonly self: string;
  readonly author: JiraUser;
  readonly updateAuthor?: JiraUser;
  readonly body: JiraCommentBody;
  readonly created: string;
  readonly updated: string;
}

export interface RegisterWebhookInput {
  readonly boardId: string;
  readonly url: string;
  readonly webhooks: readonly RegisterWebhookEntry[];
}

export interface RegisterWebhookEntry {
  readonly events: readonly string[];
  readonly jqlFilter: string; // required by the API
}

export type WebhookRegistrationOutcome =
  | { readonly createdWebhookId: number }
  | { readonly errors: readonly string[] };

export interface RegisterWebhookResult {
  readonly webhookRegistrationResult: readonly WebhookRegistrationOutcome[];
}

export interface ListWebhooksInput {
  readonly boardId: string;
  readonly startAt?: number;
  readonly maxResults?: number;
}

export interface JiraWebhook {
  readonly id: number;
  readonly url: string;
  readonly jqlFilter: string;
  readonly events: readonly string[];
  readonly expirationDate: string;
  readonly fieldIdsFilter?: readonly string[];
  readonly issuePropertyKeysFilter?: readonly string[];
}

export interface ListWebhooksResult {
  readonly values: readonly JiraWebhook[];
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
  readonly isLast: boolean;
}

export interface RefreshWebhooksInput {
  readonly boardId: string;
  readonly webhookIds: readonly number[];
}

export interface RefreshWebhooksResult {
  readonly expirationDate: string;
}
```

## ATLASSIAN_OAUTH extension

```typescript
export interface AtlassianOAuth {
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<AtlassianTokens>;
  listAccessibleResources(accessToken: string): Promise<AccessibleResource[]>;
  /** Rotates the refresh token. Throws AtlassianRejectedError (incl. providerError 'invalid_grant'). */
  refreshAccessToken(refreshToken: string): Promise<AtlassianTokens>;
}
```

`AtlassianOAuthHttpClient.refreshAccessToken` posts the documented refresh body to `${jira.authBaseUrl}/oauth/token`, parses `error` from the error body, and throws `AtlassianRejectedError(error, status)` (403 for `invalid_grant`). If a successful response omits `refresh_token`, the gateway keeps the existing stored token.

## Helper

```typescript
// src/modules/jira-sync/application/helpers/plain-text-to-adf.ts
export function plainTextToAdf(text: string): JiraCommentBody {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}
```

## Adapter

```
JiraGatewayHttpClient
├── options: { timeoutMs?, timeBudgetMs?, sleep?, now?, random? }
├── requestJson<T>/requestNoContent set deadline = now() + timeBudgetMs at call start
├── refreshInFlight = Map<boardId, Promise<string>>
├── ensureFreshAccessToken(boardId)
│   ├── load connection (select accessTokenEnc, refreshTokenEnc, expiresAt, cloudId)
│   ├── if conn == null -> JiraUnauthorizedError
│   ├── used = decrypt(accessTokenEnc)
│   ├── remaining = expiresAt - now()
│   ├── if remaining > 60_000 -> return used
│   ├── if refreshTokenEnc == null:
│   │   ├── if remaining <= 0 -> throw JiraUnauthorizedError('reconnect required')
│   │   └── return used                       (still valid; no way to refresh)
│   └── return refreshOnce(boardId, used, 'proactive')
├── refreshOnce(boardId, usedAccessToken, reason)
│   ├── existing = refreshInFlight.get(boardId); if existing -> return existing
│   ├── p = doRefresh(boardId, usedAccessToken, reason).finally(() => refreshInFlight.delete(boardId))
│   ├── refreshInFlight.set(boardId, p); return p
├── doRefresh(boardId, usedAccessToken, reason)
│   ├── conn = re-read connection with token columns
│   ├── if conn == null -> JiraUnauthorizedError
│   ├── stored = decrypt(conn.accessTokenEnc)
│   ├── if stored !== usedAccessToken -> return stored           (another refresh won)
│   ├── if reason === 'proactive' && conn.expiresAt - now() > 60_000 -> return stored
│   ├── if conn.refreshTokenEnc == null -> JiraUnauthorizedError
│   ├── previousRefreshEnc = conn.refreshTokenEnc
│   ├── tokens = ATLASSIAN_OAUTH.refreshAccessToken(decrypt(previousRefreshEnc))
│   ├── on AtlassianRejectedError('invalid_grant')
│   │   ├── UPDATE jira_connections SET refreshTokenEnc = NULL
│   │   │   WHERE board_id = :boardId AND refresh_token_enc = :previousRefreshEnc
│   │   ├── log outcome (affected rows; no token values)
│   │   └── throw JiraUnauthorizedError('reconnect required')
│   ├── on other refresh failures: do NOT null refreshTokenEnc
│   │   ├── AtlassianUnavailableError(HTTP 5xx) -> JiraServerError(status, 1, 1)
│   │   ├── network/timeout -> JiraServerError(503, 1, 1) / JiraTimeoutError(1, 1)
│   │   └── other AtlassianRejectedError -> JiraUnauthorizedError(providerError)
│   ├── persist accessTokenEnc, refreshTokenEnc (new ?? previous), expiresAt
│   │   ├── retry once on failure (2 attempts total)
│   │   ├── log each failure without secrets
│   │   └── after the second failure -> JiraPersistenceError
│   └── return new access token
├── requestJson<T>(boardId, method, path, body?, idempotent)
│   ├── accessToken = ensureFreshAccessToken(boardId)
│   ├── URL = `${jira.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3${path}`
│   ├── before each attempt and before each sleep: if now() + wait > deadline
│   │   -> JiraTimeBudgetExceededError
│   ├── timeout = min(timeoutMs, deadline - now())
│   ├── 2xx -> parse JSON body (empty body -> undefined)
│   ├── 401: re-read connection; if stored access token != token used -> retry once with stored;
│   │        else refreshOnce(boardId, tokenUsed, 'unauthorized') and retry once;
│   │        second 401 -> JiraUnauthorizedError
│   ├── 429: parse Retry-After; null or > 60s -> JiraRateLimitedError immediately;
│   │        else sleep(seconds) and retry once; second 429 -> JiraRateLimitedError
│   ├── 5xx: idempotent -> up to 3 attempts (1s, 2s × jitter in [0.75, 1.25], cap 10s);
│   │        non-idempotent -> JiraServerError(status, attempts=1, maxAttempts=1)
│   ├── timeout: idempotent -> up to 2 attempts then JiraTimeoutError;
│   │            non-idempotent -> JiraTimeoutError immediately
│   ├── network: GET -> up to 3 attempts; POST -> retry once only for
│   │            ECONNREFUSED/ENOTFOUND/EAI_AGAIN (connection phase), else throw
│   └── other 4xx -> JiraClientError(status, providerError)
└── requestNoContent(...) -> same core; accepts 204 only;
    any other status -> JiraClientError(status, 'unexpected_status')
```

**Single-flight detail:** after a 401, re-read the connection and compare the decrypted stored access token with the token used by the failed request. If they differ, a refresh already happened; reuse the stored token. If they are equal, join/create the in-flight refresh. Inside `doRefresh` the same comparison is repeated after its own re-read, so a refresh that finished between the 401 comparison and the refresh call returns the stored token without a network call. The proactive expiry skip is applied only when `reason === 'proactive'`; a 401 with a future `expiresAt` still refreshes. Multi-instance concurrency remains unsupported (see Non-Goals).

**Proactive refresh:** performed in `ensureFreshAccessToken` when `expiresAt <= now + 60_000`. If the token is already expired and `refreshTokenEnc` is NULL, it throws `JiraUnauthorizedError` immediately; if it is still valid but within the window and no refresh token exists, it returns the token and lets the 401 path fail.

**Time budget:** `timeBudgetMs` defaults to `45_000`. The deadline is per public gateway call. Elapsed time spent in the token refresh counts against it (the `ATLASSIAN_OAUTH` client has its own request timeout), and it covers all retries and waits. It is checked before every HTTP attempt and before every sleep; a wait that would cross the deadline aborts the call. The per-request timeout is `min(timeoutMs, deadline - now())`. Exhaustion throws `JiraTimeBudgetExceededError(timeBudgetMs, attempts)`.

**Persistence retry:** rotated access/refresh tokens are encrypted and written before the access token is returned. A failed encrypt+write is retried once. If both attempts fail, the error is logged without secrets and `JiraPersistenceError(attempts, maxAttempts)` is thrown; since Atlassian has already rotated the refresh token, the connection will require reconnection.

**`Retry-After` parsing:** numeric seconds or HTTP-date; HTTP-date is converted to `ceil((date - now) / 1000)`; negative values clamp to 0; invalid/missing → `null` (treated as "cannot honour" → throw immediately).

**Timeout detection:** `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError` (or `AbortError` when aborted); both map to `JiraTimeoutError`.

**Status handling:** `requestJson<T>` accepts any 2xx (200, 201, 204, ...) and parses the body when present; `requestNoContent` accepts 204 only and treats any other status as `JiraClientError(status, 'unexpected_status')`.

## Retry policy

| Condition | GET (idempotent) | POST (non-idempotent) |
|---|---|---|
| Any 2xx | success (`requestJson` parses body) | success (`requestJson` parses body) |
| 401 | refresh once + retry once | refresh once + retry once |
| 429, Retry-After ≤ 60s | sleep + retry once; second 429 throws | sleep + retry once; second 429 throws |
| 429, Retry-After > 60s or missing/invalid | throw `JiraRateLimitedError` | throw `JiraRateLimitedError` |
| 5xx | 3 attempts, exponential + jitter (`random`) | throw `JiraServerError` |
| Timeout | 2 attempts, then `JiraTimeoutError` | throw `JiraTimeoutError` |
| Connection-phase network error (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) | 3 attempts | 2 attempts |
| Other network error | 3 attempts | no retry (request may have been sent); exhaustion -> `JiraServerError(503, attempts, maxAttempts)` |
| Other 4xx | no retry | no retry |
| Next wait/attempt would exceed the 45s call budget | `JiraTimeBudgetExceededError` | `JiraTimeBudgetExceededError` |

Idempotency: `searchIssues`, `listTransitions`, `getComments`, `listWebhooks` = GET; `refreshWebhooks` = PUT (idempotent); `doTransition`, `addComment`, `registerWebhook` = POST (non-idempotent).

Network exhaustion (both GET and POST) surfaces as `JiraServerError(503, attempts, maxAttempts)` after the last attempt; there is no separate network error class.

## Errors

```typescript
export type JiraGatewayErrorCode =
  | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'CLIENT_ERROR' | 'TIMEOUT'
  | 'TIME_BUDGET_EXCEEDED' | 'PERSISTENCE_ERROR';

export abstract class JiraGatewayError extends Error {
  protected constructor(readonly code: JiraGatewayErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class JiraUnauthorizedError extends JiraGatewayError {
  constructor(readonly detail: string) {
    super('UNAUTHORIZED', `Jira authentication failed: ${detail}`);
  }
}

export class JiraRateLimitedError extends JiraGatewayError {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number | null) {
    super('RATE_LIMITED', `Jira rate limited (retry-after: ${retryAfterSeconds ?? 'unknown'})`);
  }
}

export class JiraServerError extends JiraGatewayError {
  constructor(
    readonly status: number,
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super('SERVER_ERROR', `Jira server error (HTTP ${status}), attempts ${attempts}/${maxAttempts}`);
  }
}

export class JiraClientError extends JiraGatewayError {
  constructor(
    readonly status: number,
    readonly providerError: string,
    readonly errorMessages: readonly string[] = [],
    readonly fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super('CLIENT_ERROR', `Jira client error: ${providerError} (HTTP ${status})`);
  }
}

export class JiraTimeoutError extends JiraGatewayError {
  constructor(
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super('TIMEOUT', `Jira request timed out after ${attempts}/${maxAttempts} attempts`);
  }
}

export class JiraTimeBudgetExceededError extends JiraGatewayError {
  constructor(
    readonly timeBudgetMs: number,
    readonly attempts: number,
  ) {
    super('TIME_BUDGET_EXCEEDED', `Jira call exceeded its ${timeBudgetMs}ms budget after ${attempts} attempts`);
  }
}

export class JiraPersistenceError extends JiraGatewayError {
  constructor(
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super('PERSISTENCE_ERROR', `Failed to persist refreshed Jira tokens after ${attempts}/${maxAttempts} attempts`);
  }
}
```

## Config

- API base: `jira.apiBaseUrl` (default `https://api.atlassian.com`) + `/ex/jira/{cloudId}/rest/api/3`
- Token URL: `jira.authBaseUrl` (default `https://auth.atlassian.com`) via `ATLASSIAN_OAUTH`
- Timeout: `JIRA_GATEWAY_TIMEOUT_MS` constant (10s), injectable via options for tests
- Time budget: `JIRA_GATEWAY_TIME_BUDGET_MS` constant (45s), injectable via options for tests
- `sleep`, `now`, and `random` injectable via options for deterministic tests
- Scopes: gateway requires `offline_access`, `read:jira-work`, `write:jira-work`, `manage:jira-webhook`; T-16 defaults omit `manage:jira-webhook`. Decision: no `JIRA_SCOPES` change in this change; T-26 follow-up (documented in `docs/jira-gateway.md`)

## Risks / Trade-offs

- **Multi-instance refresh is unsupported.** Two instances can refresh the same connection concurrently; Atlassian's 10-minute reuse leeway may tolerate it, but this is not guaranteed. Deploy single-instance or ensure only one instance syncs a connection.
- `invalid_grant` marking uses a conditional update, so a concurrent reconnect is preserved. Any request that was already refreshing the old credentials still fails with `JiraUnauthorizedError`; the next request uses the new credentials.
- **Token rotation is unrecoverable if persistence fails twice.** Atlassian invalidates the old refresh token on use; if the new tokens cannot be written, the board requires reconnection. The failure is logged without secrets and surfaced as `JiraPersistenceError`.
- **`manage:jira-webhook` is not in the T-16 requested scopes.** Decision: this change does **not** modify `JIRA_SCOPES`; T-26 will add it and require existing boards to reconnect. Until then, webhook operations return 403. `docs/jira-sandbox.md` already expects this follow-up.
- The 45s per-call budget can abort legitimate multi-retry calls; it is intentionally bounded and configurable through options.
- No runtime schema validation of Jira responses (typed at compile time only).
- Optional webhook filters (`fieldIdsFilter`, `issuePropertyKeysFilter`) are not exposed yet.
- Reconnect detection is not surfaced by `GET /jira/connection` (would require a contract change).

## Migration plan

1. Add/extend `ATLASSIAN_OAUTH` with `refreshAccessToken` and tests
2. Add port, DTOs, errors, `plainTextToAdf`
3. Implement adapter + register provider
4. Add stub-server tests
5. Record the scope decision: no `JIRA_SCOPES` change; `manage:jira-webhook` is a T-26 follow-up documented in `docs/jira-gateway.md`
6. Write `docs/jira-gateway.md` and `docs/verification/T-23-jira-gateway-client.md` (same directory as T-16's records; rename to `KAN-<n>-...` when imported)
7. Run lint/typecheck/test/build

## Open questions

- Should `GET /jira/connection` expose `needsReconnect` (derived from `refreshTokenEnc IS NULL`)? Deferred — API contract change.
- Should webhook registration expose the optional `fieldIdsFilter` / `issuePropertyKeysFilter`? Deferred.
- Should proactive refresh use a configurable window instead of the fixed 60s? Deferred.
- `manage:jira-webhook` scope: **decided** — do not change `JIRA_SCOPES` in this change; T-26 follow-up (requires existing boards to reconnect). Webhook operations fail with 403 until then.
- Should the 45s call budget be configurable through `ConfigService` rather than constructor options only? Deferred.
