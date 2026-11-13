## ADDED Requirements

### Requirement: Jira project listing operation
`docs/api/openapi.yaml` SHALL describe `GET /jira/projects` with the `boardId` query parameter, answering an array of `JiraProject` (`id`, `key`, `name`), and 404, 409, 429 and 502 errors.

#### Scenario: Frontend types
- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraProject` is available
