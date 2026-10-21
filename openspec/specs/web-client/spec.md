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
