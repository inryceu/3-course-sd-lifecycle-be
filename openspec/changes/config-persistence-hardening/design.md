## Context

Findings from the review of KAN-12/KAN-13: `.env.dev` key invalid; CI `JWT_SECRET: test-jwt-secret`; `configuration.ts` falls back to `'secret'`; `AppModule` calls `AppDataSource.initialize()` and then `TypeOrmModule` creates another connection; `entities: [resolve(__dirname, '../../**/*.entity{.ts,.js}')]` resolves to the repo root (can include `dist/` and `node_modules`); `BaseEntity` unused and uses `timestamptz` while the baseline migration uses `TIMESTAMP`; migrations live in `database/` outside `src/` and are not compiled; the baseline migration uses `uuid_generate_v4()` without creating the extension.

## Goals / Non-Goals

**Goals:** configuration that cannot start insecurely; one DataSource; migrations that run in dev, CI and production images; entities following one base.
**Non-Goals:** secret management infrastructure; changing Postgres version.

## Decisions

1. **Validation with `joi`** (maintained successor of `@hapi/joi`), `abortEarly: false` so every bad variable is reported at once. Secrets (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`) are required with no default; `JWT_SECRET` min 32; `BCRYPT_ROUNDS` integer 10–15 default 10.
2. **Typed namespaces** `app`, `database`, `jwt`, `jira`, `crypto`, `webhook`. `websocket` is removed: Socket.IO shares the HTTP port. `jira` gains `authBaseUrl` and `apiBaseUrl` (defaults to Atlassian) so tests can point at a stub server, and the default scopes gain `offline_access`.
3. **Dev env files** keep clearly fake but valid values (`TOKEN_ENCRYPTION_KEY` = 64 hex of a repeating pattern). A test loads `.env.dev` and `.env.example` through the schema so they cannot rot again.
4. **One DataSource**: `database-config.ts` exports `dataSourceOptions` and `AppDataSource` (for the CLI only). `TypeOrmModule.forRootAsync` spreads `dataSourceOptions` plus `autoLoadEntities: true`; it never calls `initialize()` itself. `synchronize` is hard-coded `false`.
5. **Per-module entity registration**: entities are registered where they are owned through `TypeOrmModule.forFeature([...])` in the module (`autoLoadEntities` picks them up); the CLI glob is `modules/*/infrastructure/**/*.entity.{ts,js}` relative to `__dirname`, which works from `src` (ts-node) and `dist` (compiled). This is documented in `module-structure.md`.
6. **Migrations in `src/database/migrations`** so `nest build` emits them. `src/database/migrate.ts` initialises the DataSource, runs pending migrations and exits non-zero on failure; `pnpm migration:run:prod` runs the compiled file. CLI scripts keep using ts-node.
7. **UUIDs through pgcrypto**: `uuidExtension: 'pgcrypto'` in options and `CREATE EXTENSION IF NOT EXISTS pgcrypto` in the first new migration; `gen_random_uuid()` is built into Postgres 13+ and avoids `uuid-ossp`.
8. **Additive migration, not a rewrite of the baseline.** The baseline `InitialSchema1790891436548` may already be applied on teammates' databases, so a new migration is generated against it (and hand-reviewed) instead of regenerating history. The baseline stays untouched, with a defensive `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` already tolerated by the new migration.
9. **Integration test** `test/migrations.e2e-spec.ts` uses the CI Postgres service: drops the schema, runs all migrations, reverts all, runs again. Skipped with a clear message when no database is reachable locally.

## Risks / Trade-offs

- Removing variables breaks anyone's local `.env` that still sets them → Joi allows unknown keys, so extra variables are harmless.
- Moving the migration folder changes the path used by `migration:generate` → scripts updated in the same change.
- `gen_random_uuid()` needs Postgres 13+; the project uses 16.

## Migration Plan

`pnpm migration:run` applies the new migration on existing dev databases. Rollback: `pnpm migration:revert` (down is implemented and tested).

## Open Questions

- None.
