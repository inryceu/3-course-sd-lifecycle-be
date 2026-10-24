## Context

The sources are the review comments on #47, #48 and #50. They were re-checked on the merged Sprint 3-4 code: the concurrent duplicate invite still returned `201` + `500`, the doc comment and the module comment were still wrong, and teammates could not authorise the Jira app ("This application is in development - only the owner of this application may grant it access").

## Decisions

1. **Duplicate invite → 409:** the `save` in `MembersService.invite` catches a `QueryFailedError` with Postgres code `23505` (unique violation on `UQ_board_memberships_board_user`) and throws `ConflictException('User is already a member of this board')`. The existing pre-check stays as the fast path; the index stays the guarantee.
2. **Jira app distribution:** in the Atlassian developer console, "BoardSync (dev)" → Distribution → Sharing:
   - vendor "BoardSync team";
   - the privacy policy URL points at the repository's `docs/jira-sandbox.md#privacy`;
   - personal data declaration: yes, the app stores Atlassian account ids and issue data of the connected project.

   No code or environment variable changes, because the client id and secret stay the same.
3. **Removed member and live events:** not fixed here. The realtime gateway checks access only on `board:join`. The fix (make a removed user's sockets leave the board room) belongs to T-27; it is recorded in the spec's known limitations and as a Jira follow-up.

## Risks / Trade-offs

- A shared app can be authorised by anyone who has the authorise URL, but our backend only starts the flow for a board Admin and stores tokens per board, so nothing new is exposed.
