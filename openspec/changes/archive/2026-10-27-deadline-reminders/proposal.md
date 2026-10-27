## Why

FR-09 (T-32, KAN-43): the assignee of a card must be reminded 24 hours before the card's deadline. The contract already reserves `GET /notifications` and `POST /notifications/{notificationId}/read` (marked `x-implemented-in: T-32`), and the event bus and realtime gateway already know the `notification.created` event and the personal room `user:{userId}`, but nothing creates notifications yet.

## What Changes

- **Reminder scheduler** in the `boards` module. On a fixed interval (`REMINDER_INTERVAL_SECONDS`, default 60, `0` turns it off) it claims every card that has an assignee, a deadline in the next 24 hours and no `reminderSentAt` yet, in one atomic `UPDATE ... RETURNING`, and creates one `deadline.reminder` notification per claimed card in the same transaction.
- After the commit each notification is published as `notification.created`; the existing realtime listener pushes it to `user:{recipientId}`.
- **Idempotency:** `cards.reminder_sent_at` (UTC `timestamptz`) records the claim, so restarts and several instances never remind twice. Changing a card's deadline or assignee clears it, so the new deadline gets its own reminder.
- **Notifications API** (contract paths):
  - `GET /notifications`: the current user's notifications, newest first, cursor pagination (`limit`, `cursor`, `nextCursor`).
  - `POST /notifications/{notificationId}/read`: marks it read and returns it. Another user's or an unknown notification answers 404.
- New table `notifications`, owned by `boards`, with a migration.
- The two operations lose `x-implemented-in` in `docs/api/openapi.yaml`.
- **Web client:** a notifications bell in the header shows the unread count and the list, marks items read, and updates live on `notification.created`.
- E-mail delivery is out of scope.

## Capabilities

### New Capabilities

- `deadline-reminders`: the reminder scheduler, the notifications store and the notifications endpoints.

### Modified Capabilities

- `api-contract`: the notifications operations are implemented and no longer marked `x-implemented-in`.
- `web-client`: the notifications bell.

## Impact

- Backend: `src/modules/boards` (card column, `NotificationEntity`, `DeadlineRemindersService`, `NotificationsService`, `NotificationsController`), migration, `src/config` (`REMINDER_INTERVAL_SECONDS`), `docs/api/openapi.yaml`.
- Frontend: notifications bell in the layout, regenerated API types.
- No new dependencies (a plain `setInterval` instead of `@nestjs/schedule`).
