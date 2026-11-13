# Boards Module

This module manages the core domain of BoardSync: kanban boards, columns, cards, and board memberships.

## Role Matrix

Board access is governed by the `BoardAccessGuard` and enforced via the `@BoardRoles()` decorator based on the following matrix:

| Action                          | Admin | Member | Viewer    |
| ------------------------------- | ----- | ------ | --------- |
| List members                    | ✅    | ✅     | ✅        |
| Invite / change / remove member | ✅    | ❌     | ❌        |
| Create / move / edit cards      | ✅    | ✅     | ❌        |
| Read cards / comments           | ✅    | ✅     | read-only |
| Board settings / manage columns | ✅    | ❌     | ❌        |

## Deadline reminders

`DeadlineRemindersService` runs every `REMINDER_INTERVAL_SECONDS` (default 60, `0` = off). It claims cards with an assignee and a deadline in the next 24 hours (`cards.reminder_sent_at IS NULL`) in one `UPDATE ... RETURNING`, stores a `deadline.reminder` notification per card in the same transaction and then publishes `notification.created` (pushed to `user:{assigneeId}`). Changing the deadline or the assignee clears `reminder_sent_at`. Users read and mark their notifications through `GET /notifications` and `POST /notifications/{id}/read`.
