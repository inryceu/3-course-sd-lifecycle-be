## Purpose

Defines the persisted model of boards, columns, cards, labels, comments and memberships, including relations, uniqueness rules and entity behaviour that every board and card feature builds on.

## ADDED Requirements

### Requirement: Board model
The system SHALL persist boards, columns, cards, labels, comments and board memberships, with board roles `ADMIN`, `MEMBER` and `VIEWER` and column types `TODO`, `IN_PROGRESS`, `REVIEW` and `DONE`.

#### Scenario: Roles available
- **WHEN** a membership is stored
- **THEN** its role is one of the three board roles

### Requirement: Composition and cascade
A board SHALL own its columns, a column SHALL own its cards and a card SHALL own its comments, and deleting the parent SHALL delete all children.

#### Scenario: Delete a board
- **WHEN** a board with columns, cards, comments, labels and memberships is deleted
- **THEN** all of them are removed from the database

### Requirement: Labels and users
Cards and labels SHALL be linked many-to-many, a comment SHALL record its author, and a card SHALL optionally record its assignee, both by user identifier.

#### Scenario: One label on many cards
- **WHEN** a label is attached to two cards
- **THEN** both cards list it and deleting one card keeps the label

### Requirement: Jira issue key uniqueness
A card's `jiraIssueKey` SHALL be optional and, when set, unique within its board.

#### Scenario: Duplicate key on the same board
- **WHEN** two cards of the same board get the same issue key
- **THEN** the second write is rejected

#### Scenario: Same key on different boards
- **WHEN** cards on two different boards use the same issue key
- **THEN** both are accepted

#### Scenario: Many cards without a key
- **WHEN** several cards have no issue key
- **THEN** all are accepted

### Requirement: Ordering
Columns SHALL be ordered by a position within their board and cards by a position within their column.

#### Scenario: Read in order
- **WHEN** a board is read
- **THEN** columns and cards are returned sorted by position

### Requirement: Card movement rule
A card SHALL be movable only to a column of its own board.

#### Scenario: Cross-board move
- **WHEN** a card is moved to a column of another board
- **THEN** the operation is rejected and the card is unchanged

#### Scenario: Move within the board
- **WHEN** a card is moved to another column of its board
- **THEN** its column and position are updated

### Requirement: Edit capability by role
A membership SHALL allow editing only for roles `ADMIN` and `MEMBER`.

#### Scenario: Viewer
- **WHEN** a viewer's membership is asked whether it can edit
- **THEN** the answer is no

### Requirement: Reversible migration
The schema for the board model SHALL be created by a migration that applies to an empty database and reverts cleanly, with indexes for board and column lookups.

#### Scenario: Revert
- **WHEN** the migration is reverted
- **THEN** the board tables, enums and indexes it created are removed
