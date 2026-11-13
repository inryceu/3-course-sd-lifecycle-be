## Why

KAN-38 (T-27, FR-11) asks for a realtime gateway with membership-checked rooms, origin-aware fan-out, heartbeat and clean-up. The gateway, handshake auth, `board:{boardId}` rooms and fan-out exist, but checking the acceptance criteria against the code shows three gaps: a member removed from a board keeps receiving its events until they reconnect (room membership is only checked on `board:join`), the author's own socket always receives the echo of its change, and the heartbeat is the undocumented Socket.IO default.

## What Changes

- Removing a member (`DELETE /boards/{id}/members/{userId}`) publishes a new domain event `member.removed`; the realtime module immediately removes every socket of that user from `board:{boardId}` and delivers the event to the board room and to the removed user's personal room, so the client can leave the board view.
- A client MAY send the `X-Socket-Id` header (its own Socket.IO id) on REST calls; the resulting board events are then not sent back to that socket. The header is honoured only when the socket belongs to the authenticated author. Without the header nothing changes (clients still dedupe by `actorId`).
- Heartbeat interval and timeout are configurable (`REALTIME_PING_INTERVAL_MS`, default 25000; `REALTIME_PING_TIMEOUT_MS`, default 20000), validated at start-up and documented; a client that stops answering pings is disconnected and removed from all rooms.
- `docs/api/ws-events.md` documents `member.removed`, the `X-Socket-Id` rule, heartbeat and disconnect clean-up; role changes are documented as not affecting room access (every role can view).
- Verified: every event published on `dev` (`card.*`, `board.updated`, `notification.created`, including label/comment and Jira-origin changes) is already subscribed and documented; an integration test now covers `card.commented` over a real socket.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `event-bus`: adds the `member.removed` event, origin-socket exclusion, room revocation on member removal, heartbeat and disconnect clean-up.

## Impact

- Code: `src/common/events/domain-events.ts`, `src/modules/boards/application/members.service.ts`, `src/modules/realtime/**`, `src/app.setup.ts` (CORS header, adapter options), `src/config/*` (two optional variables).
- Docs: `docs/api/ws-events.md`, `.env.example`. `openapi.yaml` is unchanged, so the frontend's generated REST types are unaffected.
- No migration, no new dependency.
