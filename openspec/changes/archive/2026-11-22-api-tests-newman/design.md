# Design

## Context

The OpenAPI file is the contract and is already enforced in unit-adjacent e2e tests. The collection must stay in sync without maintenance.

## Decisions

- **Generate schemas from OpenAPI at run time, not embed them.** The runner converts `components.schemas` (inline `$ref`, `nullable` to a type union, drop `example`/`description`) and passes them as an environment variable; test scripts call `pm.response.to.have.jsonSchema(S.<Name>)`. Embedding copies in the collection would drift; committing a generated file would drift unless regenerated. Consequence: the collection is run through `pnpm test:api`, not by importing it into the Postman app (a guard in the collection pre-request script says so).
- **Newman Node API instead of its CLI.** Needed to inject the computed variable; the CLI and JUnit reporters are still used.
- **Three users per run.** Admin, Viewer, Stranger. Error cases that do not need a registration use other endpoints, so a run stays inside the production register limit (5 per 5 minutes, one run per 5 minutes). Repeated runs inside the window need `RATE_LIMIT_REGISTER` raised (CI does).
- **Unique data per run.** A random `runId` (collection pre-request script) goes into e-mails and titles; the run deletes the board it creates.
- **Invite of an unregistered e-mail asserts 400**, the status the contract and the service use.
