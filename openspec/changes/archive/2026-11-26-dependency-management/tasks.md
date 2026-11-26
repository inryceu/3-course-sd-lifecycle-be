# Tasks

## 1. Unused dependency cleanup

- [x] 1.1 Install depcheck as a backend devDependency and verify `pnpm install --frozen-lockfile` succeeds
- [x] 1.2 Run `pnpm depcheck` and record the unused-dependency list
- [x] 1.3 Removed verified unused deps (`@nestjs/mapped-types`, `source-map-support`, `ts-loader`), kept used deps (`passport`, `pg`, `reflect-metadata`, `rxjs`, `@nestjs/throttler` — all still imported), added missing `express ^4.19.2`, verified `pnpm install` and `--frozen-lockfile` succeed
- [x] 1.4 Review frontend `3-course-sd-lifecycle-fe/package.json` with depcheck; removed `zustand` and `tailwind-merge` (unused in `src/`); `tailwindcss`/`postcss`/`autoprefixer`/`@vitest/coverage-v8` are false positives (config and CLI use). Also moved vitest to 3.x plus a `tinypool` override so the frontend audit job passes (critical advisories in the vitest 1 toolchain)
- [x] 1.5 Add a `deps:check` script and `.depcheckrc` ignoring the 3 known false positives (`@nestjs/schematics`, `@types/jest`, `tsconfig-paths`)

## 2. Node 22 LTS pin

- [x] 2.1 Set `engines.node` to `">=22 <23"` in `3-course-sd-lifecycle-be/package.json` (Node 20 is end-of-life since 30 Apr 2026)
- [x] 2.2 `.nvmrc` = `22`; CI uses `node-version-file: .nvmrc`; `Dockerfile` uses `node:22-alpine`
- [x] 2.3 Same `engines.node` range in `3-course-sd-lifecycle-fe/package.json`
- [x] 2.4 Same `.nvmrc`, CI and Dockerfile change in `3-course-sd-lifecycle-fe`

## 3. pnpm audit CI gating

- [x] 3.1 Update `3-course-sd-lifecycle-be/package.json` `"audit"` script from `pnpm audit` to `pnpm audit --audit-level=critical`
- [x] 3.2 Add a standalone `audit` job to `3-course-sd-lifecycle-be/.github/workflows/ci.yml` running `pnpm audit --audit-level=critical` and verify it passes (0 critical findings today)
- [x] 3.3 Verify CI audit job does not block on the documented non-critical findings in `EXCEPTIONS.md` (counts refreshed to the current `pnpm audit` output)
- [x] 3.4 `Dependency Audit` also runs weekly (`schedule`) and is a required check in `scripts/setup-branch-protection.sh` (identical copy in both repos)
- [x] 3.5 Same job added to the frontend `ci.yml`

## 4. Verification

- [x] 4.1 Run `pnpm install --frozen-lockfile` in backend and verify success
- [x] 4.2 Run `pnpm build` in backend and verify success
- [x] 4.3 Run `pnpm lint` in backend and verify success
- [x] 4.4 Run `pnpm typecheck` in backend and verify success
- [x] 4.5 Run `pnpm test` in backend and verify success
- [x] 4.6 `docker build` of the production stage on `node:22-alpine`; tests run on Node 22

## Workflow follow-up

