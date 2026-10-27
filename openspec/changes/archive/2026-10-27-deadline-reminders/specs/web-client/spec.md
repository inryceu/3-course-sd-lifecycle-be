## ADDED Requirements

### Requirement: Notifications bell
The web client SHALL show a notifications bell in the header of every signed-in page with the number of unread notifications. Opening it SHALL list the user's notifications newest first, let the user mark one read, and the bell SHALL update without a reload when a `notification.created` event arrives.

#### Scenario: Unread count
- **WHEN** a signed-in user has two unread notifications
- **THEN** the bell shows 2

#### Scenario: Mark read
- **WHEN** the user opens the bell and marks a deadline reminder read
- **THEN** the item is shown as read and the count decreases

#### Scenario: Live reminder
- **WHEN** a reminder is created for the user while the page is open
- **THEN** the count increases and the reminder appears in the list without a reload
