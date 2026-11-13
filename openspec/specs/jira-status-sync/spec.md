# jira-status-sync Specification

## Purpose
Keeps Jira issues aligned with board card moves by turning user column changes into one Jira workflow transition, bounded by a five-second budget and recorded in the sync log.

## Requirements

### Requirement: Synchronize only user column moves

The system SHALL synchronize a `card.moved` event only when its origin is `user`, the card changed columns, and the card has a `jiraIssueKey`. Events with origin `jira`, same-column reorders, and cards without an issue key SHALL NOT change Jira.

#### Scenario: User moves a linked card

- **WHEN** a user moves a card with a `jiraIssueKey` to a different column
- **THEN** exactly one outbound synchronization attempt starts

#### Scenario: Jira-originated event

- **WHEN** a `card.moved` event has origin `jira`
- **THEN** no outbound attempt starts and no sync log is written

#### Scenario: Same-column reorder

- **WHEN** a user reorders a linked card inside its current column
- **THEN** no outbound attempt starts and no sync log is written

#### Scenario: Unlinked card

- **WHEN** a user moves a card without a `jiraIssueKey`
- **THEN** no outbound attempt starts, no sync log is written, and a debug message is logged

### Requirement: No-op when the issue already matches the destination

The system SHALL read the issue's current Jira status from the issue resource and SHALL treat the move as a successful no-op when that status maps to the destination board column under the board's stored or default status mapping.

#### Scenario: Already in a mapped status

- **WHEN** the issue's current status maps to the destination column
- **THEN** no transition is executed and a `SUCCESS` sync log records outcome `no-op`

### Requirement: Select one direct transition for the destination column

The system SHALL consider only currently available transitions whose target status maps to the destination column. It SHALL prefer a candidate with an explicit stored mapping; otherwise it SHALL choose the lowest `jiraStatusId`. Several transitions to the chosen status SHALL be resolved by the lowest transition id. It SHALL NOT perform multi-step transition paths.

#### Scenario: Explicit mapping wins

- **WHEN** one candidate status has an explicit stored mapping to the destination column and another candidate has no explicit mapping
- **THEN** the explicitly mapped status is selected

#### Scenario: Lowest status id breaks a tie

- **WHEN** no candidate has an explicit mapping and several candidate statuses map to the destination column
- **THEN** the candidate with the lowest `jiraStatusId` is selected

#### Scenario: No direct transition

- **WHEN** no available transition targets a status mapped to the destination column
- **THEN** the attempt fails with reason `no valid transition` and no transition is executed

### Requirement: Execute exactly one transition

The system SHALL execute exactly one Jira workflow transition per synchronized move and SHALL NOT retry a rejected or failed transition.

#### Scenario: Transition succeeds

- **WHEN** a transition is selected and Jira accepts it
- **THEN** the transition is executed once and the attempt succeeds

#### Scenario: Jira rejects the transition

- **WHEN** Jira rejects the selected transition
- **THEN** the attempt is recorded as `FAILED` and no further transition is attempted

### Requirement: Record every outbound attempt in the sync log

The system SHALL write exactly one `TO_JIRA` sync-log row per attempt that passes the filters: `SUCCESS` for a transition or no-op, `FAILED` otherwise. The payload SHALL include card id, issue key, source and destination columns, outcome or reason, the chosen status and transition when known, and `latencyMs`; failure rows SHALL include `errorMessage`. `mappingId` SHALL be set when a card-issue mapping exists, otherwise null.

#### Scenario: Successful transition is logged

- **WHEN** a transition succeeds
- **THEN** one `TO_JIRA`/`SUCCESS` row contains the card, issue, columns, transition, outcome and latency

#### Scenario: No-op is logged

- **WHEN** the issue already maps to the destination column
- **THEN** one `TO_JIRA`/`SUCCESS` row records outcome `no-op`

#### Scenario: Failure is logged

- **WHEN** synchronization fails
- **THEN** one `TO_JIRA`/`FAILED` row contains the reason, the target column and an `errorMessage`

#### Scenario: Missing card-issue mapping

- **WHEN** no `jira_issue_mappings` row matches the card and issue key
- **THEN** the log row is written with `mappingId` null

#### Scenario: Board not linked

- **WHEN** the board has no Jira connection or no linked Jira project
- **THEN** one `TO_JIRA`/`FAILED` row records reason `board not linked`

### Requirement: Bound synchronization to five seconds from the event

The system SHALL measure synchronization latency from the event's `occurredAt` and SHALL give each Jira call only the time remaining in a five-second budget. When the budget is exhausted, it SHALL stop, record a timed-out failure, and start no further call. It SHALL warn when a completed synchronization takes longer than 5000 ms.

#### Scenario: Budget exhausted before a call

- **WHEN** less than the minimum remaining budget is left before a Jira call
- **THEN** that call is not started and the attempt is logged as `FAILED` with reason `deadline exceeded`

#### Scenario: Slow call is aborted

- **WHEN** a Jira call runs longer than the remaining budget
- **THEN** the gateway aborts it and the attempt is logged as `FAILED`

#### Scenario: Slow but successful synchronization

- **WHEN** a synchronization completes successfully after more than 5000 ms
- **THEN** a warning is logged and the success row records the measured latency

### Requirement: Do not block the card move

The system SHALL start outbound synchronization without making the card-move request wait for Jira, and an outbound failure SHALL NOT fail or roll back the move.

#### Scenario: Slow Jira does not delay the move

- **WHEN** Jira takes longer than the move request to respond
- **THEN** the move response completes before the Jira synchronization finishes

#### Scenario: Synchronization failure does not fail the move

- **WHEN** the outbound synchronization throws
- **THEN** the move remains successful and the failure is logged

### Requirement: Order synchronization runs per Jira issue

The system SHALL run outbound synchronization attempts for the same board and Jira issue one after another, in the order the moves were published, so that each attempt reads the issue's status only after the previous attempt for that issue finished. Attempts for different issues SHALL NOT wait for each other. The ordering is in-process only; per-card ordering across processes is T-35.

#### Scenario: Two quick moves of one card

- **WHEN** the issue is in `To Do` and the user moves its card to *In Progress* and then, before the first transition reaches Jira, to *Done*
- **THEN** Jira ends in the status mapped to *Done*, and the second attempt reads the issue after the first transition completed

#### Scenario: A failed attempt does not block the next one

- **WHEN** an attempt for an issue fails or its log write rejects
- **THEN** the next attempt for the same issue still runs

### Requirement: Surface outbound failures to operators

For T-25, a failed outbound attempt SHALL be surfaced by a `Logger.error` line naming the board, the issue and the reason, together with the `FAILED` `TO_JIRA` sync-log row. A user-facing surface (an endpoint or notification that reads these rows) is out of scope and belongs to T-34/T-35.

#### Scenario: No valid transition is surfaced

- **WHEN** a user move has no direct Jira transition to the destination column
- **THEN** an error is logged with the board, the issue and reason `no valid transition`, and one `FAILED` row is written

### Requirement: Label only link problems as board not linked

The system SHALL record reason `board not linked` only when the board does not exist, has no Jira connection, or has no valid linked project. Any other error while resolving the board, such as a database failure, SHALL be recorded as `sync failed`. The board summary SHALL be read once per attempt.

#### Scenario: Database failure while resolving the board

- **WHEN** the database query for the board's Jira connection fails
- **THEN** the attempt is logged as `FAILED` with reason `sync failed`, not `board not linked`

#### Scenario: One board read per move

- **WHEN** a linked card is moved
- **THEN** the board summary is read once for that attempt

### Requirement: Report a timed-out transition as an unknown outcome

When the transition request was sent and then timed out, the system SHALL record reason `deadline exceeded` with `payload.outcome` `unknown` and SHALL log that the outcome is unknown, because Jira may have applied the transition.

#### Scenario: Transition request times out

- **WHEN** `doTransition` times out after the request was sent
- **THEN** the `FAILED` row has reason `deadline exceeded` and outcome `unknown`, and the error log says "outcome unknown"

### Requirement: Log the latency of every completed synchronization

The system SHALL log each successful synchronization with its measured latency in milliseconds at `log` level.

#### Scenario: Successful synchronization

- **WHEN** a transition or no-op succeeds
- **THEN** the log line states the issue, the board and the latency in ms
