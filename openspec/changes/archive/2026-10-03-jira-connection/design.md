## Context

The sequence diagram (`05-sequence-oauth.puml`) has the Atlassian redirect land on the **frontend**, which then calls `GET /jira/oauth/callback?code&state` on the backend and receives `200 { connected, ... }` or `400`. Atlassian's 3LO endpoints: `https://auth.atlassian.com/authorize`, `https://auth.atlassian.com/oauth/token`, `https://api.atlassian.com/oauth/token/accessible-resources`. Config already carries client id/secret, redirect URI and scopes; the 32-byte `TOKEN_ENCRYPTION_KEY` exists.

## Goals / Non-Goals

**Goals:** a secure connect flow with state + PKCE, encrypted tokens, admin-only control, testable without internet.
**Non-Goals:** Jira REST calls, token refresh (T-23 Jira client), webhooks, the frontend callback page.

## Decisions

1. **Layout**: `domain/` (errors, `JiraConnectionStatus`), `application/` (`JiraOAuthService`, `JiraConnectionService`, ports `ATLASSIAN_OAUTH`, `TOKEN_CIPHER`), `infrastructure/` (`JiraConnection`, `JiraOAuthState` entities, `AtlassianOAuthHttpClient` adapter, `AesGcmTokenCipher`), `presentation/` (controller, DTOs).
2. **Authorisation** through `BOARDS_FACADE.getMemberRole`: start and disconnect require `ADMIN`; status requires any membership; non-members get 404. The callback is authenticated (the SPA calls it with its bearer token) and additionally requires `state.userId === currentUser.id`, so a leaked state is useless to another user.
3. **State and PKCE**: `state` = 32 random bytes (hex); `code_verifier` = 32 random bytes base64url; challenge = `S256`. Both persisted in `jira_oauth_states` with `expiresAt = now + 10 min` (a table, not memory, so restarts and multiple instances work). The verifier is encrypted with the same cipher. A state is single-use: it is deleted when the callback consumes it, even if the later exchange fails. Expired rows are purged opportunistically on each `start`.
4. **Callback outcomes**: unknown/expired/other-user state → 400; `error=access_denied` (or any `error`) → 400 with the provider error code and the state consumed; token endpoint 4xx → 400 "Jira authorisation failed"; network/5xx from Atlassian → 502; no accessible Jira site → 400. Success → 200 `{ connected: true, cloudId, siteUrl }` and an upsert on `boardId` (reconnecting replaces tokens).
5. **Cloud id**: first entry of `accessible-resources` whose `scopes` include `read:jira-work`; its `url` becomes `siteUrl`. Multi-site selection is a later enhancement.
6. **Encryption**: AES-256-GCM, 12-byte random IV, 16-byte tag, stored as `v1.<iv>.<tag>.<ciphertext>` base64url. `decrypt` throws a `TokenIntegrityError` on tag mismatch or wrong key. The key is read once from `crypto.tokenEncryptionKey`; a key not exactly 32 bytes aborts startup (already validated by config).
7. **No leakage**: the entity columns are `select: false` for token fields; responses use an explicit `JiraConnectionView` DTO (no tokens); the cipher and HTTP adapter never log values; HTTP errors log status and Atlassian error code only.
8. **Outbound HTTP** uses Node's global `fetch` with a 10 s `AbortSignal.timeout`; base URLs come from `jira.authBaseUrl` / `jira.apiBaseUrl`, which tests point at a local stub server. In production both must be `https` and the redirect URI must be `https` (config validation), covering NFR-SEC-3 for this flow.
9. **Scopes** default: `read:jira-work write:jira-work read:jira-user offline_access` (adds the missing `offline_access`; drops `manage:jira-webhook`, which is a Connect-app scope and invalid for OAuth 3LO classic scopes — webhooks are registered in T-26 with the scope that ticket needs).
10. **Existing stub removal**: `JiraSyncService`/controller (`/jira-sync/*`) are deleted; `JiraIssueMapping` and `SyncLog` entities stay with id columns instead of relations so later tickets keep their schema.

## Risks / Trade-offs

- Single-site selection can pick the wrong site for users with several → documented limitation.
- DB-stored state needs cleanup → purge on start, row count stays tiny.
- Atlassian ignores PKCE for confidential clients today; sending it is harmless and what the ticket asks for.

## Migration Plan

New tables `jira_connections` and `jira_oauth_states`; existing mapping and log tables get id columns in the same migration. Rollback drops the new tables and restores the relations.

## Open Questions

- Which scope list the Atlassian app is registered with (T-14, out of scope here); the app must include `offline_access`.

## Implementation notes (discovered while applying)

- The default scope list drops `manage:jira-webhook` (not a valid classic OAuth scope) and adds `offline_access`; tests assert the authorise URL.
- `jira_issue_mappings` keeps its unique `(board_id, jiraIssueKey)` rule as an index and loses its cross-module foreign keys, so deleting a card no longer cascades to its mapping; T-23 cleans mappings through events.
- Verified in the component test: the verifier sent to the token endpoint hashes (S256) to the `code_challenge` of the authorise URL, and the stored token columns contain neither the plaintext nor the provider's value.
