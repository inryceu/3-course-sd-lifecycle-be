## Purpose
Defines the browser-level system tests that exercise BoardSync's core user journeys (FR-01, FR-03, FR-04, FR-12) against the full stack, and how they are seeded, run in several browsers and reported in CI.

## ADDED Requirements

### Requirement: Isolated test data seeded through the API
The system tests SHALL create the users, boards and memberships they need through the public REST API, with e-mail addresses unique to the run, and SHALL NOT depend on pre-existing data, direct database access or real credentials.

#### Scenario: Two runs against the same stack
- **WHEN** the suite runs twice against the same, already used stack
- **THEN** both runs pass, because every run registers fresh `pw-<unique>@example.com` users and creates its own boards

### Requirement: Stored authentication state
The system tests SHALL sign a seeded user in once, store that session, and reuse it in the journeys that do not test signing in, so those journeys start already signed in.

#### Scenario: Reuse the stored session
- **WHEN** a journey that needs a signed-in user opens the boards page
- **THEN** the boards page is shown without passing through the sign-in form

### Requirement: Sign-up and sign-in journey
The system tests SHALL cover registering a new account in the web client, signing out, and signing in again with the same credentials.

#### Scenario: Register, then log in
- **WHEN** a visitor registers with a display name, e-mail and password, logs out and signs in with that e-mail and password
- **THEN** each step lands on the boards page showing the user's display name

### Requirement: Board and card journey
The system tests SHALL cover creating a board, adding cards to a column and moving a card to another column by drag and drop, and SHALL verify the result survives a page reload.

#### Scenario: Create a board and add cards
- **WHEN** a signed-in user creates a board from the boards page and adds two cards to its first column
- **THEN** the board opens with its default columns and both cards appear in the first column

#### Scenario: Drag a card to another column
- **WHEN** the user drags a card from the first column onto the second column
- **THEN** the card is shown in the second column, no longer in the first, and stays there after the page is reloaded

### Requirement: Viewer restrictions journey
The system tests SHALL cover a board Viewer's restrictions: a Viewer sees the board and its cards but is offered no way to add cards or columns, drag cards, or manage members.

#### Scenario: Viewer opens a shared board
- **WHEN** an Admin invites a registered user as `VIEWER` and that user opens the board
- **THEN** the columns and cards are visible, the add-card fields, the add-column form and the invite form are absent, and the cards are not draggable

### Requirement: Browser coverage
The system tests SHALL run in Chromium, Firefox and the Microsoft Edge channel.

#### Scenario: Run every browser project
- **WHEN** the suite runs without a project filter on a machine with the three browsers installed
- **THEN** every journey runs once per browser and the run reports each browser separately

### Requirement: CI job against the Compose stack
The frontend repository SHALL run the system tests in CI on pull requests and on pushes to `dev` and `main`, against the full Compose stack built from the frontend under test and the backend repository, and SHALL upload the report, traces and screenshots when a test fails.

#### Scenario: Pull request run
- **WHEN** a pull request is opened in the frontend repository
- **THEN** a CI job builds and starts PostgreSQL, the backend and the frontend with the full Compose file, waits until the web client answers, and runs the suite in every browser project

#### Scenario: A test fails in CI
- **WHEN** any system test fails in the CI job
- **THEN** the job fails and its artifacts contain the Playwright report with the trace and screenshot of the failed test
