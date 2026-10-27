## ADDED Requirements

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
