## MODIFIED Requirements

### Requirement: Typed domain events
The system SHALL define the events `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`, `notification.created` and `member.removed`, each carrying `boardId`, an optional `actorId`, an `origin` of `user` or `jira`, and the time it occurred.

#### Scenario: Event envelope
- **WHEN** a card is moved by a user
- **THEN** the published `card.moved` event contains the board id, the acting user id, origin `user` and a timestamp

#### Scenario: Event from Jira
- **WHEN** a change originates from a Jira webhook
- **THEN** the event carries origin `jira`

#### Scenario: Member removed
- **WHEN** a board admin removes a member from a board
- **THEN** a `member.removed` event is published after the removal is committed, with the board id, the admin as actor and the removed user's id in the payload

### Requirement: Realtime delivery to board rooms
The realtime module SHALL deliver each event to clients that joined the room `board:{boardId}` using the event type as the message name, and SHALL NOT deliver it to other boards' rooms. When the request that caused the event names the author's own socket in the `X-Socket-Id` header, that socket SHALL NOT receive the event; the header SHALL be ignored when the named socket does not belong to the event's actor.

#### Scenario: Subscribed client
- **WHEN** a member has joined board A and an event for board A is published
- **THEN** the member receives the event with its envelope

#### Scenario: Other board
- **WHEN** an event for board B is published
- **THEN** a client that joined only board A receives nothing

#### Scenario: Originating socket skipped
- **WHEN** a user changes a card with `X-Socket-Id` set to the id of their own socket that joined the board
- **THEN** that socket does not receive the resulting event while the user's other sockets and other members do

#### Scenario: Foreign socket id ignored
- **WHEN** a user sends `X-Socket-Id` with the id of another user's socket
- **THEN** that other user's socket still receives the event

## ADDED Requirements

### Requirement: Room access revoked on member removal
When a member is removed from a board, every socket of that user SHALL leave `board:{boardId}` immediately and SHALL receive no further events of that board; the `member.removed` event SHALL be delivered to the board room and to the removed user's personal room `user:{userId}`. Changing a member's role SHALL NOT change room membership, because every role may view the board.

#### Scenario: Removed member stops receiving events
- **WHEN** a member with a socket in `board:{boardId}` is removed by an admin and a card on that board then changes
- **THEN** the removed member's socket receives `member.removed` and does not receive the card event, while the remaining members do

#### Scenario: Rejoin refused
- **WHEN** the removed member sends `board:join` for that board
- **THEN** the ack is `{ ok: false, error: "forbidden" }`

#### Scenario: Role change keeps access
- **WHEN** an admin changes a member's role to Viewer
- **THEN** the member's sockets stay in the board room and keep receiving its events

### Requirement: Heartbeat
The realtime server SHALL ping every connected client at an interval set by `REALTIME_PING_INTERVAL_MS` (default 25000) and SHALL close a connection that does not answer within `REALTIME_PING_TIMEOUT_MS` (default 20000). Both values SHALL be positive integers validated at start-up and documented in the WebSocket contract.

#### Scenario: Configured values reach the client
- **WHEN** a client connects
- **THEN** the handshake announces the configured ping interval and timeout

#### Scenario: Unresponsive client
- **WHEN** a connected client stops answering pings
- **THEN** the server closes the connection after the interval plus the timeout

#### Scenario: Invalid value
- **WHEN** `REALTIME_PING_INTERVAL_MS` is not a positive integer
- **THEN** the application refuses to start

### Requirement: Clean-up on disconnect
When a socket disconnects for any reason (client close, ping timeout), the server SHALL remove it from every room, including `board:{boardId}` and `user:{userId}`, and SHALL keep no per-socket state for it.

#### Scenario: Client disconnects
- **WHEN** a client that joined a board room disconnects
- **THEN** neither the board room nor the user room contains the socket afterwards

#### Scenario: Ping timeout
- **WHEN** a client is disconnected by the heartbeat
- **THEN** it is no longer in any room
