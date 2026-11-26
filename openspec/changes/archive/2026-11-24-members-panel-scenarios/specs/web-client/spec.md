## MODIFIED Requirements

### Requirement: Members panel
The board page SHALL show the board's members with their roles, with a loading state while the list loads, an error with a retry if it cannot be loaded, and an empty state; Members and Viewers SHALL see the list read-only. The Admin SHALL be able to invite an existing user by e-mail as Member or Viewer, change roles and remove members, the controls that would demote or remove the only Admin SHALL be disabled with a reason, and the backend's errors (unknown e-mail, duplicate invite, last Admin, role no longer allowing the action) SHALL be shown; after a role change or a 403 the board's role SHALL be refreshed so the controls match the user's current role.

#### Scenario: Invite
- **WHEN** the Admin invites a registered user as Viewer
- **THEN** the user appears in the members list as `VIEWER`

#### Scenario: Last Admin
- **WHEN** the only Admin tries to demote themselves
- **THEN** the role stays and the backend's message is shown

#### Scenario: List
- **WHEN** any member opens the board's members panel
- **THEN** the list shows every member with their role

#### Scenario: Viewer read-only
- **WHEN** a Member or Viewer opens the board's members panel
- **THEN** the list is shown without invite, role change or removal controls

#### Scenario: Change role
- **WHEN** the Admin picks a new role for a member
- **THEN** the list shows that member with the new role

#### Scenario: Remove
- **WHEN** the Admin removes a member and confirms
- **THEN** the member disappears from the list

#### Scenario: Cancel removal
- **WHEN** the Admin removes a member and cancels the confirmation
- **THEN** the member stays in the list

#### Scenario: Unknown e-mail
- **WHEN** the Admin invites an e-mail that no registered user has
- **THEN** the backend's message is shown and the members list does not change

#### Scenario: Duplicate invite (409)
- **WHEN** the Admin invites a user who is already a member
- **THEN** the backend's message is shown

#### Scenario: Last Admin removal
- **WHEN** the Admin list contains only one Admin
- **THEN** the role select and the Remove button of that Admin are disabled with a reason, and if the backend still refuses a demotion or removal its message is shown and the role stays

#### Scenario: Role no longer allows the action (403)
- **WHEN** a members call is refused with 403 because the user's role has changed
- **THEN** the backend's message is shown, the board is refetched and the Admin controls disappear if the user is no longer an Admin

#### Scenario: Own role changed
- **WHEN** an Admin demotes themselves to Member while another Admin remains
- **THEN** the invite form, role selects and Remove buttons disappear at once

#### Scenario: Loading and empty states
- **WHEN** the members list is loading, fails to load, or is empty
- **THEN** the panel shows "Loading members..." (announced as status), an error with a retry, or "No members." respectively
