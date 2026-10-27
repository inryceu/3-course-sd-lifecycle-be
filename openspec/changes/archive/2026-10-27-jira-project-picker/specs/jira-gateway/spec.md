## ADDED Requirements

### Requirement: List projects
The gateway SHALL expose `listProjects({ boardId })`, calling `GET /rest/api/3/project/search` with the `read:jira-work` scope, and SHALL return every project visible to the board's connection as `{ id, key, name }`, following the offset pagination (`startAt`, `maxResults`) until Jira reports `isLast` or returns an empty page.

#### Scenario: Several pages
- **WHEN** Jira returns the projects in two pages, the first with `isLast: false`
- **THEN** the gateway requests the second page with `startAt` advanced by the size of the first and returns the projects of both pages

#### Scenario: Missing scope
- **WHEN** the stored connection scopes do not include `read:jira-work`
- **THEN** the gateway throws `JiraClientError` with status 403 and `missing_scope` without calling Jira
