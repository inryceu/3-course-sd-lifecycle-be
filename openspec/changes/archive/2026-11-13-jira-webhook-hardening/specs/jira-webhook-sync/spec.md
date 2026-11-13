## MODIFIED Requirements

### Requirement: Delivery deduplication
The system SHALL derive a delivery key only from signed content: a SHA-256 hash of the event, issue id and changelog id, or of the raw body when no changelog id is present. The unsigned `X-Atlassian-Webhook-Identifier` header SHALL NOT influence the key. It SHALL store keys under a unique constraint with a retention period. A delivery whose key is already stored SHALL be ignored with 200. A delivery whose processing fails SHALL release its key so a Jira retry can be processed.

#### Scenario: Duplicate delivery
- **WHEN** the same delivery is posted twice while the first is stored
- **THEN** the second answers 200, and the card is moved and the event published only once

#### Scenario: Stored key is reported as a duplicate
- **WHEN** a delivery key is claimed against the database while a row for it is already stored and not stale
- **THEN** the claim is refused

#### Scenario: Replay without the identifier header
- **WHEN** two deliveries have the same event, issue id and changelog id
- **THEN** they produce the same key and the second is ignored

#### Scenario: Replay with a different identifier header
- **WHEN** a signed delivery is re-posted unchanged except for a new `X-Atlassian-Webhook-Identifier`
- **THEN** it produces the same key, answers 200, and no card moves and no event is published

#### Scenario: Delivery without a changelog
- **WHEN** a delivery has no changelog id
- **THEN** the key is derived from the raw body

#### Scenario: Retry after a processing failure
- **WHEN** processing a delivery fails after its key was claimed
- **THEN** the key is released, the response is 5xx, and Jira's retry is processed normally

### Requirement: Jira status changes move the linked card
For a `jira:issue_updated` delivery whose changelog contains a `status` item, the system SHALL resolve the candidate boards from the Jira site that sent the issue (`issue.self` against each connection's site URL or cloud id), then the card by `(boardId, jiraIssueKey)`. A board SHALL be updated only while it has a Jira connection and its linked project key equals the mapping's project key. The target column SHALL come from the stored status mapping or the status-category default, and the card SHALL move through `BoardsFacade.moveCardFromExternal`, which publishes `card.moved` with `origin: "jira"`; the change SHALL NOT be sent back to Jira. Updates without a status change, unknown issues and no-op moves SHALL answer 200 without side effects. The receive log SHALL name each board and its outcome.

#### Scenario: Mapped status change
- **WHEN** a linked issue changes to a status mapped to another column
- **THEN** its card moves to that column and a `card.moved` event with `origin: "jira"` is published

#### Scenario: Unmapped status
- **WHEN** the new status has no stored mapping
- **THEN** the card moves to the default column for the status category

#### Scenario: Same project key on another Jira site
- **WHEN** two boards on different Jira sites both imported an issue with the same key, and a delivery arrives from one site
- **THEN** only the card on the board connected to that site moves, and only that board's event is published

#### Scenario: Two boards linked to the same project
- **WHEN** two boards connected to the same site imported the same issue and a status-change delivery arrives
- **THEN** the card moves on both boards

#### Scenario: Disconnected board
- **WHEN** a board's Jira connection was removed and a delivery for one of its former issues arrives
- **THEN** the response is 200 and its card does not move

#### Scenario: Board relinked to another project
- **WHEN** a board's project key no longer equals the mapping's project key
- **THEN** the delivery does not move its card

#### Scenario: Status change into the current column
- **WHEN** the new status maps to the column the card is already in and no position is given
- **THEN** the card keeps its position and no `card.moved` event is published

#### Scenario: Non-status update
- **WHEN** the changelog changes only summary or assignee
- **THEN** the response is 200 and no card moves

#### Scenario: Unknown issue
- **WHEN** no card ↔ issue mapping exists for the delivered issue key on any board of that site
- **THEN** the response is 200, the delivery is ignored, and no error is returned to Jira

#### Scenario: No synchronisation loop
- **WHEN** the move publishes its event with `origin: "jira"`
- **THEN** no outbound Jira call is made for that event

## ADDED Requirements

### Requirement: Out-of-order deliveries do not regress a card
Each issue mapping SHALL keep the `timestamp` of the last delivery applied to it. A delivery whose timestamp is not newer SHALL be acknowledged with 200 and dropped as stale. When the move fails, the stored timestamp SHALL be restored so Jira's retry is applied.

#### Scenario: Older delivery after a newer one
- **WHEN** a delivery moving the card to Done is applied, and an older delivery moving it to In Progress arrives afterwards
- **THEN** the response is 200 and the card stays in Done with no further event

#### Scenario: Failed move keeps the delivery retryable
- **WHEN** the move fails after the timestamp was recorded
- **THEN** the previous timestamp is restored and the retry of the same delivery moves the card
