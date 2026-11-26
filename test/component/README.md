# jira-sync component tests

Real `JiraGateway` over HTTP to `support/jira-stub.ts` (no `JIRA_GATEWAY` override).

## Run

Needs PostgreSQL (see `test/setup-env.ts`).

```bash
pnpm test:component   # this folder
pnpm test:e2e         # all *.e2e-spec.ts
```

`OUTBOX_POLL_INTERVAL_SECONDS=0` disables polling; `OutboxWorker.kick()` pumps once, so move syncs run immediately. Latency spec uses real timers (no `OUTBOX_CLOCK` override).

## Stub modes

`new JiraStub({ baseUrl: '', cloudId })`, then `await stub.start()` (`stub.url`).

- `normal` — happy path
- `down` — connection errors/503
- `status` — reply with `stub.setStatus(code)`
- `delay` — reply after `stub.setDelay(ms)`

Seed with `seedProject`/`seedIssue`/`seedTransitions`/`seedComments`; inspect `findCalls(predicate)`/`lastCall()` (`RecordedCall.receivedAt` is epoch ms); `reset()` clears all.

## Add a scenario

1. Add `test/component/jira-sync/<name>.e2e-spec.ts`; in `beforeAll` start the stub, point `JIRA_AUTH_BASE_URL`/`JIRA_API_BASE_URL` at `stub.url`, compile `AppModule`, `configureApp`, `init()`.
2. Create a board, save `JiraConnectionEntity`, set `BoardEntity.jiraProjectKey`, link cards, seed the stub issue/transitions; drive via `test/helpers.ts` and assert with `waitFor` + `stub.findCalls` (`worker.drain()` for non-move flows when poll=0).
