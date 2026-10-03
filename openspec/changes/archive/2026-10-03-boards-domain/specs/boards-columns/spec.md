## Purpose

Lets team members create and manage kanban boards and their columns with correct role-based permissions, and work with cards on those boards (FR-03, FR-04).

## ADDED Requirements

### Requirement: Create a board
The system SHALL create a board with the default columns To Do, In Progress and Done, make the creator its Admin, and do all of it atomically.

#### Scenario: New board
- **WHEN** an authenticated user creates a board with a title
- **THEN** the response is 201 with the board, three columns in order To Do, In Progress, Done, and the user is its Admin

#### Scenario: Failure leaves nothing behind
- **WHEN** creating the default columns fails
- **THEN** no board and no membership exist afterwards

### Requirement: Board visibility
Boards SHALL be visible only to their members, and a non-member SHALL get the same response as for a board that does not exist.

#### Scenario: List
- **WHEN** a user lists boards
- **THEN** only boards they belong to are returned

#### Scenario: Stranger
- **WHEN** a user reads a board they do not belong to
- **THEN** the response is 404

#### Scenario: Board with columns and cards
- **WHEN** a member reads a board
- **THEN** the response contains columns ordered by position, each with its cards ordered by position

### Requirement: Board administration
Only a board Admin SHALL change board settings or delete the board.

#### Scenario: Member renames
- **WHEN** a member who is not Admin updates the board title
- **THEN** the response is 403

#### Scenario: Admin deletes
- **WHEN** the Admin deletes the board
- **THEN** the board and everything it owns are removed and later reads return 404

### Requirement: Column management
Only a board Admin SHALL create, rename, retype, reorder or delete columns, and column positions SHALL stay consistent.

#### Scenario: Add a column
- **WHEN** the Admin adds a column
- **THEN** it is appended at the end unless a position is given, and positions remain 0..n-1 without gaps or duplicates

#### Scenario: Non-admin edits structure
- **WHEN** a member or viewer changes columns
- **THEN** the response is 403

### Requirement: Minimum column count
A board SHALL always keep at least three columns.

#### Scenario: Deleting the third column
- **WHEN** the Admin deletes a column of a board that has exactly three columns
- **THEN** the response is 409 and the column remains

### Requirement: Non-empty column deletion
A column that still holds cards SHALL NOT be deleted.

#### Scenario: Column with cards
- **WHEN** the Admin deletes a column that contains cards while the board has more than three columns
- **THEN** the response is 409 and nothing is removed

### Requirement: Transactional reordering
Reordering a column SHALL be atomic and SHALL keep positions consistent even when several reorders arrive concurrently.

#### Scenario: Move a column
- **WHEN** the Admin moves column 3 to position 0
- **THEN** it becomes first, the others shift by one and positions are 0..n-1

#### Scenario: Concurrent reorders
- **WHEN** two reorder requests for the same board run at the same time
- **THEN** both complete and the final positions are 0..n-1 without duplicates

#### Scenario: Position out of range
- **WHEN** the requested position is negative or beyond the last index
- **THEN** the response is 400 and nothing changes

### Requirement: Card access by role
Members and Admins SHALL create, edit, move and delete cards on their board, Viewers SHALL only read, and non-members SHALL see 404.

#### Scenario: Viewer edits
- **WHEN** a viewer creates or moves a card
- **THEN** the response is 403

#### Scenario: Create under a column
- **WHEN** a member posts a card to `POST /columns/{columnId}/cards`
- **THEN** the card is appended to that column and the board is derived from the column

### Requirement: Card moves keep columns consistent
Moving a card SHALL update positions in both the source and the target column atomically, leaving 0..n-1 positions in each.

#### Scenario: Move between columns
- **WHEN** a card moves from column A to position 1 of column B
- **THEN** column A closes the gap and column B shifts cards at or after position 1

### Requirement: Change events
Creating, updating or moving a card and changing board structure SHALL publish `card.created`, `card.updated`, `card.moved` or `board.updated` after the change is committed.

#### Scenario: Move publishes once
- **WHEN** a card move commits
- **THEN** one `card.moved` event with origin `user` is published
