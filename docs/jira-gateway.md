# Jira Gateway Client

Typed adapter for the Jira Cloud REST API v3 used by the `jira-sync` module.

- Port: `src/modules/jira-sync/application/jira-gateway.port.ts` (`JIRA_GATEWAY`)
- Adapter: `src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts`
- Errors: `src/modules/jira-sync/domain/jira-gateway.errors.ts`
- ADF helper: `src/modules/jira-sync/application/helpers/plain-text-to-adf.ts`

## Usage

Inject the port, never the adapter:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  JIRA_GATEWAY,
  JiraGateway,
  SearchIssuesResult,
} from '../application/jira-gateway.port';

@Injectable()
export class ExampleService {
  constructor(@Inject(JIRA_GATEWAY) private readonly jira: JiraGateway) {}

  search(boardId: string): Promise<SearchIssuesResult> {
    return this.jira.searchIssues({
      boardId,
      jql: 'project = KAN ORDER BY updated DESC',
      maxResults: 50,
    });
  }
}
```

Every input carries `boardId`; the adapter loads the board's `JiraConnectionEntity` to obtain `cloudId` and the encrypted tokens.

## Operations

| Port method | Jira endpoint | Notes |
|---|---|---|
| `searchIssues` | `GET /rest/api/3/search/jql` | Sends `fields = unique(DEFAULT_SEARCH_FIELDS ∪ caller fields)`; returns `issues`, `nextPageToken`, `isLast`. Defaults are `summary,status,assignee,reporter,created,updated` because `/search/jql` returns only ids without an explicit field list. |
| `listTransitions` | `GET /rest/api/3/issue/{issueIdOrKey}/transitions` | Accepts `expand`, `transitionId`, `includeUnavailableTransitions`; an unavailable transition is an empty list, not an error. |
| `doTransition` | `POST /rest/api/3/issue/{issueIdOrKey}/transitions` | ADF-level `fields`/`update` passthrough; requires **204 No Content**. |
| `getComments` | `GET /rest/api/3/issue/{issueIdOrKey}/comment` | Pagination and optional `orderBy`/`expand`. |
| `addComment` | `POST /rest/api/3/issue/{issueIdOrKey}/comment` | ADF body; accepts 201 and returns the created comment. |
| `registerWebhook` | `POST /rest/api/3/webhook` | `{ url, webhooks: [{ events, jqlFilter }] }`; per-entry success/error results in request order. |
| `listWebhooks` | `GET /rest/api/3/webhook` | `startAt`/`maxResults`; returns `values`, `startAt`, `maxResults`, `total`, `isLast`. |
| `refreshWebhooks` | `PUT /rest/api/3/webhook/refresh` | `{ webhookIds: number[] }`; unrecognized ids are ignored by Jira. |

Base URL: `${JIRA_API_BASE_URL}/ex/jira/{cloudId}/rest/api/3`.  
Token endpoint: `${JIRA_AUTH_BASE_URL}/oauth/token` through `ATLASSIAN_OAUTH.refreshAccessToken`.

`plainTextToAdf(text)` produces a one-paragraph ADF document for `addComment`.

## Token refresh

The adapter refreshes proactively when `expiresAt <= now + 60s` and a refresh token exists.

- Refreshes are single-flight **per process** via `Map<boardId, Promise<string>>`; the entry is removed in `finally`.
- After a 401, the connection is re-read. If the stored access token differs from the one used, another refresh already won and the stored token is reused. Otherwise the adapter refreshes and retries the request once.
- `doRefresh` re-reads the connection again, returns a concurrently refreshed token without a network call, and skips a proactive refresh if `expiresAt` was already extended.
- Rotated tokens are encrypted with `TokenCipher` and persisted **before** the access token is returned. Persistence is retried once.
- If both persistence attempts fail, the error is logged without secrets and `JiraPersistenceError` is thrown. Atlassian has already rotated the refresh token at that point, so the board requires reconnection.

### Reconnect marking

`invalid_grant` (HTTP 403 from the token endpoint) means the refresh token is no longer usable. The adapter performs a guarded update:

```sql
UPDATE jira_connections
SET refresh_token_enc = NULL
WHERE board_id = :boardId
  AND refresh_token_enc = :previouslyReadCiphertext
```

This preserves a concurrent reconnect. The guarded update is best-effort; a database failure while clearing is logged and the caller still receives `JiraUnauthorizedError`.

Failures other than `invalid_grant` **never** clear `refreshTokenEnc`:

| Refresh failure | Typed error |
|---|---|
| `AtlassianRejectedError('invalid_grant')` | `JiraUnauthorizedError`; token cleared conditionally |
| Other `AtlassianRejectedError` | `JiraUnauthorizedError`; token preserved |
| `AtlassianUnavailableError('HTTP 5xx')` | `JiraServerError(status, 1, 1)`; token preserved |
| `AtlassianUnavailableError` timeout | `JiraTimeoutError(1, 1)`; token preserved |
| Other `AtlassianUnavailableError` (network) | `JiraServerError(503, 1, 1)`; token preserved |

`GET /jira/connection` does not currently expose a `needsReconnect` flag; this is a deferred API change.

## Retry and timeout policy

Each public call has a **45s budget** (`timeBudgetMs`) that starts before the token refresh and covers all retries and sleeps. The per-request timeout is `min(10s, remaining budget)` and is enforced with `AbortSignal.timeout`.

| Condition | GET / PUT (idempotent) | POST (non-idempotent) |
|---|---|---|
| 2xx | success (`requestJson` parses a body when present) | success |
| 401 | re-read, reuse or refresh once, retry once; second 401 fails | same |
| 429, `Retry-After` <= 60s | sleep, retry once; second 429 fails | same |
| 429, missing/invalid/ > 60s | `JiraRateLimitedError` immediately | same |
| 5xx | 3 attempts, 1s/2s x jitter in `[0.75, 1.25]`, cap 10s | `JiraServerError` immediately |
| Timeout | 2 attempts, then `JiraTimeoutError` | `JiraTimeoutError` immediately |
| `ECONNREFUSED` / `ENOTFOUND` / `EAI_AGAIN` | 3 attempts | 2 attempts |
| Other network error | 3 attempts | no retry (request may have been sent) |
| Other 4xx | `JiraClientError` with parsed Jira errors | same |
| Next attempt/wait would cross the budget | `JiraTimeBudgetExceededError` | same |

Network exhaustion surfaces as `JiraServerError(503, attempts, maxAttempts)`.

`Retry-After` accepts numeric seconds or an HTTP-date. HTTP-date values are converted with `ceil((date - now) / 1000)` and clamped at 0.

`requestJson` accepts any 2xx (comments return 201); `requestNoContent` accepts 204 only and otherwise throws `JiraClientError(status, 'unexpected_status')`.

## Errors

All errors extend `JiraGatewayError` and expose a stable `code`:

- `JiraUnauthorizedError` (`detail`)
- `JiraRateLimitedError` (`status = 429`, `retryAfterSeconds`)
- `JiraServerError` (`status`, `attempts`, `maxAttempts`)
- `JiraClientError` (`status`, `providerError`, `errorMessages`, `fieldErrors`)
- `JiraTimeoutError` (`attempts`, `maxAttempts`; no `status`)
- `JiraTimeBudgetExceededError` (`timeBudgetMs`, `attempts`)
- `JiraPersistenceError` (`attempts`, `maxAttempts`)

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `JIRA_API_BASE_URL` | `https://api.atlassian.com` | Jira REST API base |
| `JIRA_AUTH_BASE_URL` | `https://auth.atlassian.com` | OAuth token endpoint |
| `JIRA_GATEWAY_TIMEOUT_MS` constant | 10s | Per-request timeout; overridable via `JiraGatewayOptions` in tests |
| `JIRA_GATEWAY_TIME_BUDGET_MS` constant | 45s | Per-public-call budget; overridable via `JiraGatewayOptions` in tests |

The call budget and timeout are constructor options today, not `ConfigService` settings. `sleep`, `now`, and `random` are injectable for deterministic tests.

## Scopes

The gateway requires:

- `offline_access` (refresh token)
- `read:jira-work`
- `write:jira-work`
- `manage:jira-webhook` (webhook registration/list/refresh only)

T-16 defaults are `read:jira-work,write:jira-work,read:jira-user,offline_access`.

**Decision for this change:** do **not** modify `JIRA_SCOPES` or the `.env.*` defaults. The console app already lists `manage:jira-webhook`, but backend webhook calls return 403 until the scope is added to `JIRA_SCOPES` and existing boards reconnect. That is a **T-26 follow-up**; `docs/jira-sandbox.md` already expects it when webhook registration starts. `read:jira-user` is extra but harmless.

## Operational limitations

- **Single-instance only for refresh.** Single-flight is in-process. Multiple backend instances can refresh the same connection concurrently; Atlassian's refresh-token reuse leeway is not a guarantee. Deploy a single sync instance or ensure only one instance syncs a board.
- **No runtime response validation.** DTOs are compile-time only; Jira response changes are not validated at runtime.
- Optional webhook filters (`fieldIdsFilter`, `issuePropertyKeysFilter`) are not exposed yet.
- Webhook calls will fail with 403 until the T-26 scope change and reconnection.
