# Tasks

## 1. Dependency upgrades

- [ ] 1.1 Upgrade `bcrypt` to `^6.0.0`, `ts-jest` to `^29.4.15`, `joi` to `^18.3.1` in `package.json` and verify `pnpm install` succeeds — verifies the 3 critical vulnerabilities are resolved by upgrade
- [ ] 1.2 Add `helmet ^8.3.0` and `@nestjs/throttler ^6.8.0` to `package.json` dependencies and verify `pnpm install` succeeds — verifies new packages are installable
- [ ] 1.3 Add `"audit": "pnpm audit"` script to `package.json` and verify `pnpm audit` runs without script errors — verifies the audit command is available

## 2. Helmet security headers

- [ ] 2.1 Add `app.use(helmet({ contentSecurityPolicy: false }))` to `configureApp` in `src/app.setup.ts` before CORS — verifies helmet middleware is registered on the app
- [ ] 2.2 Verify Swagger `/docs` still loads after helmet is added — verifies CSP relaxation does not break Swagger UI

## 3. Rate limiting on auth endpoints

- [ ] 3.1 Register `ThrottlerModule.forRoot()` in `AppModule` imports — verifies the throttler module is available for DI
- [ ] 3.2 Bind `ThrottlerGuard` as `APP_GUARD` scoped to HTTP routes — verifies global throttling is active
- [ ] 3.3 Add `@Throttle({ limit: 5, ttl: 300000 })` to `POST /auth/register` in `auth.controller.ts` — verifies register returns 429 after exceeding the limit
- [ ] 3.4 Add `@Throttle({ limit: 10, ttl: 300000 })` to `POST /auth/login` in `auth.controller.ts` — verifies login returns 429 after exceeding the limit
- [ ] 3.5 Verify `GET /auth/me` uses the global default limit (not the stricter auth endpoint limits) — verifies non-auth routes are not over-restricted

## 4. Sanitizing LoggerService

- [ ] 4.1 Create `src/common/logger/sanitizing-logger.service.ts` implementing NestJS `LoggerService` that wraps `Logger` and redacts `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`, `DATABASE_PASSWORD`, `password`, `accessToken`, `authorization` — verifies all log levels (log/error/warn/debug/verbose) are covered
- [ ] 4.2 Register `SanitizingLoggerService` via `{ provide: APP_LOGGER, useClass: SanitizingLoggerService }` in `AppModule` — verifies the app uses the sanitizing logger
- [ ] 4.3 Write unit test verifying secrets are redacted from `Logger.error()` output — verifies redaction works

## 5. Placeholder JWT blocklist

- [ ] 5.1 Add production-only placeholder-pattern blocklist to `JWT_SECRET` in `src/config/validation.schema.ts` — verifies startup aborts for placeholder secrets in production
- [ ] 5.2 Exempt `development` and `test` environments from the placeholder blocklist — verifies `.env.dev` and existing unit tests still pass
- [ ] 5.3 Update `validation.schema.spec.ts` if needed to cover placeholder rejection scenarios — verifies schema tests pass

## 6. Exceptions and audit documentation

- [ ] 6.1 Create `EXCEPTIONS.md` listing all remaining `pnpm audit` findings not fixed, with severity, CVE, rationale, and next-review date (30 days) — verifies every unaddressed advisory is documented
- [ ] 6.2 Run `pnpm audit` and confirm remaining findings match `EXCEPTIONS.md` — verifies the exception list is complete and accurate

## 7. Tests

- [ ] 7.1 Add e2e tests to `test/auth.e2e-spec.ts` verifying `POST /auth/register` returns 429 after rapid repeated requests — verifies rate limiting on register
- [ ] 7.2 Add e2e tests to `test/auth.e2e-spec.ts` verifying `POST /auth/login` returns 429 after rapid repeated requests — verifies rate limiting on login
- [ ] 7.3 Add e2e/unit test verifying startup rejects placeholder `JWT_SECRET` in production but accepts it in development — verifies placeholder blocklist behavior
- [ ] 7.4 Run `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` — verifies all checks pass

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
