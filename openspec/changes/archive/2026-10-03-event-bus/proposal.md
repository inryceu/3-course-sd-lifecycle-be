## Why

The component diagram allows an internal event bus for exactly one purpose: fanning out "card changed" notifications to `realtime` and `jira-sync` without direct dependencies and without sync loops (T-10). Today nothing publishes events, `RealtimeService` is never called by any other code, and the realtime gateway exposes broadcast methods that services would need to import (a forbidden dependency).

## What Changes

- Typed events `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`, `notification.created`, each carrying `boardId`, optional `actorId`, `origin: 'user' | 'jira'` and an `occurredAt` timestamp.
- `EVENT_PUBLISHER` port with an implementation on `@nestjs/event-emitter`, in the shared kernel (`src/common/events`).
- Publishing happens after the database commit; a failing listener never fails the originating request and is logged.
- Usage rule documented: events only for fan-out, everything else is a direct DI call through a port.
- `realtime` subscribes to the bus and broadcasts to rooms `board:{boardId}`; handshake uses `AUTH_FACADE`; joining a room is authorised through the `BOARD_ACCESS` port.

## Capabilities

### New Capabilities

- `event-bus`: typed, failure-isolated fan-out events and the realtime delivery built on them.

### Modified Capabilities

- None.

## Impact

- New `src/common/events/*` and `src/common/ports/*`; `realtime` module rewritten around the bus; `@nestjs/event-emitter` dependency added.
- Event emission points are added by the boards change (`card.*`, `board.updated`); Jira and notification emitters arrive with later tickets.
