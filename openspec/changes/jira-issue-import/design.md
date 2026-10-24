## Context

- `jira-sync` has the OAuth connection (T-16) and the `JIRA_GATEWAY` port (T-23).
- `boards` exposes `BOARDS_FACADE`, with `moveCardFromExternal` and an `upsertFromExternal` service method that KAN-30 dropped from the port.
- `boards.jiraProjectKey` and the `jira_issue_mappings` table already exist from the initial schema.
- The contract already reserves `POST /jira/import` (`{ boardId, projectKey? }` → `{ imported, skipped }`) and `GET /jira/mappings`.
- Module rule: `jira-sync` may use `boards` only through `BOARDS_FACADE`, never its entities.

## Goals / Non-Goals

**Goals:** link a board to a project, a status ↔ column mapping with sensible defaults, idempotent paged import, typed HTTP errors, tests with a stubbed gateway.
**Non-Goals:** live sync after the import (T-25/T-26), linking a single card to an existing issue (`POST /jira/mappings`), importing done issues, a "skipped because unmapped" option (every status maps to a column, defaults included).

## Decisions

1. **Path:** keep the contract path `POST /jira/import` with `boardId` in the body. The ticket's `/jira/boards/{id}/import` was written before the contract, and the frontend types already use the contract.
2. **Result:**
   - `{ imported, created, updated, skipped }`, where `imported` keeps its contract meaning (cards created or changed) and the two new fields split it.
   - `skipped` = issues whose card already matched (same title, description and column).
3. **Default mapping is computed, not stored:**
   - `GET` merges the project's statuses (via the new `listProjectStatuses`) with the stored rows and marks the rest `isDefault`.
   - The import uses the same merge. Storing defaults would freeze them before the Admin has seen them.
4. **New table `jira_status_mappings`** (`board_id`, `jira_status_id`, `jira_status_name`, `column_id`, unique `(board_id, jira_status_id)`), owned by `jira-sync`. Columns are referenced by id, with no cross-module foreign key. A deleted column falls back to the default on the next read.
5. **Facade additions** keep `jira-sync` off the board tables:
   - `getBoardSummary(boardId)` returns `{ jiraProjectKey, columns: [{ id, title, type, position }] }` or `null`.
   - `setJiraProjectKey(boardId, key)`.
   - `upsertCardFromExternal(input)` returns `{ cardId, outcome: 'created' | 'updated' | 'unchanged' }`, and also moves an existing card when its column differs (same board lock), so one call keeps a card current.
6. **Import loop:**
   - JQL `project = "<KEY>" AND statusCategory != Done ORDER BY key`, page size 50, following `nextPageToken` until `isLast`.
   - Each issue → `upsertCardFromExternal` with the mapped column, then an upsert of `jira_issue_mappings` on `(board_id, jiraIssueKey)`.
   - The description is taken from the issue's ADF as plain text: paragraphs joined, other nodes ignored.
7. **Errors:** a small mapper in the controller layer turns gateway errors into HTTP answers:
   - `JiraUnauthorizedError` → 409 "Reconnect Jira for this board";
   - `JiraClientError` 403 `missing_scope` → 403;
   - `JiraClientError` 404 → 400 "Jira project not found";
   - `JiraRateLimitedError` → 429;
   - `JiraServerError`, `JiraTimeoutError`, `JiraTimeBudgetExceededError` → 502.
8. **Authorisation** through `BOARDS_FACADE.getMemberRole`: reads need any member, import and mapping writes need Admin, non-members get 404 (the existing rule).

## Risks / Trade-offs

- A very large project makes the import a long request (≈ 50 issues per Jira call). That's acceptable for the course scale; a background job is a T-35 topic.
- Two imports at the same time are safe: card upserts take the board lock and the link upsert is keyed by a unique index. The counts may then report one of them as `skipped`.
