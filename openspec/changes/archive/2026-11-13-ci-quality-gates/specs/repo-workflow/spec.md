## ADDED Requirements

### Requirement: CI quality gates
Every pull request into `dev` or `main` of either repository, and every push to those branches, SHALL run the jobs **Lint**, **TypeCheck**, **Tests**, **Build** and **Docker Build**. Each job SHALL install dependencies from the lockfile with the package-manager cache, and the job names SHALL stay stable because branch protection and `CONTRIBUTING.md` refer to them.

#### Scenario: Pull request runs the full pipeline
- **WHEN** a pull request into `dev` is opened in either repository
- **THEN** the checks Lint, TypeCheck, Tests, Build and Docker Build are reported on it

#### Scenario: Lint or type error blocks the PR
- **WHEN** a pull request introduces an ESLint error or a TypeScript type error
- **THEN** the Lint or TypeCheck check fails

#### Scenario: Frontend API types drift
- **WHEN** a frontend pull request leaves `src/api/api.generated.ts` out of date with `docs/api/openapi.yaml`
- **THEN** the TypeCheck check fails

### Requirement: Enforced coverage thresholds
The Tests job SHALL run the unit tests with coverage and SHALL fail when line coverage falls below the thresholds agreed in the backlog index: 70 % of lines for the whole repository in both repos, and 85 % of lines for each backend `auth` and `jira-sync` application service. The coverage report SHALL be uploaded as a workflow artifact, also when the job fails.

#### Scenario: Coverage drop fails the Tests job
- **WHEN** a pull request lowers the repository's line coverage below 70 %
- **THEN** the Tests check fails and names the unmet threshold

#### Scenario: Under-tested auth or jira-sync service
- **WHEN** a backend pull request leaves any service in `src/modules/auth/application` or `src/modules/jira-sync/application` below 85 % line coverage
- **THEN** the Tests check fails

#### Scenario: Report is available for download
- **WHEN** the Tests job finishes, successfully or not
- **THEN** the workflow run lists a `coverage` artifact with the HTML and lcov report

### Requirement: Migrations gate against PostgreSQL
The backend Tests job SHALL apply all TypeORM migrations to an empty PostgreSQL 16 service container before the integration tests run, and SHALL fail when a migration fails.

#### Scenario: Broken migration
- **WHEN** a backend pull request adds a migration that fails to apply on an empty database
- **THEN** the Tests check fails before the integration tests start

### Requirement: Docker image build
The Docker Build job SHALL build the `production` stage of the repository's `Dockerfile` without pushing the image, and SHALL fail when the image does not build.

#### Scenario: Dockerfile no longer builds
- **WHEN** a pull request breaks the production image build (for example a missing file the Dockerfile copies)
- **THEN** the Docker Build check fails

### Requirement: CI status badge
Each repository's `README.md` SHALL show a status badge of the CI workflow linked to the workflow's run list.

#### Scenario: Reader checks pipeline health
- **WHEN** a reader opens either repository's README on GitHub
- **THEN** the badge shows the current CI status and links to the workflow runs

## MODIFIED Requirements

### Requirement: Protected integration branches
`main` and `dev` SHALL require a pull request, at least one approval and the passing required status checks **Lint**, **TypeCheck**, **Tests**, **Build** and **Docker Build**, and SHALL reject force pushes; both repositories SHALL receive identical settings.

#### Scenario: Direct push to dev
- **WHEN** a contributor pushes directly to `dev`
- **THEN** GitHub rejects the push

#### Scenario: Merge without approval
- **WHEN** a PR has green checks but no approval
- **THEN** merging is blocked

#### Scenario: Merge with a failing gate
- **WHEN** a PR is approved but its Tests or Docker Build check failed
- **THEN** merging is blocked

#### Scenario: Settings are reproducible
- **WHEN** an admin runs the branch-protection script against either repository
- **THEN** the resulting protection is identical for both repositories and requires the five checks
