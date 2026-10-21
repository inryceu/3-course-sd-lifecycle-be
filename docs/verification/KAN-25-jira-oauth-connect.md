# KAN-25 (T-16) — Jira-sync OAuth 2.0 (3LO) connect flow: verification

The implementation was delivered with the intermediate result (#27 into `dev`, #28 into `main`; OpenSpec change `openspec/changes/archive/2026-10-03-jira-connection`, spec `openspec/specs/jira-oauth-connection/spec.md`). This record checks every acceptance criterion against `dev` at `69e1fb0`. Dependencies: T-15 (KAN-24, verified), T-07 (global guard and `AUTH_FACADE`, on `dev`), T-14 (KAN-23, sandbox and app, see [docs/jira-sandbox.md](../jira-sandbox.md)).

| Acceptance criterion | Evidence | Result |
| --- | --- | --- |
| `GET /jira/oauth/start` (board Admin only) returns the authorise URL with `state` and PKCE `code_challenge`; state and verifier stored with a 10-minute TTL | `JiraOAuthService.start`: admin check through `BOARDS_FACADE`, 32-byte state, PKCE verifier stored encrypted in `jira_oauth_states` with `expiresAt = now + 10 min`, `code_challenge_method=S256`; e2e `returns the authorise URL with state and a PKCE S256 challenge and stores them for 10 minutes`, `is Admin only: 403 for a member, 404 for a stranger, 401 without a token, 400 for a bad id` | Met |
| `GET /jira/oauth/callback` validates `state`, exchanges the code, resolves the cloudId and stores tokens encrypted | `JiraOAuthService.callback`: single-use state bound to the caller, code exchange with the stored verifier, cloud id from `accessible-resources`, upsert with AES-256-GCM tokens; e2e `connects the board: PKCE verifier matches, tokens are stored encrypted and never returned` (checks the verifier hashes to the announced challenge), `replaces the credentials when the board is connected again` | Met |
| `GET /jira/connection` returns status; `DELETE /jira/connection` disconnects | `JiraConnectionService.getStatus` (any member, token-free view) and `disconnect` (Admin only); e2e `shows the status to any member without tokens, and lets only the Admin disconnect` | Met |
| Error branches from the diagram: user denies consent, invalid/expired state → 400 | e2e `turns a denied consent into 400, discards the state and stores nothing`, `rejects an unknown state with 400 and stores nothing`, `rejects an expired state with 400`, `cannot be replayed`, `rejects another user presenting the state …`; provider failures: rejected code → 400, Atlassian down → 502, no Jira site → 400 | Met |
| Unit tests plus a component test against a stubbed Atlassian token endpoint | Unit: `jira-oauth.service.spec.ts` (every branch above), `atlassian-oauth.http-client.spec.ts` (local stub server), `pkce.spec.ts` (RFC 7636 vector); component: `test/jira-oauth.e2e-spec.ts` runs the real app on PostgreSQL against an in-process stub of `auth.atlassian.com` and `api.atlassian.com` | Met |

## Runs on 2026-10-21 (`dev` at `69e1fb0`)

| Command | Result |
| --- | --- |
| `pnpm test` | 18 suites, 232 tests passed |
| `pnpm test:e2e` (PostgreSQL 16) | 5 suites, 79 tests passed (12 of them in `jira-oauth.e2e-spec.ts`) |
| `pnpm api:validate` | `docs/api/openapi.yaml` valid (44 operations); the four `/jira/oauth/*` and `/jira/connection` operations are documented without `x-implemented-in`, i.e. as implemented |

## Not verified here

- The flow against a real Atlassian site: it needs the OAuth app and sandbox from T-14, which require a team member's Atlassian account (see the checklist in [docs/jira-sandbox.md](../jira-sandbox.md)).
- The frontend page for `/jira/callback` is T-29; until then the callback is called manually (Swagger UI).
