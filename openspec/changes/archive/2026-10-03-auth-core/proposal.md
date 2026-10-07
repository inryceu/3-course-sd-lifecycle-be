## Why

FR-01 needs working registration and login. The existing `auth` module registers and logs users in, but the review found: refresh tokens can never be redeemed (a salted bcrypt hash is looked up by equality), `RolesGuard` always denies (reads `user.roles`, strategy returns `role`), passwords are hashed in an entity hook with a hard-coded cost, there is no `GET /auth/me`, guards are applied per controller (new controllers are public by accident) and other modules cannot use auth without importing its internals. T-06 and T-07 ask for a correct core and a facade port.

## What Changes

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me` matching `docs/api/openapi.yaml`; responses `{ accessToken, expiresIn, user }`.
- Email unique and case-insensitive, password 8–72 characters, bcrypt cost from config (≥ 10), access token ≤ 1 h, password hash never returned or logged.
- **BREAKING**: remove `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/profile`, the global `User.role` and `refreshTokenHash`. Roles are per board (T-11/T-17).
- Global `JwtAuthGuard` through `APP_GUARD`, `@Public()` opt-out, `@CurrentUser()` decorator.
- `AUTH_FACADE` port (`getUserById`, `verifyToken`) exported through `@modules/auth`.
- Unit tests for hashing, duplicate email, wrong password, token claims, guard and facade.

## Capabilities

### New Capabilities

- `user-auth`: registration, login and current-user lookup with short-lived JWTs.
- `auth-facade`: global authentication guard and the port other modules use to identify users.

### Modified Capabilities

- None.

## Impact

- `src/modules/auth/**`, `src/common/guards/*` (moved into auth), `src/app.module.ts`, migration for the users table, frontend `AuthContext`/`endpoints` (separate PR in the frontend repo).
- Every other controller becomes protected by default; `health` and the auth entry points are marked `@Public()`.
