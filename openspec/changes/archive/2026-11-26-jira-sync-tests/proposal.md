## Why

T-48 (KAN-59) asks for unit coverage of the most critical module, `jira-sync`: mappers, token cipher,
conflict resolution, outbox and loop guard, and FE tests for the Jira connection UI. Review of the
first version of the branch found that most of it was resilience work that belongs to KAN-46 (a retry
wrapper that re-posted comments and transitions, a token-refresh service the gateway already
implements, a retry endpoint that posted empty comments) and that the connection status could tell
every admin to reconnect a healthy, idle connection. Those parts were removed. What remains is a
small read API for the sync log, a corrected `requiresReconnect` flag and the missing tests.

## What Changes

- **Corrected `requiresReconnect`.** `GET /jira/connection` reports `requiresReconnect: true` only
  when the stored refresh token is gone (the gateway clears it on `invalid_grant`) and the access
  token has expired, the gateway's own "reconnect required" condition. An expired access token with a
  refresh token present is refreshed on the next call and is not reported.
- **Sync log read API.** `GET /jira/sync-logs?boardId=&status=&limit=&cursor=` lists the board's
  `sync_logs` rows newest first with keyset paging for board Admins. There is no retry endpoint:
  status moves are retried by the outbox (`POST /jira/sync/outbox/{id}/requeue`, KAN-46) and a
  comment is never re-posted (`jira-comment-sync`, "attempt each comment at most once").
- **Unit tests.** New or extended specs for the Jira error mapper, the AES-GCM cipher (malformed
  stored values), conflict listing and resolution and the connection status flag. The existing specs
  for the loop guard (user-origin check on card moves and comments), the outbox and the detector are
  kept. Mutation probes on the key guards are recorded in `tasks.md`.
- **Contract.** OpenAPI gains `GET /jira/sync-logs`, the `JiraSyncLog*` schemas and
  `requiresReconnect` on `JiraConnectionStatus`.

### Non-goals

- Any retry, backoff or token-refresh logic (KAN-46 and the gateway own them).
- Frontend retry of sync-log rows.

## Capabilities

### New Capabilities

- `jira-sync-logs`: the Admin sync-log list.
- `jira-sync-quality`: the unit-test coverage the module is held to.

### Modified Capabilities

- `jira-oauth-connection`: the status response carries `requiresReconnect`.
- `api-contract`: the sync-log operation and the new status field are documented.

## Impact

- `src/modules/jira-sync`: `JiraConnectionService.getStatus`, new `JiraSyncLogsService` and
  controller, DTO.
- `docs/api/openapi.yaml`; the frontend copy and generated types follow.
- Tests: unit, `test/jira-sync-logs.e2e-spec.ts`. No migration, no new dependency, no config.
