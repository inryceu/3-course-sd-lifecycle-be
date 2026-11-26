# Proposal

## Why

FR-12 (KAN-49) member management is implemented in the web client, but `specs/web-client/spec.md` records only the Invite and Last Admin paths of the Members panel. The rest of the panel's observable behavior - listing, the read-only view for non-Admins, role change, confirmed removal, and the backend messages for an unknown e-mail and a duplicate invite - is missing from the written contract. Recording it now keeps the spec the single source of truth for the UI the frontend already ships.

## What Changes

- Extend the `web-client` **Members panel** requirement with scenarios for:
  - **List** - any member sees the member list with roles.
  - **Viewer read-only** - Members and Viewers see the list without invite, role change or removal controls.
  - **Change role** - the Admin changes a role and the list shows the new role.
  - **Remove** - the Admin removes a member after confirmation; canceling changes nothing.
  - **Unknown e-mail** - the backend's message is shown and the list does not change.
  - **Duplicate invite (409)** - the backend's message is shown.
  - **Last Admin removal**, **Role no longer allows the action (403)**, **Own role changed**, **Loading and empty states** - added with the review fixes on the frontend PR.
- Extend the requirement's SHALL sentence so it covers every scenario; keep the **Invite** and **Last Admin** scenarios as they were.
- No new endpoints or roles. The scenarios follow `specs/board-members/spec.md` and the existing members API.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-client`: the **Members panel** requirement gains eleven scenarios: listing, the read-only non-Admin view, role change, confirmed removal and cancel, the backend messages for an unknown e-mail and a duplicate invite (409), last-Admin removal, the 403 path, own-role change, and the loading/error/empty states. The requirement's SHALL sentence is extended to cover them. No behavior changes in the backend.

## Impact

- Specs: `openspec/changes/members-panel-scenarios/specs/web-client/spec.md`; applied to `openspec/specs/web-client/spec.md` (the change was archived before merge).
- Code: none. The frontend `MembersPanel` already implements the scenarios (KAN-49); backend endpoints, roles and behavior are unchanged.
- API, dependencies, database: none.
