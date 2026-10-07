## 1. Move to the standard layout

- [x] 1.1 Create `src/modules/health` with domain/application/infrastructure/presentation, move the controller, add `DATABASE_PROBE` port and TypeORM adapter; verify `pnpm build` and the health unit tests pass
- [x] 1.2 Re-layout `auth`, `boards-cards`, `jira-sync`, `realtime` folders with an `index.ts` each; verify `pnpm typecheck` passes
- [x] 1.3 Add `src/common/ports` (`BOARD_ACCESS`) and document `src/common` as shared kernel; verify it imports no module

## 2. Enforcement

- [x] 2.1 Add per-module `no-restricted-imports` overrides and the `forwardRef` ban to `.eslintrc.js`; verify lint passes on the repo
- [x] 2.2 Change `lint` to run without `--fix`, add `lint:fix`; verify the CI workflow uses `pnpm lint`
- [x] 2.3 Add the boundary test `src/architecture/module-boundaries.spec.ts` that lints virtual files for deep import, entity import, forbidden direction, forwardRef and an accepted index import; verify it fails when a pattern is removed

## 3. Documentation

- [x] 3.1 Write `docs/architecture/module-structure.md` (layout, public API, dependency graph, ports, SOLID checklist); verify links resolve
- [x] 3.2 Update the README module table to the real modules and layout; verify it matches the code
