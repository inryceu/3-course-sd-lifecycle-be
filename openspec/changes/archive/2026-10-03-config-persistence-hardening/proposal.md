## Why

T-03 (typed config) and T-04 (shared DataSource and migrations) were merged in KAN-12/KAN-13, but the review of the merged code found that the acceptance criteria are only partly met: the committed `.env.dev` fails its own validation (`TOKEN_ENCRYPTION_KEY` is not 64 hex characters), CI injects a 15-character `JWT_SECRET` against a 32-character minimum, config silently falls back to `'secret'`, the app opens two database connections, the entity glob scans the whole repository root, `BaseEntity` is used by no entity, and migrations are not part of the build output so a production container cannot run them (blocks T-12).

## What Changes

- Fix `.env.dev`, `.env.example` and CI environment so they pass validation; drop insecure fallbacks for secrets in typed config.
- Replace deprecated `@hapi/joi` with `joi`; add `BCRYPT_ROUNDS` (≥ 10); remove unused `WS_PORT`, `JWT_REFRESH_*` and `DATABASE_SYNCHRONIZE` (the app never synchronises schema).
- Make the Nest app reuse the shared DataSource options instead of initialising a second connection; scope the entity glob to `src/modules/*/infrastructure/**/*.entity`.
- Move migrations under `src/database/migrations` so they are compiled, add `src/database/migrate.ts` for production and `pnpm migration:run:prod`.
- Make every entity extend `BaseEntity` (uuid via `gen_random_uuid()`, `createdAt`, `updatedAt` as `timestamptz`) and add a migration for the differences from the existing baseline.
- Add integration tests: the app config of `.env.dev` is valid; migrations apply to an empty Postgres, revert fully and re-apply.

## Capabilities

### New Capabilities

- `app-configuration`: typed, validated, secret-safe application configuration.
- `database-migrations`: single DataSource, migration-only schema evolution, base entity and reversible migrations.

### Modified Capabilities

- None (no main spec exists yet; KAN-12/13 predate the spec).

## Impact

- `src/config/*`, `src/app.module.ts`, `src/common/entities/base.entity.ts`, `.env.*`, CI workflow, `package.json` scripts and dependencies (`joi` replaces `@hapi/joi`).
- Developers with an existing dev database get an additive migration; no data loss.
