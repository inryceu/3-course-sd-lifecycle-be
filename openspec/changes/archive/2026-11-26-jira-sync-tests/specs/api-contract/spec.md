## ADDED Requirements

### Requirement: Jira sync log list operation
`docs/api/openapi.yaml` SHALL describe `GET /jira/sync-logs` under the `jira` tag with the required `boardId`, optional `status`, `limit` and `cursor`, returning `JiraSyncLogPage`, and the 400, 401, 403 and 404 responses. It SHALL describe `requiresReconnect` as a required boolean of `JiraConnectionStatus`.

#### Scenario: Operation is documented
- **WHEN** a reader opens `GET /jira/sync-logs`
- **THEN** the parameters, the page schema and the 400/401/403/404 responses are documented

#### Scenario: Responses validate against the contract
- **WHEN** the sync-log e2e suite runs
- **THEN** every response matches the OpenAPI document
