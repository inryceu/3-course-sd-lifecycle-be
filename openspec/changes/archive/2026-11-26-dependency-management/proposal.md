# Proposal

## Why

BoardSync's backend and frontend repositories already use pnpm 9.0.0, but dependency management is not fully standardized across the two repos. The backend lacks a `.nvmrc`, pins Node only as an open range (`>=20.0.0`, an end-of-life line), does not run `pnpm audit` in CI (only as a local script), and has no `depcheck` to surface unused dependencies. The frontend gets the same policy. Standardizing on pnpm with aligned tooling versions, a pinned Node LTS, audit gating, and unused-dependency detection reduces drift between repos and prevents dependency-related issues from reaching production.

## What Changes

- **Backend `package.json`**: `engines.node` = `">=22 <23"` (Node 22 LTS).
- **Backend `.nvmrc`**: `22`; CI reads it via `node-version-file`.
- **Backend `package.json` scripts**: Change `"audit": "pnpm audit"` to `"audit": "pnpm audit --audit-level=critical"`.
- **Backend `.github/workflows/ci.yml`**: Add a standalone `audit` job running `pnpm audit --audit-level=critical` (passes today, fails on new critical findings only).
- **Backend `package.json` devDependencies**: Install `depcheck`, run it, and remove verified unused dependencies (candidates: `@nestjs/mapped-types`, `passport`, `pg`, `reflect-metadata`, `rxjs`, `ts-loader`, `source-map-support`).
- **Frontend**: same `engines.node`, `.nvmrc`, Dependabot config, `Dependency Audit` job in `ci.yml` and Dockerfile Node 22.
- **Frontend `package.json` devDependencies**: Review for unused dependencies after backend cleanup.
- **Dockerfile**: `node:22-alpine`.
- **Dependabot**: groups split by dependency type; Docker major `node` bumps ignored.
- **Branch protection**: `Dependency Audit` is a required check; the job also runs weekly.

## Capabilities

### New Capabilities

None. This change modifies tooling and CI configuration only; it introduces no system behavior.

### Modified Capabilities

None. No existing spec's requirements change.

## Impact

- `3-course-sd-lifecycle-be/package.json` — engines pin, audit script, depcheck devDependency
- `3-course-sd-lifecycle-be/.nvmrc` — new file
- `3-course-sd-lifecycle-be/.github/workflows/ci.yml` — new audit job
- `3-course-sd-lifecycle-fe/package.json` — engines pin
- `3-course-sd-lifecycle-fe/.nvmrc` — new file
- `EXCEPTIONS.md` summary counts refreshed to the current `pnpm audit` output (0 critical); CI audit at `--audit-level=critical` does not block on the rest
