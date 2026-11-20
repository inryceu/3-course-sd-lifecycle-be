# T-35 handoff (authoritative; overrides design.md where they differ)

Stack: TS, NestJS, TypeORM, Postgres, pnpm. Branch KAN-46.
Goal: Jira outage must not lose card moves (NFR-REL-2).

## Lean scope (overrides)
- Only TRANSITION_ISSUE, but table is generic: operation varchar(64) + jsonb payload + handler registry.
- NO bulk requeue. NO throttled_count. NO gateway 429 change. NO extra listProjectStatuses call.
- 429 = transient, honour Retry-After clamped to OUTBOX_MAX_DELAY_MS, consumes an attempt (MAX_ATTEMPTS=20 covers it).
- No direct transition to target => permanent `no_transition_path` => DEAD + notify. Direct-only, no BFS.
- Enqueue only if: user move, column changed, card has jiraIssueKey, board has jiraProjectKey.

## Table sync_outbox
id uuid PK, sequence bigint identity unique, operation varchar(64), board_id uuid, card_id uuid,
actor_id uuid null, payload jsonb, status enum(PENDING,IN_PROGRESS,SENT,DEAD), attempts int default 0,
available_at timestamptz, locked_at null, locked_by varchar(128) null, last_error text null (sanitized),
error_code varchar(64) null, result jsonb null, sent_at null, dead_at null, created_at, updated_at.
Indexes: partial unique (card_id, operation) WHERE PENDING; partial unique (card_id) WHERE IN_PROGRESS;
claim (status, available_at, sequence); (card_id, sequence); (board_id, status, created_at DESC, id DESC).
Migration timestamp must be > 1794591351977 (and > 1794596054264 if KAN-45 is merged).
Entity under src/common/outbox/infrastructure/persistence/; extend glob in src/config/database-config.ts;
add sync_outbox to test/migrations.e2e-spec.ts.

## Behaviour
- Enqueue inside the CardsService.move transaction via the tx EntityManager. Rollback removes the row.
- Coalesce into an existing PENDING row (same card+operation): update payload+actor; if target changed
  reset attempts=0; keep sequence/available_at. Never touch IN_PROGRESS/SENT/DEAD.
- Claim: head-of-line per card (DISTINCT ON card_id, lowest sequence among PENDING/IN_PROGRESS/DEAD),
  keep PENDING+due heads, FOR UPDATE SKIP LOCKED, UPDATE re-checks status='PENDING'. Raw SQL.
- Worker: poll 5s + kick() after commit; refill free concurrency slots as handlers finish;
  reclaim stale IN_PROGRESS (locked_at older than 30s) every tick; graceful shutdown.
- Backoff: full jitter on min(cap, base*2^(n-1)), floor=base, delay <= cap always.
- Failure: transient (network/timeout/5xx/429) -> PENDING+backoff, attempts+1; attempts>=N -> DEAD
  attempts_exhausted; permanent (401 after refresh, 403, 404, no_transition_path, handler_missing) -> DEAD.
- DEAD blocks later rows of the same card until Admin requeue.
- Handler: getIssue -> current status maps to target => SENT no-op; else listTransitions, pick direct one,
  doTransition once; budget 5s per attempt passed as timeBudgetMs to each Jira call.
  400/409 on doTransition: re-read status; changed => transient, else permanent.
- On DEAD: notify all board Admins via BoardsFacade.notifyBoardAdmins(boardId, type, payload): Promise<number>
  (KAN-45 signature, do not invent another) + mover via new notifyUser(userId, boardId, type, payload)
  if mover is not Admin. Dedup, best-effort, type 'jira.sync.failed'. Payload has no secrets.
- Admin API (board Admin only via JiraStatusMappingService.requireRole):
  GET /api/v1/jira/sync/outbox?boardId&status(default DEAD)&limit&cursor (newest first)
  POST /api/v1/jira/sync/outbox/{id}/requeue (404/403/409; resets attempts, merges later PENDING)
- Config defaults: POLL 5, BATCH 20, CONCURRENCY 5, MAX_ATTEMPTS 20, BASE_DELAY_MS 1000,
  MAX_DELAY_MS 30000, LOCK_STALE_MS 30000, SENT_RETENTION_DAYS 7. test/setup-env.ts: POLL=0.
- Drain math: 30s cap + 5s poll + 5s handler = 40s < 60s for backlog <= 100 rows at <=200ms/call.

## Token rules for the agent
- Read ONLY this file plus the files you edit. Do not read design.md/proposal.md unless a task says so.
- No repo-wide exploration, no summaries of what you read. Use rg for targeted lookups.
- Run targeted tests (single spec file), not the full suite. Full suite only in the last session.
- Final reply: max 10 lines (files changed, commands + pass/fail, deviations). Do not commit.