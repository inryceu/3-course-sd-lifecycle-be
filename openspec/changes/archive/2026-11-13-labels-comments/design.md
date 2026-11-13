## Context

Comments are listed oldest first with `{ items, nextCursor }`. The cursor used to be the last comment's id, and its position was looked up with a subquery; a deleted (or foreign, or unknown) id made the subquery `NULL`, so the next page was empty and `nextCursor` was `null`.

## Decisions

- **Cursor = position, not a row reference.** `nextCursor` is base64url of `"<cardId>|<createdAt>|<id>"`. `createdAt` is read from Postgres as text with microseconds (`to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`), never through a JS `Date`, which would truncate to milliseconds and bring back the duplicate-row bug. The page condition is `(c."createdAt", c.id) > ((:ts)::timestamp AT TIME ZONE 'UTC', :id)`, so deleting the cursor row changes nothing.
- **Validation.** The decoded cursor must have three parts, a UUID card id equal to the requested card, a timestamp matching the format above and a UUID id; otherwise 400. A bare comment id (the old format) is therefore 400, and the client restarts from the top.
- **`board.updated` payload.** Label and comment deletion load the board and publish `{ board: toBoardSnapshot(board) }`, like `CardsService.remove`; the `as any` that hid the wrong shape is removed.

## Risks / Trade-offs

- The cursor is opaque but not signed: a client can forge a position on a card it is a member of, which only changes where its own page starts.
