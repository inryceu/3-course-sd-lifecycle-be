# Spec Delta

## Purpose

Subscribes to internal domain events to trigger outbound Jira synchronization, ensuring bidirectional sync without creating direct module dependencies or sync loops.

## ADDED Requirements

### Requirement: Subscribe to card and board events

The Jira-Sync module SHALL subscribe to `card.created`, `card.updated`, `card.moved`, `card.commented`, and `board.updated` events from the internal event bus.

#### Scenario: Card created event received

- **WHEN** a `card.created` event is published with `origin: 'user'`
- **THEN** the Jira-Sync module triggers creation of a corresponding Jira issue

#### Scenario: Card updated event received

- **WHEN** a `card.updated` event is published with `origin: 'user'`
- **THEN** the Jira-Sync module triggers update of the corresponding Jira issue

#### Scenario: Card moved event received

- **WHEN** a `card.moved` event is published with `origin: 'user'`
- **THEN** the Jira-Sync module triggers transition of the corresponding Jira issue to the mapped status

#### Scenario: Card commented event received

- **WHEN** a `card.commented` event is published with `origin: 'user'`
- **THEN** the Jira-Sync module triggers addition of a comment to the corresponding Jira issue

#### Scenario: Board updated event received

- **WHEN** a `board.updated` event is published with `origin: 'user'`
- **THEN** the Jira-Sync module triggers update of the corresponding Jira project metadata if applicable

### Requirement: Ignore Jira-originated events to prevent sync loops

The Jira-Sync module SHALL ignore all events carrying `origin: 'jira'` to prevent infinite synchronization loops.

#### Scenario: Jira-originated card updated event received

- **WHEN** a `card.updated` event is published with `origin: 'jira'`
- **THEN** the Jira-Sync module does not trigger any outbound Jira API call

#### Scenario: Jira-originated card moved event received

- **WHEN** a `card.moved` event is published with `origin: 'jira'`
- **THEN** the Jira-Sync module does not trigger any outbound Jira API call

### Requirement: Use boardId for Jira connection lookup

The Jira-Sync module SHALL use the `boardId` from the event envelope to look up the associated Jira connection and issue mapping.

#### Scenario: Valid board with Jira connection

- **WHEN** an event for a board with an active Jira connection is received
- **THEN** the module uses that connection's credentials for the outbound API call

#### Scenario: Board without Jira connection

- **WHEN** an event for a board without a Jira connection is received
- **THEN** the module logs a warning and skips synchronization for that event