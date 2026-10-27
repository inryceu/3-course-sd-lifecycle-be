## Context

- Cards (`boards` module) have `deadline` (`timestamptz`) and `assignee_id` (a user id, no foreign key).
- `common/events` already defines `notification.created` with `{ recipientId, notification }`, and `realtime` forwards it to `user:{recipientId}`; every authenticated socket joins that room on connect.
- The contract reserves `GET /notifications` (`NotificationPage`, cursor pagination) and `POST /notifications/{notificationId}/read` (returns `Notification`), both `x-implemented-in: T-32`.
- No notifications table and no "reminded" marker exist yet.

## Goals / Non-Goals

**Goals:** one in-app reminder per card deadline for its assignee, live push, list and mark read, safe across restarts and several instances, UTC everywhere.
**Non-Goals:** e-mail, reminders for cards without an assignee, user-configurable lead times, other notification types (`jira.conflict`, `board.invited` stay reserved).

## Decisions

1. **Module:** reminders and notifications live in `boards`. Notifications are only about cards today, and a new module would need a new boundary rule for no gain. The ESLint boundary config stays as it is.
2. **Scheduler without a new dependency:** `DeadlineRemindersService` starts a `setInterval` in `onModuleInit` and clears it in `onModuleDestroy`. The interval comes from `REMINDER_INTERVAL_SECONDS` (default 60, `0` = off; the e2e environment sets `0` and calls `runOnce()` directly). `@nestjs/schedule` would add a dependency for one timer. Overlapping ticks are skipped while a run is in progress.
3. **Atomic claim:** one transaction runs
   `UPDATE cards SET reminder_sent_at = :now WHERE assignee_id IS NOT NULL AND reminder_sent_at IS NULL AND deadline > :now AND deadline <= :now + 24h RETURNING ...`
   and inserts the notifications for the returned rows. Under READ COMMITTED a concurrent run waits for the row lock, re-checks `reminder_sent_at IS NULL` and skips the row, so two instances never claim the same card. If the insert fails, the claim rolls back and the next tick retries.
4. **Publish after commit:** `notification.created` is published for each created notification after the transaction, with `boardId` = the card's board, no `actorId` and the default origin `user`. The event bus never rejects, so a failed push cannot undo the stored notification.
5. **Re-arming:** `CardsService.update` clears `reminderSentAt` when the deadline value changes, and `assign` clears it when the assignee changes. A card whose deadline is already within 24 hours is then reminded on the next tick.
6. **Clock and UTC:** the service takes `now` from `Date.now()` (fake timers can set it), and passes it as a parameter to the SQL; all columns are `timestamptz`, and the API returns ISO-8601 UTC strings.
7. **Table `notifications`:** `id`, `recipient_id` (uuid, no foreign key to `users`), `board_id`, `type` (varchar), `payload` (jsonb), `read_at` (timestamptz, null), `created_at`, `updated_at`; index `(recipient_id, created_at, id)`. The reminder payload is `{ cardId, boardId, cardTitle, deadline }`.
8. **Pagination:** newest first by `(created_at DESC, id DESC)`. The cursor is the id of the last item of the page; the next page compares against that row's full-precision `created_at`, so no ms rounding can skip or repeat rows. `limit` 1..100, default 50; a cursor that is not a uuid is 400.
9. **Mark read:** `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = :id AND recipient_id = :user RETURNING *`. Zero rows → 404, so another user's notification is indistinguishable from an unknown one. Repeating the call keeps the first `readAt`.

## Risks / Trade-offs

- An interval of 60 s means a reminder can arrive up to a minute after the card enters the 24-hour window; fine for a 24-hour reminder.
- A card created with a deadline less than 24 hours away is reminded on the next tick (the reminder says "due within 24 h", not "exactly 24 h").
- The notifications table grows without cleanup; retention is a later ticket if it matters.
