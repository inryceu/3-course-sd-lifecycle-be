# Proposal

## Why

BoardSync's backend and frontend repositories already use pnpm 9.0.0, but dependency management is not fully standardized across the two repos. The backend lacks a `.nvmrc`, pins Node only as a range (`>=20.0.0`) rather than an exact LTS patch, does not run `pnpm audit` in CI (only as a local script), and has no `depcheck` to surface unused dependencies. The frontend has no CI at all despite its README referencing one. Standardizing on pnpm with aligned tooling versions, a pinned Node LTS, audit gating, and unused-dependency detection reduces drift between repos and prevents dependency-related issues from reaching production.

## What Changes

- **Backend `package.json`**: Pin `engines.node` to an exact Node 20 LTS patch version (currently `">=20.0.0"`).
- **Backend `.nvmrc`**: New file pinning the exact Node 20 LTS patch version.
- **Backend `package.json` scripts**: Change `"audit": "pnpm audit"` to `"audit": "pnpm audit --audit-level=critical"`.
- **Backend `.github/workflows/ci.yml`**: Add a standalone `audit` job running `pnpm audit --audit-level=critical` (passes today, fails on new critical findings only).
- **Backend `package.json` devDependencies**: Install `depcheck`, run it, and remove verified unused dependencies (candidates: `@nestjs/mapped-types`, `passport`, `pg`, `reflect-metadata`, `rxjs`, `ts-loader`, `source-map-support`).
- **Frontend `package.json`**: Pin `engines.node` to the same exact Node 20 LTS patch version.
- **Frontend `.nvmrc`**: New file pinning the exact Node 20 LTS patch version.
- **Frontend `package.json` devDependencies**: Review for unused dependencies after backend cleanup.
- **Dockerfiles**: Keep `node:20-alpine` floating (no change).
- **Frontend CI**: Out of scope for this change.

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
- Existing `EXCEPTIONS.md` continues to document 47 accepted pnpm audit findings (0 critical); CI audit at `--audit-level=critical` does not block on them
