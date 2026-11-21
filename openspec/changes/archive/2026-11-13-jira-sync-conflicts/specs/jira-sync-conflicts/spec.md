## Purpose

Detect, log and resolve concurrent changes of one card in BoardSync and Jira (FR-13), with Jira as the default source of truth and board admins notified for a manual decision.

## ADDED Requirements

### Requirement: Detect concurrent changes within five seconds

The system SHALL record a sync conflict when, for one card linked to a Jira issue on a board, a BoardSync user move to another column and a Jira-originated status change of that issue are at most 5000 ms apart, in either order, and the Jira status maps to a different column than the user's destination. The user move time SHALL be the `card.moved` event's `occurredAt`; the Jira change time SHALL be the delivery's `timestamp`, or the receipt time when the delivery has none. A Jira status change that echoes a transition BoardSync itself made to the same status (a successful outbound transition logged at most 5000 ms before the change, or later) SHALL NOT count as a Jira change. Each pair of changes SHALL be recorded once, by whichever side is processed second.

#### Scenario: Jira change arrives after a user move

- **WHEN** a user moves a linked card to column B and, 2 seconds later, a delivery reports the issue in a status mapped to column C
- **THEN** one conflict is logged with BoardSync column B and Jira column C

#### Scenario: User move after a Jira change

- **WHEN** a delivery moves a linked card to column C and the user moves the card to column B 2 seconds later
- **THEN** one conflict is logged with BoardSync column B and Jira column C

#### Scenario: Changes more than five seconds apart

- **WHEN** the Jira change is 10 seconds older than the user move
- **THEN** no conflict is logged and the Jira change and the user move are processed as before

#### Scenario: Both sides agree

- **WHEN** a delivery within the window reports a status mapped to the user's destination column
- **THEN** no conflict is logged

#### Scenario: Echo of BoardSync's own transition

- **WHEN** BoardSync transitioned the issue to status S after a user move and the delivery for S arrives after the user moved the card again within 5 seconds
- **THEN** no conflict is logged

### Requirement: Jira wins by default

When a conflict is detected, the card SHALL end in the column of the conflicting Jira status. If the Jira change is processed second, the card SHALL move as for any delivery. If the user move is processed second, its outbound transition SHALL NOT be sent, one `TO_JIRA` sync-log row with status `CONFLICT` SHALL be written, and the card SHALL be moved back to the Jira column with a `card.moved` event of origin `jira`. An outbound transition still pending when a conflicting Jira change is recorded SHALL NOT be sent either. The conflict SHALL be stored with resolution `jira` and no resolution time until an admin resolves it.

#### Scenario: User move loses

- **WHEN** the user move is processed second in a conflict
- **THEN** no transition is sent to Jira, a `CONFLICT` row is written and the card is back in the Jira column

#### Scenario: Jira change processed second

- **WHEN** the Jira change is processed second and its status maps to another column
- **THEN** the card is in the Jira column and the pending outbound transition, if not yet sent, is not sent

### Requirement: Conflict log

Every detected conflict SHALL be stored in `sync_conflict_log` with the board, card, issue key, mapping, the BoardSync column and its title with the user move time, the Jira column and status name with the Jira change time, the resolution (`jira` or `boardsync`), the resolution time and the resolving user. The table SHALL be created by a TypeORM migration and SHALL reference boards, cards and users by id only.

#### Scenario: Stored conflict

- **WHEN** a conflict is detected
- **THEN** one `sync_conflict_log` row holds both versions, their times and resolution `jira` with no resolution time

### Requirement: Notify board admins

For each detected conflict the system SHALL create one `jira.conflict` notification for every Admin of the board and publish `notification.created` for each of them. The notification payload SHALL include the conflict id, board id, card id, issue key, the BoardSync status and the Jira status. Members and viewers SHALL NOT be notified.

#### Scenario: Admins notified

- **WHEN** a conflict is detected on a board with one admin and one member
- **THEN** the admin receives one `jira.conflict` notification and one `notification.created` event, and the member receives none

### Requirement: List conflicts

`GET /jira/conflicts?boardId=` SHALL return the board's conflicts newest first as a cursor page (`limit`, `cursor`, `{ items, nextCursor }`). Only board admins SHALL list them: a non-member SHALL receive 404 and a member or viewer 403.

#### Scenario: Admin lists conflicts

- **WHEN** an admin lists the conflicts of a board with two conflicts
- **THEN** both are returned, newest first, each with both versions and its resolution

#### Scenario: Member is refused

- **WHEN** a member who is not an admin lists conflicts
- **THEN** the response is 403

### Requirement: Resolve a conflict

`POST /jira/conflicts/{conflictId}/resolve` with `resolution` SHALL let a board admin resolve an unresolved conflict once. `jira` SHALL read the issue's current Jira status and move the card to its column without writing to Jira. `boardsync` SHALL send the conflict's BoardSync column to Jira through the outbound status synchronization (one sync-log row, no conflict check) and, when it succeeds, move the card back to that column. The answer SHALL be the updated conflict with resolution, resolution time and resolving user. An unknown conflict or a non-member SHALL receive 404, a non-admin 403, an already resolved conflict 409, and a Jira failure 502 leaving the conflict unresolved.

#### Scenario: Keep the Jira version

- **WHEN** an admin resolves a conflict with `jira`
- **THEN** no transition is sent, the card is in the column of Jira's current status and the conflict is resolved with `jira`

#### Scenario: Push the BoardSync version

- **WHEN** an admin resolves a conflict with `boardsync`
- **THEN** Jira is transitioned to the status of the BoardSync column, the card is in that column and the conflict is resolved with `boardsync`

#### Scenario: Jira rejects the push

- **WHEN** the push to Jira fails
- **THEN** the response is 502, the card stays where it is and the conflict stays unresolved

#### Scenario: Resolved twice

- **WHEN** an admin resolves an already resolved conflict
- **THEN** the response is 409
