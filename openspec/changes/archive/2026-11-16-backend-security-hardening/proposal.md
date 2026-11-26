# Proposal

## Why

The BoardSync backend currently lacks several non-functional security requirements identified during review: HTTP security headers (helmet) are not applied; auth endpoints (`POST /auth/register`, `POST /auth/login`) have no rate limiting; NestJS `Logger` writes raw to stdout and can leak secrets, tokens, and passwords; the startup validation schema accepts JWT secrets that look like placeholders in production; and there is no dependency audit process or documented exception policy. Closing these gaps brings the implementation in line with the NFR list and reduces the risk of secret leakage, brute-force authentication attacks, and vulnerable transitive dependencies reaching production.

## What Changes

- Add `helmet` middleware with default security headers; relax only Content-Security-Policy so Swagger `/docs` keeps working.
- Add `@nestjs/throttler` and apply rate limits to `POST /auth/register` and `POST /auth/login`; add a lighter global default across all HTTP routes.
- Wrap NestJS `Logger` in a `SanitizingLoggerService` that redacts known secret keys (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`, `DATABASE_PASSWORD`, `password`, `accessToken`, `authorization`) before any log write.
- Extend the Joi startup validation schema to reject `JWT_SECRET` values that look like placeholders (e.g. containing `change-me`, `default`, `example`, `your-`, `placeholder`) when `NODE_ENV === "production"`; exempt `development` and `test`.
- Add a `pnpm audit` script to `package.json` (CI checks unchanged).
- Fix critical-vulnerability dependencies: upgrade `bcrypt` (transitive `tar` Gzip bomb), `ts-jest` (transitive `handlebars` RCEs), and `joi` (direct DoS).
- Add `EXCEPTIONS.md` documenting all remaining audit findings not fixed, with severity, rationale, and next-review date.
- Add e2e tests for rate limiting and placeholder-JWT rejection; add unit tests for the sanitizing logger.

## Capabilities

### New Capabilities

- `security-headers`: HTTP response security headers applied via helmet, with CSP relaxed for Swagger.
- `secure-logging`: All application log output passes through a sanitizing layer that redacts secrets, tokens, and passwords before writing.

### Modified Capabilities

- `app-configuration`: `JWT_SECRET` validation gains a production-only placeholder-pattern rejection on top of the existing minimum-32-characters rule.
- `user-auth`: `POST /auth/register` and `POST /auth/login` now enforce rate limits; excessive attempts receive `429 Too Many Requests` instead of processing.

## Impact

- `package.json`: new `helmet`, `@nestjs/throttler`, `joi` version bumps, `bcrypt` version bump, `ts-jest` version bump, new `audit` script.
- `src/app.setup.ts`: register helmet middleware.
- `src/app.module.ts`: register `ThrottlerModule`, bind `ThrottlerGuard`, bind `SanitizingLoggerService` via `APP_LOGGER`.
- `src/modules/auth/presentation/auth.controller.ts`: add `@Throttle()` decorators.
- `src/config/validation.schema.ts`: add placeholder JWT blocklist (production-only).
- `src/common/logger/sanitizing-logger.service.ts`: new file.
- `EXCEPTIONS.md`: new file.
- `test/auth.e2e-spec.ts`: add rate-limiting and placeholder-JWT tests.
- `test/`: new sanitizing-logger unit test.
