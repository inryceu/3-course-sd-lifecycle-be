## 1. Tests first

- [ ] 1.1 e2e: `board.updated` on label and comment delete carries `{ board: { id } }` (fails before 2.1)
- [ ] 1.2 e2e: delete the cursor comment, then load more returns the rest (fails before 2.2)
- [ ] 1.3 e2e: a well-formed UUID cursor and another card's cursor answer 400 (fail before 2.2)

## 2. Fixes

- [ ] 2.1 Publish `{ board: BoardSnapshot }` on label and comment delete; drop `as any`; update the `board.updated` row in `docs/api/ws-events.md`
- [ ] 2.2 Position cursor `(cardId, createdAt µs, id)`; 400 for malformed or foreign cursors; document 400 on `listComments`
- [ ] 2.3 Remove the new lint warnings (shared `isUniqueViolation`, typed `@Transform`, typed e2e items)

## 3. Verification

- [ ] 3.1 typecheck, lint (no new warnings), unit, e2e, `pnpm api:validate`
