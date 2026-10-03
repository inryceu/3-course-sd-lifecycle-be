## Why

FR-02 lets a board Admin connect a Jira Cloud workspace through OAuth 2.0 (3LO), and NFR-SEC-2 requires the tokens to be encrypted at rest. The current `jira-sync` module is a stub (`syncCardToJira` only logs), its entities reference board/card/user entities from other modules, its endpoints have no authorisation and no token storage exists (T-15, T-16).

## What Changes

- `jira-sync` module in the standard layout, depending only on `AUTH_FACADE` and `BOARDS_FACADE`.
- `JiraConnection` entity and migration: cloud id, site URL, linked board, encrypted access and refresh tokens, expiry, scopes, connecting user.
- `TokenCipher` with AES-256-GCM, a random IV per value and the key from configuration; tamper and wrong-key detection; tokens never in logs or responses.
- OAuth flow: `GET /jira/oauth/start` (board Admin only; returns authorise URL with `state` and PKCE `code_challenge`, state and verifier stored with a 10-minute TTL), `GET /jira/oauth/callback` (validates state, exchanges code, resolves cloud id, stores encrypted tokens), `GET /jira/connection`, `DELETE /jira/connection`.
- Error branches from the sequence diagram: consent denied and invalid or expired state return 400.
- **BREAKING**: remove the stub endpoints `/jira-sync/*` (map, card, board, sync) which had no authorisation; mapping and sync arrive with T-23–T-26. Mapping and sync-log entities are kept but reference boards and cards by id only.
- Component test against a stubbed Atlassian token endpoint.

## Capabilities

### New Capabilities

- `jira-token-vault`: encrypted storage of Jira credentials and the connection record.
- `jira-oauth-connection`: connect, inspect and disconnect a Jira workspace for a board through OAuth 2.0 (3LO) with PKCE.

### Modified Capabilities

- None.

## Impact

- `src/modules/jira-sync/**`, new migration, config (`jira.authBaseUrl`, `jira.apiBaseUrl`, `offline_access` scope, HTTPS-only redirect in production), frontend callback page is a separate ticket (T-29).
- `JIRA_REDIRECT_URI` now points at the frontend route (`/jira/callback`) as the sequence diagram shows.
