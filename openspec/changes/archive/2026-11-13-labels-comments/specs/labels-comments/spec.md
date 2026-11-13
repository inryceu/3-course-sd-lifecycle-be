## ADDED Requirements

### Requirement: Board labels
Board members SHALL list a board's labels; Members and Admins SHALL create, rename, recolor and delete them, and Viewers SHALL get 403. A label name SHALL be trimmed before validation and SHALL be unique per board; `color` SHALL be optional and default to `#3498db`.

#### Scenario: Label without a color
- **WHEN** a Member creates a label with body `{ "name": "bug" }`
- **THEN** the response is 201 and the label's `color` is a hex color

#### Scenario: Padded duplicate name
- **WHEN** the board already has `bug` and a label `"  bug  "` is created, or another label is renamed to `" bug"`
- **THEN** the response is 409

#### Scenario: Blank name
- **WHEN** the name is only whitespace
- **THEN** the response is 400

### Requirement: Labels on cards
Members and Admins SHALL attach a label of the same board to a card and detach it; a label from another board SHALL answer 404, and a change SHALL publish `card.updated`.

#### Scenario: Label from another board
- **WHEN** a label of board B is attached to a card of board A
- **THEN** the response is 404

### Requirement: Comments and their access
Members and Admins SHALL comment on a card, which publishes `card.commented` with `origin: 'user'`; a comment SHALL be deleted only by its author or a board Admin. A user who is not a member of the card's board, including a member who was removed after commenting, SHALL get 404 when listing or deleting comments, and the comment SHALL remain.

#### Scenario: Removed member deletes their old comment
- **WHEN** a member comments, is removed from the board, and then lists the comments or deletes that comment
- **THEN** both requests answer 404 and the comment still exists

#### Scenario: Stranger deletes a comment
- **WHEN** a user who never was a member deletes a comment
- **THEN** the response is 404, not 403

### Requirement: Comment paging
`GET /cards/{cardId}/comments` SHALL return comments oldest first as `{ items, nextCursor }`, ordered by `(createdAt, id)`. Following `nextCursor` SHALL return every comment of the card exactly once, also when comments share a timestamp and when the comment the cursor was taken from has been deleted. A malformed cursor, a cursor that is not one the server issued (such as a bare comment id) and a cursor issued for another card SHALL answer 400.

#### Scenario: Three pages without duplicates
- **WHEN** a card has 9 comments and the client pages with `limit=4`
- **THEN** the pages hold 4, 4 and 1 comments, each comment once, and the last `nextCursor` is `null`

#### Scenario: Cursor comment deleted between pages
- **WHEN** a card has 9 comments, the client reads the first 3 with `limit=3`, the third comment is deleted, and the client loads the next page with the returned cursor
- **THEN** the next page holds comments 4 to 6 and `nextCursor` is not `null`

#### Scenario: Unknown cursor
- **WHEN** the cursor is a well-formed UUID that the server never issued as a cursor
- **THEN** the response is 400, not an empty last page

#### Scenario: Cursor from another card
- **WHEN** a cursor returned for card A is sent when listing card B
- **THEN** the response is 400

### Requirement: Deletion events
Deleting a label or a comment SHALL publish `board.updated` with the payload `{ board: Board }`, the same shape as every other `board.updated`.

#### Scenario: Delete a label, then a comment
- **WHEN** a label and then a comment of the board are deleted
- **THEN** two `board.updated` events are published, each with `payload.board.id` equal to the board id
