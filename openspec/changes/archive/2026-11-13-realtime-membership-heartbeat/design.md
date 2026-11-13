## Context

`realtime` depends only on the event bus, `BOARD_ACCESS` and `AUTH_FACADE`; it never imports `boards`. Room access is checked once, on `board:join`. Socket.IO already removes a socket from all rooms when it disconnects, and the gateway keeps no per-socket maps (only `socket.data.userId`). Heartbeat runs with the library defaults (25 s / 20 s) and is not configured anywhere. See proposal.md for the gaps.

## Goals / Non-Goals

**Goals:** revoke room membership on member removal without a new dependency from `realtime` to `boards`; let a client opt out of its own echo safely; make the heartbeat explicit and testable.

**Non-Goals:** evicting sockets when a board is deleted (no events can follow), disconnecting a socket when its access token expires, presence, cross-instance fan-out (single process).

## Decisions

1. **Revocation through the event bus.** `MembersService.remove` publishes `member.removed` (payload `{ userId }`) after the transaction commits. The realtime listener calls `server.in('user:{userId}').socketsLeave('board:{boardId}')` first and then emits the event to both the board room and the user room (one `to([...])` call, so a socket in both gets it once). Alternative: the realtime module re-checks `BOARD_ACCESS` before every emit — rejected: a database query per event per socket.
2. **Role changes publish nothing.** All three roles can view, so no role change can revoke room access. Documented instead of adding an unused event.
3. **Origin socket via `X-Socket-Id` + `AsyncLocalStorage`.** A middleware stores the header in an `AsyncLocalStorage` for the request; services already `await publish(...)` inside the request, and the publisher runs listeners in the same async context, so the realtime listener can read the id without threading it through every service signature or putting socket ids into the event envelope. The listener excludes the socket only when it exists in the namespace and its `userId` equals the event's `actorId` — otherwise anyone could silence someone else's socket. Alternative: a field on the envelope set by every service — rejected: touches every publisher and leaks a transport detail into the domain event.
4. **Heartbeat in the adapter.** `RealtimeIoAdapter` already receives config from `configureApp`; it now also receives `pingInterval`/`pingTimeout` from a new `realtime` config namespace (`REALTIME_PING_INTERVAL_MS`, `REALTIME_PING_TIMEOUT_MS`, Joi positive integers with defaults). The e2e environment uses short values so a dead client is detected within a test.
5. **Clean-up stays the library's.** No per-socket state is added; tests assert that rooms are empty after a client close and after a ping timeout.

## Risks / Trade-offs

- [A `board:join` whose access check passed just before the removal commits can still join after the eviction] → window is one query long; documented with a `ponytail:` comment, upgrade path is re-checking access after `join`.
- [`X-Socket-Id` needs CORS] → added to `allowedHeaders`.
- [Short e2e heartbeat] → only in the test environment defaults; production keeps the library defaults.

## Migration Plan

No data migration. Both new variables are optional. Frontend can adopt `member.removed` and `X-Socket-Id` independently; without them it behaves as before (except that a removed user no longer receives the board's events).
