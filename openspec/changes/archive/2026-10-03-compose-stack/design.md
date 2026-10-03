## Context

Backend `Dockerfile` has stages `base`, `deps`, `builder`, `development`, `production`; the production stage copies `node_modules`, `dist`, `package.json` and runs `node dist/main.js`. Dev compose uses `pg_hba.conf` with `trust` for Docker networks. The frontend `Dockerfile` has a `production` stage (nginx) with `/api/` already proxied to `backend:3000`; `VITE_*` values are read at build time.

## Goals / Non-Goals

**Goals:** `docker compose -f docker-compose.full.yml up --build` works on a clean machine; ordered, healthy startup; data survives restarts; documented URLs.
**Non-Goals:** TLS and production hardening (T-39), backups (T-42), publishing images.

## Decisions

1. **The full stack lives in the backend repo** as `docker-compose.full.yml`, which already owns Postgres, migrations and the env files. The frontend is built from `${FRONTEND_CONTEXT:-../3-course-sd-lifecycle-fe}`; a prebuilt image can be used instead through `FRONTEND_IMAGE`. Deviation from the ticket's suggestion (pull a GHCR image built by FE CI): AGENTS.md states CI pushes no images and "all development happens locally", so publishing would contradict an existing rule.
2. **Browser traffic goes through the frontend nginx on port 8080** (`/api/` and `/socket.io/` proxied to `backend:3000`, with `Upgrade`/`Connection` headers and long read timeout). The SPA is built with `VITE_API_URL=/api/v1` and an empty `VITE_WS_URL` (same origin), so no CORS is involved and no backend port needs publishing. The backend port is still published on `127.0.0.1:3000` for debugging.
3. **Migrations run before the API starts**, inside the backend container: the command is `node dist/database/migrate.js && node dist/main.js`. A failed migration stops the container (exit non-zero) and the frontend never becomes healthy.
4. **Health**: Postgres `pg_isready`; backend `wget -qO- http://localhost:3000/api/v1/health` (public route, 503 when the DB is down); frontend `wget -qO- http://localhost/`. `depends_on` uses `condition: service_healthy` everywhere, and `start_period` covers the migration run.
5. **Named volume** `boardsync-postgres-full-data`; the `init-db` scripts are not mounted (the `pg_hba.conf` trust rewrite is a dev-only convenience and is not applied to this stack — Postgres defaults with `POSTGRES_PASSWORD` apply).
6. **Configuration**: `env_file: .env.dev` for non-secret defaults plus an `environment:` block overriding `DATABASE_HOST=postgres`, `NODE_ENV=production`, `FRONTEND_URL=http://localhost:8080`, `JIRA_REDIRECT_URI=http://localhost:8080/jira/callback`. Secrets come from a git-ignored `.env.full` created from `.env.full.example`; the compose file reads it through `${VAR:?message}` interpolation so missing secrets fail fast. Because `NODE_ENV=production` would force HTTPS redirect validation, the full stack sets `NODE_ENV=development` for the backend process but runs the production *image target*; the HTTPS rule is for real production in T-39.
7. **Single compose project name** `boardsync-full` so containers and networks do not collide with the dev stacks.

## Risks / Trade-offs

- Building the frontend from a sibling directory needs both repos checked out side by side → documented; `FRONTEND_IMAGE` is the escape hatch.
- First build is slow (two multi-stage builds) → acceptable for a one-time local setup.

## Migration Plan

Additive: no existing compose file changes except the backend `Dockerfile` (adds a `wget` healthcheck-compatible base and keeps `CMD`), so dev and prod flows are unaffected.

## Open Questions

- None.

## Implementation notes (discovered while applying)

- Running the real stack found a defect in the image: it emitted `dist/src/main.js` instead of `dist/main.js` (fixed with `tsconfig.build.json`). Testing the migrations on an empty database found another one, the missing extension in the baseline (see config-persistence-hardening).
- Host ports are configurable (`WEB_PORT`, `BACKEND_PORT` in `.env.full`) because 8080/3000 are often taken; the backend `FRONTEND_URL` and the Jira redirect URI follow `WEB_PORT`.
- The dev compose file no longer maps the obsolete WebSocket port 3001 (Socket.IO shares the HTTP port).
