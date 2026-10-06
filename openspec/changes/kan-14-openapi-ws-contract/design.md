## Context

BoardSync is a modular monolith (NestJS backend, React frontend, separate repos) with spec-driven development. The project requires a complete OpenAPI 3.0 specification and WebSocket event contract before any controller implementation. This contract will serve as the single source of truth for both repositories.

## Goals / Non-Goals

**Goals:**
- Define comprehensive OpenAPI 3.0 spec covering all REST domains
- Define WebSocket event contract with handshake, rooms, events, and origin tracking
- Establish shared components: error schema, bearer auth, pagination
- Document FE type generation command (openapi-typescript)
- Add OpenAPI linting (Redocly CLI)
- Get approval from all four module owners

**Non-Goals:**
- Implement any controllers, services, or business logic
- Generate actual FE types (documented command only)
- Create database migrations or entities

## Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| **OpenAPI 3.0 (not 3.1)** | Wide tooling support, NestJS Swagger module compatibility | OpenAPI 3.1 - rejected (less mature tooling) |
| **Single openapi.yaml (not split)** | Simpler CI validation, single source of truth, Redocly handles large specs | Split by module - rejected (cross-module refs, validation complexity) |
| **Tags per domain** | Maps to module boundaries: auth, boards, columns, cards, labels, comments, members, jira, notifications | Single tag - rejected (no organization) |
| **Shared components: Error, BearerAuth, Pagination** | DRY, consistent error responses, auth, and pagination across all endpoints | Inline per endpoint - rejected (maintenance burden, inconsistency) |
| **WebSocket contract in separate ws-events.md** | OpenAPI doesn't fully cover WS; separate doc is clearer | OpenAPI `webhooks` or `x-webhook` extensions - rejected (limited tooling) |
| **Room pattern: `board:{boardId}`** | Scalable, isolates board traffic, matches FR-11 real-time req | Global room - rejected (noise, security) |
| **Event origin: `user \| jira`** | Required for conflict detection (FR-13) and audit trail | No origin - rejected (can't distinguish sync source) |
| **openapi-typescript for FE generation** | Type-safe, generates TS types, CLI + programmatic API | orval, openapi-generator - rejected (openapi-typescript is lightweight, TS-native) |
| **Redocly CLI for linting** | Industry standard, CI-friendly, supports custom rules, bundles refs | spectral, vacuum - rejected (Redocly has better OpenAPI 3.0 support) |

## OpenAPI Structure

### Tags (Domains)
```
auth            - Registration, login, JWT refresh, me
boards          - CRUD boards, list user boards
columns         - CRUD columns within a board, reorder
cards           - CRUD cards, move, assign, update status
labels          - CRUD labels, assign to cards
comments        - CRUD comments on cards
members         - Board membership CRUD, roles (admin/member/viewer), invitations
jira            - Connect start/callback, status, disconnect, mapping, import, webhook, conflicts
notifications   - List, mark read, reminder preferences
```

### Shared Components (components/)
```
schemas:
  - ErrorResponse: { timestamp, status, error, message, path, details? }
  - PaginatedResponse<T>: { items: T[], total, page, pageSize, totalPages }
  - PageParams: { page?, pageSize? } (query)
  - CursorParams: { cursor?, limit? } (query)

securitySchemes:
  - BearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }

parameters:
  - BoardIdParam: path, required, string (uuid)
  - ColumnIdParam: path, required, string (uuid)
  - CardIdParam: path, required, string (uuid)
```

### Pagination Convention
- Offset-based for lists: `?page=1&pageSize=20` → `PaginatedResponse`
- Cursor-based for real-time feeds: `?cursor=...&limit=50`

### Error Response Convention
All error responses use `ErrorResponse` schema. HTTP status codes: 400, 401, 403, 404, 409, 422, 500.

## WebSocket Contract (ws-events.md)

### Handshake
- Connection: `wss://<API_HOST>/ws`
- After connect, client sends auth payload: `{ "type": "auth", "token": "<JWT>" }`
- Server validates JWT, extracts userId, joins user to their board rooms
- On auth failure: server sends `{ "type": "error", "code": 4001, "message": "Unauthorized" }` and closes

### Rooms
- `board:{boardId}` - user joins on board open, leaves on close
- User presence tracked per room

### Events (Server → Client)
| Event | Payload | Description |
|-------|---------|-------------|
| `card.created` | `{ card, origin: 'user' \| 'jira' }` | New card |
| `card.updated` | `{ card, origin: 'user' \| 'jira' }` | Card updated |
| `card.moved` | `{ cardId, fromColumnId, toColumnId, position, origin: 'user' \| 'jira' }` | Card moved |
| `card.commented` | `{ comment, origin: 'user' \| 'jira' }` | New comment |
| `board.updated` | `{ boardId, changes, origin: 'user' \| 'jira' }` | Board/column changes |
| `notification.created` | `{ notification }` | New notification (reminder, invite, conflict) |

### Origin Field
- `user` - action initiated by BoardSync user
- `jira` - action triggered by Jira webhook/sync
- Required for all card/board events to enable conflict detection (FR-13)

**Note:** All mutations (create/update/move/comment) go through REST API. WebSocket only broadcasts events.

## FE Type Generation

```json
// package.json script
"generate:types": "openapi-typescript docs/api/openapi.yaml -o src/generated/api-types.ts"
```
- Generates TypeScript types for all paths and components from OpenAPI spec
- Run in CI to detect contract drift
- Frontend consumes generated types from backend repo (or published package)

## OpenAPI Linting (Redocly)

```yaml
# .redocly.yaml
apis:
  main:
    root: docs/api/openapi.yaml
lint:
  extends: [recommended]
  rules:
    no-unused-components: error
    operation-singular-tag: error
    spec-components-invalid-map-name: error
```

Run: `redocly lint docs/api/openapi.yaml`

## Risks / Trade-offs

- [Risk] Large single openapi.yaml becomes hard to review → Mitigation: Use tags, Redocly bundling, per-domain review sessions
- [Risk] WS contract not machine-validatable like OpenAPI → Mitigation: Document thoroughly, review with all owners, consider AsyncAPI later
- [Risk] FE type generation depends on backend repo access → Mitigation: Publish types as npm package or use git submodule

## Migration Plan

1. Create `docs/api/openapi.yaml` with all domains and shared components
2. Create `docs/api/ws-events.md` with handshake, rooms, events
3. Add `.redocly.yaml` and `generate:types` script
4. Review with all four module owners (Pavlo, Edward, Denys, Kyrylo)
5. Incorporate feedback, get approvals
6. Archive change (specs synced to main)

## Open Questions

- Should WS events also have a machine-readable format (AsyncAPI) for future tooling?
- Exact JWT claim structure for WS handshake (sub, boardIds[]?)?
- Rate limiting headers in OpenAPI?
- Socket.IO or plain WebSocket (decision by realtime owner)?
- Where does the type generation script live: BE repo or FE repo?