## Why

FR-03, FR-04 and FR-12 need a persisted boards model and board CRUD with correct permission rules (T-11, T-17). The existing `boards-cards` code has no board-level role enforcement (a viewer can edit cards), no default columns, non-transactional position changes, no unique rule for `jiraIssueKey`, user links that are cross-module relations, and a `POST /cards` route that derives the board from `columnId.split('-')[0]`.

## What Changes

- Domain entities `Board`, `Column`, `Card`, `Label`, `Comment`, `BoardMembership` with enums `BoardRole` (`ADMIN | MEMBER | VIEWER`) and `ColumnType`, on `BaseEntity`, in the module layout from `module-boundaries`.
- Relations per the class diagram: Board → Column → Card and Card → Comment cascade on delete, Card ↔ Label many-to-many, Comment → author and Card → assignee stored as plain user-id columns (no cross-module foreign key).
- `Card.jiraIssueKey` nullable and unique per board when set; positions ordered; indexes on board/column lookups; migration that applies and reverts cleanly.
- Entity behaviour with unit tests: `Card.moveTo`, `BoardMembership.canEdit`.
- Board and column CRUD per `docs/api/openapi.yaml`: new board gets default columns To Do, In Progress, Done and its creator becomes Admin; a board never has fewer than 3 columns; column reorder is transactional; only Admin changes structure.
- Card endpoints keep working on the new model: create under a column, read, update, move, delete, with Viewer read-only; they publish `card.*` events.
- `BOARDS_FACADE` (member role lookup) and the `BOARD_ACCESS` port implemented by the boards module.
- **BREAKING**: `POST /cards` becomes `POST /columns/{columnId}/cards`; `boards-cards` module is renamed `boards`; `inviteMember` stub removed until T-18.

## Capabilities

### New Capabilities

- `board-domain`: persisted board model, relations, constraints and entity behaviour.
- `boards-columns`: board and column CRUD, defaults, ordering, permissions and card access rules.

### Modified Capabilities

- None.

## Impact

- `src/modules/boards-cards/**` becomes `src/modules/boards/**`; new migration; DTOs and controllers move to `presentation/`; `jira-sync` stops importing board entities.
- Frontend `endpoints.ts` is regenerated from the contract.
