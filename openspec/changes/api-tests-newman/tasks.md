# Tasks

## 1. Collection and runner
- [x] 1.1 Add `newman` devDependency and `pnpm test:api`; add `scripts/run-api-tests.mjs` (OpenAPI to JSON Schema, Newman Node API, CLI + JUnit reporters)
- [x] 1.2 Add `test/postman/` collection (FR-01, FR-03, FR-04, FR-08, error cases) and `local`/`ci` environment files
- [x] 1.3 Run against the Docker stack on :8090 and record results
- [x] 1.4 Mutation probe: break one schema expectation and one status and see Newman fail

## 2. CI and docs
- [x] 2.1 Add `.github/workflows/api-tests.yml` (compose up --wait, health wait, Newman, JUnit artifact, logs on failure)
- [x] 2.2 README section "API tests (Postman/Newman)"
- [x] 2.3 `openspec validate`, prettier on touched files, typecheck/lint/unit unaffected
