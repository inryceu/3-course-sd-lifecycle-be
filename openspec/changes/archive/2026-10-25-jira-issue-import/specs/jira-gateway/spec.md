## ADDED Requirements

### Requirement: List project statuses
The gateway SHALL expose `listProjectStatuses({ boardId, projectKey })`, calling `GET /rest/api/3/project/{projectKey}/statuses` with the `read:jira-work` scope, and SHALL return each status of the project once (deduplicated across issue types) with its id, name and status category key.

#### Scenario: Statuses of several issue types
- **WHEN** the project's Task and Bug issue types both use the status `To Do`
- **THEN** `To Do` is returned once

#### Scenario: Unknown project
- **WHEN** Jira answers 404 for the project
- **THEN** the gateway throws `JiraClientError` with status 404
