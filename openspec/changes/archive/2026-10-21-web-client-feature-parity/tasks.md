## 1. Boards

- [x] 1.1 Boards page: create-board form, list with role; verify a component test creates a board and navigates to it
- [x] 1.2 Board settings for Admin: rename/description and delete with confirmation; verify hidden for Member/Viewer in a test

## 2. Columns

- [x] 2.1 Admin column controls: add, rename, change type, move left/right, delete; verify backend errors are shown and the board refetches

## 3. Cards

- [x] 3.1 Add-card field per column and card dialog (title, description, deadline, move-to column, delete); verify a component test edits a card
- [x] 3.2 Drag and drop between and within columns with optimistic update and rollback (`moveCardInBoard`); verify unit tests for the move function and the rollback
- [x] 3.3 Viewer read-only board; verify no edit controls are rendered for a Viewer

## 4. Live updates

- [x] 4.1 Keep the board room joined and refetch on `card.*` and `board.updated`; verify in the running stack with two browser sessions

## 5. Jira

- [x] 5.1 Jira page with per-board status, Connect (Admin) and Disconnect; verify a component test
- [x] 5.2 `/jira/callback` route completing the flow once, with success and failure states; verify a component test for both

## 6. Verification

- [x] 6.1 Frontend `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass
- [x] 6.2 Full stack rebuilt with `scripts/full-stack-smoke.sh` and every scenario of the `web-client` spec checked in a browser
