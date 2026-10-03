## Context

`RealtimeGateway` verifies JWTs itself with `JwtService`, keeps its own connection map and exposes `broadcastToBoard`; `RealtimeService` wraps it but nobody calls it. `joinBoard` joins any room without checking access. Event names in the code (`board:update`, `card.created` inside a payload type) differ from the contract in `docs/api/ws-events.md`.

## Goals / Non-Goals

**Goals:** one publish port, typed events, isolation of listener failures, a realtime module that depends only on the bus, the auth port and a board-access port.
**Non-Goals:** durable queues or retries (listener failures are logged and dropped), the Jira listeners (T-25/T-26), notifications content (T-32).

## Decisions

1. **Shared kernel location** `src/common/events`: the bus is used by several modules, none may own it. It contains `domain-events.ts` (types and the `EventOrigin` union), `event-publisher.port.ts` (`EVENT_PUBLISHER` token + interface), `event-emitter.publisher.ts` and `event-bus.module.ts` (`@Global`).
2. **Event shape** `{ type, boardId, actorId?, origin, occurredAt, payload }` with a per-type payload type; `type` doubles as the emitter event name so `@OnEvent('card.moved')` is strongly typed through a map `EventPayloads`.
3. **`publish` never throws.** It calls `emitAsync` and swallows/logs both a rejected listener and a synchronous throw. The caller `await`s it after its transaction, so listener latency is bounded by the slowest listener but a failure is invisible to the request.
4. **After-commit rule.** Services publish only after `save()`/`transaction()` resolved; a service that publishes inside a transaction callback is a review failure. A unit test proves no event is published when the save rejects.
5. **Anti-loop**: `origin` is part of every event. The (later) Jira outbound listener ignores `origin: 'jira'`; the inbound handler publishes with `origin: 'jira'`.
6. **Realtime** (`src/modules/realtime`): the gateway authenticates the handshake with `AUTH_FACADE.verifyToken` and disconnects otherwise; `board:join` checks `BOARD_ACCESS.canView(userId, boardId)` before `socket.join('board:<id>')`; a `BoardEventsListener` subscribes to the six event types and emits to the room with the same name and the full envelope. The author is **not** excluded server-side because the contract tells clients to dedupe by `actorId`.
7. **`BOARD_ACCESS`** is declared in `src/common/ports` and implemented by the boards module, so `realtime → boards` is avoided (documented in module-boundaries).
8. **Server on the HTTP port**; namespace `/realtime`; the separate `WS_PORT` is dropped.

## Risks / Trade-offs

- In-process, non-durable events can be lost on crash → acceptable for UI fan-out; Jira sync gets its own queue with persistence in T-35.
- `@Global` module hides the dependency → mitigated by lint rule that only `common/events` types are imported, and the port token is explicit.

## Migration Plan

No data. Frontend switches to the namespace and event names from the contract.

## Open Questions

- None.
