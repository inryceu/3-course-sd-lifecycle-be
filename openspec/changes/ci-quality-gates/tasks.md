## 1. Backend coverage gate

- [x] 1.1 Add `coverageThreshold` (global lines 70) and the `text-summary`, `lcov`, `json-summary`, `html` reporters to `jest.config.js`, plus `scripts/check-service-coverage.mjs` (85 % lines per auth/jira-sync application service) chained into `pnpm test:cov`; verify `pnpm test:cov` passes on current code and fails when either threshold is temporarily raised above the measured value
- [x] 1.2 In the backend Tests job, name the migration step as the migration gate and replace the Codecov upload with an `always()` `coverage` artifact upload; verify the workflow YAML parses

## 2. Frontend coverage gate

- [x] 2.1 Add `coverage.thresholds.lines: 70` and the `text-summary`, `lcov`, `json-summary`, `html` reporters to `vitest.config.ts`; verify `pnpm test:coverage` passes and fails with a raised threshold
- [x] 2.2 Switch the frontend Tests job to `pnpm test:coverage` and replace the Codecov upload with the `coverage` artifact; keep the API drift check in TypeCheck untouched; verify the YAML parses

## 3. Docker Build job

- [x] 3.1 Add a `Docker Build` job to both workflows building the `production` target with Buildx and the GHA cache, no push; verify locally with `docker build --target production` in each repo

## 4. Required checks, docs and badges

- [x] 4.1 Add `Docker Build` to `REQUIRED_CHECKS` in `scripts/setup-branch-protection.sh` in both repos (files stay identical); verify with `bash -n` and `diff` between the repos (the script itself is run by the admin after merge)
- [x] 4.2 Update `CONTRIBUTING.md` (and the CI lines in `AGENTS.md`, `docs/process.md`) in both repos: five required checks, coverage thresholds, the local coverage command; verify the text matches the workflow job names
- [x] 4.3 Add the CI status badge to both READMEs; verify the URLs point to `ci.yml` of the right repository

## 5. Verification

- [ ] 5.1 Push `KAN-51` in both repos, open PRs, and confirm all five checks are green and the `coverage` artifact is listed on the run
