## Why

The reviews of KAN-29 (#47), KAN-30 (#48) and KAN-34 (#50) left defects that are still in the code going into the Sprint 3-4 consolidated PR. In addition:
- T-18's member behaviour was shipped without a spec.
- The Jira OAuth app can only be authorised by its owner, which blocks every teammate from connecting a board.

## What Changes

- **Members (T-18):** two identical concurrent invites answer `409` instead of `500` (the unique-index violation is mapped).
- **Members (T-18):** member behaviour is written down as a spec, `board-members`: invite / list / change role / remove, the last-admin rule under concurrency, and the 409 cases.
- **Auth:** the `AuthFacade` doc comment that ended up on `getUserByEmail` goes back to `verifyToken`.
- **jira-sync:** the module comment that says `BOARDS_FACADE` is global is corrected, since the module now imports `BoardsModule`.
- **Jira app distribution:** the Atlassian app "BoardSync (dev)" is switched to **Sharing**, so any team member can authorise it for their boards. `docs/jira-sandbox.md` loses the wrong claim that a "Not sharing" app works for the owner's site members, and documents the distribution settings and which credentials each developer needs.
- **Known limitation, recorded and not fixed here:** a removed member's open socket keeps receiving board events until it reconnects. This belongs to realtime (T-27).

## Capabilities

### New Capabilities

- `board-members`: board membership management and the role rules enforced on it.

### Modified Capabilities

- None.

## Impact

`src/modules/boards/application/members.service.ts`, `src/modules/auth/application/auth-facade.port.ts`, `src/modules/jira-sync/jira-sync.module.ts`, `docs/jira-sandbox.md`, plus the Atlassian developer console (app distribution). No environment variable changes.
