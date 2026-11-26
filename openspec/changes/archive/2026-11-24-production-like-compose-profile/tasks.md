# Tasks

## 1. Nginx configuration and local certificate

- [x] 1.1 Create `nginx/nginx.conf` with TLS termination (`ssl_protocols TLSv1.2 TLSv1.3;`), HTTP (80) → HTTPS (443) redirect, and `proxy_pass` to `backend:3000` forwarding `Upgrade`/`Connection` for `/socket.io/` — verified with `nginx` loading the files in the running stack.
- [x] 1.2 Create `nginx/conf.d/boardsync.conf` with the 80 redirect and 443 TLS server blocks — verify it is referenced by `nginx.conf`.
- [x] 1.3 Add `nginx/generate-self-signed-cert.sh` that creates `./ssl` and produces a cert + key into it (works in Git Bash) — verified from a checkout without `ssl/`.
- [x] 1.4 Put every `proxy_set_header` in `nginx/snippets/proxy.conf` and include it in each proxying `location` (Host, X-Real-IP, X-Forwarded-For/Proto/Port set from the edge, Upgrade/Connection via the `$connection_upgrade` map) — verified with an echo backend: real client address, `https`, forged client headers discarded; two clients get separate rate-limit buckets.

## 2. Production compose wiring

- [x] 2.1 Add an always-on nginx service to `docker-compose.prod.yml` (ports 80/443, `./ssl` volume read-only, `restart: always`, `deploy.resources.limits`, `depends_on: backend`) — verify `docker compose -f docker-compose.prod.yml config` validates without error.
- [x] 2.2 Point the backend compose healthcheck at `GET /api/v1/health/ready` and the nginx healthcheck at `GET /api/v1/health/alive` — verified: with Postgres stopped the backend is unhealthy and nginx stays healthy.
- [x] 2.3 Confirm `restart: always` and `deploy.resources.limits`/`reservations` are present on postgres, backend, and nginx — verify config output for each service.
- [x] 2.4 Run `node dist/database/migrate.js` before `node dist/main.js` in the backend service — verified on an empty volume (7 migrations applied, register and login work).
- [x] 2.5 Publish no backend or database port; make the host ports configurable (`HTTP_PORT`, `HTTPS_PORT`); drop the obsolete `version` key.

## 3. Split health endpoints

- [x] 3.1 Split `HealthController` into `GET /api/v1/health/alive` (liveness, process only, no DB, no `database` field) and `GET /api/v1/health/ready` (readiness, DB probe, 503 when down) — verified by `test/health.e2e-spec.ts`.
- [x] 3.2 Add `LivenessStatus` to `health-status.ts` — verify `pnpm typecheck` passes.
- [x] 3.3 Update the Dockerfile `HEALTHCHECK` to call `/api/v1/health/ready` — verify the `HEALTHCHECK` instruction references the readiness endpoint.
- [x] 3.4 Add/extend health unit tests covering alive vs ready behavior — verify `pnpm test` passes for health specs.
- [x] 3.5 Document both routes in `docs/api/openapi.yaml` (200 and 503, public) and the README — verify `pnpm api:validate`.

## 4. Environment variables

- [x] 4.1 `.env.prod` already held `${...}` placeholders for `FRONTEND_URL`, `JIRA_REDIRECT_URI`, `JIRA_WEBHOOK_URL`; fix its comments (the callback URLs come from `JIRA_REDIRECT_URI` and `JIRA_WEBHOOK_URL`, not from the forwarded scheme) and require `FRONTEND_URL` to be https when `NODE_ENV=production` — verified by a unit test of the validation schema.

## 5. Verification and validation

- [x] 5.1 Bring up the prod stack with the self-signed cert; run the `openssl s_client` matrix (TLS 1.0/1.1 refused, TLS 1.2/1.3 accepted) — recorded in `docs/tls-verification.md`.
- [x] 5.2 Confirm HTTP→HTTPS 301, a single HSTS header on HTTPS responses, and a `wss://` Socket.IO connection through the proxy — recorded in `docs/tls-verification.md`.
- [ ] 5.3 `testssl.sh` against the stack — not run (tool not available).
- [x] 5.4 Record the verification results in `docs/tls-verification.md`.
- [x] 5.5 Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm api:validate` — all pass.
