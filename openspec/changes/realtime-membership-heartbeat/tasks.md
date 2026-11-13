## 1. Tests first (RED)

- [ ] 1.1 Add integration tests in `test/realtime.e2e-spec.ts` for every scenario of the delta spec (member removal, rejoin refused, role change keeps access, origin socket skipped, foreign socket id ignored, heartbeat values, unresponsive client, clean-up on close/timeout, `card.commented` over a socket) and verify the new behaviour tests fail on the current code
- [ ] 1.2 Add unit tests (listener eviction/exclusion, `MembersService.remove` publishes after commit, config validation of the ping values) and verify they fail

## 2. Implementation (GREEN)

- [ ] 2.1 Add `member.removed` to the domain events and publish it from `MembersService.remove` after the transaction; verify the unit test passes
- [ ] 2.2 Evict the removed user's sockets and deliver `member.removed` in the realtime listener; verify the removal e2e tests pass
- [ ] 2.3 Add the `X-Socket-Id` request context, CORS header and origin exclusion; verify the origin e2e tests pass
- [ ] 2.4 Add the `realtime` config namespace with validated ping settings and pass them to the adapter; verify the heartbeat e2e and config unit tests pass

## 3. Docs and gate

- [ ] 3.1 Document `member.removed`, `X-Socket-Id`, heartbeat, clean-up and role changes in `docs/api/ws-events.md` and the variables in `.env.example`; verify the WS contract unit test passes
- [ ] 3.2 Run typecheck, lint, unit, e2e, `pnpm api:validate` and `openspec validate --specs --strict`; all green
