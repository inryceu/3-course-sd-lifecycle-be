## Why

FR-05 (T-24, KAN-35): a board Admin must be able to link a board to a Jira project and pull that project's open issues onto the board as cards. Two-way sync (T-25, T-26) also needs a stored mapping between Jira statuses and board columns, which does not exist yet. The gateway (T-23) and the `BoardsFacade` external-card methods (T-19) are in place, so the import can now be built on them.

## What Changes

- **Link a board to a Jira project.** `boards.jiraProjectKey` (it already exists) is set through the import request or `PATCH /boards/{id}`. A key is validated against the Jira key format and against the connected site (the project must exist and be readable).
- **Status ↔ column mapping**, stored per board in a new table `jira_status_mappings`:
  - `GET /jira/status-mappings?boardId=` returns every status of the linked project with its column. Statuses that have no stored row get a default from the Jira status category (`new` → TODO column, `indeterminate` → IN_PROGRESS, `done` → DONE; first column of the board when that type is missing), marked `isDefault: true`.
  - `PUT /jira/status-mappings` (Admin) stores the mapping and validates that every column belongs to the board and every status belongs to the project.
- **Import:** `POST /jira/import` (Admin, contract path) imports the open issues (`statusCategory != Done`) of the linked project page by page (cursor pagination), through `BoardsFacade.upsertCardFromExternal`:
  - It is idempotent by `jiraIssueKey`: re-import updates title, description and column and never duplicates.
  - Each issue also gets a `jira_issue_mappings` row (card ↔ issue id and key).
  - The result is `{ imported, created, updated, skipped }`.
- `GET /jira/mappings?boardId=` (card ↔ issue links, already in the contract) is implemented, read-only.
- **Gateway:** a new `listProjectStatuses` operation (`GET /rest/api/3/project/{key}/statuses`, scope `read:jira-work`).
- **`BoardsFacade`:**
  - `upsertCardFromExternal` is back on the port (it was dropped from the interface in KAN-30) and returns `{ cardId, outcome }`.
  - New methods: `getBoardSummary` (columns and project key) and `setJiraProjectKey`.
- **Errors:** gateway failures are mapped to HTTP:
  - reconnect required → 409;
  - missing scope → 403;
  - project not found → 400;
  - rate limited → 429;
  - Jira unavailable → 502.

## Capabilities

### New Capabilities

- `jira-issue-import`: linking a board to a Jira project, the status ↔ column mapping and the issue import.

### Modified Capabilities

- `jira-gateway`: adds the `listProjectStatuses` operation.
- `api-contract`: the import result gains `created` and `updated`; the status-mapping endpoints are added.

## Impact

- Backend: `src/modules/jira-sync` (new `JiraImportService`, `JiraStatusMappingService`, entity + migration, controller), `src/modules/boards` (facade port and service), `docs/api/openapi.yaml`.
- Frontend (contract consumer): the Jira Sync page gets the project key, the mapping table and the Import button (web-client parity).
- No new dependencies.
