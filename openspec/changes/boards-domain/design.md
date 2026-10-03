## Context

Existing entities use `User` relations across modules, a `type` enum on columns, a global `Label` table and a `Card.jiraIssueKey` without constraints. `BoardsService.create` saves the board and membership in two independent writes; `CardsService.move` shifts positions with a raw query but never closes the gap in the source column; `ColumnsService` (not reviewed in detail) has no minimum-column rule. Only `BoardsService.update/remove` check for Admin.

## Goals / Non-Goals

**Goals:** a correct model and permission rules for boards and columns; transactional structure changes; module boundaries respected.
**Non-Goals:** members endpoints (T-18), labels and comments endpoints (T-30), card detail features (T-19), Jira mapping logic.

## Decisions

1. **Users are referenced by id, not relation.** `BoardMembership.userId`, `Card.assigneeId`, `Comment.authorId` are `uuid` columns with indexes and no FK to `users`. This is the AGENTS.md rule "no cross-module FKs" and keeps `boards` from importing the `User` entity. Referential cleanup on user deletion is a later concern (no delete-user feature exists). Unlike the ticket's wording ("Comment → author, Card → assignee"), no join is possible in SQL across modules by design; user display data is fetched through `AUTH_FACADE` where needed (T-19).
2. **`Card.boardId` is denormalised** next to `columnId` so the partial unique index `(boardId, jiraIssueKey) WHERE jiraIssueKey IS NOT NULL` enforces "unique per board" in the database. `Card.moveTo(column)` refuses a column of another board and keeps `boardId` in sync.
3. **Cascade through foreign keys** (`ON DELETE CASCADE`) for Board → Column → Card, Card → Comment, Board → Label, Board → BoardMembership, and join-table rows of card labels. Deleting a board is one SQL statement.
4. **Positions are dense integers** `0..n-1` per parent (`columns` per board, `cards` per column). They are not unique constraints (that makes swaps painful); consistency is maintained by renumbering inside a transaction with the board row locked (`SELECT … FOR UPDATE`), so concurrent reorders serialise.
5. **Default columns** (`To Do`/`TODO`, `In Progress`/`IN_PROGRESS`, `Done`/`DONE`) are created in the same transaction as the board and the Admin membership. `ColumnType` keeps `REVIEW` for boards that add a review column (Jira workflow has In Review).
6. **Minimum columns**: delete is rejected with 409 when it would leave fewer than 3 columns, and with 409 when the column still holds cards (the user must move them first). A move-to-column option can be added later without breaking the contract.
7. **Permissions**: `ADMIN` = structure and board settings, `MEMBER` = create/edit/move/delete cards, `VIEWER` = read only. A user without membership gets 404 (existence is not leaked); a member without the required role gets 403. Rules live in `BoardAccessService` in the application layer and are unit tested.
8. **Facade/ports**: `BOARDS_FACADE.getMemberRole(boardId, userId)` for `jira-sync`, and `BOARD_ACCESS.canView` for `realtime`; both are implemented by one `BoardsFacadeService`.
9. **Events**: services publish after commit — `card.created`, `card.updated`, `card.moved`, `board.updated` (structure change), with `origin: 'user'`. Comments/labels emit later.
10. **API shape** follows the contract: `GET /boards/{id}` returns the board with `columns[]` each with ordered `cards[]` (card summary: id, title, position, jiraIssueKey, deadline, assigneeId, labelIds); one query with joins, bounded by board size.
11. **Module rename** `boards-cards` → `boards` matches the contract (`boards` tag) and the dependency diagram.

## Risks / Trade-offs

- No FK to users means orphan ids are possible; acceptable until user deletion exists.
- Denormalised `boardId` can drift if a card is moved by raw SQL → only `Card.moveTo` and the service touch it, covered by tests.
- Fetching a 100-card board in one query keeps NFR-PERF-1 realistic; pagination is not needed for the course scope.

## Migration Plan

Generated migration reshapes tables (rename `column_id` constraints, add `board_id`, indexes, cascades) and backfills `cards.board_id` from the column. Revert reverses it. Existing dev data survives; there is no production data.

## Open Questions

- None.
