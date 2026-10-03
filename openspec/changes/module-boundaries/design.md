## Context

`src/modules/*` currently mixes controllers, services, entities and DTOs in one folder. Cross-module imports exist (`jira-sync/entities/jira-issue-mapping.entity.ts` imports Board, Card and User; `boards-cards` imports `auth/entities/user.entity`). `tsconfig` is not strict although AGENTS.md says it should be; flipping strict is out of scope (it would touch every file) and is recorded as a follow-up.

## Goals / Non-Goals

**Goals:** a layout every module can copy; a failing lint check for illegal imports; a reference module; a documented dependency graph without cycles.
**Non-Goals:** full DDD (TypeORM entities live in `infrastructure/` and keep small behaviour methods); turning on `strict`; moving to a workspace tool.

## Decisions

1. **Layout** `src/modules/<m>/{index.ts,<m>.module.ts,domain,application,infrastructure,presentation}`. `domain` = enums, value types, domain errors (no Nest/TypeORM). `application` = services and ports (injection tokens + interfaces). `infrastructure` = TypeORM entities, adapters, external clients. `presentation` = controllers, DTOs, gateways.
2. **Public API** is `index.ts` only: module class, port tokens/interfaces, public types, decorators. Everything else is private.
3. **Enforcement with ESLint core `no-restricted-imports`** (per-module `overrides`), not `eslint-plugin-boundaries`. Reason: zero new dependencies, patterns are plain globs, and the rule is exercised by a Jest test that runs ESLint on virtual files. A pattern `**/<other>/**` forbids deep imports (alias or relative) while the bare `@modules/<other>` (the index) stays allowed. Cross-module entity/repository imports are a special case of deep imports.
4. **Dependency direction** (documented and tested): `boards → auth`; `jira-sync → auth, boards`; `realtime → common/events, common/ports, auth`; `auth → nothing`. `common` is the shared kernel and depends on no module.
5. **Inversion for realtime access checks**: `realtime` may not import `boards`, so `common/ports` declares `BOARD_ACCESS`, implemented by `BoardsModule` and consumed by `realtime`. This closes the review finding that any authenticated user could join any board room, without adding a forbidden dependency. It is a deliberate small extension of T-02's "realtime depends on nothing but the event bus and AUTH_FACADE".
6. **`forwardRef()` is banned** by lint (`no-restricted-syntax` on the identifier): a cycle means the boundary is wrong.
7. **Reference module = `health`** with `HealthService` (application), `DATABASE_PROBE` port, `TypeOrmDatabaseProbe` adapter (infrastructure), `HealthController` (presentation). It returns 503 when the DB is down so Docker healthchecks mean readiness.
8. `pnpm lint` stops using `--fix`; `pnpm lint:fix` is added. With `--fix` in CI a job could pass while rewriting files.

## Risks / Trade-offs

- Glob patterns match on the target directory name, not on import depth, so a deep relative import such as `../../../auth/x` is still caught.
- Moving files breaks open PRs of the other developers → the move is done in one commit and called out in the PR description.

## Migration Plan

Move files first (pure rename), then change code. No data migration. Roll back by reverting the commit.

## Open Questions

- Switch `tsconfig` to `strict: true`: not decided here.
