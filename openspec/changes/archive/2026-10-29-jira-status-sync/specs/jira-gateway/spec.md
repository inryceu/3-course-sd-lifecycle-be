# Spec Delta

## ADDED Requirements

### Requirement: Get one issue's current status

The gateway SHALL expose `getIssue({ boardId, issueIdOrKey })`, calling `GET /rest/api/3/issue/{issueIdOrKey}?fields=status` with the `read:jira-work` scope, and SHALL return the issue id, key and current status (id, name and category). A missing or invisible issue SHALL surface as `JiraClientError` with status 404.

#### Scenario: Current status is returned

- **WHEN** `getIssue` is called for a valid issue key
- **THEN** the current status is returned with its id, name and status category

#### Scenario: Unknown issue

- **WHEN** Jira answers 404 for the issue
- **THEN** `JiraClientError` is thrown with status 404

## MODIFIED Requirements

### Requirement: Per-call time budget

The system SHALL enforce an overall time budget per public gateway call (default 45 seconds), covering token refresh and all retries and waits. `getIssue`, `listTransitions` and `doTransition` SHALL accept an optional `timeBudgetMs`; the effective budget SHALL be the smaller of the requested value and the configured budget. The deadline SHALL be checked before each attempt and before each sleep. Exhaustion SHALL throw `JiraTimeBudgetExceededError` with the effective `timeBudgetMs` and the attempts made.

#### Scenario: Budget exhausted before a retry

- **WHEN** the next backoff or `Retry-After` wait would pass the 45-second deadline
- **THEN** `JiraTimeBudgetExceededError` is thrown and no further request is sent

#### Scenario: Budget caps the request timeout

- **WHEN** less than the configured 10 seconds remain in the budget
- **THEN** the per-request timeout is reduced to the remaining budget

#### Scenario: Caller shortens the budget

- **WHEN** `getIssue`, `listTransitions` or `doTransition` is called with a `timeBudgetMs` below the configured budget
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
