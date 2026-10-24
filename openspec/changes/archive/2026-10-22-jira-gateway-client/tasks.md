## 1. Ports, DTOs, Errors, Helper

- [x] 1.1 Create `src/modules/jira-sync/application/jira-gateway.port.ts` with `JIRA_GATEWAY`, all input/output DTOs (every input has `boardId`), `DEFAULT_SEARCH_FIELDS`, and webhook result union types; document that caller `fields` are merged with the defaults
- [x] 1.2 Create `src/modules/jira-sync/domain/jira-gateway.errors.ts`:
  - base `JiraGatewayError` with `code` only (no `status` on the base)
  - `JiraUnauthorizedError` (`detail`, no status)
  - `JiraRateLimitedError` (`status = 429`, `retryAfterSeconds: number | null`)
  - `JiraServerError` (`status`, `attempts`, `maxAttempts`)
  - `JiraClientError` (`status`, `providerError`, `errorMessages`, `fieldErrors`)
  - `JiraTimeoutError` (`attempts`, `maxAttempts`, **no status**)
  - `JiraTimeBudgetExceededError` (`timeBudgetMs`, `attempts`)
  - `JiraPersistenceError` (`attempts`, `maxAttempts`; no secret values)
- [x] 1.3 Create `src/modules/jira-sync/application/helpers/plain-text-to-adf.ts`

## 2. Extend ATLASSIAN_OAUTH for Refresh

- [x] 2.1 Add `refreshAccessToken(refreshToken: string): Promise<AtlassianTokens>` to `AtlassianOAuth` port
- [x] 2.2 Implement `refreshAccessToken` in `AtlassianOAuthHttpClient` (`POST ${jira.authBaseUrl}/oauth/token`, `grant_type=refresh_token`, parse `error` from the response body into `AtlassianRejectedError.providerError`)
- [x] 2.3 Extend `atlassian-oauth.http-client.spec.ts`: success + rotated refresh token, missing refresh token in response, `invalid_grant` (403 body), 5xx/unreachable
- [x] 2.4 Verify the existing OAuth tests still pass

## 3. HTTP Adapter

- [x] 3.1 Create `src/modules/jira-sync/infrastructure/jira-gateway.http-client.ts`
  - [x] 3.1.1 Constructor: `ConfigService`, `TokenCipher`, `Repository<JiraConnectionEntity>`, injected `JiraGatewayOptions` (`timeoutMs?`, `timeBudgetMs?`, `sleep?`, `now?`, `random?`)
  - [x] 3.1.2 Load connection selecting `accessTokenEnc`, `refreshTokenEnc`, `expiresAt`, `cloudId` (`select: false` columns must be requested explicitly)
  - [x] 3.1.3 `refreshInFlight = Map<string, Promise<string>>`; `refreshOnce(boardId, usedAccessToken, reason)` creates `doRefresh(boardId, usedAccessToken, reason).finally(() => delete)` and returns the existing promise when present
  - [x] 3.1.4 `ensureFreshAccessToken`: return the stored token when `expiresAt - now > 60s`; if `refreshTokenEnc == null`, throw `JiraUnauthorizedError` when the token is expired and otherwise return the still-valid token; otherwise call `refreshOnce(..., 'proactive')`
  - [x] 3.1.5 `doRefresh`: after the re-read, return the decrypted stored token without network if it differs from `usedAccessToken`, or if `reason === 'proactive'` and `expiresAt - now > 60s`; otherwise refresh with `ATLASSIAN_OAUTH.refreshAccessToken`
  - [x] 3.1.6 `doRefresh` `invalid_grant`: conditional `UPDATE ... WHERE board_id = :boardId AND refresh_token_enc = :previouslyReadCiphertext` to NULL; log affected rows (no secrets); throw `JiraUnauthorizedError`; never overwrite a concurrent reconnect. Any other refresh failure **must not** null `refreshTokenEnc`: 5xx/network → `JiraServerError`/`JiraTimeoutError`; other rejection → `JiraUnauthorizedError`
  - [x] 3.1.7 Persist rotated tokens **before** returning; retry the encrypt+write once on failure; log failures without secrets; after both attempts throw `JiraPersistenceError`
  - [x] 3.1.8 `requestJson<T>` / `requestNoContent` shared retry core:
    - `deadline = now() + timeBudgetMs` at public-call start (covers refresh + retries)
    - URL `${jira.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3${path}`
    - per-request timeout `min(timeoutMs, deadline - now())`, enforced with `AbortSignal.timeout`; map `TimeoutError`/`AbortError` to `JiraTimeoutError`
    - before each attempt/sleep: if `now() + wait > deadline` → `JiraTimeBudgetExceededError`
    - any 2xx → success (`requestJson` parses a body when present; 201 included)
    - `requestNoContent` accepts 204 only; any other status → `JiraClientError(status, 'unexpected_status')`
    - 401: re-read connection, compare stored access token with the token used; different → reuse and retry once; same → `refreshOnce(..., 'unauthorized')` and retry once; second 401 → `JiraUnauthorizedError`
    - 429: parse `Retry-After` (numeric seconds or HTTP-date); `null` or `> 60s` → `JiraRateLimitedError` immediately; otherwise `sleep`, retry once; second 429 → `JiraRateLimitedError`
    - 5xx: idempotent → up to 3 attempts with 1s/2s backoff × jitter from `random()` in `[0.75, 1.25]` (cap 10s); POST → `JiraServerError` immediately
    - timeout: GET → up to 2 attempts; POST → `JiraTimeoutError` immediately
    - network: GET → up to 3 attempts; POST → retry once only for `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`, otherwise throw; exhaustion → `JiraServerError(503, attempts, maxAttempts)`
    - other 4xx → `JiraClientError` with parsed Jira error body
  - [x] 3.1.9 Implement all 8 public methods with verified paths/payloads:
    - `GET /search/jql` sends `fields = unique(DEFAULT_SEARCH_FIELDS ∪ caller fields)` and returns `issues`, `nextPageToken`, `isLast`
    - `GET|POST /issue/{issueIdOrKey}/transitions`
    - `GET|POST /issue/{issueIdOrKey}/comment`
    - `POST /webhook` → `{ webhookRegistrationResult }` (200, per-entry success/errors)
    - `GET /webhook?startAt&maxResults` → `{ values, startAt, maxResults, total, isLast }`
    - `PUT /webhook/refresh` `{ webhookIds }` → `{ expirationDate }` (200 body)
- [x] 3.2 Register `JIRA_GATEWAY` provider in `src/modules/jira-sync/jira-sync.module.ts`
- [x] 3.3 Resolve the scope mismatch: the console app lists `manage:jira-webhook`, but `JIRA_SCOPES` (config default + `.env.*`) omits it; `docs/jira-sandbox.md` says to add it when webhook registration starts (T-26). **Decision: do not change `JIRA_SCOPES` in this change; T-26 follow-up.** Recorded in `design.md` and `docs/jira-gateway.md`

## 4. Unit Tests (Stub HTTP Server)

- [x] 4.1 Create `src/modules/jira-sync/infrastructure/jira-gateway.http-client.spec.ts` with a local `http.createServer` stub; configure `jira.apiBaseUrl`/`jira.authBaseUrl` to it; inject fake `sleep`, `now`, and `random`
- [x] 4.2 `searchIssues`: no fields → defaults; caller fields merged with defaults without duplicates; pagination (`nextPageToken`, `isLast`); empty results; invalid JQL → `JiraClientError(400)`
- [x] 4.3 `listTransitions`: full transition shape, empty list; `doTransition`: 204, 400/404 errors
- [x] 4.4 `getComments`: `{ comments, startAt, maxResults, total }`; `addComment`: 201 comment shape; `plainTextToAdf` body
- [x] 4.5 Webhooks: `registerWebhook` 200 `{ webhookRegistrationResult }` with mixed `createdWebhookId`/`errors`; `listWebhooks` page shape incl. `url`/`jqlFilter`/`expirationDate`; `refreshWebhooks` 200 `{ expirationDate }` and unrecognized IDs ignored
- [x] 4.6 Access-token freshness: proactive refresh within 60s; expired + NULL refresh token → `JiraUnauthorizedError` without HTTP; valid token + NULL refresh token → token used
- [x] 4.7 Refresh re-read guards: `doRefresh` returns stored token when it differs from `usedAccessToken`; proactive race with extended `expiresAt` skips network; 401 with future `expiresAt` still refreshes
- [x] 4.8 Concurrent 401s: only one refresh request; map entry removed after settle
- [x] 4.9 401 → refresh + retry once; new tokens persisted; rotated refresh token persisted before return
- [x] 4.10 Conditional `invalid_grant`: update criteria include `boardId` + previously read ciphertext; one row → set NULL; zero rows (simulated concurrent reconnect) → new `refreshTokenEnc` preserved; `JiraUnauthorizedError` in both cases
- [x] 4.11 Persistence retry: first write fails, second succeeds → token returned; both writes fail → `JiraPersistenceError` and logged error contains no token values
- [x] 4.12 429: numeric seconds and HTTP-date (fake sleep asserts delay); >60s/missing/invalid → immediate `JiraRateLimitedError`; second 429 throws; wait beyond budget → `JiraTimeBudgetExceededError`
- [x] 4.13 5xx: GET 3 attempts with fake sleep and deterministic jitter from `random`; POST no retry → `JiraServerError.attempts === 1`
- [x] 4.14 Timeout: GET 2 attempts then `JiraTimeoutError`; POST 1 attempt; no `status` on timeout error
- [x] 4.15 Network: POST retries once for `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`; POST no retry for `ECONNRESET`; GET retries up to 3
- [x] 4.16 Time budget: fake `now` advances with `sleep`; retries stop at 45s with `JiraTimeBudgetExceededError`; per-request timeout capped by remaining budget; no request sent after exhaustion
- [x] 4.17 Status handling: `requestJson` accepts 200/201; `requestNoContent` accepts 204 and rejects other 2xx with `JiraClientError('unexpected_status')`
- [x] 4.18 Missing connection → `JiraUnauthorizedError`

## 5. Documentation

- [x] 5.1 Create `docs/jira-gateway.md`: operations, DTOs, retry table, 45s budget, reconnect marking, persistence-failure risk, required scopes (including the missing `manage:jira-webhook`), config, multi-instance limitation, usage examples
- [x] 5.2 Add JSDoc to public port/DTO/error members
- [x] 5.3 No OpenAPI changes (no HTTP endpoints exposed by this change)

## 6. Verification

- [x] 6.1 Run `pnpm test`
- [x] 6.2 Run `pnpm lint`
- [x] 6.3 Run `pnpm typecheck`
- [x] 6.4 Run `pnpm build`
- [x] 6.5 Create `docs/verification/T-23-jira-gateway-client.md` (same directory as T-16's records; rename to `KAN-<n>-...` when the ticket is imported) with commands, results, and deviations