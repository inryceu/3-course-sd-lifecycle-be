## Why

BoardSync is developed spec-first across two repositories. No REST or WebSocket contract exists, so the frontend ships a one-endpoint stub and hand-written types that already disagree with the backend (`/auth/profile` vs planned `/auth/me`, `/columns/:id/cards` vs `/cards`, WebSocket path vs namespace). T-05 requires the contract before more controllers are written.

## What Changes

- Add `docs/api/openapi.yaml` (OpenAPI 3.0.3) covering auth, boards, columns, cards (create/update/move/assign), labels, comments, members/roles, Jira (connect start/callback, status, disconnect, mapping, import, webhook, conflicts) and notifications, with a shared error schema, bearer-auth scheme and pagination parameters defined once.
- Add `docs/api/ws-events.md` defining the JWT handshake, rooms `board:{boardId}`, events `card.created|updated|moved|commented`, `board.updated`, `notification.created` and the payload with `origin: user | jira`.
- Document the command that generates frontend types from the spec; the frontend repo keeps a synced copy and a deterministic `api:generate`.
- Mark endpoints not implemented yet with `x-implemented-in: T-<n>` so later conformance checks (T-43) know the target.
- Contract approval by the four module owners is recorded as a checklist in the PR (it cannot be self-approved).

## Capabilities

### New Capabilities

- `api-contract`: the REST and WebSocket contract and the rules for keeping it the single source of truth.

### Modified Capabilities

- None.

## Impact

- New docs in the backend; the frontend consumes them through generated types (see the frontend PR).
- Implementations in this branch (auth, boards, columns, cards, Jira OAuth) are built to match it; the rest is `planned`.
