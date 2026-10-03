## Purpose

Stores the credentials of a connected Jira workspace so that they are encrypted at rest and cannot leak through logs or API responses (NFR-SEC-2).

## ADDED Requirements

### Requirement: Connection record
The system SHALL store, per board, a Jira connection with the cloud id, site URL, connecting user, access token, refresh token, expiry and granted scopes.

#### Scenario: One connection per board
- **WHEN** a board is connected twice
- **THEN** a single record exists holding the latest credentials

### Requirement: Authenticated encryption of tokens
Access and refresh tokens SHALL be encrypted with AES-256-GCM using a random IV for every value and a key from configuration, and SHALL be stored only in encrypted form.

#### Scenario: Round trip
- **WHEN** a token is encrypted and then decrypted with the same key
- **THEN** the original value is returned

#### Scenario: Same plaintext twice
- **WHEN** the same token is encrypted twice
- **THEN** the two ciphertexts differ

#### Scenario: Tampering
- **WHEN** stored ciphertext is modified
- **THEN** decryption fails with an integrity error

#### Scenario: Wrong key
- **WHEN** decryption is attempted with a different key
- **THEN** decryption fails

#### Scenario: Database content
- **WHEN** the stored token columns are read directly from the database
- **THEN** they contain neither the plaintext token nor the string the provider returned

### Requirement: Tokens never exposed
Tokens SHALL NOT appear in logs or in any API response.

#### Scenario: Status response
- **WHEN** a client reads the connection status
- **THEN** the body contains no access or refresh token

#### Scenario: Failure logging
- **WHEN** the token exchange fails
- **THEN** logs contain the status and provider error code but no token or code verifier
