## 1. Contract

- [x] 1.1 Update `docs/api/openapi.yaml`: import result fields, the status-mapping endpoints and schemas, drop `x-implemented-in` for the implemented operations; verify `pnpm api:validate`

## 2. Boards facade

- [x] 2.1 Put `upsertCardFromExternal` back on `BoardsFacade` with `{ cardId, outcome }`, moving an existing card to the given column; add `getBoardSummary` and `setJiraProjectKey`; verify unit tests for created / updated / unchanged / moved and a type-level use through the port

## 3. Gateway

- [x] 3.1 Add `listProjectStatuses` to the port and the HTTP client (dedupe across issue types); verify stub-server tests

## 4. Mapping and import

- [x] 4.1 `JiraStatusMappingEntity` and the migration; verify apply and revert on Postgres
- [x] 4.2 `JiraStatusMappingService` (defaults by category, validation, Admin-only save); verify unit tests
- [x] 4.3 `JiraImportService` (project link, paging, idempotent upsert, card ↔ issue links, result counts, error mapping); verify unit tests with a stubbed gateway
- [x] 4.4 Controller endpoints `POST /jira/import`, `GET|PUT /jira/status-mappings`, `GET /jira/mappings`; verify a component test (real Postgres, stubbed gateway) for first import, re-import, paging, roles and errors

## 5. Frontend

- [x] 5.1 Jira Sync page: project key, Import with result counts, status mapping (Admin edit, others read-only); verify component tests

## 6. Verification

- [x] 6.1 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `openspec validate --strict`
- [x] 6.2 Live import against the team's Jira site through the running stack
