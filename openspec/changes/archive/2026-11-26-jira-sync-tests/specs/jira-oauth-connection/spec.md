## MODIFIED Requirements

### Requirement: Connection status and disconnect
Any board member SHALL be able to read the connection status, and only the Admin SHALL disconnect, which deletes the stored credentials. The status SHALL carry `requiresReconnect`, true only when the stored refresh token is gone and the access token has expired, so that a connection whose access token merely expired (and is refreshed on the next call) is never reported as needing a reconnect.

#### Scenario: Status when connected
- **WHEN** a member reads `GET /jira/connection`
- **THEN** the response shows connected, site URL, scopes and expiry without tokens

#### Scenario: Status when not connected
- **WHEN** the board has no connection
- **THEN** the response shows connected false and `requiresReconnect` false

#### Scenario: Idle connection with an expired access token
- **WHEN** the access token expired hours ago and a refresh token is stored
- **THEN** `requiresReconnect` is false

#### Scenario: Revoked connection
- **WHEN** the refresh token was cleared after `invalid_grant` and the access token has expired
- **THEN** `requiresReconnect` is true

#### Scenario: Disconnect
- **WHEN** the Admin calls `DELETE /jira/connection`
- **THEN** the stored credentials are deleted and later status shows connected false
