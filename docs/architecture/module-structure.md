# Backend module structure and boundaries

BoardSync's backend is a **modular monolith** (see [`ARCHITECTURE.md`](../../ARCHITECTURE.md)): one process, one deployable, one PostgreSQL database, and four feature modules that four people build in parallel. This document turns the rules into code-level conventions that the CI enforces.

## Layout of a module

```
src/modules/<module>/
├── index.ts                 # the ONLY file other modules may import
├── <module>.module.ts       # Nest wiring
├── domain/                  # enums, value types, domain errors, pure rules (no Nest, no TypeORM)
├── application/             # use-case services and PORTS (injection token + interface)
├── infrastructure/          # TypeORM entities (`*.entity.ts`), adapters to the outside world
└── presentation/            # controllers, DTOs, gateways, guards, decorators
```

| Layer | May depend on | Contains |
| --- | --- | --- |
| `domain` | nothing | `BoardRole`, `ColumnType`, `CrossBoardMoveError`, role rules |
| `application` | `domain`, `infrastructure` of the same module, ports | services such as `BoardsService`, ports such as `BOARDS_FACADE` |
| `infrastructure` | `domain` | entities (`CardEntity`, `UserEntity`), `AesGcmTokenCipher`, `AtlassianOAuthHttpClient` |
| `presentation` | `application`, `domain` | `BoardsController`, DTOs, `RealtimeGateway` |

Pragmatic notes: application services inject the TypeORM `Repository<…>` of **their own module's** entities directly (no extra repository wrapper); entities may hold small behaviour (`CardEntity.moveTo`, `BoardMembershipEntity.canEdit`). Neither is allowed across modules.

The reference implementation is [`src/modules/health`](../../src/modules/health): a domain type, an application service with the `DATABASE_PROBE` port, a TypeORM adapter in `infrastructure`, a controller in `presentation` and an `index.ts`.

## Shared kernel: `src/common`

Code that no single module may own and that depends on **no** module:

| Path | Purpose |
| --- | --- |
| `common/entities/base.entity.ts` | uuid primary key, `createdAt`, `updatedAt` (`timestamptz`) |
| `common/events/` | typed domain events, `EVENT_PUBLISHER` port, `EventBusModule` |
| `common/ports/` | ports implemented by one module and consumed by another that must not depend on it (`BOARD_ACCESS`) |
| `common/decorators/` | `@Public()` |

## Public API

A module's `index.ts` exports only what others may use: the Nest module, port tokens and their interfaces, public types and decorators.

```ts
// src/modules/auth/index.ts
export { AuthModule } from './auth.module';
export { AUTH_FACADE } from './application/auth-facade.port';
export type { AuthFacade } from './application/auth-facade.port';
export type { AuthUser } from './domain/auth-user';
export { Public } from '../../common/decorators/public.decorator';
export { CurrentUser } from './presentation/decorators/current-user.decorator';
```

Always use **relative imports** inside `src` (`../../auth`), not `@modules/...` aliases: `nest build` does not rewrite path aliases, so an alias import compiles but fails at runtime in `dist`.

## Dependency direction (no cycles)

```
            ┌────────┐
            │  auth  │   depends on nothing
            └────────┘
               ▲  ▲  ▲
   boards ─────┘  │  └───── realtime ──► common/events, common/ports
      ▲           │
      └─── jira-sync
```

| Module | May import (through the module's `index.ts` only) |
| --- | --- |
| `auth` | – |
| `boards` | `auth` |
| `jira-sync` | `auth`, `boards` |
| `realtime` | `auth`, plus `common/events` and `common/ports` |
| `health` | – |

`forwardRef()` is **banned**. If you need it, the boundary is drawn wrongly: introduce a port in the dependent module, or an event, and invert the dependency.

### Why `BOARD_ACCESS` lives in `common/ports`

`realtime` must authorise `board:join` ("is this user a member of the board?") but must not depend on `boards`. The question is declared as the port `BOARD_ACCESS` in `common/ports`; `boards` implements it (`BoardAccessModule`, a global module) and `realtime` injects the token. The dependency points **at the port**, never at the module.

## Collaboration between modules

1. **Direct call through an exported port** (default). The consumer injects a token, the provider implements the interface:

   ```ts
   constructor(@Inject(BOARDS_FACADE) private readonly boards: BoardsFacade) {}
   const role = await this.boards.getMemberRole(boardId, userId);
   ```

   Existing ports: `AUTH_FACADE` (`getUserById`, `verifyToken`), `BOARDS_FACADE` (`getMemberRole`), `BOARD_ACCESS` (`canView`).

2. **Event for fan-out only.** Use the bus when a module must announce "something changed" to listeners it does not know (realtime delivery, Jira sync). Rules:
   - events only for fan-out; anything that needs a result is a direct port call;
   - publish **after** the database change committed, never inside the transaction callback;
   - `publish` never rejects: a failing listener is logged and cannot fail the request;
   - every event carries `boardId`, optional `actorId` and `origin: 'user' | 'jira'`; the Jira outbound sync ignores `origin: 'jira'` to avoid loops.

   ```ts
   const saved = await this.cards.save(card);                     // commit first
   await this.events.publish(createEvent('card.created', {...})); // then fan out
   ```

3. **Never**: import another module's entity or repository, query its tables, add a foreign key to its tables. Cross-module references are plain `uuid` columns (`assignee_id`, `user_id`, `board_id` in `jira_connections`).

## Persistence conventions

- One shared `DataSource` definition (`src/config/database-config.ts`) for the app and the TypeORM CLI. `synchronize` is always off.
- **Entities are registered by their owning module** with `TypeOrmModule.forFeature([...])` (the app uses `autoLoadEntities`). The CLI discovers `src/modules/*/infrastructure/**/*.entity.ts`, so entity files must live under `infrastructure/` and end with `.entity.ts`.
- Every entity extends `BaseEntity`.
- Migrations live in `src/database/migrations` (compiled into `dist`). Run in production with `pnpm migration:run:prod`.

## Enforcement

`pnpm lint` fails (and so does CI) on:

- a deep import into another module (`../../auth/application/auth.service`), which includes entities and repositories;
- an import in the wrong direction (e.g. `auth` importing `boards`, `realtime` importing `boards`);
- `forwardRef`.

The rules are defined once in [`eslint-boundaries.js`](../../eslint-boundaries.js) and tested by `src/architecture/module-boundaries.spec.ts`, which lints sample files and the real `src` tree against them (and fails if a pattern is removed).

## SOLID checklist (also in the PR template)

- **S**ingle responsibility: each class has one reason to change (controller = HTTP, service = use case, entity = persistence + small rules).
- **O**pen/closed: extend by adding listeners and adapters, not by editing existing services.
- **L**iskov: every implementation honours its port's contract (`null`, not an exception, for "not found" in facades).
- **I**nterface segregation: ports are small (`BoardAccess` has one method).
- **D**ependency inversion: modules depend on ports (`AUTH_FACADE`, `BOARDS_FACADE`, `EVENT_PUBLISHER`, `TOKEN_CIPHER`), not on each other's classes.
