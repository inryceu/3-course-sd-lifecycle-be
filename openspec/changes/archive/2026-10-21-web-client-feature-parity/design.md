## Context

The frontend already has a typed API client for every implemented endpoint (`src/api/endpoints.ts`, types generated from `docs/api/openapi.yaml`), TanStack Query, a Socket.IO hook that joins board rooms, and sign-in. The board page is read-only and `/jira-sync` is a placeholder. Labels, comments, members and Jira import/mappings are not implemented in the backend yet, so they stay out of scope.

## Goals / Non-Goals

**Goals:** every implemented backend feature is usable from the UI; no business rule is re-implemented on the client; tests for the parts with logic (move/rollback, role gating, callback).
**Non-Goals:** members and invitations, labels, comments, notifications, Jira import and mappings (backend not implemented); visual redesign.

## Decisions

1. **Server state stays in TanStack Query.** The board page reads `GET /boards/{id}` (`['board', id]`); every mutation invalidates that key (and `['boards']` for board changes). No Zustand store is added.
2. **Drag and drop with the native HTML5 API**, no new dependency. A card is draggable for Admin/Member; a column and the gaps between cards are drop targets that compute `{ columnId, position }`. A select-based "Move to" control in the card dialog gives the keyboard alternative.
3. **Optimistic move**: `onMutate` moves the card in the cached `BoardDetail` (pure function `moveCardInBoard`, unit tested), `onError` restores the snapshot and the global error toast shows the backend message, `onSettled` refetches.
4. **Role gating is presentation only**: `canEditStructure = myRole === 'ADMIN'`, `canEditCards = myRole !== 'VIEWER'`. The backend's 403/409 messages are shown through the existing client toast.
5. **Column reorder** uses left/right buttons calling `PATCH /columns/{id}/reorder` (simpler and accessible); card drag and drop is the main interaction.
6. **Jira page** lists the user's boards with `GET /jira/connection` per board; Connect stores the board id in `sessionStorage` and navigates to `authorizeUrl`. `/jira/callback` is a protected route that calls `GET /jira/oauth/callback` once (guarded against React strict-mode double effects, since a state is single-use) and shows the result.
7. **Realtime** keeps the existing hook: board events trigger a refetch of the board; card deletion arrives as `board.updated`.

## Risks / Trade-offs

- Native drag and drop does not work on touch screens → the "Move to" control covers it.
- One `GET /jira/connection` per board on the Jira page → fine for the expected handful of boards.
