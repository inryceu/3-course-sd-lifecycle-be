# ADR 0001: Where the full-stack Docker Compose lives and how the frontend image is obtained

- Status: accepted
- Date: 2026-10-03
- Ticket: T-12 (Full local stack with Docker Compose)

## Context

Lab 5 integration is done locally, so one command must bring the whole system up: PostgreSQL, the backend (with its migrations applied) and the frontend (nginx). Both repositories already have Dockerfiles and *per-repo* dev/prod compose files, but nothing combines them. The ticket suggested putting the full-stack compose in the backend repository and pulling a frontend image built by the frontend CI and published to GitHub Container Registry (GHCR).

## Decision

1. **The full-stack compose is `docker-compose.full.yml` in the backend repository.** The backend already owns PostgreSQL, the migrations and the environment files, and the specs/contract live here.
2. **The frontend image is built from the sibling repository checkout** (`build.context: ${FRONTEND_CONTEXT:-../3-course-sd-lifecycle-fe}`), not pulled from GHCR. A prebuilt image can still be used: set `FRONTEND_IMAGE` and run `up --no-build`.
3. **The browser only talks to the frontend nginx (`http://localhost:8080`)**, which serves the SPA and proxies `/api/` and `/socket.io/` (WebSocket upgrade) to the backend. The SPA is built with same-origin URLs (`VITE_API_URL=/api/v1`, empty `VITE_WS_URL`), so no CORS configuration is needed and the backend port is not required by the UI.
4. **Migrations run before the API starts** in the same container (`node dist/database/migrate.js && node dist/main.js`); a failed migration stops the container.
5. **Startup is ordered by health checks** (`depends_on: condition: service_healthy`): postgres (`pg_isready`) -> backend (`GET /api/v1/health`, which answers 503 when the database is down) -> frontend.
6. **Secrets come from a git-ignored `.env.full`** and are required with `${VAR:?message}`; no insecure defaults exist.

## Consequences

- *Deviation from the ticket:* publishing the frontend image to GHCR is not done. AGENTS.md states that the CI is "cost-free" (no image pushes, no deployment) and that all development happens locally, so a publishing pipeline would contradict that rule. Building locally costs a slower first start (two multi-stage builds) and requires both repositories to be checked out side by side.
- The backend process runs with `NODE_ENV=development` inside the compose stack although the image is the production target, because production mode requires `https://` redirect and Atlassian URLs (NFR-SEC-3). TLS for a real production setup is covered by T-39.
- The `init-db/pg_hba.conf` trust rewrite of the dev compose is deliberately not used here; PostgreSQL's default password authentication applies.
