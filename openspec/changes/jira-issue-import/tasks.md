## 1. Contract

- [ ] 1.1 Update `docs/api/openapi.yaml`: import result fields, the status-mapping endpoints and schemas, drop `x-implemented-in` for the implemented operations; verify `pnpm api:validate`

## 2. Boards facade

- [ ] 2.1 Put `upsertCardFromExternal` back on `BoardsFacade` with `{ cardId, outcome }`, moving an existing card to the given column; add `getBoardSummary` and `setJiraProjectKey`; verify unit tests for created / updated / unchanged / moved and a type-level use through the port

## 3. Gateway

- [ ] 3.1 Add `listProjectStatuses` to the port and the HTTP client (dedupe across issue types); verify stub-server tests

## 4. Mapping and import

- [ ] 4.1 `JiraStatusMappingEntity` and the migration; verify apply and revert on Postgres
- [ ] 4.2 `JiraStatusMappingService` (defaults by category, validation, Admin-only save); verify unit tests
- [ ] 4.3 `JiraImportService` (project link, paging, idempotent upsert, card ↔ issue links, result counts, error mapping); verify unit tests with a stubbed gateway
- [ ] 4.4 Controller endpoints `POST /jira/import`, `GET|PUT /jira/status-mappings`, `GET /jira/mappings`; verify a component test (real Postgres, stubbed gateway) for first import, re-import, paging, roles and errors

## 5. Verification

- [ ] 5.1 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `openspec validate --strict`
- [ ] 5.2 Live import against the team's Jira site through the running stack
