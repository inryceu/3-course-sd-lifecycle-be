## Why

BoardSync follows a spec-first approach: REST and WebSocket contracts must be agreed before any controller implementation begins. This enables backend and frontend (two separate repositories) to be built in parallel and verified against the same source of truth. Without a shared OpenAPI 3.0 spec and WebSocket event contract, teams risk integration drift, mismatched types, and rework.

## What Changes

- Create `docs/api/openapi.yaml` covering all REST endpoints for: auth, boards, columns, cards (create/update/move/assign), labels, comments, members/roles, Jira integration (connect start/callback, status, disconnect, mapping, import, webhook, conflicts), and notifications
- Define shared components once: error schema, bearer-auth scheme, pagination conventions
- Create `docs/api/ws-events.md` defining: JWT handshake, rooms `board:{boardId}`, events `card.created|updated|moved|commented`, `board.updated`, `notification.created`, payload with `origin: user | jira`
- Document a command to generate FE types/client from the spec (using openapi-typescript)
- Add linting for OpenAPI spec (Redocly CLI)
- Deliver as an OpenSpec change proposal approved by all four module owners

## Capabilities

### New Capabilities

- `contracts/openapi`: OpenAPI 3.0 specification for all REST endpoints
- `contracts/ws-events`: WebSocket event contract specification
- `contracts/fe-generation`: Documented command to generate FE types/client from spec
- `contracts/linting`: Redocly CLI configuration for OpenAPI validation

### Modified Capabilities

- None (greenfield contract definition)

## Impact

- New files: `docs/api/openapi.yaml`, `docs/api/ws-events.md`, `.redocly.yaml` (or similar lint config)
- New documented command in package.json or Makefile for FE type generation
- No functional code changes - contract definition only
- Enables parallel BE/FE development with type-safe contracts
- All four module owners (Pavlo, Edward, Denys, Kyrylo) must approve the contract