# jira-issue-import Specification

## Purpose
Lets a board Admin link a connected board to a Jira project, map the project's statuses to board columns, and import its open issues as cards idempotently (FR-05, T-24); the mapping is what two-way sync (T-25, T-26) builds on.

## Requirements

### Requirement: Link a board to a Jira project
The system SHALL let the board Admin link a connected board to one Jira project by key. The key SHALL match the Jira key format (`^[A-Z][A-Z0-9_]{1,9}$`) and SHALL name a project the connection can read; it is stored as the board's `jiraProjectKey`.

#### Scenario: Link through the import request
- **WHEN** the Admin calls `POST /jira/import` with `{ boardId, projectKey: "KAN" }` for a connected board
- **THEN** the board's `jiraProjectKey` becomes `KAN` and the import runs for that project

#### Scenario: Unknown or malformed project
- **WHEN** the project key is malformed, or Jira reports that the project does not exist
- **THEN** the response is 400 and the stored key is unchanged

#### Scenario: Board not connected
- **WHEN** the board has no Jira connection
- **THEN** import and mapping requests answer 409 with a message to connect Jira first

### Requirement: Status to column mapping with defaults
The system SHALL store, per board, which column each status of the linked Jira project maps to. Statuses without a stored mapping SHALL get a default from their Jira status category: `new` → the board's first `TODO` column, `indeterminate` → the first `IN_PROGRESS` column, `done` → the first `DONE` column, falling back to the board's first column when no column of that type exists. Defaults SHALL be marked as such in the response.

#### Scenario: Read the mapping
- **WHEN** a board member calls `GET /jira/status-mappings?boardId=`
- **THEN** every status of the linked project is returned once with `jiraStatusId`, `jiraStatusName`, `statusCategory`, `columnId` and `isDefault`

#### Scenario: Save the mapping
- **WHEN** the Admin calls `PUT /jira/status-mappings` with columns of this board for statuses of the linked project
- **THEN** the mapping is stored and returned with `isDefault: false` for those statuses

#### Scenario: Invalid mapping
- **WHEN** a mapping names a column of another board or a status that is not in the project
- **THEN** the response is 400 and nothing is stored

#### Scenario: Not an Admin
- **WHEN** a Member or Viewer calls `PUT /jira/status-mappings` or `POST /jira/import`
- **THEN** the response is 403

### Requirement: Import open issues idempotently
`POST /jira/import` SHALL import every open issue (`statusCategory != Done`) of the linked project as a card in the mapped column, through the boards facade, reading all result pages. Cards SHALL be matched by `jiraIssueKey`: a re-import SHALL update the title, the description and the column of existing cards and SHALL NOT create duplicates. Each imported issue SHALL have a card ↔ issue mapping row. The response SHALL be `{ imported, created, updated, skipped }`, where `imported = created + updated` and `skipped` counts issues left unchanged.

#### Scenario: First import
- **WHEN** the project has 3 open issues and the board has no Jira cards
- **THEN** 3 cards are created in their mapped columns and the result is `{ imported: 3, created: 3, updated: 0, skipped: 0 }`

#### Scenario: Re-import
- **WHEN** the import runs again after one issue was renamed and another moved to a status mapped to another column
- **THEN** no card is duplicated, the two changed cards are updated or moved, and the result is `{ imported: 2, created: 0, updated: 2, skipped: 1 }`

#### Scenario: Many pages
- **WHEN** the project has more open issues than one search page
- **THEN** the import follows `nextPageToken` until Jira reports the last page and imports every issue once

#### Scenario: Jira failure
- **WHEN** the gateway reports that the connection must be reconnected, a scope is missing, Jira rate-limits, or Jira is unavailable
- **THEN** the response is 409, 403, 429 or 502 respectively, with the reason in the message

### Requirement: Card to issue links are readable
`GET /jira/mappings?boardId=` SHALL return the board's card ↔ issue links (`id`, `boardId`, `cardId`, `jiraIssueKey`, `jiraIssueId`, `jiraProjectKey`) to any board member.

#### Scenario: After an import
- **WHEN** a member reads the mappings after an import of 3 issues
- **THEN** 3 links are returned, each pointing at the created card

### Requirement: List the projects a board can be linked to
`GET /jira/projects?boardId=` SHALL return the Jira projects visible to the board's connection as `{ id, key, name }`, sorted by name. Any board member MAY call it.

#### Scenario: Connected board
- **WHEN** a member of a connected board calls `GET /jira/projects?boardId=`
- **THEN** the response is 200 with the projects of the connected Jira site

#### Scenario: Not a member
- **WHEN** a user who is not a member of the board calls it
- **THEN** the response is 404

#### Scenario: Board not connected
- **WHEN** the board has no Jira connection
- **THEN** the response is 409 with a message to connect Jira first

#### Scenario: Reconnect required
- **WHEN** the gateway reports that the connection must be reconnected
- **THEN** the response is 409
