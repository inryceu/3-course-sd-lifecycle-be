# Proposal

## Why

The BoardSync backend needs a reliable internal event bus to fan out board and card change notifications to the Realtime module (for WebSocket delivery to clients) and the Jira-Sync module (for bidirectional Jira synchronization). Currently, the event bus infrastructure exists but the Jira-Sync module does not subscribe to events, leaving a gap in the bidirectional sync architecture. This change formalizes the event bus capability and adds the missing Jira-Sync event listener.

## What Changes

- Formalize the **internal event bus** as a documented capability with typed domain events (`card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`, `notification.created`)
- Add **Jira-Sync event listener** that subscribes to board/card events and triggers outbound Jira synchronization
- Ensure all events carry `boardId`, optional `actorId`, `origin: 'user' | 'jira'`, and `occurredAt` for sync loop prevention
- Document the **fan-out-only usage rule**: events are for notifications only; direct module communication uses injected ports
- Verify **listener failure isolation**: a failing listener never fails the originating request and is logged

## Capabilities

### New Capabilities

- `event-bus`: Internal publish/subscribe channel for fan-out of board and card changes. Defines typed domain events, publishing guarantees, and subscriber isolation.

### Modified Capabilities

- `jira-sync`: Add requirement to subscribe to board/card events and trigger outbound Jira sync, filtering out `origin: 'jira'` events to prevent sync loops.
- `realtime`: Already subscribes; no requirement changes (confirming existing behavior matches spec).

## Impact

- **Code**: `src/common/events/` (event bus infrastructure — already implemented), `src/modules/jira-sync/application/` (new listener), `src/modules/realtime/application/board-events.listener.ts` (existing, confirmed)
- **APIs**: No public API changes; internal event contract only
- **Dependencies**: `@nestjs/event-emitter` (already in use)
- **Database**: No schema changes
- **Modules**: `jira-sync` imports `EventBusModule` (global) and registers `@OnEvent` handlers