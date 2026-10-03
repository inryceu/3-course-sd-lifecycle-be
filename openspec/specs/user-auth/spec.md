# user-auth Specification

## Purpose
Lets people create a BoardSync account and sign in with e-mail and password, receiving a short-lived access token, as the foundation of every protected feature (FR-01).

## Requirements

### Requirement: Registration
The system SHALL let a visitor register with an e-mail, a display name and a password, SHALL create the account and SHALL return an access token, its lifetime in seconds and the user profile.

#### Scenario: Successful registration
- **WHEN** a visitor posts a valid e-mail, display name and an 8-character password to `POST /auth/register`
- **THEN** the response is 201 with `accessToken`, `expiresIn` and `user` without any password data

#### Scenario: Duplicate e-mail
- **WHEN** a visitor registers with an e-mail that exists, regardless of letter case
- **THEN** the response is 409 and no second account is created

#### Scenario: Concurrent duplicate registration
- **WHEN** two registrations for the same new e-mail arrive at the same time
- **THEN** exactly one succeeds and the other receives 409

### Requirement: Password policy and storage
Passwords SHALL be between 8 and 72 characters and SHALL be stored only as bcrypt hashes with a cost factor of at least 10 that is configurable.

#### Scenario: Short password
- **WHEN** the password has 7 characters
- **THEN** the response is 400 and no account is created

#### Scenario: Hash is not reversible plaintext
- **WHEN** an account is created
- **THEN** the stored value is a bcrypt hash using the configured cost and differs from the password

### Requirement: Login
The system SHALL authenticate a user by e-mail and password and return an access token, its lifetime and the profile.

#### Scenario: Successful login
- **WHEN** a registered user posts correct credentials to `POST /auth/login`
- **THEN** the response is 200 with `accessToken`, `expiresIn` and `user`

#### Scenario: Wrong password
- **WHEN** the password is wrong
- **THEN** the response is 401 with a generic message

#### Scenario: Unknown e-mail
- **WHEN** the e-mail is not registered
- **THEN** the response is 401 with the same message as for a wrong password

### Requirement: Access-token lifetime and claims
An access token SHALL expire after at most one hour and SHALL carry the user id and e-mail.

#### Scenario: Token claims
- **WHEN** a token is issued
- **THEN** decoding it shows the user id as subject, the e-mail and an expiry no more than 3600 seconds after issue

#### Scenario: Expired token
- **WHEN** a request presents an expired token
- **THEN** the response is 401

### Requirement: Current user
The system SHALL return the authenticated user's profile from `GET /auth/me`.

#### Scenario: Valid token
- **WHEN** a client calls `GET /auth/me` with a valid token
- **THEN** the response is 200 with id, e-mail and display name

#### Scenario: Missing token
- **WHEN** a client calls `GET /auth/me` without a token
- **THEN** the response is 401

### Requirement: Password hash never leaks
The password hash SHALL NOT appear in any API response or log output.

#### Scenario: Profile response
- **WHEN** any auth endpoint returns a user
- **THEN** the body has no password or hash field
