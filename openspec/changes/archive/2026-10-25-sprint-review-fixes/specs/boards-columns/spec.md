## ADDED Requirements

### Requirement: Assign a card
Members and Admins SHALL set or clear a card's assignee with `PUT /cards/{cardId}/assignee` (`{ assigneeId: uuid | null }`). The assignee SHALL be a member of the card's board, Viewers SHALL get 403, and a change SHALL publish `card.updated`.

#### Scenario: Assign a member
- **WHEN** a Member assigns a card to another member of the board
- **THEN** the response is 200 with the card whose `assigneeId` is that user, and `card.updated` is published

#### Scenario: Clear the assignee
- **WHEN** the request body is `{ "assigneeId": null }`
- **THEN** the card has no assignee

#### Scenario: Assignee outside the board
- **WHEN** the assignee is not a member of the board
- **THEN** the response is 400 and the card is unchanged

#### Scenario: Viewer
- **WHEN** a Viewer calls the endpoint
- **THEN** the response is 403
