## Why

Both repositories already run Lint, TypeCheck, Tests and Build on every pull request (T-02), but the pipeline is not a quality gate yet: coverage is measured nowhere in the frontend and enforced nowhere in either repo, the report goes to Codecov without a token (silently dropped), the Docker images are only built by hand, and `dev`/`main` carry no required checks. T-40 (KAN-51) turns the existing workflows into gates that block a PR, and it blocks eight later tickets (T-41, T-45..T-48, T-51, T-55, T-56) that add their own CI jobs on top.

## What Changes

- Backend and frontend `ci.yml` are extended, not rewritten; the existing check names **Lint**, **TypeCheck**, **Tests**, **Build** stay unchanged.
- **Tests** runs unit tests with coverage in both repos and fails when coverage drops below the agreed thresholds (backend Jest `coverageThreshold`, frontend Vitest `coverage.thresholds`); the coverage report is uploaded as a workflow artifact instead of the token-less Codecov upload.
- Backend **Tests** keeps running the TypeORM migrations against a PostgreSQL 16 service container before the e2e suite; the step is named and documented as the migration gate.
- New job **Docker Build** in both repos builds the production stage of the repository's `Dockerfile` (no push), with the GitHub Actions layer cache.
- `scripts/setup-branch-protection.sh` (identical in both repos) adds **Docker Build** to the required checks; `CONTRIBUTING.md` lists the five checks and the coverage thresholds.
- Both READMEs get a CI status badge.
- The frontend's generated-API drift check in **TypeCheck** stays as is.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `repo-workflow`: adds the CI quality-gate requirements (jobs, coverage thresholds, migration gate, Docker build, badges) and makes the protected-branch requirement name the five required checks.

## Impact

- Backend: `.github/workflows/ci.yml`, `jest.config.js`, `scripts/setup-branch-protection.sh`, `CONTRIBUTING.md`, `README.md`.
- Frontend: `.github/workflows/ci.yml`, `vitest.config.ts`, `scripts/setup-branch-protection.sh`, `CONTRIBUTING.md`, `README.md`.
- No application code, API or dependency changes (`@vitest/coverage-v8` is already a frontend devDependency).
- Branch protection itself is applied by a repository admin running the updated script after merge; the change only versions the settings.
- KAN-58 (Playwright) adds its own job to the frontend `ci.yml`; expect a textual merge overlap there.
