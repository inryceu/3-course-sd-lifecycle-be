# auth-facade Specification

## Purpose
Makes every endpoint protected by default and gives other modules a stable port for identifying users, so they never import authentication internals.

## Requirements

### Requirement: Protected by default
All HTTP routes SHALL require a valid access token unless explicitly marked public.

#### Scenario: New controller without annotations
- **WHEN** a route has no public marker and the request has no token
- **THEN** the response is 401

#### Scenario: Public route
- **WHEN** a route is marked public
- **THEN** it is reachable without a token

### Requirement: Current-user access
Handlers SHALL be able to obtain the authenticated user (id, e-mail, display name) through a decorator, and the user SHALL reflect an account that still exists.

#### Scenario: Handler reads the user
- **WHEN** an authenticated request reaches a handler using the decorator
- **THEN** the handler receives the user's id, e-mail and display name

#### Scenario: Deleted account
- **WHEN** a request carries a valid token of a user that no longer exists
- **THEN** the response is 401

### Requirement: Auth facade port
The auth module SHALL export an `AUTH_FACADE` port with `getUserById` and `verifyToken`, and SHALL expose it only through its public API.

#### Scenario: Verify a valid token
- **WHEN** another module calls `verifyToken` with a valid token
- **THEN** it receives the user

#### Scenario: Verify an invalid token
- **WHEN** `verifyToken` receives a tampered or expired token
- **THEN** it returns null instead of throwing

#### Scenario: Lookup of a missing user
- **WHEN** `getUserById` is called with an unknown id
- **THEN** it returns null
