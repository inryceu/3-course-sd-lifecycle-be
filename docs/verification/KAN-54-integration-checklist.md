# KAN-54 (T-43) — Integration review: FE ↔ BE against the OpenAPI contract

Executed on 21 Nov 2026 against the Compose stack (`docker-compose.full.yml`) built from the Sprint 6
consolidation branches (`sprint-6` in both repositories: KAN-38, 39, 42, 44, 45, 47, 48, 51, 56, 57, 58,
65, 70 merged on top of `dev`). Web client on `:8090`, API on `:8090/api/v1` through nginx.

## Acceptance criteria

| Criterion | Result | Evidence |
| --- | --- | --- |
| CI regenerates FE types from `openapi.yaml` and fails on drift | ✅ | Frontend `ci.yml`, TypeCheck job: `pnpm api:generate` + `git diff --exit-code src/api/api.generated.ts`. |
| Backend checked against the contract | ✅ | KAN-57: `test/openapi-setup.ts` validates **every** e2e HTTP response (status and body, incl. error bodies) with `jest-openapi`; only routes asserted as non-existent opt out. 14 suites / 158 tests pass on `sprint-6`. |
| Integration checklist FR-01…FR-13 on the Compose stack, results recorded | ✅ | This document (table below). |
| Mismatches fixed or turned into follow-up tickets | ✅ | Section "Mismatches found during integration" (all fixed) and "Follow-ups". |

## Checklist FR-01 … FR-13

Live checks used fresh test users and boards only. The "Demo board" is linked to the real Jira project, so
on it only read-only calls were made; outbound/inbound sync is verified by the e2e suites with a faked Jira
gateway.

| FR | Requirement | Check | Result |
| --- | --- | --- | --- |
| FR-01 | Registration and login | Playwright `auth.spec.ts` (register → log out → sign in) in Chromium, Firefox, Edge; wrong password → 401 | ✅ |
| FR-02 | Connect Jira via OAuth 2.0 (3LO) | Live, read-only: `GET /jira/connection` on the Demo board → 200 `connected: true`, site `kanban-proj.atlassian.net`; OAuth flow in `jira-oauth.e2e-spec.ts` | ✅ |
| FR-03 | Boards with ≥ 3 columns | Playwright `board.spec.ts`; new boards get To Do / In Progress / Done | ✅ |
| FR-04 | Create cards manually | Playwright `board.spec.ts` (add cards, drag to another column) in 3 browsers | ✅ |
| FR-05 | Import open Jira issues | Live, read-only: `GET /jira/projects` → `["KAN"]`, `GET /jira/status-mappings` → 5 mappings; import flow in `jira-import.e2e-spec.ts` | ✅ |
| FR-06 | Board → Jira status sync (≤ 5 s) | `jira-status-sync.e2e-spec.ts` (faked gateway, 5 s budget, per-issue ordering) | ✅ (automated only) |
| FR-07 | Jira → board status sync (≤ 5 s) | `jira-webhook.e2e-spec.ts` (signed deliveries, dedup, watermark); live: unsigned delivery → 401, 110 deliveries never throttled | ✅ (automated + live negative) |
| FR-08 | Labels | Live: label without colour → 201 with default colour, name trimmed; duplicate → 409; UI: label popover with create/rename/delete (KAN-42) | ✅ |
| FR-09 | Deadlines + reminder 24 h before | Live: card due in 2 h assigned to a member → `deadline.reminder` notification after 40 s (scheduler interval 60 s); deadline stored as UTC midnight; badges in UI (KAN-48) | ✅ |
| FR-10 | Comments mirrored to Jira | Live: comment on an unlinked board stays `syncedToJira: false`; mirroring in `jira-comment-sync.e2e-spec.ts` (KAN-44, faked gateway) | ✅ (automated only) |
| FR-11 | Real-time updates | Live (socket.io-client): member and stranger join → `ok` / `forbidden`; `X-Socket-Id` skips only the originating socket; removed member gets `member.removed`, cannot rejoin and receives no further events; UI shows "Live" | ✅ |
| FR-12 | Invitations and roles | Live: Viewer comment → 403, Viewer deletes another's comment → 403; Playwright `viewer.spec.ts` in 3 browsers | ✅ |
| FR-13 | Sync conflict logging + admin notification | Live: `GET /jira/conflicts` Admin 200 / Member 403 / stranger 404, unknown conflict resolve → 404; detection in `jira-conflicts.e2e-spec.ts` (KAN-45) | ✅ |

Non-functional, measured on the same stack (Playwright `performance.spec.ts`, 100 cards, 1280×720):

| Browser | Board load | 1280 px layout |
| --- | --- | --- |
| Chromium | 451 ms | no horizontal overflow |
| Firefox | 381 ms | no horizontal overflow |
| Edge | 430 ms | no horizontal overflow |

Security (KAN-47), live: helmet headers on API responses (`X-Frame-Options: DENY`, CSP; Swagger without CSP),
foreign CORS origin refused, unknown body fields → 400, 6th registration from one client → 429 while another
forwarded client still gets 201, 101st request per minute → 429, a wrong password never appears in the logs.

## Mismatches found during integration (all fixed)

| # | Where | Mismatch | Fix |
| --- | --- | --- | --- |
| 1 | Contract × KAN-47 | Rate-limited routes answer 429, but `openapi.yaml` documented 429 nowhere; KAN-57's validator rejected the responses | Shared `TooManyRequests` response referenced by the 44 throttled operations (`sprint-6`) |
| 2 | KAN-47 × KAN-58/65 | Fixed limits (5 registrations / 10 logins per 5 min, 100 req/min) made 10 of 16 Playwright tests fail with 429 | Limits configurable via `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_REGISTER`, `RATE_LIMIT_LOGIN` (KAN-47); the e2e workflow raises them (KAN-58) |
| 3 | nginx × KAN-47 | Server-level `add_header` in the web client's nginx was inherited by `/api/`: duplicate `X-Frame-Options` (DENY + SAMEORIGIN), two `Referrer-Policy` values and a second CSP on the Swagger UI | Security headers moved into `location /` (frontend `sprint-6`) |
| 4 | KAN-48 × KAN-45 | Conflict resolve sent `JIRA` / `BOARD`; contract is `jira` / `boardsync` | Fixed on KAN-48, types regenerated from KAN-45 |
| 5 | KAN-39 × KAN-38 | Client ignored `member.removed` and filtered echoes by user id instead of `X-Socket-Id` | Fixed on KAN-39 |

## Follow-ups (proposed tickets)

1. **Outbox / retry for failed Jira writes** (FR-06, FR-10): failed status transitions and comments are logged
   (`sync_logs`, `outcome: unknown` for timeouts) but not retried. Planned scope of T-35/T-49 (KAN-46).
2. **Notify users about failed syncs** (FR-06): failures are visible only to operators (log + `sync_logs`).
3. **Live Jira round trip** (FR-06/07/10/13): run once against a disposable Jira project, not the team's
   backlog, to confirm the real webhook payload format (`issue.self` site lookup, 3LO JWT claims).
4. **Concurrent card edits**: the card panel keeps a user's draft when someone else edits the card, but the
   later save overwrites the other change without warning.
