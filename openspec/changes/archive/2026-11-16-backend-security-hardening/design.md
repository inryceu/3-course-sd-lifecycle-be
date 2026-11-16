# Design

## Context

The backend runs NestJS 10 with TypeORM, PostgreSQL, and class-validator/class-transformer DTOs. Configuration is loaded via `@nestjs/config` with a Joi schema that aborts startup on missing/invalid values. A global `ValidationPipe` with `whitelist: true` is already applied in `configureApp` (`src/app.setup.ts`). CORS is already config-driven via `FRONTEND_URL`. Auth (`POST /auth/register`, `POST /auth/login`, `GET /auth/me`) lives in `src/modules/auth`. There is no Redis in `docker-compose.yml`, and no `helmet`, `@nestjs/throttler`, or sanitizing logger exists today. `pnpm audit` reports 3 critical vulnerabilities (2 in `handlebars` via `ts-jest`, 1 in `tar` via `bcrypt`) plus many high/moderate/low findings, most transitive.

## Goals / Non-Goals

**Goals:**
- Apply helmet security headers on all HTTP responses (CSP relaxed for Swagger).
- Rate-limit `POST /auth/register` and `POST /auth/login` with `@nestjs/throttler`, plus a lighter global default.
- Redact secrets/tokens/passwords from all `Logger` output via a custom `LoggerService`.
- Reject placeholder-looking `JWT_SECRET` values at startup in production only.
- Fix the 3 critical audit vulnerabilities via dependency upgrades.
- Document remaining audit findings in `EXCEPTIONS.md` with review dates.
- Add tests for rate limiting, placeholder-JWT rejection, and log redaction.

**Non-Goals:**
- No Redis or distributed rate-limit store (in-memory throttler only).
- No changes to CI job definitions (only add a `pnpm audit` script).
- No changes to existing spec files outside this change's delta specs.
- No frontend changes.

## Decisions

### 1. helmet with CSP relaxed (`contentSecurityPolicy: false`)
**Why:** Default helmet ships a strict CSP that breaks Swagger UI (`/docs`). Disabling only CSP keeps all other headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.) while preserving Swagger functionality.
**Alternative considered:** Full default helmet and accept Swagger breakage — rejected because `/docs` is used in development and CI contract validation.

### 2. `@nestjs/throttler` with in-memory store
**Why:** No Redis exists in compose; adding Redis would be infrastructure scope creep. In-memory is sufficient for a single-instance deployment.
**Alternative considered:** Redis-backed throttler — rejected due to no Redis dependency and single-instance architecture. Revisit if multi-replica deployment is added.
**Configuration:** Global default 100 req / 1 min; `POST /auth/register` 5 req / 5 min; `POST /auth/login` 10 req / 5 min; `GET /auth/me` uses the global default.

### 3. Sanitizing `LoggerService` via `APP_LOGGER`
**Why:** NestJS `Logger` writes raw strings to stdout; error stacks and debug logs can embed JWTs, DB passwords, or request bodies containing passwords. A custom `LoggerService` wrapping NestJS `Logger` redacts known secret keys centrally.
**Alternative considered:** Per-call-site sanitization — rejected as error-prone and easy to miss new log sites.
**Redacted keys:** `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`, `DATABASE_PASSWORD`, `password`, `accessToken`, `authorization`.

### 4. Placeholder JWT blocklist, production-only
**Why:** `.env.dev` and unit tests use `dev-jwt-secret-key-for-local-development-only-min-32-chars` (starts with `dev-`). Exempting `development`/`test` keeps local dev and tests working while protecting production.
**Alternative considered:** Blocklist all envs — rejected because it breaks `.env.dev` and existing unit tests.

### 5. Fix criticals via dependency upgrades
- `bcrypt` `^5.1.1` → `^6.0.0` (pulls patched `node-pre-gyp`/`tar` ≥7.5.19, fixes Critical CVE-2026-59873).
- `ts-jest` `^29.1.1` → `^29.4.15` (pulls `handlebars` ≥4.7.10, fixes Criticals CVE-2026-106446 and CVE-2026-106445).
- `joi` `^18.2.9` → `^18.3.1` (fixes HIGH CVE-2026-118772 direct dependency).
**Alternative:** Document as exceptions — rejected for criticals because they are production-reachable (bcrypt/tar) or easy one-line fixes (joi, ts-jest).

### 6. `EXCEPTIONS.md` with review dates
**Why:** Remaining audit findings (fast-uri, qs, deepmerge, glob, minimatch, lodash, body-parser, etc.) are transitive and not directly fixable without major dependency churn. Document each with severity, rationale, and next-review date (30 days from creation).

## Risks / Trade-offs

[In-memory throttler resets on restart] → Rate-limit counters are lost when the process restarts; acceptable for single-instance, revisit with Redis if multi-replica is added.
[helmet default headers may affect API clients] → `X-Frame-Options: DENY` blocks embedding BoardSync in iframes; acceptable since BoardSync is a standalone SPA.
[Sanitizing logger adds CPU overhead] → String scanning on every log write; negligible for typical log volume, but high-throughput logging should be audited.
[Placeholder blocklist may reject legitimate non-placeholder secrets] → Blocklist is narrow (specific known patterns); false positives are unlikely but possible. Review `EXCEPTIONS.md` if a legitimate secret is flagged.
[bcrypt@6.0.0 requires Node ≥18] → Project requires Node ≥20, so no conflict.

## Migration Plan

1. Run `pnpm install` after `package.json` dependency changes.
2. Deploy `bcrypt` and `ts-jest` upgrades first (they fix criticals).
3. Add helmet, throttler, sanitizing logger, and placeholder validation in one release.
4. Add `EXCEPTIONS.md` and `pnpm audit` script in the same release.
5. Rollback: revert dependency versions and remove `helmet()`/`ThrottlerModule`/`APP_LOGGER` if regressions appear.

## Open Questions

None — all scope decisions resolved in proposal.md and specs.
