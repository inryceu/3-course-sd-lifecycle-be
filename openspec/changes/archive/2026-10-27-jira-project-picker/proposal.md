## Why

T-29 (KAN-40) asks for a **project picker** on the Jira Sync page: the board Admin should choose one of the projects of the connected Jira site instead of typing its key. Everything else in T-29 (connect / disconnect, callback error states, status mapping editor, import with result) is already delivered. The backend has no way to list the projects a connection can see, so the picker needs a new endpoint and a gateway operation.

## What Changes

- **Gateway:** a new `listProjects({ boardId })` operation calling Jira `GET /rest/api/3/project/search` (scope `read:jira-work`), following the offset pagination (`startAt`, `maxResults`, `isLast`) until the last page, and returning `{ id, key, name }` per project.
- **API:** `GET /jira/projects?boardId=` returns the projects visible to the board's Jira connection, sorted by name. Any board member may call it; non-members get 404, a board without a connection gets 409, gateway failures are mapped like the import (409 reconnect, 403 missing scope, 429, 502).
- **Contract:** `docs/api/openapi.yaml` gains the operation and a `JiraProject` schema.
- **Web client:** the project key text field of the import form becomes a select listing `name (KEY)`, preselecting the board's linked project. When the list cannot be loaded, the page falls back to the key text field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jira-gateway`: adds the `listProjects` operation.
- `jira-issue-import`: adds listing the projects a board can be linked to.
- `api-contract`: adds `GET /jira/projects` and `JiraProject`.
- `web-client`: the import form picks the project from a list.

## Impact

- Backend: `src/modules/jira-sync` (gateway port and HTTP client, `JiraImportService`, `JiraStatusMappingService`, controller), `docs/api/openapi.yaml`.
- Frontend: `JiraImportPanel`, `jiraApi.projects`, regenerated types, component tests.
- No new dependencies, no migration.
