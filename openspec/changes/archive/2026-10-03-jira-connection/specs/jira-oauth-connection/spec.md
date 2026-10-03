## Purpose

Lets a board Admin connect, inspect and disconnect a Jira Cloud workspace through the OAuth 2.0 (3LO) authorisation-code flow with PKCE and an anti-CSRF state (FR-02).

## ADDED Requirements

### Requirement: Start the flow
The system SHALL let only the board Admin start a connection and SHALL return an authorisation URL containing a client id, scopes, redirect URI, a `state` and a PKCE `code_challenge`; the state and verifier SHALL be stored for 10 minutes.

#### Scenario: Admin starts
- **WHEN** the Admin calls `GET /jira/oauth/start` for their board
- **THEN** the response contains an authorise URL with `state`, `code_challenge` and `code_challenge_method=S256`

#### Scenario: Non-admin
- **WHEN** a member who is not Admin calls start
- **THEN** the response is 403

#### Scenario: Not a board member
- **WHEN** a user outside the board calls start
- **THEN** the response is 404

### Requirement: Complete the flow
On callback the system SHALL validate the state, exchange the code with the stored verifier, resolve the Jira cloud id and store the tokens encrypted, and SHALL return the connected status.

#### Scenario: Successful callback
- **WHEN** the Admin calls the callback with a valid code and the stored state
- **THEN** the response is 200 with `connected` true, the cloud id and the site URL, and the board has a stored connection

#### Scenario: Reconnect
- **WHEN** the Admin connects a board that already has a connection
- **THEN** the previous credentials are replaced

### Requirement: State validation
A state SHALL be accepted once, only before it expires, and only for the user who started the flow.

#### Scenario: Unknown state
- **WHEN** the callback receives a state that was never issued
- **THEN** the response is 400 and nothing is stored

#### Scenario: Expired state
- **WHEN** the callback arrives more than 10 minutes after start
- **THEN** the response is 400 and nothing is stored

#### Scenario: Replay
- **WHEN** the same state is used a second time
- **THEN** the response is 400

#### Scenario: Other user
- **WHEN** a different authenticated user presents someone else's state
- **THEN** the response is 400 and the state is not consumed for its owner

### Requirement: Consent denied
If the user denies consent, the callback SHALL fail with 400 and no connection SHALL be stored.

#### Scenario: Access denied
- **WHEN** the callback receives `error=access_denied`
- **THEN** the response is 400 identifying the denial and the state is discarded

### Requirement: Provider failures
Failures of the Atlassian token or resource endpoints SHALL be reported without exposing secrets and without storing partial data.

#### Scenario: Rejected code
- **WHEN** the token endpoint rejects the code
- **THEN** the response is 400 and no connection is stored

#### Scenario: Provider unreachable
- **WHEN** the Atlassian endpoints cannot be reached
- **THEN** the response is 502

#### Scenario: No Jira site
- **WHEN** the account has no accessible Jira site
- **THEN** the response is 400 and nothing is stored

### Requirement: Connection status and disconnect
Any board member SHALL be able to read the connection status, and only the Admin SHALL disconnect, which deletes the stored credentials.

#### Scenario: Status when connected
- **WHEN** a member reads `GET /jira/connection`
- **THEN** the response shows connected, site URL, scopes and expiry without tokens

#### Scenario: Status when not connected
- **WHEN** the board has no connection
- **THEN** the response shows connected false

#### Scenario: Disconnect
- **WHEN** the Admin calls `DELETE /jira/connection`
- **THEN** the stored credentials are deleted and later status shows connected false

### Requirement: Secure transport in production
In production the redirect URI and the Atlassian base URLs SHALL use HTTPS.

#### Scenario: Plain HTTP redirect in production
- **WHEN** `NODE_ENV` is production and the redirect URI uses `http`
- **THEN** startup aborts
