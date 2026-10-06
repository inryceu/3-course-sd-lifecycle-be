## 1. OpenAPI — Auth Domain

- [ ] 1.1 Define `POST /auth/register` (request/response, ErrorResponse)
- [ ] 1.2 Define `POST /auth/login` (request/response, tokens)
- [ ] 1.3 Define `POST /auth/refresh` (refresh token rotation)
- [ ] 1.4 Define `GET /auth/me` (current user profile)
- [ ] 1.5 Add `BearerAuth` security requirement to protected endpoints
- [ ] 1.6 Mark public endpoints with `security: []`: `POST /auth/register`, `POST /auth/login`, `GET /jira/callback`, `POST /jira/webhook` (webhook verifies Jira signature, not JWT)

## 2. OpenAPI — Boards + Columns Domain

- [ ] 2.1 Define `GET /boards` (paginated, query: page, pageSize)
- [ ] 2.2 Define `POST /boards` (create board with columns)
- [ ] 2.3 Define `GET /boards/{boardId}` (board with columns)
- [ ] 2.4 Define `PATCH /boards/{boardId}` (update board metadata)
- [ ] 2.5 Define `DELETE /boards/{boardId}`
- [ ] 2.6 Define `GET /boards/{boardId}/columns` (ordered list)
- [ ] 2.7 Define `POST /boards/{boardId}/columns` (create column)
- [ ] 2.8 Define `PATCH /boards/{boardId}/columns/{columnId}` (update column)
- [ ] 2.9 Define `DELETE /boards/{boardId}/columns/{columnId}`
- [ ] 2.10 Define `POST /boards/{boardId}/columns/reorder` (drag-drop reorder)

## 3. OpenAPI — Cards Domain

- [ ] 3.1 Define `GET /boards/{boardId}/cards` (paginated, filter by columnId, assigneeId, labelId)
- [ ] 3.2 Define `POST /boards/{boardId}/cards` (create card in column)
- [ ] 3.3 Define `GET /boards/{boardId}/cards/{cardId}`
- [ ] 3.4 Define `PATCH /boards/{boardId}/cards/{cardId}` (update title, description, assignee, deadline)
- [ ] 3.5 Define `POST /boards/{boardId}/cards/{cardId}/move` (move to column, position)
- [ ] 3.6 Define `POST /boards/{boardId}/cards/{cardId}/assign` (assigneeId)
- [ ] 3.7 Define `DELETE /boards/{boardId}/cards/{cardId}`

## 4. OpenAPI — Labels + Comments Domain

- [ ] 4.1 Define `GET /boards/{boardId}/labels` (list labels)
- [ ] 4.2 Define `POST /boards/{boardId}/labels` (create label)
- [ ] 4.3 Define `PATCH /boards/{boardId}/labels/{labelId}` (update label)
- [ ] 4.4 Define `DELETE /boards/{boardId}/labels/{labelId}`
- [ ] 4.5 Define `POST /boards/{boardId}/cards/{cardId}/labels` (assign labels to card)
- [ ] 4.6 Define `DELETE /boards/{boardId}/cards/{cardId}/labels/{labelId}` (remove label)
- [ ] 4.7 Define `GET /boards/{boardId}/cards/{cardId}/comments` (paginated)
- [ ] 4.8 Define `POST /boards/{boardId}/cards/{cardId}/comments` (add comment)
- [ ] 4.9 Define `PATCH /boards/{boardId}/cards/{cardId}/comments/{commentId}` (edit comment)
- [ ] 4.10 Define `DELETE /boards/{boardId}/cards/{cardId}/comments/{commentId}`

## 5. OpenAPI — Members/Roles Domain

- [ ] 5.1 Define `GET /boards/{boardId}/members` (list memberships with roles)
- [ ] 5.2 Define `POST /boards/{boardId}/members/invite` (invite user by email, role)
- [ ] 5.3 Define `PATCH /boards/{boardId}/members/{userId}` (update role)
- [ ] 5.4 Define `DELETE /boards/{boardId}/members/{userId}` (remove member)
- [ ] 5.5 Define `GET /invitations` (list pending invitations for current user)
- [ ] 5.6 Define `POST /invitations/{invitationId}/accept` / `reject`

## 6. OpenAPI — Jira Integration Domain

- [ ] 6.1 Define `GET /jira/connect` (OAuth start URL)
- [ ] 6.2 Define `GET /jira/callback` (OAuth callback, exchange code for tokens)
- [ ] 6.3 Define `GET /jira/status` (connection status, linked project)
- [ ] 6.4 Define `DELETE /jira/disconnect` (revoke tokens, remove mapping)
- [ ] 6.5 Define `GET /jira/mappings` (list Jira issue ↔ card mappings)
- [ ] 6.6 Define `POST /jira/import` (import open Jira issues as cards)
- [ ] 6.7 Define `POST /jira/webhook` (Jira webhook receiver)
- [ ] 6.8 Define `GET /jira/conflicts` (list sync conflicts)
- [ ] 6.9 Define `POST /jira/conflicts/{conflictId}/resolve` (resolve conflict)

## 7. OpenAPI — Notifications Domain

- [ ] 7.1 Define `GET /notifications` (paginated, filter: unread, type)
- [ ] 7.2 Define `PATCH /notifications/{notificationId}/read` (mark read)
- [ ] 7.3 Define `PATCH /notifications/read-all` (mark all read)
- [ ] 7.4 Define `GET /notifications/preferences` (reminder settings)
- [ ] 7.5 Define `PATCH /notifications/preferences` (update reminder settings)

## 8. OpenAPI — Shared Components

- [ ] 8.1 Define `ErrorResponse` schema (timestamp, status, error, message, path, details?)
- [ ] 8.2 Define `PaginatedResponse<T>` schema (items, total, page, pageSize, totalPages)
- [ ] 8.3 Define `PageParams` (page, pageSize) and `CursorParams` (cursor, limit) parameter objects
- [ ] 8.4 Define `BearerAuth` security scheme (HTTP Bearer, JWT)
- [ ] 8.5 Define reusable path parameters: `BoardIdParam`, `ColumnIdParam`, `CardIdParam`, `LabelIdParam`, `CommentIdParam`, `UserIdParam`
- [ ] 8.6 Apply pagination convention consistently across all list endpoints
- [ ] 8.7 Apply error response convention (400, 401, 403, 404, 409, 422, 500) to all endpoints

## 9. WebSocket Contract (ws-events.md)

- [ ] 9.1 Document handshake: `wss://<API_HOST>/ws` + auth payload `{ type: "auth", token: "<JWT>" }`, error codes
- [ ] 9.2 Document room pattern: `board:{boardId}`, join/leave lifecycle
- [ ] 9.3 Document server→client events: `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated`, `notification.created`
- [ ] 9.4 Document `origin: 'user' | 'jira'` field on all card/board events (including `board.updated`)
- [ ] 9.5 Document payload schemas for each event (reference OpenAPI components where possible)
- [ ] 9.6 Note: all mutations go through REST; WS only broadcasts events

## 10. FE Type Generation & Linting

- [ ] 10.1 Add `openapi-typescript` to devDependencies
- [ ] 10.2 Add `generate:types` script to package.json (outputs to src/generated/)
- [ ] 10.3 Add `.redocly.yaml` with recommended ruleset and custom rules
- [ ] 10.4 Add `lint:openapi` script running `redocly lint docs/api/openapi.yaml`
- [ ] 10.5 Verify `pnpm generate:types` produces valid TypeScript types
- [ ] 10.6 Verify `pnpm lint:openapi` passes on the spec
- [ ] 10.7 Create `docs/api/README.md` documenting `generate:types` and `lint:openapi` commands

## 11. Review & Approval

- [ ] 11.1 Share OpenAPI spec and WS contract with all four module owners
- [ ] 11.2 Collect feedback from Pavlo (boards-cards), Edward (jira-sync), Denys (auth), Kyrylo (realtime)
- [ ] 11.3 Incorporate feedback and resolve conflicts
- [ ] 11.4 Obtain explicit approval from all four module owners
- [ ] 11.5 Document approvals in change metadata or PR description