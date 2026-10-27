## 1. Contract

- [ ] 1.1 Add `GET /jira/projects` and the `JiraProject` schema to `docs/api/openapi.yaml`; verify `pnpm api:validate`

## 2. Gateway

- [ ] 2.1 Add `listProjects` to the port and the HTTP client (offset pagination, `read:jira-work`); verify stub-server tests for paging and missing scope

## 3. Endpoint

- [ ] 3.1 Split `requireConnectedBoard` out of `requireLinkedBoard`; add `JiraImportService.listProjects` and `GET /jira/projects`; verify unit tests (sorted list, 404 non-member, 409 not connected, gateway error mapping) and an e2e test

## 4. Frontend

- [ ] 4.1 `jiraApi.projects`, regenerated types, project picker in `JiraImportPanel` with the text fallback; verify component tests (loading, list, preselect, selection → import call, failure fallback)

## 5. Verification

- [ ] 5.1 Backend `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm api:validate`, `openspec validate --specs --strict`; frontend `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
