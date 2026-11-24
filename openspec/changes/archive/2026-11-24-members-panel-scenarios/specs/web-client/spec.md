## MODIFIED Requirements

### Requirement: Members panel
The board page SHALL show the board's members with their roles; the Admin SHALL be able to invite an existing user by e-mail as Member or Viewer, change roles and remove members, and the backend's errors (unknown e-mail, last Admin) SHALL be shown.

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
