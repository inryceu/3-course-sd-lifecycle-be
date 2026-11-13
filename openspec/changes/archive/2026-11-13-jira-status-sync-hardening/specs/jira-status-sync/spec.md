## ADDED Requirements

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
