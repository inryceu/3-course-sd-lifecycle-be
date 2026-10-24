## 1. Members

- [x] 1.1 Map the unique violation on invite to 409; verify a component test with two concurrent identical invites
- [x] 1.2 Component tests for the `board-members` scenarios (invite, roles, last admin under concurrency, 403/404)

## 2. Cards

- [x] 2.1 `PUT /cards/{cardId}/assignee` (member check, Viewer 403, `card.updated`); verify unit and component tests

## 3. Cleanup

- [x] 3.1 Restore the `verifyToken` doc comment in `auth-facade.port.ts` and fix the `jira-sync.module.ts` comment

## 4. Jira app access

- [x] 4.1 Decide the app distribution: stays Not sharing (Personal Data Reporting API missing); the limitation, workaround and follow-up are recorded in `docs/jira-sandbox.md`
- [x] 4.2 Correct `docs/jira-sandbox.md` (distribution, privacy note, which credentials teammates need)

## 5. Frontend

- [x] 5.1 Members panel on the board page (list; Admin invite / role / remove; errors shown); verify component tests
- [x] 5.2 Assignee select in the card dialog (members, clear; read-only for Viewers); verify component tests
