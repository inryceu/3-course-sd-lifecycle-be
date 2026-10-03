## 1. Domain and persistence

- [ ] 1.1 Rewrite `User` entity on `BaseEntity` (email unique case-insensitive, `passwordHash` select false, `displayName`), drop role and refresh hash; verify typecheck passes
- [ ] 1.2 Add `PasswordHasher` using `BCRYPT_ROUNDS`; verify unit tests for hash cost and compare

## 2. Use cases

- [ ] 2.1 Implement register (normalise e-mail, map unique violation to 409) and login (dummy compare for unknown e-mail); verify unit tests: duplicate e-mail, wrong password, token claims, no hash in result
- [ ] 2.2 Add `GET /auth/me`; remove refresh, logout and profile; verify controller test and that removed routes return 404

## 3. Guard, decorators and facade

- [ ] 3.1 Add global `JwtAuthGuard` via `APP_GUARD`, `@Public()`, `@CurrentUser()`; verify unit tests for guard behaviour on public and protected routes
- [ ] 3.2 Add `AUTH_FACADE` + `AuthFacadeService` and export through `src/modules/auth/index.ts`; verify unit tests for valid, tampered, expired token and missing user
- [ ] 3.3 Mark health and auth entry points public; verify an e2e request without token gets 401 on a protected route

## 4. Validation and migration

- [ ] 4.1 Add DTO validation (email, password 8–72, display name 1–100); verify e2e returns 400 on bad bodies
- [ ] 4.2 Generate the migration for the users table changes; verify apply and revert on Docker Postgres
- [ ] 4.3 Add e2e tests (Supertest) for register, duplicate, login, me and expiry against a real database; verify they pass
