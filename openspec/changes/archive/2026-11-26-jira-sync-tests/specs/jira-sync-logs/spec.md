## ADDED Requirements

### Requirement: Admin sync log list
The system SHALL let a board Admin list the board's sync log rows with `GET /jira/sync-logs?boardId=`, newest first, optionally filtered by `status` (`SUCCESS`, `FAILED`, `CONFLICT`), with keyset paging (`limit` 1 to 100, default 50, and the `cursor` returned as `nextCursor`). The system SHALL NOT offer an operation that replays a log row.

#### Scenario: Paging
- **WHEN** an Admin requests pages of two rows from a board with five rows
- **THEN** the pages hold the rows newest first without overlap and the last page has `nextCursor` null

#### Scenario: Status filter
- **WHEN** an Admin passes `status=FAILED`
- **THEN** only FAILED rows of that board are returned

#### Scenario: Not an Admin
- **WHEN** a member or a user outside the board calls the list
- **THEN** the response is 403

#### Scenario: Invalid query
- **WHEN** the status, limit or cursor is malformed
- **THEN** the response is 400

#### Scenario: Another board
- **WHEN** an Admin lists a board whose rows belong to other boards
- **THEN** none of those rows is returned
