# Design

## Context

The internal event bus infrastructure (`EventBusModule`, `EventEmitterPublisher`, typed domain events in `src/common/events/`) is already implemented and tested. The Boards module publishes `card.*` and `board.updated` events after database commits. The Realtime module subscribes via `@OnEvent` and delivers to `board:{boardId}` WebSocket rooms. The Jira-Sync module currently only publishes (future webhook) but does not subscribe — this is the gap.

Event envelope: `{ type, boardId, actorId?, origin: 'user'|'jira', occurredAt, payload }`. The `origin` field enables sync loop prevention.

Module boundaries: `jira-sync` must not import `boards-cards` repositories directly. Cross-module communication uses injected ports (`BOARDS_FACADE`) or the event bus (fan-out only).

## Goals / Non-Goals

**Goals:**
- Add `BoardEventsListener` in `jira-sync` that subscribes to `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`
- Filter out `origin: 'jira'` events to prevent sync loops
- Use `boardId` to look up Jira connection and issue mapping
- Reuse existing `JiraConnectionService`, `ATLASSIAN_OAUTH` port for outbound calls
- Keep module isolation: no direct repository access across modules

**Non-Goals:**
- Implement Jira webhook endpoint (separate change)
- Change existing event bus infrastructure
- Modify Realtime module behavior
- Add new event types

## Decisions

### 1. Listener location: `src/modules/jira-sync/application/board-events.listener.ts`

**Rationale:** Mirrors `realtime` module's `BoardEventsListener` pattern. Keeps event handling separate from OAuth/connection logic.

**Alternative considered:** Add handlers inside `JiraConnectionService` — rejected because it mixes concerns (connection management vs. event-driven sync).

### 2. Sync loop prevention: filter by `event.origin === 'jira'` at listener entry

**Rationale:** Simple, explicit, matches event-bus spec requirement. The `origin` field is already part of the envelope.

**Alternative considered:** Track sync state in database — rejected as over-engineering; `origin` is sufficient.

### 3. Jira connection lookup: by `boardId` via `JiraConnectionService`

**Rationale:** `JiraConnectionService` already provides `getConnection(boardId)` and `getIssueMapping(boardId, localCardId)`. Reuses existing port.

**Alternative considered:** Embed connection info in event payload — rejected; couples event to Jira internals, violates fan-out-only rule.

### 4. Error handling: log and continue; don't retry in listener

**Rationale:** Matches event-bus spec: "listener failures are isolated". Failed syncs are logged; reconciliation can be handled by a separate scheduled job (future).

**Alternative considered:** Retry with backoff in listener — rejected; would block event bus, violate isolation guarantee.

### 5. Register listener in `JiraSyncModule` providers array

**Rationale:** Standard NestJS pattern. `EventBusModule` is global, so `EventEmitter2` is available for `@OnEvent`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Jira API rate limits during burst of events | Outbound calls use existing `ATLASSIAN_OAUTH` HTTP client; rate limiting handled there. Listener is fire-and-forget. |
| Event published but Jira sync fails silently | Listener logs error with `boardId`, `cardId`, event type. Future: add `SyncLogEntity` entry for observability. |
| `boardId` in event doesn't map to Jira connection | Listener checks connection existence; logs warning and skips. No crash. |
| Multiple rapid events for same card cause duplicate Jira calls | Idempotency handled by Jira API (issue key update is idempotent). Transition calls may duplicate; acceptable for MVP. |
| Listener throws sync error crashes Node process | `@nestjs/event-emitter` catches listener errors; `EventEmitterPublisher` wraps in `Promise.allSettled` — already tested. |

## Migration Plan

1. Create `board-events.listener.ts` in `jira-sync/application/`
2. Add listener to `JiraSyncModule` providers
3. Run existing tests (`pnpm test`) — should pass
4. Add unit tests for listener (filtering, connection lookup, error handling)
5. Verify `pnpm build`, `pnpm lint`, `pnpm typecheck` pass

No database migration needed. No breaking changes to public APIs.

## Open Questions

- Should `notification.created` also trigger Jira sync? (Spec says yes; currently only Realtime handles it. Defer to implementation.)
- Should failed syncs be persisted for retry? (Current design: log only. Reconciliation job is future work.)