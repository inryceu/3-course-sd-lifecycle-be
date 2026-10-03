## 1. Token vault

- [ ] 1.1 Restructure `jira-sync` to the standard layout; delete the `/jira-sync/*` stub controller and service; verify `pnpm build` passes and no cross-module entity import remains
- [ ] 1.2 Implement `AesGcmTokenCipher` behind the `TOKEN_CIPHER` port; verify unit tests: round trip, distinct IVs, tamper detection, wrong key
- [ ] 1.3 Add `JiraConnection` and `JiraOAuthState` entities (token columns `select: false`), convert mapping and sync-log entities to id columns, and generate the migration; verify apply and revert on Docker Postgres and that stored token columns contain no plaintext

## 2. OAuth flow

- [ ] 2.1 Implement `AtlassianOAuthHttpClient` (exchange code, accessible resources, timeout, no secret logging) behind `ATLASSIAN_OAUTH`; verify unit tests with a stub HTTP server
- [ ] 2.2 Implement `JiraOAuthService.start` (admin check through `BOARDS_FACADE`, state + PKCE, 10-minute TTL, purge expired); verify unit tests for roles and URL parameters
- [ ] 2.3 Implement `JiraOAuthService.callback` (single-use state, user match, denial, rejected code, no site, upsert encrypted tokens); verify unit tests for every error branch of the diagram
- [ ] 2.4 Implement `GET /jira/connection` and `DELETE /jira/connection` with a token-free view DTO; verify tests that responses never contain tokens
- [ ] 2.5 Add production HTTPS checks and `offline_access` default scope to config validation; verify config tests

## 3. Verification

- [ ] 3.1 Add a component test (Supertest + real Postgres + stub Atlassian server) covering start → callback → status → disconnect and the 400 branches; verify it passes
