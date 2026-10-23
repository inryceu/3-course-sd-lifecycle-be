# jira-gateway Specification

## Purpose
Provide a typed, resilient gateway for the Jira Cloud REST API v3 used by the `jira-sync` module. It covers JQL search, transitions, comments, and dynamic webhooks, and manages encrypted per-board OAuth token refresh, single-flight coalescing, retry/timeout policies, and typed errors.

## Requirements

### Requirement: Search issues with JQL enhanced search
The system SHALL search issues via `GET /rest/api/3/search/jql` using `jql`, optional `nextPageToken`, `maxResults`, `expand`, and an explicit `fields` list. The effective field list SHALL be the union of `DEFAULT_SEARCH_FIELDS` and any caller-provided fields, so the typed response fields are always present. The result SHALL expose `issues`, `nextPageToken` (null on the last page), and `isLast`.

#### Scenario: First page
- **WHEN** `searchIssues` is called with a JQL query and no `nextPageToken`
- **THEN** the first page is returned with `nextPageToken` when more results exist and `isLast` false

#### Scenario: Default fields when none provided
- **WHEN** `searchIssues` is called without `fields`
- **THEN** the request contains the default field list (`summary,status,assignee,reporter,created,updated`)

#### Scenario: Caller fields merged with defaults
- **WHEN** `searchIssues` is called with `fields: ['labels']`
- **THEN** the request contains `labels` plus every field in `DEFAULT_SEARCH_FIELDS`, without duplicates

#### Scenario: Subsequent pages
- **WHEN** `searchIssues` is called with a valid `nextPageToken`
- **THEN** the next page is returned with a new `nextPageToken` or null, and `isLast` true on the last page

#### Scenario: Empty results
- **WHEN** the JQL matches no issues
- **THEN** `issues` is empty, `nextPageToken` is null, and `isLast` is true

#### Scenario: Invalid JQL
- **WHEN** the JQL query is invalid
- **THEN** a `JiraClientError` is thrown with status 400

### Requirement: List and perform issue transitions
The system SHALL list transitions via `GET /rest/api/3/issue/{issueIdOrKey}/transitions` (response `{ transitions: [...] }`) and perform a transition via `POST /rest/api/3/issue/{issueIdOrKey}/transitions` with body `{ transition: { id }, fields?, update? }`, which returns 204 No Content.

#### Scenario: List transitions
- **WHEN** `listTransitions` is called with a valid issue ID/key
- **THEN** the transitions are returned with `id`, `name`, `to`, `hasScreen`, `isGlobal`, `isInitial`, `isConditional`, and `isAvailable`

#### Scenario: Unavailable transition
- **WHEN** the issue has no available or matching transition
- **THEN** the response contains an empty `transitions` list (not an error)

#### Scenario: Perform transition
- **WHEN** `doTransition` is called with a valid issue and transition ID
- **THEN** the transition is applied and the call resolves with no content (HTTP 204)

#### Scenario: Rejected transition
- **WHEN** Jira rejects the transition with 400 or the issue does not exist (404)
- **THEN** a `JiraClientError` is thrown with the corresponding status

### Requirement: Get and add issue comments
The system SHALL retrieve comments via `GET /rest/api/3/issue/{issueIdOrKey}/comment` (response `{ comments, startAt, maxResults, total }`) and add a comment via `POST /rest/api/3/issue/{issueIdOrKey}/comment` with an ADF `body`, which returns 201 Created with the created comment.

#### Scenario: Get comments
- **WHEN** `getComments` is called with a valid issue ID/key
- **THEN** a page of comments is returned with author, ADF body, timestamps, and pagination fields

#### Scenario: Add comment
- **WHEN** `addComment` is called with a valid issue ID/key and ADF body
- **THEN** the created comment is returned with its `id`, `self`, author, body, and timestamps

#### Scenario: Invalid ADF body
- **WHEN** Jira rejects the comment body
- **THEN** a `JiraClientError` is thrown with status 400

#### Scenario: Plain text to ADF helper
- **WHEN** `plainTextToAdf` is called with a string
- **THEN** it returns `{ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }`

### Requirement: Register, list, and refresh webhooks per Jira Cloud API
The system SHALL register webhooks via `POST /rest/api/3/webhook` with `{ url, webhooks: [{ events, jqlFilter }] }` (`jqlFilter` required), list webhooks via `GET /rest/api/3/webhook` with `startAt`/`maxResults`, and refresh webhook life via `PUT /rest/api/3/webhook/refresh` with `{ webhookIds: number[] }`.

#### Scenario: Register webhooks (partial success allowed)
- **WHEN** `registerWebhook` is called with a URL and one or more `{ events, jqlFilter }` entries
- **THEN** the response is HTTP 200 and contains `webhookRegistrationResult`, one entry per requested webhook in order: `{ createdWebhookId }` on success or `{ errors: string[] }` on failure

#### Scenario: List webhooks
- **WHEN** `listWebhooks` is called with optional `startAt`/`maxResults`
- **THEN** the response contains `values` (each with `id`, `url`, `jqlFilter`, `events`, `expirationDate`, and optional filters), `startAt`, `maxResults`, `total`, and `isLast`

#### Scenario: Refresh webhooks
- **WHEN** `refreshWebhooks` is called with webhook IDs
- **THEN** the response is HTTP 200 with `{ expirationDate }`

#### Scenario: Unrecognized webhook IDs
- **WHEN** `refreshWebhooks` includes IDs that do not exist or belong to another app
- **THEN** Jira ignores them and still returns 200 with `{ expirationDate }`

### Requirement: Automatic access-token refresh
The system SHALL refresh access tokens proactively when `expiresAt` is within 60 seconds and a refresh token exists. If the access token is already expired and `refreshTokenEnc` is NULL, it SHALL throw `JiraUnauthorizedError` immediately; if the token is still valid and no refresh token exists, it SHALL use the stored token.

#### Scenario: Proactive refresh
- **WHEN** a request is made and the stored access token expires within 60 seconds and a refresh token exists
- **THEN** the token is refreshed before the request is sent

#### Scenario: Expired access token without refresh token
- **WHEN** the access token is expired and `refreshTokenEnc` is NULL
- **THEN** `JiraUnauthorizedError` is thrown immediately without an HTTP request

#### Scenario: Valid access token without refresh token
- **WHEN** the access token is still valid and `refreshTokenEnc` is NULL
- **THEN** the stored access token is used

### Requirement: Refresh token rotation persistence
The system SHALL persist rotated access and refresh tokens before returning the new access token and SHALL retry a failed persistence once. If persistence still fails after two attempts, it SHALL log without secrets and throw `JiraPersistenceError`.

#### Scenario: Persist rotated refresh token before returning
- **WHEN** Atlassian returns a new refresh token
- **THEN** it is encrypted and stored before the new access token is returned

#### Scenario: Persistence fails once
- **WHEN** the first token write fails
- **THEN** the write is retried once and succeeds, and the new access token is returned

#### Scenario: Persistence fails twice
- **WHEN** both token writes fail
- **THEN** a `JiraPersistenceError` is thrown, the error is logged without token values, and the risk of requiring reconnection is documented

### Requirement: Refresh failure handling
On `invalid_grant`, the system SHALL set `refreshTokenEnc` to NULL only when it still equals the previously read ciphertext, and throw `JiraUnauthorizedError` without retrying. Other refresh failures SHALL NOT modify `refreshTokenEnc`: 5xx/network failures surface as `JiraServerError`/`JiraTimeoutError`, and other rejections surface as `JiraUnauthorizedError`.

#### Scenario: Refresh token expired or revoked
- **WHEN** Atlassian answers the refresh with `error=invalid_grant` (HTTP 403)
- **THEN** `refreshTokenEnc` is set to NULL only if it still equals the previously read ciphertext, a `JiraUnauthorizedError` is thrown, and no retry is attempted; `expiresAt` is not modified

#### Scenario: Concurrent reconnect is preserved
- **WHEN** `invalid_grant` occurs but another process reconnected and replaced `refreshTokenEnc` before the conditional update
- **THEN** the conditional update affects zero rows, the new refresh token is not overwritten, and `JiraUnauthorizedError` is thrown for the failed refresh

#### Scenario: Refresh fails without invalid_grant
- **WHEN** the token refresh fails with a 5xx/network error or a rejection other than `invalid_grant`
- **THEN** `refreshTokenEnc` is preserved and the failure surfaces as `JiraServerError`/`JiraTimeoutError` (5xx/network) or `JiraUnauthorizedError` (other rejection)

### Requirement: In-process single-flight refresh
The system SHALL coalesce refreshes per board in-process with `Map<boardId, Promise<string>>`, creating each promise as `doRefresh(...).finally(delete)`. Callers needing a refresh SHALL pass the access token they used to `refreshOnce(boardId, usedAccessToken, reason)` and await the same in-flight promise.

#### Scenario: Concurrent requests during refresh
- **WHEN** multiple concurrent requests need a refresh for the same board
- **THEN** only one refresh is performed and all callers await the same promise; the map entry is removed in `finally`

#### Scenario: First refresh call starts the network request
- **WHEN** no refresh is in flight for the board
- **THEN** `refreshOnce` starts `doRefresh` with the caller's used access token and reason, stores the promise, and returns it

#### Scenario: 401 triggers refresh and retry
- **WHEN** a request returns 401 and the stored access token equals the one used
- **THEN** `refreshOnce` is called with reason `unauthorized`, both tokens are persisted, and the request is retried once with the new access token

### Requirement: Refresh re-read guards
Inside `doRefresh`, after re-reading the connection, the gateway SHALL return the stored access token without a network call when it differs from `usedAccessToken`. For a proactive refresh it SHALL also return the stored token without a network call when `expiresAt - now > 60s`. A 401-triggered refresh with an unchanged token SHALL always call Atlassian, even if `expiresAt` is still in the future.

#### Scenario: Another refresh already happened
- **WHEN** a refresh is requested with token A but the re-read stored token is B
- **THEN** B is returned without calling Atlassian

#### Scenario: Proactive refresh race
- **WHEN** a proactive refresh starts but the re-read connection shows the token now expires in more than 60 seconds
- **THEN** the stored token is returned without calling Atlassian

#### Scenario: 401 with future expiry
- **WHEN** a request returns 401 and the stored access token is unchanged even though `expiresAt` is more than 60 seconds away
- **THEN** the refresh calls Atlassian (the token was rejected despite its expiry)

#### Scenario: 401 after refresh retry
- **WHEN** the retry after a refresh also returns 401
- **THEN** `JiraUnauthorizedError` is thrown and no further retries occur

### Requirement: Rate-limit retry policy
The system SHALL parse `Retry-After` as numeric seconds or an HTTP-date. If the wait is at most 60 seconds, it SHALL sleep and retry once; a second 429 SHALL throw. If the wait exceeds 60 seconds or cannot be determined, it SHALL throw immediately without retrying.

#### Scenario: 429 with numeric Retry-After
- **WHEN** a request returns 429 with `Retry-After: 30`
- **THEN** the gateway sleeps 30 seconds and retries once

#### Scenario: 429 with HTTP-date Retry-After
- **WHEN** a request returns 429 with an HTTP-date that is at most 60 seconds away
- **THEN** the gateway computes the wait, sleeps, and retries once

#### Scenario: 429 with Retry-After above the cap
- **WHEN** `Retry-After` is greater than 60 seconds, missing, or invalid
- **THEN** `JiraRateLimitedError` is thrown immediately with `retryAfterSeconds` (or null) and no retry is made

#### Scenario: Second 429
- **WHEN** the single retry after 429 also returns 429
- **THEN** `JiraRateLimitedError` is thrown

#### Scenario: 429 wait exceeds the call budget
- **WHEN** `Retry-After` is at most 60 seconds but the wait would pass the per-call deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown instead of sleeping

### Requirement: Server error retry policy
For idempotent requests the system SHALL retry 5xx up to 3 attempts with exponential backoff (1s, 2s) and jitter in `[0.75, 1.25]` from an injected random source, capped at 10 seconds per wait. Non-idempotent POSTs SHALL NOT retry on 5xx. A retry SHALL be abandoned if it would exceed the per-call time budget.

#### Scenario: 5xx on GET
- **WHEN** an idempotent request returns 500, 502, or 503
- **THEN** the gateway retries up to 3 attempts with the documented backoff and jitter

#### Scenario: 5xx on POST
- **WHEN** a non-idempotent POST returns 5xx
- **THEN** no retry is made and `JiraServerError` is thrown with `attempts`

#### Scenario: Budget cuts server retries short
- **WHEN** a 5xx backoff would pass the per-call deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown instead of sleeping

### Requirement: Timeout and network retry policy
For idempotent requests the system SHALL retry timeouts up to 2 attempts and network errors up to 3 attempts. Non-idempotent POSTs SHALL NOT retry timeouts. A POST SHALL retry a network error only once and only for connection-phase `ECONNREFUSED`, `ENOTFOUND`, or `EAI_AGAIN`. A retry SHALL be abandoned if it would exceed the per-call time budget. Network exhaustion SHALL surface as `JiraServerError(503, attempts, maxAttempts)`.

#### Scenario: Timeout on GET
- **WHEN** an idempotent request times out
- **THEN** the gateway retries up to 2 attempts, then throws `JiraTimeoutError`

#### Scenario: Timeout on POST
- **WHEN** a non-idempotent POST times out
- **THEN** no retry is made and `JiraTimeoutError` is thrown

#### Scenario: Connection-phase network error on POST
- **WHEN** a POST fails with `ECONNREFUSED`, `ENOTFOUND`, or `EAI_AGAIN`
- **THEN** it is retried once (the request was never sent)

#### Scenario: Other network error on POST
- **WHEN** a POST fails with any other network error
- **THEN** it is not retried (the request may have been sent)

#### Scenario: Budget cuts network retries short
- **WHEN** another network attempt would pass the per-call deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown and no further attempt is made

#### Scenario: Network retries exhausted
- **WHEN** all permitted network attempts fail
- **THEN** `JiraServerError(503, attempts, maxAttempts)` is thrown

### Requirement: Typed errors and response DTOs without `any`
All errors SHALL be typed classes; no `any` SHALL appear in the public API. `JiraTimeoutError` SHALL NOT carry a synthetic HTTP status. `JiraServerError` SHALL expose `attempts` (and `maxAttempts`). `JiraTimeBudgetExceededError` SHALL expose `timeBudgetMs` and `attempts`, and `JiraPersistenceError` SHALL expose `attempts`/`maxAttempts`. `JiraGatewayError` SHALL NOT declare `status`, so subclasses do not duplicate it.

#### Scenario: Error discrimination
- **WHEN** catching a gateway error
- **THEN** `instanceof` checks work for `JiraUnauthorizedError`, `JiraRateLimitedError`, `JiraServerError`, `JiraClientError`, `JiraTimeoutError`, `JiraTimeBudgetExceededError`, and `JiraPersistenceError`

#### Scenario: Timeout error has no status
- **WHEN** `JiraTimeoutError` is thrown
- **THEN** it exposes `attempts`/`maxAttempts` and no `status` property

#### Scenario: Server error attempts
- **WHEN** `JiraServerError` is thrown
- **THEN** `attempts` and `status` are available

#### Scenario: Budget and persistence errors expose no secrets
- **WHEN** `JiraTimeBudgetExceededError` or `JiraPersistenceError` is thrown
- **THEN** its public fields contain no token values

#### Scenario: DTO immutability
- **WHEN** a DTO is received from the gateway
- **THEN** its fields are `readonly`

### Requirement: Per-request timeout
Every outbound HTTP request SHALL have a configurable timeout (default 10 seconds) enforced with `AbortSignal.timeout`, capped by the remaining per-call time budget.

#### Scenario: Request exceeds timeout
- **WHEN** a request exceeds the timeout
- **THEN** the timeout is handled per the retry policy above and surfaces as `JiraTimeoutError`

### Requirement: Per-call time budget
The system SHALL enforce an overall time budget per public gateway call (default 45 seconds), covering token refresh and all retries and waits. The deadline SHALL be checked before each attempt and before each sleep. Exhaustion SHALL throw `JiraTimeBudgetExceededError` with `timeBudgetMs` and the attempts made.

#### Scenario: Budget exhausted before a retry
- **WHEN** the next backoff or `Retry-After` wait would pass the 45-second deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown and no further request is sent

#### Scenario: Budget caps the request timeout
- **WHEN** less than the configured 10 seconds remain in the budget
- **THEN** the per-request timeout is reduced to the remaining budget

### Requirement: Response status handling
`requestJson<T>` SHALL accept any 2xx status and parse the JSON body when present. `requestNoContent` SHALL accept exactly 204 and treat any other status as `JiraClientError(status, 'unexpected_status')`.

#### Scenario: 201 Created with a body
- **WHEN** `addComment` receives 201 with a comment body
- **THEN** the body is returned

#### Scenario: 204 No Content
- **WHEN** `doTransition` receives 204
- **THEN** the call resolves without parsing a body

#### Scenario: Unexpected status for a no-content call
- **WHEN** a no-content operation receives anything other than 204
- **THEN** `JiraClientError` is thrown with `providerError = 'unexpected_status'`

### Requirement: Required OAuth scopes
Gateway operations SHALL require `offline_access` (refresh), `read:jira-work` (search, transitions read, comments read), `write:jira-work` (transitions, comments), and `manage:jira-webhook` (webhooks). Before sending a request, the gateway SHALL check the operation's required scope against the scopes stored on the board's `JiraConnectionEntity` (`scopes`, a string array). If the stored scopes are non-empty and lack the required scope, it SHALL throw `JiraClientError(403, 'missing_scope')` without any HTTP request and without attempting a token refresh. Empty or unknown stored scopes SHALL NOT block the call. Jira reports a missing scope as HTTP 401, not 403; the gateway's early check is what produces the explicit 403. The T-16 defaults omit `manage:jira-webhook`, so webhook calls fail early until the scope is granted and the board reconnects.

#### Scenario: Webhook scope missing
- **WHEN** a webhook operation is attempted on a connection whose known scopes omit `manage:jira-webhook`
- **THEN** the gateway throws `JiraClientError(403, 'missing_scope')` before any HTTP request or token refresh

#### Scenario: Refresh scope missing
- **WHEN** the stored tokens lack `offline_access`
- **THEN** no refresh token is available and an expired token causes `JiraUnauthorizedError`

### Requirement: Config-driven URLs and cloudId base
The Jira REST base URL SHALL be `${jira.apiBaseUrl}/ex/jira/{cloudId}/rest/api/3`, where `cloudId` comes from the board's `JiraConnectionEntity`. The token endpoint SHALL come from `jira.authBaseUrl` via `ATLASSIAN_OAUTH`. Both SHALL be overridable in tests through configuration.

#### Scenario: Base URL construction
- **WHEN** a gateway operation is called for a board
- **THEN** the connection is loaded, `cloudId` is used, and the API base URL is built from `jira.apiBaseUrl`

#### Scenario: Stub server in tests
- **WHEN** `jira.apiBaseUrl` and `jira.authBaseUrl` point to a local stub server
- **THEN** all gateway traffic goes to the stub

### Requirement: Reuse existing token storage (T-16)
The gateway SHALL reuse `JiraConnectionEntity`, `TokenCipher`, and the existing OAuth configuration. No new tables, columns, or migrations SHALL be added.

#### Scenario: Token encryption
- **WHEN** tokens are read or written
- **THEN** `TokenCipher.encrypt`/`decrypt` are used and tokens are never logged

#### Scenario: Connection not found
- **WHEN** a gateway operation is called for a board without a Jira connection
- **THEN** `JiraUnauthorizedError` is thrown

#### Scenario: Reconnect marking
- **WHEN** refresh fails with `invalid_grant`
- **THEN** `refreshTokenEnc` is set to NULL only if it still equals the previously read ciphertext; reconnect detection requires selecting that column (it is `select: false`)

### Requirement: In-process single-flight limitation
Single-flight refresh SHALL be in-process only. Multiple backend instances refreshing the same connection concurrently are unsupported.

#### Scenario: Multi-instance deployment
- **WHEN** more than one backend instance may refresh the same board concurrently
- **THEN** the deployment is unsupported by this change; no distributed lock is provided
