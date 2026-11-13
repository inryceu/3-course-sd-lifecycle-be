# Design

## Context

See `proposal.md` for motivation. Current state that shapes the design:

- `JiraGateway` already exposes `registerWebhook`, `listWebhooks` and `refreshWebhooks`; its scope guard requires `manage:jira-webhook`, which is not yet in the default `JIRA_SCOPES`.
- A board's project key is stored on the board (`BoardsFacade.getBoardSummary`/`setJiraProjectKey`), not on `JiraConnectionEntity`; the key becomes known only after import or an explicit link.
- `BoardsFacade.moveCardFromExternal` publishes `card.moved` with `origin: "jira"` and already implements the no-loop contract. It currently requires an explicit `position`.
- `upsertCardFromExternal` matches by issue key but also overwrites title and description, so it is unsuitable for status-only updates.
- The global JWT guard is registered as `APP_GUARD`; the webhook route must opt out with `@Public()` and authenticate itself.
- Nest does not retain raw request bytes today: neither `main.ts` nor `createTestApp()` enables `rawBody`.
- The stack has no Redis and no scheduling package. Postgres is the only shared store.
- Atlassian authenticates admin/console webhooks with `X-Hub-Signature` HMAC-SHA256, and dynamic webhooks registered by an OAuth 2.0 app with a Bearer JWT signed by the app's client secret. Dynamic webhooks do not receive the HMAC header, so an HMAC-only receiver cannot protect the registration path this ticket introduces.

### Atlassian documentation check (verified 2026-11-05)

- The Jira Webhooks page states that OAuth 2.0 webhook deliveries use bearer authentication: the token is in the `Authorization` header and is signed with the app's client secret; Atlassian recommends verifying it with a JWT library. The same page states that dynamic webhooks expire **30 days** after creation or refresh and remain available for up to **3 months** after expiry: <https://developer.atlassian.com/cloud/jira/platform/webhooks/#webhooks-authentication-for-oauth-2-0-apps> and <https://developer.atlassian.com/cloud/jira/platform/webhooks/#webhook-expiration>.
- The Jira REST API v3 Webhooks reference confirms that registered webhooks expire after 30 days and that `PUT /rest/api/3/webhook/refresh` extends their life: <https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/#api-rest-api-3-webhook-refresh-put>.
- The 3LO webhook documentation does not publish a separate algorithm or claim list. Atlassian's JWT guide documents Atlassian-issued JWTs as `HS256` with `typ: "JWT"` and mandatory `iss`, `iat` and `exp` claims: <https://developer.atlassian.com/cloud/jira/platform/understanding-jwt-for-connect-apps/> and <https://jwt.io/>. The verifier therefore allows only HMAC JWT algorithms, requires standard claims, and fails closed on anything else; sandbox verification must confirm a real 3LO token before release.

## Goals / Non-Goals

**Goals:**

- Authenticate both Atlassian delivery modes without weakening the route, and never log secret material.
- Make duplicate/replayed deliveries harmless under concurrent and retried delivery.
- Keep the receive path independent of Jira latency so the 5-second budget is attainable.
- Register and refresh webhooks from existing connection/link lifecycles, with reconciliation for missed events.
- Leave prompts, errors and payload handling testable without a live Jira tenant.

**Non-Goals:**

- Full two-way conflict resolution, issue creation/deletion, comment or assignee sync.
- Deleting remote webhooks on disconnect or project change (the gateway has no delete operation; deferred).
- Multi-region scheduling or exactly-once event delivery.
- Polling fallback; webhooks are the only near-real-time path in this change.
- Redis or another new infrastructure dependency.

## Decisions

### 1. Dual authenticity with explicit precedence

The receiver tries `X-Hub-Signature` first when present: parse the `sha256=` prefix, recompute HMAC-SHA256 over the retained raw body with `WEBHOOK_SECRET`, compare buffers of equal length with `crypto.timingSafeEqual`, and reject on any mismatch. If that header is absent, it requires `Authorization: Bearer <JWT>`, verifies the signature with `JIRA_CLIENT_SECRET` using `@nestjs/jwt` (already a dependency, backed by `jsonwebtoken`), restricts algorithms to `HS256`/`HS512`, checks `iss` equals `JIRA_CLIENT_ID`, and requires a numeric `exp` that has not passed. A delivery carrying an invalid HMAC does not fall back to JWT. Missing or invalid proof answers 401 before any lookup.

Rationale: this is the only way to cover both console/tunnel webhooks (HMAC, needed for local testing and the existing `WEBHOOK_SECRET`) and the dynamic webhooks this ticket registers (JWT). Alternatives: HMAC-only rejects every dynamic delivery; JWT-only removes the secret-based path promised by the ticket and the sandbox flow; accepting either proof when both are present creates ambiguity and a downgrade surface, so precedence is fixed.

The controller uses `@Public()` and reads `RawBodyRequest<Request>.rawBody`. JSON parsing still runs, but authenticity is computed over the raw buffer, not the parsed object. Body size is capped at 1 MB; requests without a raw buffer or with malformed JSON are rejected with 400. (Correction, `jira-webhook-hardening`: Express's JSON parser rejects malformed JSON before the controller runs, so an unsigned malformed body also gets 400; only well-formed JSON with an invalid payload shape is rejected after authenticity.)

### 2. Deduplicate in Postgres with a claim/release row

Add `jira_webhook_deliveries` with `delivery_key` (primary key or unique), `status` (`processing`/`processed`), `attempts`, `claimed_at` and `expires_at`. The handler derives the key from SHA-256 of event + issue id + changelog id, or the raw body when there is no changelog. (Correction, `jira-webhook-hardening`: the original design preferred `X-Atlassian-Webhook-Identifier`, which is not covered by the signature, so a replay with a new header bypassed dedup.) It claims the row with an insert that does nothing on conflict; no inserted row means a duplicate, answered with 200. Claiming, parsing and moving run inside one `try/finally`: any failure after the claim, including a failure between the claim and the move, deletes the row so Jira's retry can claim it again. A dedicated test injects a failure immediately after the claim and asserts the row is released. A row stuck in `processing` longer than 5 minutes may be reclaimed, covering a crash between claim and completion.

A periodic cleanup deletes rows past a 7-day retention, which comfortably covers Atlassian's retry window. Rationale: the unique constraint handles concurrent duplicates across instances without new infrastructure. Alternatives: Redis `SET NX` adds a dependency the stack does not have; in-memory sets fail on restart and multi-instance deployment; relying only on `X-Atlassian-Webhook-Retry` misses duplicate identifiers.

### 3. Sync directly from the payload, without calling Jira

The handler accepts only `jira:issue_updated` with a changelog item whose `field` is `status`. It resolves the boards from the Jira site that sent the delivery (`issue.self` against each connection) and the card by `(boardId, jiraIssueKey)`; boards without a connection or linked to another project are skipped. (Correction, `jira-webhook-hardening`: the original lookup by issue key alone picked an arbitrary board, since keys are unique only per board.) The status snapshot in `issue.fields.status` is the source of truth for the destination: its id/name selects the stored mapping and its status-category key selects the default. The changelog is used only to detect that a status change occurred, not as the destination. It queries `JiraStatusMappingEntity` for that board/status; if no row exists or its column was deleted, it picks the default column by the category (`new` → TODO, `indeterminate` → in progress, `done` → done), matching `JiraStatusMappingService`'s existing rule.

Out-of-order deliveries: Jira retries can arrive after a newer event. Using the `issue.fields.status` snapshot captured with each event avoids applying an intermediate status from a multi-step changelog, and each delivery stays self-contained. (Correction, `jira-webhook-hardening`: the original claim that the board converges does not hold, since nothing guarantees a next update.) Each issue mapping stores the `timestamp` of the last applied delivery in `last_jira_event_at`; a delivery that is not newer is dropped as `stale`, and a failed move restores the previous value. Remaining limit: two deliveries for the same issue that pass the check concurrently can still finish their moves in reverse order.

It then calls `BoardsFacade.moveCardFromExternal`. `ExternalCardMove.position` becomes optional; when omitted the facade appends at the end of the target column using the existing board lock. This avoids a second read of the whole board and avoids the title/description overwrite of `upsertCardFromExternal`. `'unchanged'` and `'not-found'` both answer 200 and are logged; they are not errors Jira should retry.

Rationale: one indexed mapping lookup plus one transaction keeps the path well inside 5 seconds and removes token-refresh, rate-limit and Jira-outage failure modes from the delivery path. Alternative: calling `listProjectStatuses` per delivery is slower and can fail independently; deriving the target from the changelog can apply an intermediate state; `upsertCardFromExternal` would silently overwrite user edits.

### 4. Webhook registration is owned by a lifecycle service

Add `jira_webhooks` (`board_id` unique, `project_key`, `webhook_id`, `url`, `events`, `jql_filter`, `expires_at`, `last_refreshed_at`). A `JiraWebhookLifecycleService` exposes `registerForBoard(boardId)` and is called:

- at the end of the OAuth callback when the board already has a project key;
- after `JiraImportService.import` stores a project key;
- from the periodic reconciliation sweep for connected+linked boards without a row.

`registerForBoard` loads the connection and board summary, skips when the board is unlinked or `JIRA_WEBHOOK_URL` is unset, calls `registerWebhook` for `jira:issue_updated` with JQL `project = "<KEY>"`, and logs failures without failing the caller. `registerWebhook` returns only the created id, so registration then calls `listWebhooks` to read that webhook's `expirationDate`; if the lookup fails, it stores `now + 30 days` (the documented lifetime) so the sweep can still refresh before expiry. When the project key changes, the row is replaced and a new webhook is registered; the old remote webhook is left to expire because the gateway has no delete operation.

Rationale: a separate table keeps webhook lifecycle out of the credential entity and lets the sweep find stale registrations. Alternative: columns on `JiraConnectionEntity` cannot store the project key cleanly and mix two lifecycles; registering only at connect misses the normal connect-then-import order.

### 5. Refresh with a lightweight in-process timer

On application bootstrap the lifecycle service starts a timer only when `NODE_ENV` is not `test`: every 6 hours, `unref`'d, cleared on shutdown, with one immediate sweep. Under `NODE_ENV=test` no interval is created, so integration tests never perform background Jira refreshes; tests call the public `sweep()` directly. A sweep takes a Postgres advisory lock so only one instance refreshes. It refreshes every row expiring within 7 days, including rows that have already expired but are still within Atlassian's 3-month grace period; refresh resets the life to 30 days and the returned `expirationDate` is persisted. A row whose expiration is older than the 3-month grace can no longer be refreshed, so the sweep registers a new webhook and replaces the row. Rows missing for connected+linked boards are registered in the same sweep. Failures are logged and retried on the next sweep.

Rationale: one background job does not justify `@nestjs/schedule`. The advisory lock prevents duplicate refresh calls when multiple backend instances run. Alternative: cron package adds a dependency and configuration for one job; refreshing on every request would add Jira latency to unrelated paths.

### 6. Configuration and transport

Add optional `JIRA_WEBHOOK_URL` (full public URL including `/api/v1/jira/webhook`, HTTPS in production) and add `manage:jira-webhook` to the default `JIRA_SCOPES`. When the URL is unset, registration is skipped with a warning so local and CI runs without a tunnel still start. Existing connections lack the new scope: connect/import succeeds, registration logs `missing_scope`, and reconciliation succeeds after the Admin reconnects.

Enable `rawBody: true` in `main.ts` and in `createTestApp()` so both production and integration tests verify the same bytes. The receiver stays outside the global JWT guard. Logs include event type, board id, a short hash prefix of the delivery key, outcome and latency; they never include tokens, secrets, signatures or the full payload.

Alternative: deriving the receiver URL from `JIRA_REDIRECT_URI` is wrong because the frontend callback path is not the API receiver. Making the URL required breaks tests and local startup without a tunnel.

### 7. Contract and documentation

Update `/jira/webhook` in `docs/api/openapi.yaml` to 200/400/401, public security, and the signature/identifier/retry headers; remove `x-implemented-in`. Update `README.md`, `docs/jira-sandbox.md` and `docs/jira-gateway.md` for the new scope, URL, header-based verification and the dynamic-vs-admin authentication distinction.

## Risks / Trade-offs

- **Dynamic webhook JWT format is under-documented** → Restrict to HMAC JWT algorithms (HS256/HS512), verify issuer and expiry, and cover both token shapes with unit tests; a rejected token fails closed with 401 and sandbox verification confirms a real 3LO token.
- **A crash after claiming a delivery** → Stale claims are reclaimable after 5 minutes; a delivery may be processed twice, but the move is idempotent and the unique key limits the window.
- **A slow database breaks the 5-second budget** → The path uses a fixed small number of indexed queries and no external calls; a failed transaction returns 5xx and releases the key for retry rather than acknowledging a lost update.
- **Existing boards lack the webhook scope** → Connect/import still succeeds, the failure is visible in logs, and reconciliation retries after reconnection; documentation states that reconnection is required.
- **Remote webhooks orphaned on disconnect/project change** → They keep delivering until their 30-day life ends; the gateway still has no delete operation. (Correction, `jira-webhook-hardening`: the mapping lookup did not fail, so these deliveries kept moving cards. The receiver now ignores boards without a connection and boards whose project key differs from the mapping's.)
- **Multiple instances run the sweep** → A Postgres advisory lock elects one runner; duplicate refresh is otherwise idempotent.
- **Callback registration adds latency or a failure to OAuth/import** → Registration is best-effort and never changes the success response.
- **HMAC and JWT precedence is subtle** → Fixed precedence (HMAC when present) and explicit tests for invalid HMAC with a valid JWT prevent accidental fallback.

## Migration Plan

1. Add the two tables and their indexes via a TypeORM migration; deploy the schema before the application because startup does not synchronise.
2. Add `JIRA_WEBHOOK_URL`, update `JIRA_SCOPES` defaults and `.env.example`/`.env.full.example`; restart the backend.
3. Existing boards keep working without webhooks. Each Admin reconnects Jira to grant `manage:jira-webhook`; the reconciliation sweep then registers webhooks for connected, linked boards.
4. Verify a signed test delivery and a registered webhook's expiration; roll back by removing the route/scope/URL and dropping the tables. Remote webhooks expire on their own.

## Open Questions

None. The receiver URL is a configuration value, and remote webhook deletion is explicitly deferred.
