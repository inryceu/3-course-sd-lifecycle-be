## Why

Lab 5 integration runs locally, so one command must bring the whole system up (T-12). Both repos have their own Dockerfiles and dev compose files, but they are not combined: the frontend dev compose builds the backend in dev mode, the backend production image cannot run migrations, the backend healthcheck URL is unauthenticated only by accident (it will be protected by default after the auth change), and nothing documents how the browser reaches REST and WebSocket.

## What Changes

- Add `docker-compose.full.yml` in the backend repo: Postgres (named volume, healthcheck), backend (production image, migrations applied before start, healthcheck, `service_healthy` dependency) and frontend (nginx image built from the sibling repo, `service_healthy` dependency on the backend).
- Record the decision in `docs/adr/0001-full-stack-compose.md`: where the stack lives, why the frontend image is built from the sibling repository instead of pulled from a registry.
- Frontend nginx proxies `/api/` and `/socket.io/` (WebSocket upgrade) to the backend; documented URLs: web `http://localhost:8080`, API `http://localhost:8080/api/v1`, WebSocket `http://localhost:8080/realtime`.
- Backend production image gets a migration entrypoint and a `wget`-based healthcheck on the public health route.
- Add `.env.full.example`; run instructions in both READMEs.

## Capabilities

### New Capabilities

- `full-stack-compose`: single-command local stack with ordered startup, health checks and persistent data.

### Modified Capabilities

- None.

## Impact

- New compose file and ADR in the backend; changes to the backend `Dockerfile`/entrypoint, the frontend nginx config and both READMEs.
- No CI image publishing (AGENTS.md keeps CI cost-free), so the ticket's suggestion to publish the FE image to GHCR is not followed.
