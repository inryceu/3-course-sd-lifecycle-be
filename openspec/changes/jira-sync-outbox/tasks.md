## 1. Planning artifacts

- [x] 1.1 Create `.openspec.yaml`, `proposal.md` and this task list for T-35 / NFR-REL-2
- [x] 1.2 Write `design.md` with the durable outbox, direct-only transition, head-of-line claim,
  retry/backoff, 429, stale recovery, Admin API and notification decisions
- [x] 1.3 Write the `jira-status-sync` and `api-contract` spec deltas with Given/When/Then scenarios
- [x] 1.4 Run `openspec validate jira-sync-outbox --strict` and fix every error
- [x] 1.5 Report the files, validation command, deviations and open questions; do not commit

## 2. Schema and configuration

- [ ] 2.1 Add a migration for `sync_outbox` using `board_id`/`card_id` (no aggregate columns):
  `id`, `board_id`, `card_id`, `actor_id`, `operation varchar(64)`, `payload`, `status`, `attempts`,
  `throttled_count`, `available_at`, `locked_at`, `locked_by varchar(128)`, `last_error`,
  `error_code varchar(64)`, `result jsonb`, `sent_at`, `dead_at`, `sequence`, timestamps; add the
  PENDING/IN_PROGRESS partial unique indexes, due/claim indexes, and the admin listing index
  `(board_id, status, created_at DESC, id DESC)`; coordinate the timestamp with KAN-45
  (`1794596054264` if it lands first)
- [ ] 2.2 Add `SyncOutboxEntity` under `src/common/outbox` with the status/operation types and
  sanitized error handling
- [ ] 2.3 Add `OUTBOX_POLL_INTERVAL_SECONDS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_CONCURRENCY`,
  `OUTBOX_MAX_ATTEMPTS=20`, `OUTBOX_BASE_DELAY_MS`, `OUTBOX_MAX_DELAY_MS`,
  `OUTBOX_LOCK_STALE_MS`, `OUTBOX_MAX_THROTTLES=100` and `OUTBOX_SENT_RETENTION_DAYS` to the typed
  config, Joi schema, `.env.example` and the README table
- [ ] 2.4 Register the entity for the app and TypeORM CLI (`autoLoadEntities` plus the
  `database-config.ts` glob for `src/common/**/*.entity.ts`); update expected-table assertions if
  the migration e2e suite has them
- [ ] 2.5 Add migration/entity/config tests, including fresh up/down and the two partial indexes

## 3. Transactional enqueue, coalescing and worker

- [ ] 3.1 Add the generic outbox module, `OutboxHandler` port and handler registry
- [ ] 3.2 Insert the eligible `TRANSITION_ISSUE` row inside `CardsService.move` through the common
  outbox helper when the card has a `jiraIssueKey` and the board has a `jiraProjectKey`; no Jira call
  in the request; roll back the move if the insert fails
- [ ] 3.3 Coalesce a new move into an existing PENDING row for the same card/operation, preserving
  sequence, timestamps and availability; reset attempts and throttles when the target column changes,
  otherwise preserve them; add the PENDING unique index
- [ ] 3.4 Replace the direct `JiraStatusSyncListener -> JiraStatusSyncService` path with a worker
  kick; remove the in-process `chains` map
- [ ] 3.5 Implement the head-of-line claim (`PENDING/IN_PROGRESS/DEAD`, lowest sequence per card,
  due PENDING only, `FOR UPDATE SKIP LOCKED`, `PENDING` re-check), fill only free concurrency slots
  and refill them immediately, and reclaim stale rows on every 5s maintenance tick; the poll is
  not a one-batch-per-interval throttle
- [ ] 3.6 Add DB tests: atomic enqueue and rollback, coalescing, a two-claimer concurrency loop of at
  least 200 iterations asserting the one-IN_PROGRESS-per-card invariant every iteration, no successor
  claim while the head is locked, stale recovery, and per-card order

## 4. Transition handler, retries and dead letter

- [ ] 4.1 Implement `TRANSITION_ISSUE`: `getIssue`, current target -> `SENT`/no-op, one direct
  available transition, no mapped status -> `SENT`/`unmapped_target`, mapped but unreachable ->
  permanent `no_transition_path`; no BFS or multi-step path. On the no-candidate path, add optional
  `timeBudgetMs` to `ListProjectStatusesInput`/the HTTP client and call `listProjectStatuses`
  directly with the remaining budget before `resolveMappings`
- [ ] 4.2 Classify failures and implement capped full-jitter backoff, 400/409 re-read, unknown
  `doTransition` outcomes, and 429 `Retry-After` without consuming `attempts`
- [ ] 4.3 Enforce 20 attempts, 100 throttles, `attempts_exhausted`/`rate_limited_exhausted`, and
  the later-PENDING supersede rule for the throttle cap
- [ ] 4.4 Keep exactly one `TO_JIRA` `sync_logs` row per `TRANSITION_ISSUE` handler attempt,
  including no-op, `unmapped_target` and `superseded` outcomes, with outboxId, attempt,
  outcome/reason, target status/transition, retryable, errorCode and latency; sanitize `last_error`
- [ ] 4.5 On terminal DEAD, add `jira.sync.failed` and notify all board Admins plus the latest mover
  with deduplication, using `notifyBoardAdmins` and a new `notifyUser`; `notifyUser` is a no-op if the
  user left the board; best-effort, no retry on notification failure
- [ ] 4.6 Unit tests for classification, backoff bounds, direct choice, no-op, unmapped no-op,
  mapped-but-unreachable, coalescing, throttle handling, notification recipients and redaction

## 5. Gateway 429 classification

- [ ] 5.1 Add failing tests that a 429 whose `Retry-After` exceeds the call budget throws
  `JiraRateLimitedError`, not `JiraTimeBudgetExceededError`
- [ ] 5.2 Change the gateway to surface the rate-limit error immediately; keep the existing inbound
  sync and KAN-45 call paths working
- [ ] 5.3 Run the gateway tests for existing callers and the outbox handler; do not change KAN-45
  business logic

## 6. Admin API and contract

- [ ] 6.1 Add `GET /api/v1/jira/sync/outbox` for board Admins with required `boardId`, optional
  `status` (default `DEAD`), `limit`/`cursor`, 400/403/404 and a sanitized response
- [ ] 6.2 Add `POST /api/v1/jira/sync/outbox/{outboxId}/requeue` with 403/404/409, reset of
  attempts/throttles, and merge of a later PENDING same-operation row
- [ ] 6.3 Add `POST /api/v1/jira/sync/outbox/requeue?boardId=...` for board Admins, scanning DEAD
  rows in sequence order, requeueing only unblocked rows and returning `{ requeued: n }`; register
  the static route before `{outboxId}`
- [ ] 6.4 Add DTO validation, stable error responses and admin e2e tests for list, single requeue,
  bulk requeue, idempotency and every 400/403/404/409 case; add a bulk-requeue case with one card
  holding two DEAD rows and assert only the first is requeued per call
- [ ] 6.5 Extend `docs/api/openapi.yaml` with the three operations, outbox schemas, `jira.sync.failed`
  and `throttledCount`; validate with `pnpm api:validate`
- [ ] 6.6 Update `docs/api/ws-events.md` for the new notification type and its payload

## 7. Component tests, docs and verification

- [ ] 7.1 Add `test/component/jira-outbox-outage-recovery.component-spec.ts` with the real worker
  loop, production timings and injectable clock/scheduler; at least 100 rows across distinct cards,
  fast 503s for the backlog plus a separate timeout case, recovery within a simulated 60s, per-card
  order and no duplicate transitions
- [ ] 7.2 Add a component test for permanent failure: DEAD after 20 attempts and one
  `jira.sync.failed` notification per unique Admin and mover
- [ ] 7.3 Update `docs/jira-status-sync.md`, `docs/architecture/module-structure.md`, the README and
  the verification record with the outbox flow, defaults, guaranteed 100-row/60s bound, 500-row
  best-effort requirement (`OUTBOX_CONCURRENCY >= 10`) and Admin recovery steps
- [ ] 7.4 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm api:validate` and
  `openspec validate jira-sync-outbox --strict`; fix every failure
- [ ] 7.5 Confirm no tokens/secrets in `last_error`, logs or Admin responses and record the
  verification evidence
