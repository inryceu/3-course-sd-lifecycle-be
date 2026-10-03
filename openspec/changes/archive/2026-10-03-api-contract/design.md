## Context

Existing code exposes `/auth/register|login|refresh|logout|profile`, `/boards`, `/columns`, `/cards`, `/jira-sync/*` and a Socket.IO namespace `/realtime`. The frontend `endpoints.ts` calls routes that don't exist (`/boards/:id/columns`, `/columns/:id/cards`, `/labels`). The OAuth sequence diagram has the Atlassian redirect land on a frontend route which then calls the backend callback.

## Goals / Non-Goals

**Goals:** one contract both repos build against; stable operation ids for client generation; planned endpoints visible.
**Non-Goals:** implementing planned endpoints; versioning beyond `/api/v1`.

## Decisions

1. **OpenAPI 3.0.3, hand-written YAML in `docs/api/openapi.yaml`** (spec-first). The Nest Swagger output is not the source of truth; T-43 will compare it with the contract.
2. **Auth surface = `POST /auth/register`, `POST /auth/login`, `GET /auth/me`.** Refresh and logout are dropped: the current refresh implementation can never succeed, tokens last at most 1 h (NFR-SEC-1) and the frontend redirects to login on 401 (T-09). Auth responses: `{ accessToken, expiresIn, user }`.
3. **Resource routes**: `/boards`, `/boards/{boardId}`, `/boards/{boardId}/columns`, `/columns/{columnId}`, `/columns/{columnId}/reorder`, `/columns/{columnId}/cards`, `/cards/{cardId}`, `/cards/{cardId}/move`, `/cards/{cardId}/assignee`, `/boards/{boardId}/labels`, `/cards/{cardId}/labels/{labelId}`, `/cards/{cardId}/comments`, `/boards/{boardId}/members`, `/boards/{boardId}/members/{userId}`, `/notifications`. Cards are created under a column so the board is implicit and cannot be spoofed.
4. **Jira routes** under `/jira`: `GET /jira/oauth/start?boardId=` (returns `{ authorizeUrl }` as JSON rather than a 302, so the SPA can navigate and handle errors), `GET /jira/oauth/callback?code&state` (authenticated, 200 `{ connected, siteUrl }`, 400 on bad or expired state), `GET|DELETE /jira/connection?boardId=`, `POST /jira/import`, `GET|POST /jira/mappings`, `POST /jira/webhook` (public, secret-verified), `GET /jira/conflicts`.
5. **Errors**: one `Error` schema `{ statusCode, error, message, details? }`, matching Nest's default shape; reusable responses `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`.
6. **Pagination convention**: `limit` (1–100, default 50) and `cursor`; list responses `{ items, nextCursor }` for unbounded lists (notifications, conflicts, comments); small board-scoped lists return arrays.
7. **WebSocket**: Socket.IO on the HTTP port, namespace `/realtime`, JWT in `handshake.auth.token`, client emits `board:join` and `board:leave` with `{ boardId }`, server emits the event names from the ticket with payload `{ type, boardId, actorId?, origin, occurredAt, payload }`. The current `board:update` and `joinBoard` names are replaced.
8. **Type generation**: `openapi-typescript` in the frontend, reading a synced copy (`pnpm api:sync` copies from the sibling backend repo, `pnpm api:generate` is pure and deterministic).

## Risks / Trade-offs

- A hand-written spec can drift from code → every operation implemented in this branch has a test hitting the documented path and shape; T-43 adds full conformance checks later.
- Dropping refresh/logout changes behaviour for anyone using them → nothing in the frontend works with them today (the server side is broken).

## Migration Plan

Merge the docs first; implementations in later changes cite them. The frontend regenerates its types on its own branch.

## Open Questions

- Owner approval (Denys, Pavlo, Edward, Kyrylo) is pending and is tracked as a PR checklist.
