## 1. Remove duplicated resilience code

- [x] 1.1 Delete `JiraRetryService` and its use in comment and status sync, restoring the KAN-46
  versions of those services and specs
- [x] 1.2 Delete the unused `JiraTokenRefreshService`
- [x] 1.3 Delete `POST /jira/sync-logs/{id}/retry`, its service method, controller action and OpenAPI entry

## 2. Behaviour

- [x] 2.1 `requiresReconnect` true only for a cleared refresh token with an expired access token
- [x] 2.2 `GET /jira/sync-logs` documented with 400/401/403/404 and covered by an e2e against Postgres

## 3. Tests

- [x] 3.1 Jira error mapper spec (every gateway error to its HTTP answer)
- [x] 3.2 Cipher: malformed and extended stored values are refused
- [x] 3.3 Conflicts service: list (role, paging, cursor scoped to the board)
- [x] 3.4 Connection status: idle but refreshable, revoked, fresh, not connected
- [x] 3.5 Mutation probes, all killed: loop guard in comment sync, in status sync and in the status
  listener; conflict window boundary (`<=` to `<`); resolve claim (`affected` check removed);
  `requiresReconnect` refresh-token check and expiry check; cipher auth tag and trailing-part checks;
  mapper `403` check for `missing_scope`
- [x] 3.6 `pnpm test:cov` passes the global gate and the per-service gate (85 %)
