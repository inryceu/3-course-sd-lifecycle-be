## REST (docs/api/openapi.yaml)

- **10 tags**: health, auth, boards, columns, cards, labels, comments, members, jira, notifications
- **Shared `Error` schema**: `statusCode`, `error`, `message` (string|string[]), `details?`
- **Global `bearerAuth`** (HTTP Bearer, JWT); public ops override with `security: []` (health, register, login, jira/webhook)
- **Cursor pagination**: `limit` + `cursor` returning `{ items, nextCursor }`; small board-scoped lists return plain arrays
- **OAuth callback** `GET /jira/oauth/callback` is authenticated (bearer); `state` belongs to the caller, validated server-side

## WebSocket (docs/api/ws-events.md)

- **Transport**: Socket.IO v4, same port as REST, namespace `/realtime`
- **Handshake**: JWT in `auth.token` (`io('/realtime', { auth: { token } })`); invalid/expired → disconnect
- **Rooms**: `board:{boardId}` via `board:join` / `board:leave` ack; membership checked
- **Personal room**: every socket auto-joins `user:{userId}` for `notification.created`
- **Envelope**: `type`, `boardId`, `actorId?`, `origin: 'user' | 'jira'`, `occurredAt`, `payload`
- **Event types**: `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`, `notification.created`

## Spec validation

- CI runs `pnpm api:validate` on `docs/api/openapi.yaml`

## Frontend type generation (in frontend repo)

- `pnpm api:sync && pnpm api:generate` copies the spec and generates `src/api/api.generated.ts` (deterministic)
- Frontend CI runs `git diff --exit-code src/api/api.generated.ts` after generation to detect drift
- Documented in the backend and frontend READMEs

## Out of scope for this change

- No refresh endpoint
- No Redocly config
- No new endpoints or nested routes
- No type generation in backend