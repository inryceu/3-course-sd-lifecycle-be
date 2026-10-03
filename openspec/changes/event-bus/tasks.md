## 1. Event bus

- [ ] 1.1 Add `@nestjs/event-emitter`; create typed events in `src/common/events/domain-events.ts`; verify typecheck and a unit test of the envelope fields
- [ ] 1.2 Implement `EVENT_PUBLISHER` port, emitter-based publisher and global `EventBusModule`; verify unit tests for publish/subscribe, listener error isolation (async and sync throw) and remaining listeners still running
- [ ] 1.3 Document the fan-out-only rule in `docs/architecture/module-structure.md`; verify the section exists

## 2. Realtime

- [ ] 2.1 Declare `BOARD_ACCESS` in `src/common/ports`; verify it imports no module
- [ ] 2.2 Rewrite `RealtimeGateway` (namespace `/realtime`, handshake through `AUTH_FACADE`, `board:join` / `board:leave` authorised through `BOARD_ACCESS`); verify unit tests: no token, invalid token, join denied, join allowed
- [ ] 2.3 Add `BoardEventsListener` broadcasting the six event types to `board:{boardId}`; verify unit test that other rooms receive nothing
- [ ] 2.4 Remove `RealtimeService`, `WsJwtGuard` and `WS_PORT` usage; verify `pnpm build` passes and no module imports realtime internals

## 3. Verification

- [ ] 3.1 Add an e2e test with two socket.io clients on one board and one on another; verify delivery and isolation
