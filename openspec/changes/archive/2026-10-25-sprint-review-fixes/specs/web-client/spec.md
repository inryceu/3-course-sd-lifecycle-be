## ADDED Requirements

### Requirement: Members panel
The board page SHALL show the board's members with their roles; the Admin SHALL be able to invite an existing user by e-mail as Member or Viewer, change roles and remove members, and the backend's errors (unknown e-mail, last Admin) SHALL be shown.

#### Scenario: Invite
- **WHEN** the Admin invites a registered user as Viewer
- **THEN** the user appears in the members list as `VIEWER`

#### Scenario: Last Admin
- **WHEN** the only Admin tries to demote themselves
- **THEN** the role stays and the backend's message is shown

### Requirement: Assign a card in the web client
The card dialog SHALL let Admins and Members choose the assignee among the board members or clear it; Viewers SHALL see the assignee read-only.

#### Scenario: Assign
- **WHEN** a Member picks a member as assignee in the card dialog
- **THEN** the card shows that assignee after reload
