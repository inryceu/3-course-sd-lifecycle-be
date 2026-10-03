## Why

ARCHITECTURE.md promises a modular monolith, but nothing enforces it: `jira-sync` entities import `boards-cards` and `auth` entities directly, `boards-cards` imports `UserRole` from auth internals, modules have a flat layout, and there are no ports and no lint rule. Four people build four modules in parallel (T-02), so boundaries must be code-level conventions with a failing CI check, not prose.

## What Changes

- Add `docs/architecture/module-structure.md`: per-module layout `domain/`, `application/`, `infrastructure/`, `presentation/`, public API only through `index.ts`, allowed dependency direction, port rules, SOLID checklist.
- Move `health` into `src/modules/health` as the reference module implementing the full layout (port + adapter + controller).
- Add ESLint `no-restricted-imports` overrides per module that fail on deep imports into another module and on any cross-module import of entities/repositories; `lint` no longer runs with `--fix` in CI.
- Document and test the dependency direction `boards → auth`, `jira-sync → auth`, `jira-sync → boards`, `realtime → event bus + AUTH_FACADE` and forbid `forwardRef()`.
- Add a shared-kernel convention for `src/common` (base entity, events, ports implemented by other modules).

## Capabilities

### New Capabilities

- `module-boundaries`: layout, public-API and dependency rules for backend modules and their automated enforcement.

### Modified Capabilities

- None.

## Impact

- Code: `src/health/*` moves to `src/modules/health/*`; `.eslintrc.js`, `package.json` (`lint`, `lint:fix`), new boundary test under `src/architecture/`.
- Docs: new `docs/architecture/module-structure.md`. AGENTS.md is NOT modified (agents may not edit it); its stale module-structure block is called out in the PR.
- Unblocks T-06, T-10, T-11, T-15 and the later CI tickets.
