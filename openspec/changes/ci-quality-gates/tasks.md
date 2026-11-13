## 1. Backend coverage gate

- [ ] 1.1 Add `coverageThreshold` (global lines 70, per-file lines 85 for auth and jira-sync application services) and the `text-summary`, `lcov`, `html` reporters to `jest.config.js`; verify `pnpm test:cov` passes on current code and fails when the global threshold is temporarily raised above the measured value
- [ ] 1.2 In the backend Tests job, name the migration step as the migration gate and replace the Codecov upload with an `always()` `coverage` artifact upload; verify the workflow YAML parses

## 2. Frontend coverage gate

- [ ] 2.1 Add `coverage.thresholds.lines: 70` and the `text-summary`, `lcov`, `html` reporters to `vitest.config.ts`; verify `pnpm test:coverage` passes and fails with a raised threshold
- [ ] 2.2 Switch the frontend Tests job to `pnpm test:coverage` and replace the Codecov upload with the `coverage` artifact; keep the API drift check in TypeCheck untouched; verify the YAML parses

## 3. Docker Build job

- [ ] 3.1 Add a `Docker Build` job to both workflows building the `production` target with Buildx and the GHA cache, no push; verify locally with `docker build --target production` in each repo

## 4. Required checks, docs and badges

- [ ] 4.1 Add `Docker Build` to `REQUIRED_CHECKS` in `scripts/setup-branch-protection.sh` in both repos (files stay identical); verify with `--dry-run` and `diff` between the repos
- [ ] 4.2 Update `CONTRIBUTING.md` in both repos: five required checks, coverage thresholds, the local coverage command; verify the text matches the workflow job names
- [ ] 4.3 Add the CI status badge to both READMEs; verify the URLs point to `ci.yml` of the right repository

## 5. Verification

- [ ] 5.1 Push `KAN-51` in both repos, open PRs, and confirm all five checks are green and the `coverage` artifact is listed on the run
