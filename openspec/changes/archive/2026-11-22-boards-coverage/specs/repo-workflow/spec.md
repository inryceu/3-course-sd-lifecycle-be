## MODIFIED Requirements

### Requirement: Enforced coverage thresholds
The Tests job SHALL run the unit tests with coverage and SHALL fail when line coverage falls below the agreed thresholds: 75 % of lines for the whole repository in both repos; in the backend 85 % of lines for each `auth` and `jira-sync` application service, 80 % for each `boards` application service and 90 % for the `boards` module as a whole; in the frontend 95 % of lines and 90 % of branches for `src/features/boards` and 95 % of lines and 85 % of branches for `src/features/cards`. The per-module figures SHALL be printed in the Tests job log. The coverage report SHALL be uploaded as a workflow artifact, also when the job fails.

#### Scenario: Coverage drop fails the Tests job
- **WHEN** a pull request lowers the repository's line coverage below 75 %
- **THEN** the Tests check fails and names the unmet threshold

#### Scenario: Under-tested auth or jira-sync service
- **WHEN** a backend pull request leaves any service in `src/modules/auth/application` or `src/modules/jira-sync/application` below 85 % line coverage
- **THEN** the Tests check fails

#### Scenario: Under-tested boards service or module
- **WHEN** a backend pull request leaves any service in `src/modules/boards/application` below 80 % line coverage, or the `src/modules/boards` files together below 90 %
- **THEN** the Tests check fails and the log names the failing file or module

#### Scenario: Under-tested frontend feature
- **WHEN** a frontend pull request leaves `src/features/boards` below 95 % lines or 90 % branches, or `src/features/cards` below 95 % lines or 85 % branches
- **THEN** the Tests check fails and the log table marks the module as failing

#### Scenario: Per-module result is visible
- **WHEN** the Tests job runs, whether the gates pass or not
- **THEN** its log lists the measured figure next to the gate for every module rule

#### Scenario: Report is available for download
- **WHEN** the Tests job finishes, successfully or not
- **THEN** the workflow run lists a `coverage` artifact with the HTML and lcov report
