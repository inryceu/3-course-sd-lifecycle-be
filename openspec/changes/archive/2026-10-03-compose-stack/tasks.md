## 1. Backend image and compose

- [x] 1.1 Add `docs/adr/0001-full-stack-compose.md` with the decision and the deviation from the GHCR suggestion; verify it is linked from the READMEs
- [x] 1.2 Add `docker-compose.full.yml` (postgres, backend, frontend, named volume, healthchecks, `service_healthy`); verify `docker compose -f docker-compose.full.yml config` succeeds
- [x] 1.3 Add `.env.full.example` and git-ignore `.env.full`; verify missing secrets produce a clear compose error
- [x] 1.4 Ensure the production image runs migrations then the API and has `wget` for the healthcheck; verify the container applies migrations on an empty volume

## 2. Frontend proxy

- [x] 2.1 Extend frontend nginx config to proxy `/socket.io/` with upgrade headers and keep `/api/`; verify `nginx -t` passes in the built image
- [x] 2.2 Build the SPA with relative API and same-origin WebSocket values through build args; verify the built JavaScript bundle contains no `localhost:3000` (only the source map does)

## 3. End-to-end check

- [x] 3.1 Run the stack from scratch: all services healthy, register a user through the web origin, restart the stack, log in again; verify data persisted
- [x] 3.2 Add run instructions to both READMEs; verify commands match the compose file
