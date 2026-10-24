## Context

The sources are the review comments on #47, #48 and #50. They were re-checked on the merged Sprint 3-4 code: the concurrent duplicate invite still returned `201` + `500`, the doc comment and the module comment were still wrong, and teammates could not authorise the Jira app ("This application is in development - only the owner of this application may grant it access").

## Decisions

1. **Duplicate invite → 409:** the `save` in `MembersService.invite` catches a `QueryFailedError` with Postgres code `23505` (unique violation on `UQ_board_memberships_board_user`) and throws `ConflictException('User is already a member of this board')`. The existing pre-check stays as the fast path; the index stays the guarantee.
2. **Jira app distribution stays Not sharing (decided 2026-10-25).** Sharing requires a personal data declaration. Because BoardSync caches issue content longer than 24 hours, the answer is "Yes", and "Yes" requires confirming the Atlassian Personal Data Reporting API, which is not implemented. Until then:
   - only the app owner's account can authorise;
   - teammates add the owner as board Admin to connect a board;
   - a backlog ticket covers the API.

   `docs/jira-sandbox.md` documents this.
3. **Removed member and live events:** not fixed here. The realtime gateway checks access only on `board:join`. The fix (make a removed user's sockets leave the board room) belongs to T-27; it is recorded in the spec's known limitations and as a Jira follow-up.

## Risks / Trade-offs

- Every Jira connection depends on the owner's account. If that account loses access to the site, every board must be reconnected, and Jira shows all BoardSync changes under the owner's name. This is accepted until the Personal Data Reporting API exists.
