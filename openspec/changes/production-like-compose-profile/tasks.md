# Tasks

## 1. Nginx configuration and local certificate

- [ ] 1.1 Create `nginx/nginx.conf` with TLS termination (`ssl_protocols TLSv1.2 TLSv1.3;`), HSTS, `X-Forwarded-Proto: https`, HTTP (80) → HTTPS (443) redirect, and `proxy_pass` to `backend:3000` forwarding `Upgrade`/`Connection` for `/socket.io/` — verify file exists and is structurally valid (run `nginx -t` if available, else review).
- [ ] 1.2 Create `nginx/conf.d/boardsync.conf` with the 80 redirect and 443 TLS server blocks — verify it is referenced by `nginx.conf`.
- [ ] 1.3 Add `nginx/generate-self-signed-cert.sh` that produces a cert + key into `./ssl` — verify `./ssl/boardsync.crt` and `./ssl/boardsync.key` exist after running the script.

## 2. Production compose wiring

- [ ] 2.1 Add an always-on nginx service to `docker-compose.prod.yml` (ports 80/443, `./ssl` volume read-only, `restart: always`, `deploy.resources.limits`, `depends_on: backend`) — verify `docker compose -f docker-compose.prod.yml config` validates without error.
- [ ] 2.2 Point the backend compose healthcheck at `GET /api/v1/health/ready` — verify config output shows the readiness test.
- [ ] 2.3 Confirm `restart: always` and `deploy.resources.limits`/`reservations` are present on postgres, backend, and nginx — verify config output for each service.

## 3. Split health endpoints

- [ ] 3.1 Split `HealthController` into `GET /health/alive` (liveness, process only, no DB) and `GET /health/ready` (readiness, DB probe, 503 when down) — verify routes register and return expected statuses via the health unit/integration specs.
- [ ] 3.2 Update `health-status.ts` if the split requires a new status shape — verify `pnpm typecheck` passes.
- [ ] 3.3 Update the Dockerfile `HEALTHCHECK` to call `/health/ready` — verify the `HEALTHCHECK` instruction references the readiness endpoint.
- [ ] 3.4 Add/extend health unit tests covering alive vs ready behavior — verify `pnpm test` passes for health specs.

## 4. Environment variables

- [ ] 4.1 Add HTTPS placeholders to `.env.prod` for `FRONTEND_URL`, `JIRA_REDIRECT_URI`, `JIRA_WEBHOOK_URL` — verify each is a `${...}` placeholder and no real secrets are committed.

## 5. Verification and validation

- [ ] 5.1 Bring up the prod stack with the self-signed cert; run `openssl s_client` matrix (TLS 1.0/1.1 refused, TLS 1.2/1.3 accepted) — verify handshake acceptance/refusal per protocol.
- [ ] 5.2 Confirm HTTP→HTTPS 301/308, HSTS header on HTTPS responses, and `wss://` WebSocket upgrade reach the backend — verify responses.
- [ ] 5.3 Optionally run `testssl.sh` against the stack — verify report produced if the tool is available.
- [ ] 5.4 Record timestamped verification results in `docs/tls-verification.md` — verify the file exists with the results.
- [ ] 5.5 Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — verify all pass.

## Workflow follow-up

- Run `/opsx-apply` when ready to implement.
- Archive the change after implementation and review are complete.
