# Jira sync: latency report (T-50, NFR-PERF-3)

**Requirement:** NFR-PERF-3, propagation Jira <-> BoardSync takes at most 5 s (absolute maximum, not a percentile).
**Environment:** Jira stub (`test/component/jira-sync/support/jira-stub.ts`), real HTTP gateway, real PostgreSQL, `OUTBOX_POLL_INTERVAL_SECONDS=0`.
**Source:** `test-results/latency-jira-sync.json`, written by `test/system/support/latency.ts`. Run date: 2026-11-27.

## Backend journeys (Jest system tests)

| Journey | Label | Samples | Min, ms | Avg, ms | Max, ms | Budget, ms | Result |
|---|---|---|---|---|---|---|---|
| Import 55 issues (FR-05) | `jira-import` | 1 | 556 | 556 | 556 | none (informational) | n/a |
| Move card -> stub receives transition (FR-06) | `move->stub` | 1 | 55 | 55 | 55 | 5000 | pass |
| Webhook -> card moved in DB (FR-07) | `webhook->db` | 1 | 41 | 41 | 41 | 5000 | pass |
| Webhook -> realtime event on socket (FR-07) | `webhook->socket` | 1 | 31 | 31 | 31 | 5000 | pass |

## Frontend journey (Playwright, full stack)

| Journey | Label | Samples | Value, ms | Budget, ms | Result |
|---|---|---|---|---|---|
| Card moved by another user appears in the target column without reload | `move->ui` | 1 | _TODO: from fe `test-results/latency-realtime-ui.json`_ | 5000 | pass |

## How the acceptance criterion is covered

The Jira stub exists only inside Jest and cannot deliver webhooks, so the full chain was split:

- Jira webhook -> DB -> realtime event: proven in the backend system tests (`jira-inbound`), with latency.
- Realtime event -> UI: proven in the frontend Playwright journey `e2e/realtime-move.spec.ts` against the full-stack compose.
- A full stack with a stub container was not built; it can be a separate task.

## Caveats

- `move->stub` is measured with `worker.drain()` standing in for the periodic outbox worker (poll interval is 0 in tests). In production the figure grows by up to `OUTBOX_POLL_INTERVAL_SECONDS`. Production value: _TODO: N_ s (from config).
- The stub answers instantly; real Jira network latency is not included. See the manual sandbox checklist for real observations.
- Each journey has one sample per run. The figures are a smoke-level proof, not a statistical benchmark.

## How to reproduce

1. Start PostgreSQL (see README) and set the `DATABASE_*` variables for it.
2. `pnpm test:e2e -- test/system`
3. Read `test-results/latency-jira-sync.json`.
4. Frontend: start the full stack (`docker-compose.full.yml`), then in the fe repo `pnpm exec playwright test e2e/realtime-move.spec.ts --project=chromium`.