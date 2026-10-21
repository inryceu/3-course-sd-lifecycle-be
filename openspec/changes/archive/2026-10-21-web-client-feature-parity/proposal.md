## Why

The backend already implements registration and login, boards, columns, cards, board roles, live board events and the Jira OAuth connection, but the web client only signs users in and shows a read-only board. Every implemented feature has to be usable from the UI so the system can be reviewed and demonstrated end to end, and the Atlassian redirect (`JIRA_REDIRECT_URI` = frontend `/jira/callback`) currently lands on a route that does not exist.

## What Changes

- Boards: create, rename/describe, delete (Admin), list with the user's role.
- Columns (Admin): add, rename, change type, reorder, delete; backend rules (minimum 3 columns, column must be empty) are shown as errors, not duplicated.
- Cards (Admin, Member): create, edit title/description/deadline, delete, move within and between columns by drag and drop with optimistic update and rollback, plus a keyboard-accessible move control.
- Viewers see the board read-only; the UI hides actions the role cannot perform (the backend still enforces them).
- Live updates: the open board joins its room and refreshes on `card.*` and `board.updated` events from other users.
- Jira: per-board connection panel (status, connect, disconnect) for Admins and the `/jira/callback` route that completes the OAuth flow and returns to the board.
- No backend behaviour changes; the API and WebSocket contract stay as documented.

## Capabilities

### New Capabilities

- `web-client`: what the BoardSync web client lets a signed-in user do with the features the backend exposes (boards, columns, cards, roles, live updates, Jira connection).

### Modified Capabilities

- `jira-oauth-connection`: the frontend callback page, previously a non-goal, becomes a requirement of the connect flow.

## Impact

- Frontend repository (`3-course-sd-lifecycle-fe`): `src/features/boards`, `src/features/cards`, `src/features/jira-sync`, `src/App.tsx` routes, tests. No new dependencies (native HTML5 drag and drop).
- Backend repository: specs only.
