## 1. Configuration

- [x] 1.1 Replace `@hapi/joi` with `joi`, make secrets required without defaults, add `BCRYPT_ROUNDS`, remove `WS_PORT`, `JWT_REFRESH_*`, `DATABASE_SYNCHRONIZE`; verify the updated schema unit tests pass
- [x] 1.2 Update typed namespaces (drop `websocket`, add `jira.authBaseUrl/apiBaseUrl`, default `offline_access` scope, no `'secret'` fallbacks); verify unit tests cover each namespace
- [x] 1.3 Fix `.env.dev`, `.env.example`, `.env.prod`; add a test that validates `.env.dev` and `.env.example` against the schema and verify it passes
- [x] 1.4 Fix CI environment values (32-char JWT secret, new variables); verify the workflow file is consistent with the schema

## 2. Data source and entities

- [x] 2.1 Refactor `database-config.ts` to export options and the CLI DataSource with a scoped entity glob, `synchronize: false`, `uuidExtension: 'pgcrypto'`; verify typecheck passes
- [x] 2.2 Make `AppModule` reuse the options and stop calling `initialize()`; verify the app boots against Postgres (integration tests) and never initialises `AppDataSource` itself
- [x] 2.3 Move migrations to `src/database/migrations`, add `src/database/migrate.ts`, scripts `migration:run:prod`; verify `pnpm build` emits `dist/database/migrate.js`
- [x] 2.4 Make `BaseEntity` the base of every entity (applied together with the module changes) and generate the additive migration; verify `migration:generate` reports no further diff

## 3. Verification

- [x] 3.1 Add `test/migrations.e2e-spec.ts` (apply, revert, apply on a fresh schema); verify it passes against Docker Postgres
- [x] 3.2 Add `pnpm test:e2e` to the CI `Tests` job after migrations; verify the workflow runs it
