## Purpose

Provides a typed internal publish/subscribe channel for fan-out of board and card changes so that realtime delivery and Jira synchronisation can react without depending on the modules that produce the changes.

## ADDED Requirements

### Requirement: Typed domain events
The system SHALL define the events `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated` and `notification.created`, each carrying `boardId`, an optional `actorId`, an `origin` of `user` or `jira`, and the time it occurred.

#### Scenario: Event envelope
- **WHEN** a card is moved by a user
- **THEN** the published `card.moved` event contains the board id, the acting user id, origin `user` and a timestamp

#### Scenario: Event from Jira
- **WHEN** a change originates from a Jira webhook
- **THEN** the event carries origin `jira`

### Requirement: Publish after commit
Events SHALL be published only after the corresponding database change has been committed.

#### Scenario: Save fails
- **WHEN** persisting a card change fails
- **THEN** no event is published

#### Scenario: Save succeeds
- **WHEN** persisting succeeds
- **THEN** exactly one event is published after the save completed

### Requirement: Listener failures are isolated
A failing event listener SHALL NOT fail the request that published the event, and the failure SHALL be logged.

#### Scenario: Listener throws
- **WHEN** one listener throws while handling an event
- **THEN** the publishing request still succeeds and an error is logged

#### Scenario: Other listeners still run
- **WHEN** one listener fails
- **THEN** the remaining listeners still receive the event

### Requirement: Events only for fan-out
The event bus SHALL be used only to fan out notifications of changes; calls that need a result SHALL use direct injected ports, and the rule SHALL be documented.

#### Scenario: Documentation
- **WHEN** a developer reads the module-structure document
- **THEN** it states the fan-out-only rule with an example of a direct port call

### Requirement: Realtime delivery to board rooms
The realtime module SHALL deliver each event to clients that joined the room `board:{boardId}` using the event type as the message name, and SHALL NOT deliver it to other boards' rooms.

#### Scenario: Subscribed client
- **WHEN** a member has joined board A and an event for board A is published
- **THEN** the member receives the event with its envelope

#### Scenario: Other board
- **WHEN** an event for board B is published
- **THEN** a client that joined only board A receives nothing

### Requirement: Authenticated handshake and room access
Realtime connections SHALL require a valid access token in the handshake, and a client SHALL be admitted to a board room only if it may view that board.

#### Scenario: No token
- **WHEN** a client connects without a token
- **THEN** the connection is closed

#### Scenario: Joining a board the user cannot view
- **WHEN** an authenticated user requests to join a board they are not a member of
- **THEN** the request is rejected and the client receives no events for that board
