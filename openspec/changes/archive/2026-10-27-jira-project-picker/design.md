## Context

- `jira-sync` already has the `JIRA_GATEWAY` port with typed errors, `toHttpError` for the HTTP mapping, and `JiraStatusMappingService.requireRole` / `requireLinkedBoard` for authorisation and the connection check.
- `requireLinkedBoard` also demands a linked project key, which the picker must not need (the picker is how the key is chosen).
- The frontend import form (`JiraImportPanel`) has a free-text project key field.

## Goals / Non-Goals

**Goals:** list the projects of the connected site for a board, pick one in the UI, keep typing the key as a fallback.
**Non-Goals:** searching or filtering projects on the server (`query` parameter), caching the list, archived projects.

## Decisions

1. **Endpoint** `GET /jira/projects?boardId=` → `JiraProject[]` (`{ id, key, name }`), sorted by name. It sits next to the other import endpoints in `JiraImportController` and is served by `JiraImportService.listProjects`.
2. **Authorisation:** any board member (reading the list reveals nothing a member could not see on the Jira site); non-members 404 through `requireRole(…, false)`.
3. **Connection check:** `requireLinkedBoard` is split. A new `requireConnectedBoard(boardId)` returns the board summary or throws 404 / 409; `requireLinkedBoard` calls it and then resolves the project key. Behaviour of existing callers is unchanged.
4. **Gateway** `listProjects({ boardId })`: `GET /project/search?startAt=<n>&maxResults=50`, scope `read:jira-work`, repeated while `isLast` is false, advancing `startAt` by the number of values received; a page with no values also ends the loop so a misbehaving server cannot loop forever. Each page is a separate gateway call with its own retry/time budget, like the import's search loop.
5. **Errors** reuse `toHttpError` (409 reconnect, 403 missing scope, 429 rate limit, 502 unavailable).
6. **Frontend:** `jiraApi.projects(boardId)` with `silent: true` (the panel renders its own fallback instead of the global error toast). Only Admins load it, since only they see the import form. While loading, the select is disabled with a "Loading projects..." option. On success, a `<select>` lists `name (KEY)` and preselects the board's `jiraProjectKey` (or nothing, with a "Choose a project" placeholder). On failure, the old text field is shown with a short note. A linked key that is no longer in the list is still offered so the current link stays visible.

## Risks / Trade-offs

- A site with many projects returns them all in one response; for the course scale (a handful of projects) that is fine. A search box would be the next step.
