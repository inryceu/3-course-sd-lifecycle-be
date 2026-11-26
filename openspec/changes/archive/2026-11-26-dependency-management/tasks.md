# Tasks

## 1. Unused dependency cleanup

- [x] 1.1 Install depcheck as a backend devDependency and verify `pnpm install --frozen-lockfile` succeeds
- [x] 1.2 Run `pnpm depcheck` and record the unused-dependency list
- [x] 1.3 Removed verified unused deps (`@nestjs/mapped-types`, `source-map-support`, `ts-loader`), kept used deps (`passport`, `pg`, `reflect-metadata`, `rxjs`, `@nestjs/throttler` — all still imported), added missing `express ^4.19.2`, verified `pnpm install` and `--frozen-lockfile` succeed
- [x] 1.4 Review frontend `3-course-sd-lifecycle-fe/package.json` for unused deps after backend cleanup and remove any confirmed

## 2. Node 20 LTS pin

- [x] 2.1 Pin `engines.node` to the exact current LTS 20 patch in `3-course-sd-lifecycle-be/package.json` (e.g. `"20.19.0"`)
- [x] 2.2 Create `3-course-sd-lifecycle-be/.nvmrc` with the exact LTS 20 patch version
- [x] 2.3 Pin `engines.node` to the same exact LTS 20 patch in `3-course-sd-lifecycle-fe/package.json`
- [x] 2.4 Create `3-course-sd-lifecycle-fe/.nvmrc` with the exact LTS 20 patch version

## 3. pnpm audit CI gating

- [x] 3.1 Update `3-course-sd-lifecycle-be/package.json` `"audit"` script from `pnpm audit` to `pnpm audit --audit-level=critical`
- [x] 3.2 Add a standalone `audit` job to `3-course-sd-lifecycle-be/.github/workflows/ci.yml` running `pnpm audit --audit-level=critical` and verify it passes (0 critical findings today)
- [x] 3.3 Verify CI audit job does not block on the 47 documented non-critical findings in `EXCEPTIONS.md`

## 4. Verification

- [x] 4.1 Run `pnpm install --frozen-lockfile` in backend and verify success
- [x] 4.2 Run `pnpm build` in backend and verify success
- [x] 4.3 Run `pnpm lint` in backend and verify success
- [x] 4.4 Run `pnpm typecheck` in backend and verify success
- [x] 4.5 Run `pnpm test` in backend and verify success
- [x] 4.6 Confirm Dockerfiles keep `node:20-alpine` floating (no change needed)

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
