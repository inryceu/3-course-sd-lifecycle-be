## Context

Current code: `AuthService.refresh` computes `bcrypt.hash(refreshToken, 10)` and queries by it (never matches); `RolesGuard` checks `user.roles?.includes` while `JwtStrategy.validate` returns `{ id, email, role }`; `User` hashes in `@BeforeInsert/@BeforeUpdate`; guards are attached with `@UseGuards` per controller; `WsJwtGuard` and the gateway verify tokens on their own.

## Goals / Non-Goals

**Goals:** a correct minimal auth core; secure by default; usable by other modules only through a port.
**Non-Goals:** refresh tokens, password reset, e-mail verification, rate limiting (tracked as follow-ups), OAuth sign-in.

## Decisions

1. **Stateless access tokens only.** HS256 JWT with claims `sub` and `email`, lifetime from `JWT_EXPIRES_IN` (≤ 1 h). Dropping refresh is deliberate: the existing path is broken, a correct rotating-refresh design needs its own table and review, and T-09 specifies "redirect to login on 401".
2. **Roles are per board.** The global `User.role` is removed; admin/member/viewer live in `BoardMembership` (boards-domain change). `RolesGuard` is deleted instead of fixed — nothing should authorise on a global role.
3. **Hashing in `PasswordHasher`** (application service) with `BCRYPT_ROUNDS` from config; the entity has no hooks. `comparePassword` on unknown users runs a dummy compare against a fixed hash so response time does not reveal whether the email exists.
4. **Email normalisation**: trimmed and lower-cased before lookup and storage; uniqueness enforced by a unique index and a `ConflictException` mapped from the DB error code `23505` to cover the check-then-insert race.
5. **Validation**: `email` valid, `password` 8–72 characters (bcrypt ignores bytes past 72), `displayName` 1–100 trimmed. `ValidationPipe` already forbids unknown fields.
6. **Global guard**: `{ provide: APP_GUARD, useClass: JwtAuthGuard }` registered by `AuthModule`; `@Public()` sets metadata read by the guard through `Reflector`. This makes protection the default.
7. **`AuthUser`** = `{ id, email, displayName }` is what `request.user`, `@CurrentUser()` and the facade return; the entity never leaves the module.
8. **`AUTH_FACADE`** implemented by `AuthFacadeService`: `getUserById(id): Promise<AuthUser | null>` and `verifyToken(token): Promise<AuthUser | null>` (valid signature, not expired and user still exists). Used by the WebSocket handshake and later modules. Exported with `@Public`, `@CurrentUser`, `AuthUser`, `AuthModule` from `index.ts`.
9. **Responses** `{ accessToken, expiresIn (seconds), user }` for register and login; `GET /auth/me` returns the user. Failed login always says "Invalid credentials" with 401.
10. **Logging**: no controller or service logs request bodies; DTOs are never serialised into logs. The `passwordHash` column keeps `select: false`.

## Risks / Trade-offs

- No refresh → users re-login hourly; acceptable for the course scope and recorded as a follow-up.
- No rate limiting on login → listed in the PR as a known gap (NFR-SEC hardening is T-36).
- Removing endpoints is breaking for the current frontend → the frontend branch switches to the new contract in the same release.

## Migration Plan

Migration drops `users.role` and `users.refreshTokenHash`, lower-cases existing emails and enforces a case-insensitive unique index. Rollback re-adds the columns with defaults.

## Open Questions

- None.

## Implementation notes (discovered while applying)

- `JwtAuthGuard` returns `true` for non-HTTP contexts, so the global guard never interferes with WebSocket handlers (the gateway authenticates the handshake through `AUTH_FACADE`).
- Passwords are limited to 72 characters because bcrypt ignores the rest; the limit is in the DTO and the contract.
- The e-mail is normalised in the DTO transform **and** in the service, so callers other than the controller get the same behaviour; uniqueness is the unique index on `users.email`.
