# deadline-reminders Specification

## Purpose
Defines the 24-hour deadline reminders for card assignees (FR-09): the idempotent scheduler, the in-app notifications store with its endpoints, and the realtime push of `notification.created`.

## Requirements

### Requirement: Deadline reminder
The system SHALL create one in-app notification of type `deadline.reminder` for the assignee of every card whose deadline lies within the next 24 hours and that has not been reminded yet, and SHALL record the reminder on the card (`reminderSentAt`). Cards without an assignee or deadline, and cards whose deadline has already passed, SHALL NOT be reminded.

#### Scenario: Card due within 24 hours
- **WHEN** the scheduler runs and a card assigned to Bob is due in 3 hours
- **THEN** Bob has one unread `deadline.reminder` notification with the card id, board id, card title and deadline

#### Scenario: Card not due soon
- **WHEN** the scheduler runs and a card is due in 30 hours, or is overdue, or has no assignee
- **THEN** no notification is created for it

### Requirement: Reminders are idempotent
A card SHALL be reminded at most once per deadline and assignee, across scheduler runs, restarts and concurrently running instances. The claim and the notification SHALL be stored in one transaction. Changing the card's deadline or assignee SHALL allow a new reminder.

#### Scenario: Second run
- **WHEN** the scheduler runs again, or the application restarts and runs it
- **THEN** no second notification is created for an already reminded card

#### Scenario: Concurrent runs
- **WHEN** two scheduler runs execute at the same time
- **THEN** each due card is reminded exactly once

#### Scenario: Deadline moved
- **WHEN** an Editor changes the deadline of a reminded card to another time within the next 24 hours
- **THEN** the next run creates a new reminder

### Requirement: Scheduler interval
The scheduler SHALL run every `REMINDER_INTERVAL_SECONDS` seconds (default 60) while the application runs, SHALL be disabled when the value is `0`, SHALL not start a run while the previous one is still in progress, and SHALL stop when the application shuts down.

#### Scenario: Interval elapses
- **WHEN** the configured interval elapses
- **THEN** one reminder run is started

#### Scenario: Disabled
- **WHEN** `REMINDER_INTERVAL_SECONDS` is `0`
- **THEN** no timer is started

### Requirement: Times are UTC
All reminder and notification times SHALL be stored as `timestamptz` and returned as ISO-8601 UTC strings; the 24-hour window SHALL be computed from the server clock in UTC.

#### Scenario: Notification times
- **WHEN** a client reads a notification
- **THEN** `createdAt`, `readAt` and the payload `deadline` end in `Z`

### Requirement: Realtime push
After a notification is stored, the system SHALL publish `notification.created` with `{ recipientId, notification }` and the card's `boardId`, which the realtime module delivers to the room `user:{recipientId}`.

#### Scenario: Assignee is online
- **WHEN** a reminder is created for Bob while Bob's client is connected
- **THEN** Bob's client receives `notification.created` with the new notification

### Requirement: Notifications endpoints
`GET /notifications` SHALL return the current user's notifications newest first with cursor pagination (`limit` 1..100, default 50, `nextCursor`). `POST /notifications/{notificationId}/read` SHALL mark the user's notification read and return it; repeating it SHALL keep the first `readAt`.

#### Scenario: List
- **WHEN** Bob requests `GET /notifications?limit=1` and has two notifications
- **THEN** he receives the newer one and a `nextCursor` that returns the older one

#### Scenario: Mark read
- **WHEN** Bob marks his notification read
- **THEN** the response has a `readAt` time and the list shows it as read

### Requirement: Notifications are private
A user SHALL only list and mark their own notifications; another user's notification SHALL answer 404, the same as an unknown id.

#### Scenario: Other user's notification
- **WHEN** Carol tries to mark Bob's notification read
- **THEN** she receives 404 and Bob's notification stays unread
