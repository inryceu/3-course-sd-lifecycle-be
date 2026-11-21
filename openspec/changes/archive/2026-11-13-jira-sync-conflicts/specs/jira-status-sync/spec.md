## MODIFIED Requirements

### Requirement: Record every outbound attempt in the sync log

The system SHALL write exactly one `TO_JIRA` sync-log row per attempt that passes the filters: `SUCCESS` for a transition or no-op, `CONFLICT` when the move lost a sync conflict and no transition was sent, `FAILED` otherwise. The payload SHALL include card id, issue key, source and destination columns, outcome or reason, the chosen status and transition when known, and `latencyMs`; failure rows SHALL include `errorMessage`. `mappingId` SHALL be set when a card-issue mapping exists, otherwise null.

#### Scenario: Successful transition is logged

- **WHEN** a transition succeeds
- **THEN** one `TO_JIRA`/`SUCCESS` row contains the card, issue, columns, transition, outcome and latency

#### Scenario: No-op is logged

- **WHEN** the issue already maps to the destination column
- **THEN** one `TO_JIRA`/`SUCCESS` row records outcome `no-op`

#### Scenario: Conflict is logged

- **WHEN** the move lost a sync conflict
- **THEN** one `TO_JIRA`/`CONFLICT` row records outcome `conflict` and no transition is sent

#### Scenario: Failure is logged

- **WHEN** synchronization fails
- **THEN** one `TO_JIRA`/`FAILED` row contains the reason, the target column and an `errorMessage`

#### Scenario: Missing card-issue mapping

- **WHEN** no `jira_issue_mappings` row matches the card and issue key
- **THEN** the log row is written with `mappingId` null

#### Scenario: Board not linked

- **WHEN** the board has no Jira connection or no linked Jira project
- **THEN** one `TO_JIRA`/`FAILED` row records reason `board not linked`
