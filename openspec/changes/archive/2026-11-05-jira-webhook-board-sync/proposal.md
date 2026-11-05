# Proposal

## Why

FR-07 (T-26, KAN-37) requires status changes made directly in Jira to appear on the BoardSync board within 5 seconds, without polling. The Jira gateway (T-23), the status ↔ column mapping and issue links (T-24), the `BoardsFacade` external-card methods (T-19) and the origin-aware event bus (T-10) are in place, so the receive path can now be built. The endpoint must also satisfy NFR-SEC-3: every delivery is authenticated, and webhook secrets are never logged.

## What Changes

- **Public `POST /jira/webhook` receiver** (`@Public`; JWT auth does not apply):
  - Verifies the delivery against the raw request body. Two documented Atlassian modes are accepted: `X-Hub-Signature: sha256=<hex>` HMAC-SHA256 with `WEBHOOK_SECRET` (admin webhooks / local tunnel), and `Authorization: Bearer <JWT>` signed with `JIRA_CLIENT_SECRET` (dynamic webhooks registered by an OAuth 2.0 app). HMAC comparison uses `crypto.timingSafeEqual`; invalid or missing credentials answer 401.
  - Rejects malformed or unsigned deliveries before touching board data.
- **Delivery deduplication**: stores a delivery key in a new `jira_webhook_deliveries` table with a unique constraint and a retention TTL. The key is `X-Atlassian-Webhook-Identifier`, falling back to a SHA-256 hash of the event, issue id and changelog id, or the raw body when no changelog is present. A duplicate or replay answers 200 and is ignored; a failed delivery releases its key so Jira's retry can be processed.
- **Status-change handling**: only `jira:issue_updated` events with a `status` changelog item are acted on. The board is resolved from `jira_issue_mappings` by issue key, the target column from the stored status mapping (category default when unmapped), and the card is moved through `BoardsFacade.moveCardFromExternal`. The facade publishes `card.moved` with `origin: "jira"`; the outbound Jira sync must ignore that origin to prevent a loop. Unknown issues, unrelated updates and no-op moves answer 200 without side effects.
- **Webhook lifecycle**:
  - Adds `manage:jira-webhook` to the default `JIRA_SCOPES`; existing connections must reconnect.
  - Registers `jira:issue_updated` with JQL `project = "<KEY>"` through `POST /rest/api/3/webhook` once both a connection and a project key exist (OAuth callback when already linked, import/project link otherwise), and stores the webhook id, project key and expiration.
  - A scheduled refresh calls `PUT /rest/api/3/webhook/refresh` for webhooks close to expiry. Atlassian expires dynamic webhooks 30 days after creation or the last refresh; the refresh threshold is 7 days.
- **Configuration and transport**: enables Nest raw-body capture, adds an optional public `JIRA_WEBHOOK_URL` for registration (HTTPS in production), and keeps both secrets out of logs.
- **Contract and documentation**: updates `/jira/webhook` in `docs/api/openapi.yaml` (200 response, auth headers, 401), the README working notes and `docs/jira-sandbox.md` (secret header instead of a secret in the URL).

## Capabilities

### New Capabilities

- `jira-webhook-sync`: receiving authenticated Jira webhook deliveries, deduplicating them, moving cards on status changes through the boards facade, publishing origin-`jira` events, and registering/refreshing the webhook over its 30-day life.

### Modified Capabilities

- `api-contract`: `POST /jira/webhook` changes from an unimplemented 202 operation to the implemented 200/401 contract with its authentication headers.

## Impact

- Backend: `src/modules/jira-sync` (controller, signature verifier, delivery entity + migration, webhook handler, lifecycle/refresh service), `src/config` (scope defaults and public webhook URL), `src/main.ts`/test bootstrap (`rawBody: true`), `src/modules/boards` only through the existing `BOARDS_FACADE`.
- Tests: unit tests for signature verification and dedup keys; component tests with real Postgres and a stubbed `JIRA_GATEWAY` for valid/invalid deliveries, duplicate/replay, unknown issue, registration and refresh; a timing test for the 5-second budget.
- Docs: `docs/api/openapi.yaml`, `README.md`, `docs/jira-sandbox.md`, `docs/jira-gateway.md`.
- Operations: boards connected before this change must reconnect to grant `manage:jira-webhook`; the webhook URL must be publicly reachable over HTTPS.
- Dependencies: none expected; dedup uses PostgreSQL, not Redis.
