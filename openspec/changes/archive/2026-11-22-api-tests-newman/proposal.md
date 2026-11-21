# Proposal

## Why

T-56 (KAN-67, Lab 6) requires API tests built as a Postman collection and run with Newman in CI. The backend already validates every response against `docs/api/openapi.yaml` in its Jest e2e suites, but nothing exercises the deployed Compose stack over plain HTTP, the way a client or the frontend sees it (nginx proxy, built image, migrations applied).

## What Changes

- **Collection.** `test/postman/boardsync.postman_collection.json` covers FR-01 (register, login, me), FR-03 (board with three default columns), FR-04 (columns and cards: create, rename, update, move, delete) and FR-08 (invite a member, Viewer restrictions), plus error cases (401, 403, 404, 400). Each request asserts the status code and validates the JSON body against its OpenAPI schema.
- **Schemas cannot drift.** `scripts/run-api-tests.mjs` builds JSON Schemas from `components.schemas` of `docs/api/openapi.yaml` on every run and hands them to the collection as the `schemas` variable; the collection stores no schema copies.
- **Environments.** `local` (`http://localhost:8090/api/v1`) and `ci` (`http://localhost:8080/api/v1`); no secrets.
- **Run.** `pnpm test:api` (Newman as a devDependency, CLI + JUnit reporters, JUnit in `test-results/api-tests.xml`).
- **CI.** New workflow `.github/workflows/api-tests.yml` starts `docker-compose.full.yml`, runs Newman and uploads the JUnit report.
- **Docs.** README section "API tests (Postman/Newman)".

## Capabilities

### Modified Capabilities

- `repo-workflow`: adds the API-tests CI requirement.

## Impact

Backend only: `test/postman/`, `scripts/run-api-tests.mjs`, `package.json` (+ `newman`, `test:api`), lockfile, a workflow, README. No runtime code or API contract change.
