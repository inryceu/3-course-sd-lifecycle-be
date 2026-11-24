# Design

## Context

The production compose file (`docker-compose.prod.yml`) already reserves ports 80/443 and mounts `./ssl` into an `nginx:alpine` service, but no `nginx/` config or certificates exist, so the backend is reachable only over plain HTTP. The backend listens on port 3000 with `TRUST_PROXY=1`; it hosts both REST (`/api/v1`) and Socket.IO (namespace `/realtime`, upgrade path `/socket.io/`) on the same port. Health is a single combined `GET /api/v1/health` that returns 503 when the database is down; it is used by both the Dockerfile HEALTHCHECK and compose `healthcheck`. Helmet runs in `src/app.setup.ts` setting the baseline headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, X-XSS-Protection). Dev compose (`docker-compose.yml`) exposes ports directly and uses `restart: unless-stopped` without resource limits. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- TLS termination (≥1.2 including 1.3) at the reverse proxy on port 443; TLS 1.0/1.1 refused.
- HTTP (80) → HTTPS (443) redirect.
- REST (`/api/v1`) and WebSocket (`/socket.io/`, upgrade headers) proxying to `backend:3000` over `wss://`/`https://`.
- The real client address and scheme (`X-Forwarded-*`) reach the backend on every proxied route; exactly one HSTS header per HTTPS response; backend Helmet baseline unchanged.
- Split health probes, served under the API prefix: `/api/v1/health/alive` (liveness, process only) and `/api/v1/health/ready` (readiness, DB, 503 when down); the backend healthcheck targets readiness, the nginx healthcheck liveness.
- The backend applies database migrations before it starts listening, so readiness cannot report ready against an empty schema.
- `restart: always` + `deploy.resources.limits`/`reservations` on all prod services including nginx.
- Self-signed cert for local verification; verification results recorded in `docs/tls-verification.md`.

**Non-Goals:**
- Production certificate issuance/renewal (ACME/certbot) — out of scope; self-signed is for local verification only.
- Changing the local dev stack (`docker-compose.yml`, `docker-compose.full.yml`).
- Moving TLS into the Node application.
- Kubernetes migration or per-service mesh TLS.

## Decisions

### 1. Nginx terminates TLS at the edge (not application-level TLS)
**Rationale:** Keeps TLS out of application code (no module-boundary impact), handles WebSocket upgrades cleanly via `proxy_pass` + `Upgrade`/`Connection` forwarding, and matches the reserved 443 port and `./ssl` volume already declared in prod compose. Node is not a TLS-termination edge.
**Alternative considered:** Node/Express-level HTTPS with `fs` cert reload. Rejected: adds cert-management complexity to the app, no clean hot-reload, and couples TLS to the backend process.

### 2. Accept TLS 1.2 and TLS 1.3 (`ssl_protocols TLSv1.2 TLSv1.3;`)
**Rationale:** "≥1.2 only" means disable 1.0 and 1.1 while keeping both 1.2 and 1.3 enabled; 1.3 is widely supported and more performant.
**Alternative considered:** TLS 1.2 only (`ssl_protocols TLSv1.2;`). Rejected: unnecessarily excludes 1.3 with no security benefit for this threat model.

### 3. Nginx always-on in production (no profile gate)
**Rationale:** This is a production-like profile; nginx must always be the entry point on 80/443.
**Alternative considered:** `--profile tls` opt-in. Rejected: production-like means the edge is always present.

### 4. Header ownership split
**nginx:** HTTP→HTTPS 301 redirect and the forwarded-client headers, all set in one shared snippet (`nginx/snippets/proxy.conf`) included by every proxying `location` (nginx only inherits `proxy_set_header` into a location that sets none of its own, so per-location lists silently drop the server-level ones). This nginx is the edge, so `X-Forwarded-For` is set to `$remote_addr` (overwritten, never appended): a client cannot forge the address that keys the rate limits (`TRUST_PROXY=1`).
**Backend (Helmet):** every security header, `Strict-Transport-Security` included (`max-age=31536000; includeSubDomains`), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-XSS-Protection: 0`, default CSP (Swagger exception).
**Rationale:** one owner per header; two `Strict-Transport-Security` headers were sent when both layers set it, and clients act on the first. HSTS is not sent on the plaintext redirect. Responses nginx generates itself (for example 413 or 502) carry no HSTS; acceptable because the browser has already pinned the host from any backend response.

### 5. Split health: `/api/v1/health/alive` and `/api/v1/health/ready`
**Rationale:** Liveness = process alive (restart-worthy); readiness = DB reachable (traffic-worthy, 503 when down). Compose healthcheck targets readiness so unhealthy-backend traffic stops at the edge. Dockerfile HEALTHCHECK updated to `/api/v1/health/ready`. The nginx container's own healthcheck uses liveness, so it does not turn unhealthy when only the database is down.
**Alternative considered:** Keep single combined `/api/v1/health`. Rejected: conflates process health with DB health; readiness should be able to fail without marking the container un-restartable.

### 6. Self-signed certificate for local verification only
**Rationale:** Enables the `openssl s_client` / testssl verification loop locally without depending on a real CA or DNS. Production must rotate in a real cert/key into `./ssl` (out of scope).
**Alternative considered:** Real cert via ACME. Rejected: requires DNS/CA access, not reproducible locally.

## Risks / Trade-offs

- [Self-signed cert triggers browser warnings] → Acceptable; local verification only. Production requires a real cert before HSTS long max-age is safe.
- [HSTS pins clients to HTTPS for a year, helmet's default] → Mitigation: use a real certificate before pointing real users at it; the self-signed one is for local verification only.
- [Socket.IO long-polling fallback needs buffering/timeouts] → Mitigation: `proxy_buffering off` and adequate `proxy_read_timeout` on the `/socket.io/` location.
- [Readiness returns 503 when DB is down] → Mitigation: compose healthcheck interval/retries tuned so transient DB blips don't flap the edge; restart policy handles container restart, not routing.
- [Dev and prod compose drift] → Mitigation: keep dev (`unless-stopped`, direct ports, no limits) intentionally distinct from prod (`always`, limits, nginx edge); document the split.

## Migration Plan

1. Add `nginx/nginx.conf`, `nginx/conf.d/boardsync.conf`, and `nginx/generate-self-signed-cert.sh` (local verification only).
2. Update `docker-compose.prod.yml`: wire nginx as always-on service on 80/443 with `./ssl` volume, `restart: always`, `deploy.resources.limits`; set backend healthcheck to `/api/v1/health/ready`.
3. Update `.env.prod`: add HTTPS placeholders for `FRONTEND_URL`, `JIRA_REDIRECT_URI`, `JIRA_WEBHOOK_URL`.
4. Split `src/modules/health/presentation/health.controller.ts` into `/alive` and `/ready`; adjust `health-status.ts` if needed; update Dockerfile HEALTHCHECK to `/api/v1/health/ready`.
5. Run migrations before the app starts (`node dist/database/migrate.js && node dist/main.js`), drop the published backend and database ports, parametrise the host ports (`HTTP_PORT`, `HTTPS_PORT`).
6. Generate the self-signed cert into `./ssl`; bring the prod stack up.
7. Run the `openssl s_client` protocol matrix (1.0/1.1 refused, 1.2/1.3 accepted), confirm HSTS + redirect + WebSocket upgrade over `wss://`; optionally run testssl.sh.
8. Record results (timestamped) in `docs/tls-verification.md`.
9. Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Rollback:** Revert compose/nginx/health changes; remove `./ssl` cert; restore single combined health endpoint if split proves problematic.

## Open Questions

None that block the plan. Deferrable: production cert renewal mechanism (ACME/certbot), final HSTS `max-age` value, and whether to add nginx upstream health checks beyond the compose healthcheck.
