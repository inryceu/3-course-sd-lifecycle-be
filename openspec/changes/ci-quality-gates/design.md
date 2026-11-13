## Context

Both repositories have the same `ci.yml` shape from T-02: four jobs (Lint, TypeCheck, Tests, Build), each installing with `pnpm install --frozen-lockfile` behind `actions/setup-node` `cache: pnpm`. The backend Tests job already starts a `postgres:16-alpine` service, runs `pnpm migration:run`, `pnpm test:cov` and `pnpm test:e2e`. The frontend Tests job runs `pnpm test` without coverage, yet both upload `coverage/lcov.info` to Codecov v3 without a token, which never produced a report. `scripts/setup-branch-protection.sh` is byte-identical in both repos and requires `Lint, TypeCheck, Tests, Build`; it has never been applied (no protection on `dev`/`main`).

## Goals / Non-Goals

**Goals:**
- Make coverage a failing gate in both repos and keep the report as a downloadable artifact.
- Build the production Docker image of each repo on every PR.
- Keep the four existing check names so docs, CONTRIBUTING and future tickets keep working.

**Non-Goals:**
- Pushing images to a registry or deploying (later tickets).
- Applying branch protection; the repository admin runs the script after merge.
- Raising coverage; this change only freezes the floor.
- End-to-end browser tests (KAN-58 adds its own job).

## Decisions

### Thresholds: the backlog-index numbers, measured to hold today
The backlog index (`README.md`, item 11) proposes "≥ 70 % line coverage per repo; ≥ 85 % for the `auth` and `jira-sync` services". Measured on `dev` at `8a63742` (BE) / `11056fe` (FE):

| Scope | Lines covered | Threshold |
| --- | --- | --- |
| Backend, all of `src/**` | 71.48 % (2093/2928) | 70 % |
| Backend, each `src/modules/auth/application/*.service.ts` | 90.0 – 100 % (lowest: `auth-facade.service.ts` 90 %) | 85 % per file |
| Backend, each `src/modules/jira-sync/application/*.service.ts` | 90.56 – 100 % (lowest: `jira-import.service.ts` 90.56 %) | 85 % per file |
| Frontend, all of `src/**` | 72.97 % (1844/2527) | 70 % |

All agreed numbers pass on current code, so they are adopted unchanged instead of "just below current". Only line coverage is gated, because that is what was agreed; statements/branches/functions are reported but not enforced (backend branches are at 61.8 %, enforcing them would need a new agreement).

The 85 % rule is backend-only: the frontend has no auth/jira-sync service layer (its `features/auth` and `features/jira-sync` are React components and a context), so applying a service rule there would be an invented requirement.

Backend: Jest `coverageThreshold: { global: { lines: 70 } }` gates the whole repository, and `scripts/check-service-coverage.mjs` (chained into `pnpm test:cov`) reads `coverage/coverage-summary.json` and fails when any `src/modules/{auth,jira-sync}/application/*.service.ts` is below 85 % lines, or when no such file is in the report. Frontend: Vitest `coverage.thresholds.lines: 70`. Both gates live in the `test:cov` / `test:coverage` commands, so a developer sees the failure locally before pushing.

Alternative considered and rejected: Jest glob keys (`'./src/modules/auth/application/*.service.ts': { lines: 85 }`). Jest moves every file matching a path/glob key out of the `global` pool, so the global number becomes "everything except the services": measured 64.76 %, which fails 70 % and no longer means "70 % per repo" as agreed. Keeping the agreed semantics needs the services counted twice (repo-wide and per file), which Jest cannot express; a 20-line summary check can.

### Coverage report as a workflow artifact, Codecov dropped
`actions/upload-artifact@v4` with `if: always()` uploads `coverage/` (HTML, lcov, summary) as `coverage` for 14 days. Codecov without a token on a private-owner repo is rate-limited and silently skipped (`fail_ci_if_error: false`), so it gave a false sense of reporting. The `text-summary` reporter prints the totals in the job log.

### Migrations stay in the Tests job
The backend Tests job already owns the only PostgreSQL service container; a separate Migrations job would start a second database for the same `migration:run` and add a sixth required check. The step is renamed to say what it gates and runs before unit and integration tests, so a broken migration fails Tests first.

### New Docker Build job, parallel and cached
`docker/setup-buildx-action@v3` + `docker/build-push-action@v6` with `target: production`, `push: false`, `cache-from/to: type=gha` (scoped per repo). It runs without `needs:` so it does not lengthen the critical path. The frontend passes the same same-origin build args as `docker-compose.full.yml`. Named **Docker Build** and added to the required checks.

Alternative: `docker build` in the existing Build job. Rejected: it would serialise behind the Build `needs:` chain and hide which part failed.

### Badges
The standard workflow badge `actions/workflows/ci.yml/badge.svg?branch=dev` (dev is the integration branch everyone targets) linked to the workflow run list.

## Risks / Trade-offs

- [Backend global margin is only 1.5 points] → New untested code can fail Tests; that is the intended gate. The failure message names the threshold, and the report artifact shows which files lost coverage.
- [Required check names are a contract] → The protection script and CONTRIBUTING list the five names in one place each; renaming a job requires updating both and re-running the script.
- [KAN-58 edits the same frontend `ci.yml`] → Both add a job at the end of the file; resolve by keeping both jobs.
- [GHA cache eviction] → Cache miss only slows the Docker Build job; correctness is unaffected.

## Migration Plan

1. Merge to `dev` (then `main`) with green checks.
2. The repository admin runs `./scripts/setup-branch-protection.sh --dry-run`, then without `--dry-run`, from either repo (it protects both). The Docker Build check must have reported at least once on each repo first, otherwise GitHub cannot select it.
3. Rollback: revert the commit and re-run the script from the reverted revision.
