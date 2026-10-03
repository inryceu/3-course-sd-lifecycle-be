## 1. Domain and persistence

- [x] 1.1 Create `src/modules/boards` layout and move/rename from `boards-cards`; verify `pnpm typecheck` passes
- [x] 1.2 Implement entities on `BaseEntity` with enums, relations, cascade, user-id columns, partial unique index for `(boardId, jiraIssueKey)` and lookup indexes; verify `migration:generate` shows no diff after the migration
- [x] 1.3 Generate and review the migration (with `cards.board_id` backfill); verify apply, revert, apply on Docker Postgres
- [x] 1.4 Add entity logic `Card.moveTo` and `BoardMembership.canEdit`; verify unit tests cover cross-board move and every role

## 2. Application services

- [x] 2.1 Implement `BoardAccessService` (role rules, 404 vs 403); verify unit tests for each role and non-member
- [x] 2.2 Implement `BoardsService` (create with defaults + Admin in one transaction, list, read with ordered columns/cards, update, delete); verify unit tests including rollback
- [x] 2.3 Implement `ColumnsService` (create, update, delete with min-3 and non-empty rules, transactional reorder with board row lock); verify unit tests for ordering, minimum count and range errors
- [x] 2.4 Re-implement `CardsService` (create under column, read, update, move across columns with gap closing, delete) with role checks and after-commit events; verify unit tests including "no event when save fails"
- [x] 2.5 Implement `BoardsFacadeService` for `BOARDS_FACADE` and `BOARD_ACCESS` and export through `index.ts`; verify unit tests

## 3. Presentation

- [x] 3.1 Add controllers and DTOs matching `docs/api/openapi.yaml` for boards, columns and cards; verify requests/responses against the spec in e2e tests
- [x] 3.2 Add e2e tests (Supertest, real Postgres) for default columns, permissions, min columns, reorder concurrency, card moves; verify they pass
