## Why

T-30 (KAN-41) shipped labels and comments without a spec. The first review of #56 found a removed member who could still delete comments, paging that repeated each page's last comment, a required label `color` and untrimmed label names; the re-review found that deleting a label or comment publishes `board.updated` without the documented `{ board }` payload, and that deleting the comment a cursor points at silently ends the list. This change writes the behaviour down so those cases stay fixed.

## What Changes

- New capability `labels-comments`: label CRUD and attach/detach, comment create/list/delete, access rules, paging and the events these publish.
- **Events:** deleting a label or a comment publishes `board.updated` with `{ board: Board }`, the same payload as every other `board.updated`.
- **Paging:** the comment cursor carries its own position (`createdAt` with microseconds, `id`) and the card it belongs to, so it keeps working when the comment it was taken from is deleted. A malformed cursor, or one issued for another card, answers 400.
- `docs/api/ws-events.md` lists label and comment deletion under `board.updated`; `listComments` documents its 400.
- Lint: the new code adds no warnings (shared `isUniqueViolation`, typed `@Transform` callbacks, typed e2e items).

## Capabilities

### New Capabilities

- `labels-comments`: board labels, card comments, their access rules, paging and events.

### Modified Capabilities

None.

## Impact

`src/modules/boards/application/comments.service.ts`, `labels.service.ts`, `members.service.ts`, `presentation/dto/label.dto.ts`, `test/labels-comments.e2e-spec.ts`, `docs/api/ws-events.md`, `docs/api/openapi.yaml`. Cursors issued before this change are rejected with 400; the client restarts from the first page. No schema or environment changes.
