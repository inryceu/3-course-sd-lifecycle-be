## 1. Contract

- [x] 1.1 Drop `x-implemented-in` from the notifications operations in `docs/api/openapi.yaml`, document 400 for an invalid cursor; verify `pnpm api:validate`

## 2. Persistence

- [x] 2.1 `cards.reminder_sent_at`, `NotificationEntity` (table `notifications`) and the migration; verify run, revert, run on a fresh Postgres

## 3. Backend

- [x] 3.1 `REMINDER_INTERVAL_SECONDS` (default 60, `0` off) in the validation schema, the typed config and `.env.example`; verify config unit tests
- [x] 3.2 `DeadlineRemindersService`: interval in `onModuleInit`/`onModuleDestroy`, atomic claim + notifications in one transaction, `notification.created` after commit; verify unit tests with fake timers
- [x] 3.3 Clear `reminderSentAt` when the deadline or the assignee changes; verify a unit test
- [x] 3.4 `NotificationsService` and `NotificationsController` (`GET /notifications`, `POST /notifications/{id}/read`); verify a component test on real Postgres: due card → one notification, second run → none, concurrent runs → one, list + pagination + mark read, other user 404, event emitted

## 4. Frontend

- [ ] 4.1 Regenerate API types; notifications bell in the layout (unread count, list, mark read, live update on `notification.created`); verify component tests

## 5. Verification

- [ ] 5.1 Backend `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm api:validate`, `openspec validate --specs --strict`; frontend `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
