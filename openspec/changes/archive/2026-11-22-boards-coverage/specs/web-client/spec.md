## MODIFIED Requirements

### Requirement: Move cards
The web client SHALL let Admins and Members move a card within or between columns by drag and drop and by a keyboard-accessible control, update the board optimistically and roll back if the backend rejects the move. A drop that leaves the card where it is, including a drop on the card itself, SHALL NOT send a request.

#### Scenario: Drag to another column
- **WHEN** a Member drops a card on another column
- **THEN** the card is shown there immediately and stays there after the backend confirms

#### Scenario: Rejected move
- **WHEN** the backend rejects a move
- **THEN** the card returns to its previous place and an error is shown

#### Scenario: Keyboard move
- **WHEN** a user moves a card with the card's move control without a pointer
- **THEN** the card moves to the chosen column

#### Scenario: Drop on itself
- **WHEN** a Member drops a card on the card itself
- **THEN** the card keeps its place and no move request is sent

#### Scenario: Viewer cannot move
- **WHEN** a drop event reaches the board of a Viewer
- **THEN** no move request is sent
