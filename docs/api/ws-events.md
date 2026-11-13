# BoardSync WebSocket contract

Companion to [`openapi.yaml`](./openapi.yaml). Real-time updates satisfy FR-11: every board member sees changes of others without reloading.

## Transport

- Socket.IO v4 on the **same HTTP port** as the REST API (no separate port).
- Namespace: **`/realtime`**. Default Socket.IO path (`/socket.io/`).
- Behind the full compose stack the browser connects to the web origin: `io('/realtime', { auth: { token } })`; in local dev `io('http://localhost:3000/realtime', { auth: { token } })`.

## Handshake

The access token (the same JWT used for REST) is sent in the handshake:

```ts
const socket = io(`${WS_ORIGIN}/realtime`, { auth: { token: accessToken } });
```

- Missing, invalid, expired or unknown-user token → the server closes the connection (client receives `connect_error`/`disconnect`).
- The token lifetime is at most one hour; when it expires the client must reconnect with a new token after logging in again.

## Rooms

A client receives events only for boards whose room it joined. Room name: **`board:{boardId}`**.

| Client → server | Payload | Result |
| --- | --- | --- |
| `board:join` | `{ "boardId": "<uuid>" }` | Ack `{ "ok": true }` and the socket joins the room, only if the user is a member of the board (any role). |
| `board:leave` | `{ "boardId": "<uuid>" }` | Ack `{ "ok": true }`. |

If the user may not view the board, the ack is `{ "ok": false, "error": "forbidden" }` and the socket does not join. Non-members and unknown boards are indistinguishable.

### Membership changes

- **Removal** (`DELETE /boards/{id}/members/{userId}`): every socket of the removed user leaves `board:{boardId}` immediately and receives no further events of that board. The `member.removed` event is sent to the board room and to the removed user's personal room `user:{userId}`; the removed user's client should leave the board view. A later `board:join` for that board is answered with `forbidden`.
- **Role change**: no effect on room membership, because every role (Admin, Member, Viewer) may view the board.

## Heartbeat and disconnect

- The server pings every client every `REALTIME_PING_INTERVAL_MS` (default **25000** ms) and closes a connection that does not answer within `REALTIME_PING_TIMEOUT_MS` (default **20000** ms). Socket.IO clients answer automatically; the values are announced in the handshake.
- On any disconnect (client close, network loss, ping timeout) the socket is removed from every room (`board:*`, `user:*`); the server keeps no other per-socket state. After reconnecting, the client must send `board:join` again.

## Server → client events

All events share one envelope. The Socket.IO event name equals `type`.

```jsonc
{
  "type": "card.moved",
  "boardId": "uuid",
  "actorId": "uuid",          // optional: user who caused the change; absent for system changes
  "origin": "user",           // "user" | "jira"
  "occurredAt": "2026-10-03T10:00:00.000Z",
  "payload": { }              // per type, below
}
```

### `origin`

- `user` — the change was made in BoardSync by a person.
- `jira` — the change came from Jira (webhook/import). Consumers must treat these identically for display, and the Jira outbound sync must **ignore** them to avoid sync loops.

### Event types

| `type` | When | `payload` |
| --- | --- | --- |
| `card.created` | A card was created or imported | `Card` (see `openapi.yaml`) |
| `card.updated` | Title, description, deadline, assignee or labels changed | `Card` |
| `card.moved` | A card changed column or position | `{ "card": Card, "fromColumnId": "uuid", "toColumnId": "uuid", "position": 0 }` |
| `card.commented` | A comment was added | `Comment` |
| `board.updated` | Board settings or columns changed (create, rename, retype, reorder, delete), or a card, label or comment was deleted — clients refetch the board | `{ "board": Board }` without `myRole` (it is per user; keep your own) |
| `notification.created` | A notification for one user was created | `{ "recipientId": "uuid", "notification": Notification }` |
| `member.removed` | An admin removed a member from the board | `{ "userId": "uuid" }` — the removed user |

`notification.created` is addressed to one user, so it is **not** sent to the board room: every authenticated socket is placed in the personal room `user:{userId}` on connect and receives it there. Its `boardId` is the board the notification is about.

`member.removed` goes to the board room (after the removed user's sockets left it) and to `user:{userId}` of the removed user.

Events with origin `jira` (webhook or import) and label/comment changes use the same types: label changes arrive as `card.updated` (labels assigned/unassigned) or `board.updated` (label deleted), comment deletion as `board.updated`. Creating or editing a label publishes no event (see the `labels-comments` spec).

## Skipping the originating socket

A client may send its own Socket.IO id (`socket.id`) in the **`X-Socket-Id`** header of a REST request. Events caused by that request are then **not** sent to that socket; the user's other sockets (other tabs) and other members still receive them. The header is ignored when the id does not belong to a socket of the authenticated user, so it cannot be used to silence someone else. Without the header every socket in the room receives the event.

## Client rules

- **Do not re-apply your own change.** Unless you send `X-Socket-Id`, the author also receives the event; compare `actorId` with the current user id and skip events from yourself that were already applied optimistically.
- Events are notifications of change, not a replay log. After reconnecting, refetch the board with `GET /boards/{id}`.
- Order is per-room best effort; use `occurredAt` and the entity's `updatedAt` to ignore stale updates.

## Delivery guarantees

At-most-once, in-process fan-out. A failing consumer never fails the request that produced the event. Persistent queues for Jira synchronisation are separate (Jira resilience ticket).

## Event name constants

The backend defines the names in `src/common/events/domain-events.ts`; the list above must match it.
