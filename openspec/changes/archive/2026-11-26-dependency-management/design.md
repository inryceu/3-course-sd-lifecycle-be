# Design

## Context

See `proposal.md` for the "why" and "what". Current state (from codebase exploration):

- Both repos already declare `packageManager: "pnpm@9.0.0"` and use `pnpm-lock.yaml`.
- Both Dockerfiles use `node:20-alpine` with `corepack prepare pnpm@9.0.0`.
- Backend CI uses `pnpm/action-setup@v3`, pnpm 9.0.0, Node 20, `pnpm install --frozen-lockfile` across lint/typecheck/test/build/docker jobs.
- Frontend has `ci.yml` and `e2e.yml` (KAN-51, KAN-58), so it gets the same audit job.
- Backend `engines.node` is `">=20.0.0"`; no `.nvmrc` exists in either repo.
- Backend has `"audit": "pnpm audit"` script (not in CI); `EXCEPTIONS.md` documents the accepted findings (counts refreshed in this change), 0 Critical.
- `depcheck` is not installed or used anywhere.
- `pnpm-workspace.yaml` does not exist — single repo per project, frontend is a separate repository.
- Shared tooling (TS ^5.3.3, ESLint ^8.56.0, Prettier ^3.1.1, @typescript-eslint ^6.17.0) is identical across both repos.

## Goals / Non-Goals

**Goals:**

- Standardize on pnpm as the single package manager across backend and frontend (packageManager field, lockfiles, Dockerfiles, CI, READMEs agree).
- Pin Node LTS 20 exact patch in `engines` and `.nvmrc` in both repos; keep shared tooling versions aligned.
- Add `pnpm audit --audit-level=critical` as a standalone CI job on backend (passes today, fails on new critical findings only).
- Install `depcheck`, run it, and remove verified unused dependencies from backend.
- Sync equivalent config (engines range, `.nvmrc`, Dependabot, audit job, unused-dep review) to the frontend.

**Non-Goals:**

- Do not pin Dockerfile base image to an exact Node patch (keep `node:20-alpine` floating).
- Do not change any application code, API contracts, or spec-level behavior (`skip_specs: true`).
- Do not remove or alter existing `EXCEPTIONS.md` entries; critical-only audit does not block on the documented non-critical findings.

## Decisions

### 1. pnpm audit severity level: `--audit-level=critical` (Option A)

**Rationale:** The backend has 18 documented High findings in `EXCEPTIONS.md`. Running `pnpm audit` at `high` or default level would fail CI immediately without prior remediation work. `--audit-level=critical` passes today (0 critical) and only blocks merges when a new critical vulnerability appears — matching the goal of not blocking all merges while catching critical regressions.

**Alternatives considered:**
- `--audit-level=high` — rejected; would fail CI on 18 pre-existing High findings requiring remediation before any merge.
- Report-only audit (no fail) — rejected; provides visibility but no enforcement gate.
- Custom baseline diff vs `EXCEPTIONS.md` — deferred; more complex to implement, can be added later if needed.

### 2. Standalone `audit` job in backend CI

**Rationale:** Adding an audit step inside each existing job (lint, typecheck, test, build) runs pnpm audit 4× per PR. A standalone job runs once, is easier to read, and can be toggled independently.

**Alternatives considered:**
- Inline step in each job — rejected; redundant, slows every job.

### 3. Node 22 LTS pin (`.nvmrc` = `22`, `engines` range `>=22 <23`), both repos

**Rationale:** Node 20 reached end-of-life on 30 April 2026. Node 22 is a supported LTS line. One major in `.nvmrc`, `engines`, CI (`node-version-file: .nvmrc`) and `node:22-alpine` keeps local, CI and production on the same line without an exact-patch match that warns on every install.

**Alternatives considered:**
- Keep Node 20 — rejected; end-of-life, no more security fixes.
- Exact patch pin (`22.x.y`) — rejected; warns for anyone on another 22.x.

### 4. depcheck: install → run → remove verified unused

**Rationale:** `depcheck` is not installed. Installing it as a devDependency and running it produces a verified unused-dep list before any removal. Grep-based candidates (`@nestjs/mapped-types`, `passport`, `pg`, `reflect-metadata`, `rxjs`, `ts-loader`, `source-map-support`) must be confirmed by depcheck before deletion.

**Alternatives considered:**
- Remove candidates by grep alone — rejected; grep can miss type-only or indirect usage.
- Skip depcheck entirely — rejected; no way to verify unused deps without it.

### 5. skip_specs: true

**Rationale:** This change modifies tooling/CI configuration only; no application behavior, API, or spec requirement changes. Per OpenSpec validation rules, a change with zero capabilities must set `skip_specs: true`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `pnpm audit --audit-level=critical` fails CI if a new critical advisory lands between reviews | Triage and upgrade the affected dependency; exceptions remain documented in `EXCEPTIONS.md` for non-critical findings |
| depcheck reports a dep as unused that is actually used indirectly | Manually verify each candidate against imports before removal; keep anything uncertain |
| Frontend and backend `engines.node` pins drift over time | Sync both repos in the same change; document the pin in README |
| `skip_specs: true` means no spec artifacts exist for this change | Acceptable; change is tooling-only, no behavior to specify |

## Migration Plan

1. Create OpenSpec change `dependency-management` (done — this design).
2. Install `depcheck` as backend devDependency; run `pnpm depcheck`.
3. Review depcheck output + grep candidates; confirm unused list.
4. Remove verified unused deps from backend `package.json`.
5. Pin `engines.node` to exact LTS 20 patch in backend and frontend `package.json`.
6. Add `.nvmrc` (exact LTS 20 patch) to backend and frontend roots.
7. Update backend `"audit"` script to `--audit-level=critical`.
8. Add standalone `audit` job to backend `.github/workflows/ci.yml`.
9. Verify `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
10. Commit planning artifacts; implementation proceeds via `/opsx-apply`.

## Open Questions

None. All decisions resolved during planning.
