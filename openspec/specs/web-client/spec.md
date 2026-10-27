# web-client Specification

## Purpose
Defines what a signed-in user can do in the BoardSync web client with the features the backend implements: boards, columns, cards, board roles, live board updates and the Jira connection (FR-02, FR-03, FR-04, FR-06, FR-11).

## Requirements

### Requirement: Board management
The web client SHALL let a signed-in user list the boards they belong to with their role, create a board, and let the board Admin rename, describe and delete it.

#### Scenario: Create a board
- **WHEN** a user submits a new board title on the boards page
- **THEN** the board is created, appears in the list with the role `ADMIN`, and opens with its default columns

#### Scenario: Delete a board
- **WHEN** the Admin deletes a board and confirms
- **THEN** the board is removed and the user returns to the boards list

#### Scenario: Not an Admin
- **WHEN** a Member or Viewer opens a board
- **THEN** the board settings (rename, delete) are not offered

### Requirement: Column management
The web client SHALL let the board Admin add, rename, retype, reorder and delete columns, and SHALL show the backend's rejection when a rule is violated.

#### Scenario: Add and reorder
- **WHEN** the Admin adds a column and moves it left or right
- **THEN** the board shows the columns in the new order returned by the backend

#### Scenario: Rule violation
- **WHEN** the Admin deletes a column that still has cards, or one of the last three columns
- **THEN** the column stays and the backend's error message is shown

### Requirement: Card management
The web client SHALL let Admins and Members create cards in a column, edit their title, description and deadline, and delete them.

#### Scenario: Create a card
- **WHEN** a Member enters a title in a column's add-card field
- **THEN** the card appears at the bottom of that column

#### Scenario: Edit a card
- **WHEN** a Member opens a card, changes its description and deadline and saves
- **THEN** the card shows the new values after reload

### Requirement: Move cards
The web client SHALL let Admins and Members move a card within or between columns by drag and drop and by a keyboard-accessible control, update the board optimistically and roll back if the backend rejects the move.

#### Scenario: Drag to another column
- **WHEN** a Member drops a card on another column
- **THEN** the card is shown there immediately and stays there after the backend confirms

#### Scenario: Rejected move
- **WHEN** the backend rejects a move
- **THEN** the card returns to its previous place and an error is shown

#### Scenario: Keyboard move
- **WHEN** a user moves a card with the card's move control without a pointer
- **THEN** the card moves to the chosen column

### Requirement: Role-aware board
The web client SHALL show a Viewer the board read-only and hide controls the user's role does not allow; the backend remains the authority for permissions.

#### Scenario: Viewer
- **WHEN** a Viewer opens a board
- **THEN** no add, edit, delete or move controls are shown

### Requirement: Live board updates
An open board SHALL join its realtime room and refresh when another user creates, updates, moves or deletes a card or changes the board.

#### Scenario: Change by another user
- **WHEN** another member moves a card on a board the user has open
- **THEN** the user's board shows the card in its new column without a manual reload

### Requirement: Jira connection panel
The web client SHALL show each board's Jira connection status and let the board Admin connect and disconnect the board.

#### Scenario: Connect
- **WHEN** the Admin chooses Connect for a board
- **THEN** the browser is sent to the Atlassian authorisation URL returned by the backend

#### Scenario: Disconnect
- **WHEN** the Admin disconnects a connected board and confirms
- **THEN** the status shows the board as not connected

### Requirement: Jira import from the web client
The Jira Sync page SHALL let the board Admin of a connected board choose the Jira project from the list of projects of the connected site (shown as `name (KEY)`, the board's linked project preselected), run the import, and see its result (created, updated, skipped). When the project list cannot be loaded, the page SHALL fall back to entering the project key by hand. It SHALL show every member the status → column mapping, and let the Admin change and save it.

#### Scenario: Import
- **WHEN** the Admin of a connected board picks `Kanban (KAN)` and chooses Import
- **THEN** the import runs for `KAN`, the page shows the counts returned by the backend and the board shows the imported cards

#### Scenario: Linked project preselected
- **WHEN** the Admin opens the Jira Sync page of a board linked to `KAN`
- **THEN** the project picker shows `KAN` selected

#### Scenario: Project list unavailable
- **WHEN** listing the projects fails
- **THEN** the page offers a project key text field instead of the picker and the import still works with the typed key

#### Scenario: Edit the mapping
- **WHEN** the Admin picks another column for a status and saves
- **THEN** the mapping shows that status as stored (not default) after reload

#### Scenario: Not an Admin
- **WHEN** a Member opens the Jira Sync page
- **THEN** the mapping is shown read-only and no Import control is offered

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
