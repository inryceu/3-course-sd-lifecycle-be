## ADDED Requirements

### Requirement: Jira import and status mapping operations
`docs/api/openapi.yaml` SHALL describe `POST /jira/import` with the result `{ imported, created, updated, skipped }`, `GET /jira/status-mappings`, `PUT /jira/status-mappings` and `GET /jira/mappings`, and these operations SHALL no longer be marked with `x-implemented-in`.

#### Scenario: Frontend types
- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraImportResult`, `JiraStatusMapping` and `PutJiraStatusMappingsRequest` are available
