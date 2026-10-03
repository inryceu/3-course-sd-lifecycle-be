# BoardSync - Backend

> Kanban board service with two-way Jira synchronisation. Backend repository (NestJS + TypeORM + PostgreSQL).

## Concept

BoardSync closes the gap between Jira's issue tracking and a team's day-to-day kanban view. Instead of manually mirroring status changes between two tools, BoardSync keeps a kanban board and its linked Jira project in sync automatically, in both directions.

This repository implements the backend: REST API, a Socket.IO gateway for real-time updates, PostgreSQL persistence through TypeORM and the Jira integration.

## Approach

- **Spec-driven development.** Behaviour changes start as an OpenSpec change (`openspec/changes/<name>`: proposal, design, spec deltas, tasks) and are archived into `openspec/specs/` afterwards. The REST/WebSocket contract is written first: [`docs/api/openapi.yaml`](docs/api/openapi.yaml) and [`docs/api/ws-events.md`](docs/api/ws-events.md).
- **Modular monolith.** Feature modules with a fixed internal layout and automated boundary checks - see [`docs/architecture/module-structure.md`](docs/architecture/module-structure.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **Contract first with the frontend.** The frontend repository generates its API types from the OpenAPI file.

## Modules

| Module | Responsibility | Status |
| --- | --- | --- |
| `auth` | Registration, login, JWT (<= 1 h), global guard, `AUTH_FACADE` | implemented (FR-01) |
| `boards` | Boards, columns (ordering, minimum 3), cards, board roles, `BOARDS_FACADE` | boards/columns/cards core implemented (FR-03, FR-04); labels, comments, members: planned |
| `jira-sync` | OAuth 2.0 (3LO) connect flow, AES-256-GCM token storage | connect/status/disconnect implemented (FR-02); import and sync: planned |
| `realtime` | Socket.IO namespace `/realtime`, board rooms, event delivery | implemented (FR-11 transport) |
| `health` | `GET /api/v1/health` (database readiness) - reference module | implemented |

Cross-module rules (public API only, no entity/repository sharing, no cycles) are enforced by `pnpm lint`.

## Tech stack

TypeScript, NestJS 10, TypeORM 0.3, PostgreSQL 16, Socket.IO, Jest + Supertest, pnpm, Docker / Docker Compose, GitHub Actions.

## Getting started

Requirements: Node.js 20+, pnpm 9, Docker (for PostgreSQL).

```bash
pnpm install

# 1. start PostgreSQL (dev database on localhost:5433)
docker compose up -d postgres

# 2. configuration: .env.dev is committed and already valid for local work.
#    Put real secrets (e.g. the Jira client secret) into the git-ignored .env.local.

# 3. apply the migrations
pnpm migration:run

# 4. run with hot reload
pnpm start:dev          # http://localhost:3000/api/v1  (Swagger UI: /api/v1/docs)
```

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | ESLint + Prettier + module boundary rules (`lint` never rewrites files) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:cov` | unit tests |
| `pnpm test:e2e` | integration tests against a real PostgreSQL (see below) |
| `pnpm build` | compile to `dist/` |
| `pnpm migration:generate src/database/migrations/<Name>` | generate a migration from entity changes |
| `pnpm migration:run` / `migration:revert` | apply / revert migrations (ts-node) |
| `pnpm migration:run:prod` | apply migrations from the compiled build (`node dist/database/migrate.js`) |
| `pnpm api:validate` | validate `docs/api/openapi.yaml` |

### Integration tests

`pnpm test:e2e` resets the test database (drops everything, applies all migrations) and runs the HTTP and WebSocket tests against it. Defaults: `localhost:5432`, user/password `postgres`, database `boardsync_test` (what CI uses). Override with `DATABASE_HOST`, `DATABASE_PORT`, ... , e.g.:

```bash
docker run -d --name bs-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=boardsync_test -p 5434:5432 postgres:16-alpine
DATABASE_HOST=127.0.0.1 DATABASE_PORT=5434 pnpm test:e2e
```

## Run the whole system (database + backend + frontend)

With this repository and `3-course-sd-lifecycle-fe` checked out side by side:

```bash
cp .env.full.example .env.full     # fill in the secrets; it is git-ignored
docker compose --env-file .env.full -f docker-compose.full.yml up --build
```

| What | URL |
| --- | --- |
| Web UI | http://localhost:8080 |
| REST API (through the frontend proxy) | http://localhost:8080/api/v1 |
| WebSocket (Socket.IO namespace) | http://localhost:8080/realtime |
| Swagger UI | http://localhost:8080/api/v1/docs |
| Backend directly (debugging) | http://127.0.0.1:3000/api/v1 |

Startup order is gated by health checks (postgres -> backend with migrations applied -> frontend); data lives in the named volume `boardsync-postgres-full-data`. Stop with `docker compose -f docker-compose.full.yml down` (add `-v` to delete the data). Rationale: [`docs/adr/0001-full-stack-compose.md`](docs/adr/0001-full-stack-compose.md).

The per-environment compose files remain: `docker-compose.yml` (development, hot reload) and `docker-compose.prod.yml` (production-like).

## Environment variables

Every variable is validated at startup (`src/config/validation.schema.ts`); the app refuses to start when one is missing or invalid. [`.env.example`](.env.example) documents all of them with sample values. Committed `.env.dev` holds development placeholders only, `.env.prod` holds `${...}` placeholders; real secrets come from the git-ignored `.env.local` or the process environment.

| Variable | Required | Meaning |
| --- | --- | --- |
| `NODE_ENV` | yes | `development`, `production` or `test` |
| `PORT`, `API_PREFIX`, `FRONTEND_URL` | `FRONTEND_URL` | HTTP port (default 3000), route prefix (default `api/v1`), allowed CORS/WebSocket origin |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME` | yes | PostgreSQL connection |
| `JWT_SECRET` | yes | HS256 secret, at least 32 characters |
| `JWT_EXPIRES_IN` | no (`1h`) | access-token lifetime, **at most 1 h** |
| `BCRYPT_ROUNDS` | no (`10`) | bcrypt cost, 10-15 |
| `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET` | yes | Atlassian OAuth 2.0 (3LO) app |
| `JIRA_REDIRECT_URI` | yes | callback URL registered in the app; points at the **frontend** route `/jira/callback`; `https` in production |
| `JIRA_SCOPES` | no | default `read:jira-work,write:jira-work,read:jira-user,offline_access` |
| `JIRA_AUTH_BASE_URL`, `JIRA_API_BASE_URL` | no | Atlassian endpoints (override for tests; `https` in production) |
| `TOKEN_ENCRYPTION_KEY` | yes | 64 hex characters (32 bytes) for AES-256-GCM |
| `WEBHOOK_SECRET` | yes | at least 32 characters |

## API documentation and user guide

- **Contract:** [`docs/api/openapi.yaml`](docs/api/openapi.yaml) (operations marked `x-implemented-in: T-<n>` are planned) and [`docs/api/ws-events.md`](docs/api/ws-events.md).
- **Generate frontend types:** in the frontend repository run `pnpm api:sync && pnpm api:generate` (copies this spec and regenerates `src/api/api.generated.ts`; running it twice gives identical output).
- **Authentication:** `POST /api/v1/auth/register` or `/login` return `{ accessToken, expiresIn, user }`; send `Authorization: Bearer <accessToken>`. Tokens last at most one hour; there is no refresh endpoint - log in again after a 401.
- **Roles are per board:** `ADMIN` (settings, columns, Jira connection), `MEMBER` (cards), `VIEWER` (read-only). Users who are not members get `404`.
- **Connect Jira (board Admin):** `GET /jira/oauth/start?boardId=` returns an Atlassian authorise URL; Atlassian redirects to the frontend route `/jira/callback?code&state`, which calls `GET /jira/oauth/callback?code&state`. Setting up the Atlassian app and a sandbox site is a separate task (T-14).

## Contributing

Branches `KAN-<n>`, Conventional Commits, PR template, code owners and the OpenSpec flow are described in [`CONTRIBUTING.md`](CONTRIBUTING.md). Agents' rules: [`AGENTS.md`](AGENTS.md).

## Team

| Name | Role |
| --- | --- |
| Pavlo | PM + Fullstack developer - boards & cards module |
| Edward | Fullstack developer - Jira integration module |
| Denys | Fullstack developer - auth & users module |
| Kyrylo | Fullstack developer - realtime module, DevOps/CI-CD |

## Related

- Frontend repository: [`3-course-sd-lifecycle-fe`](https://github.com/inryceu/3-course-sd-lifecycle-fe)
- Requirements specification: `Специфікація_вимог.md` (course folder)
