## ADDED Requirements

### Requirement: Jira conflict operations

`docs/api/openapi.yaml` SHALL describe `GET /jira/conflicts` (query `boardId`, `limit`, `cursor`; 200 `JiraConflictPage`, 401, 403, 404) and `POST /jira/conflicts/{conflictId}/resolve` (body `ResolveJiraConflictRequest` with `resolution: jira | boardsync`; 200 `JiraConflict`, 400, 401, 403, 404, 409, 502), and neither operation SHALL carry `x-implemented-in`. `JiraConflict` SHALL include both versions (column id and status text), their change times, the resolution, the resolution time and the resolving user.

#### Scenario: Frontend types

- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraConflict`, `JiraConflictPage` and `ResolveJiraConflictRequest` are available

#### Scenario: Contract matches the implementation

- **WHEN** a reader opens the conflict operations
- **THEN** they carry no `x-implemented-in` and document the responses the backend returns
