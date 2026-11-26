# jira-sync-quality Specification

## Purpose
Defines the unit-test coverage the Jira synchronisation module is held to (T-48), so that regressions in its guards fail a test.

## Requirements

### Requirement: Unit coverage of the Jira synchronisation module
The `jira-sync` module SHALL have unit tests for its error mapper, its token cipher (round trip, tamper, wrong key, malformed value), conflict detection and resolution, the outbox handler and the loop guard that keeps Jira-originated events from being sent back to Jira, and each service SHALL stay at or above the per-service line threshold of the CI gate.

#### Scenario: Loop guard
- **WHEN** a card move or a comment has origin `jira`
- **THEN** no Jira call is made and no outbox row or sync log is written

#### Scenario: Cipher refuses malformed values
- **WHEN** a stored value has an unknown version, a missing part, an extra part or is not authentic
- **THEN** decrypting it fails with a token-integrity error

#### Scenario: Guard mutations are caught
- **WHEN** a key guard (loop guard, conflict window, resolve claim, reconnect flag, cipher checks) is removed or inverted
- **THEN** at least one unit test fails
