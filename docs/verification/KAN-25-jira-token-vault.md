# KAN-25 (T-15) — Jira-sync module skeleton and encrypted token storage: verification

The implementation was delivered with the intermediate result (#27 into `dev`, #28 into `main`; OpenSpec change `openspec/changes/archive/2026-10-03-jira-connection`, specs `jira-token-vault`, `jira-oauth-connection`). This record checks every acceptance criterion against `dev` at `69e1fb0`.

| Acceptance criterion | Evidence | Result |
| --- | --- | --- |
| Module skeleton follows `docs/architecture/module-structure.md` | `src/modules/jira-sync/{domain,application,infrastructure,presentation,index.ts}`; boundary rules enforced by `src/architecture/module-boundaries.spec.ts` (lints the real `src` tree) | Met |
| `JiraConnection` entity and migration (cloudId, site URL, linked board, encrypted access/refresh tokens, expiry, scopes) | `infrastructure/persistence/jira-connection.entity.ts`: `boardId` (unique), `cloudId`, `siteUrl`, `accessTokenEnc`, `refreshTokenEnc`, `expiresAt`, `scopes`, `connectedById`, `connectedAt`; table created by `src/database/migrations/1791053289431-ModularRestructure.ts`; `test/migrations.e2e-spec.ts` applies, reverts and re-applies on an empty database and checks there is no schema drift | Met |
| `TokenCipher` uses AES-256-GCM with a random IV per value and the key from config | `infrastructure/aes-gcm-token-cipher.ts`: `aes-256-gcm`, 12-byte `randomBytes` IV per call, key from `crypto.tokenEncryptionKey` (validated as 64 hex characters at startup); bound to the `TOKEN_CIPHER` port | Met |
| Tokens are never written to logs or API responses | Token columns are `select: false`; `GET /jira/connection` returns a token-free view (`JiraConnectionStatus`); the only log lines in the module (`atlassian-oauth.http-client.ts`) contain the HTTP status and the provider error code; `atlassian-oauth.http-client.spec.ts › never logs the code, verifier, secret or tokens`; `test/jira-oauth.e2e-spec.ts` asserts the stored row and the status response contain neither the plaintext nor the provider's token | Met |
| Unit tests: round trip, tamper detection, wrong key | `aes-gcm-token-cipher.spec.ts`: round trip (incl. empty string and Unicode), different IVs for equal plaintexts, ciphertext never contains the plaintext, modified ciphertext, modified auth tag, wrong key, malformed stored values, key length check | Met |

## Runs on 2026-10-21 (`dev` at `69e1fb0`)

| Command | Result |
| --- | --- |
| `pnpm lint` | 0 errors, 3 warnings (pre-existing `no-unsafe-return`) |
| `pnpm typecheck` | passed |
| `pnpm test` | 18 suites, 232 tests passed |
| `pnpm test:e2e` (PostgreSQL 16) | 5 suites, 79 tests passed |
| `openspec validate --specs --strict` | 13 specs passed |

## Notes

- Tokens are encrypted before they reach the database, so even with `DATABASE_LOGGING=true` the SQL log only contains ciphertext.
- Token refresh is not part of T-15; it belongs to the Jira client (T-23).
