# Proposal

## Why

BoardSync's production compose file (`docker-compose.prod.yml`) reserves ports 80/443 and an `./ssl` volume for nginx, but no nginx config, TLS certificate handling, or HTTPS redirect exists. The backend currently speaks plain HTTP only, so a real production deployment cannot terminate TLS, enforce HSTS, or safely proxy WebSocket upgrades. Ticket T-39 defers TLS to a dedicated change; this change introduces it as a production-like profile so the stack can run behind a TLS-terminating reverse proxy locally and in production.

## What Changes

- New nginx configuration that terminates TLS (`TLSv1.2` and `TLSv1.3`), redirects HTTP (80) to HTTPS (443), and proxies REST (`/api/v1`) plus Socket.IO WebSocket upgrades (`/socket.io/`) to the backend.
- Self-signed certificate generation for local verification; `./ssl` volume wired into compose.
- Split health probes: `GET /health/alive` (liveness, process only) and `GET /health/ready` (readiness, DB probe, 503 when down); compose healthcheck targets readiness.
- Security-header split: nginx owns HSTS + `X-Forwarded-Proto: https`; backend Helmet keeps the baseline CSP/X-XSS/etc.
- `restart: always` and `deploy.resources.limits` on all prod services (already present; kept and extended to nginx).
- `.env.prod` gains HTTPS placeholders for `FRONTEND_URL`, `JIRA_REDIRECT_URI`, `JIRA_WEBHOOK_URL`.
- Verification steps (`openssl s_client` protocol matrix, optional testssl) recorded in `docs/tls-verification.md`.

**BREAKING**: Production `FRONTEND_URL`, `JIRA_REDIRECT_URI`, and `JIRA_WEBHOOK_URL` must be `https://` (already hinted by existing validation/Jira spec).

## Capabilities

### New Capabilities

- `tls-reverse-proxy`: Production-like TLS termination at nginx (≥1.2 including 1.3), HTTP→HTTPS redirect, REST + WebSocket proxying to the backend, HSTS and forwarded-proto headers, self-signed cert for local verification, split liveness/readiness health probes, restart policies and resource limits, and TLS verification recording.

### Modified Capabilities

<!-- None: this change targets docker-compose.prod.yml (production), while the
     full-stack-compose spec covers docker-compose.full.yml (local dev stack).
     No existing capability's REQUIREMENTS change; the new behavior is captured
     by the tls-reverse-proxy capability below. -->

## Impact

- `docker-compose.prod.yml` (add nginx service, healthcheck target).
- New `nginx/` directory (config + cert script).
- `.env.prod` (HTTPS placeholders).
- `src/modules/health/presentation/health.controller.ts` (split `/alive` + `/ready`).
- `src/modules/health/domain/health-status.ts` (status shape).
- `Dockerfile` (HEALTHCHECK targets readiness).
- `docs/tls-verification.md` (verification results).
