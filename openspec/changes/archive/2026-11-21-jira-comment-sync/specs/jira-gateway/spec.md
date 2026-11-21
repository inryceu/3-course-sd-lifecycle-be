# Spec Delta

## MODIFIED Requirements

### Requirement: Per-call time budget

The system SHALL enforce an overall time budget per public gateway call (default 45 seconds), covering token refresh and all retries and waits. `getIssue`, `listTransitions`, `doTransition` and `addComment` SHALL accept an optional `timeBudgetMs`; the effective budget SHALL be the smaller of the requested value and the configured budget. The deadline SHALL be checked before each attempt and before each sleep. Exhaustion SHALL throw `JiraTimeBudgetExceededError` with the effective `timeBudgetMs` and the attempts made.

#### Scenario: Budget exhausted before a retry

- **WHEN** the next backoff or `Retry-After` wait would pass the 45-second deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown and no further request is sent

#### Scenario: Budget caps the request timeout

- **WHEN** less than the configured 10 seconds remain in the budget
- **THEN** the per-request timeout is reduced to the remaining budget

#### Scenario: Caller shortens the budget

- **WHEN** `getIssue`, `listTransitions`, `doTransition` or `addComment` is called with a `timeBudgetMs` below the configured budget
- **THEN** the deadline uses the caller value, and the request timeout, retries and waits are capped by it

#### Scenario: Caller cannot extend the budget

- **WHEN** a call requests a `timeBudgetMs` above the configured budget
- **THEN** the effective deadline remains the configured budget

#### Scenario: No override

- **WHEN** a call omits `timeBudgetMs`
- **THEN** the configured per-call budget applies unchanged

#### Scenario: Caller budget exhausted

- **WHEN** the effective caller budget is exhausted
- **THEN** `JiraTimeBudgetExceededError` reports the effective budget and the attempts made, and no further request is sent
