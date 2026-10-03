## Purpose

Guarantees that the backend is configured through validated, typed environment variables, fails fast on bad configuration and never starts with insecure default secrets, so Docker, CI and local runs behave identically.

## ADDED Requirements

### Requirement: Fail fast on invalid configuration
The application SHALL refuse to start when a required environment variable is missing or invalid and SHALL report every invalid variable in one error.

#### Scenario: Missing secret
- **WHEN** the application starts without `JWT_SECRET`
- **THEN** startup aborts with an error naming `JWT_SECRET`

#### Scenario: Several problems at once
- **WHEN** both `DATABASE_HOST` and `TOKEN_ENCRYPTION_KEY` are invalid
- **THEN** the error lists both variables

### Requirement: Token lifetime limit
The configured access-token lifetime SHALL NOT exceed one hour.

#### Scenario: Lifetime above one hour
- **WHEN** `JWT_EXPIRES_IN` is `2h`
- **THEN** startup aborts with a message that the lifetime must be at most 1h

#### Scenario: Lifetime within limit
- **WHEN** `JWT_EXPIRES_IN` is `45m`
- **THEN** configuration is accepted

### Requirement: Strong secrets without defaults
Secrets (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`) SHALL be required with no built-in default, `JWT_SECRET` SHALL be at least 32 characters, and `TOKEN_ENCRYPTION_KEY` SHALL be exactly 64 hexadecimal characters (32 bytes).

#### Scenario: Short JWT secret
- **WHEN** `JWT_SECRET` has 15 characters
- **THEN** startup aborts

#### Scenario: Malformed encryption key
- **WHEN** `TOKEN_ENCRYPTION_KEY` is not 64 hex characters
- **THEN** startup aborts

### Requirement: Password hashing cost
The bcrypt cost factor SHALL be configurable through `BCRYPT_ROUNDS`, SHALL default to 10 and SHALL NOT be accepted below 10.

#### Scenario: Cost below minimum
- **WHEN** `BCRYPT_ROUNDS` is `8`
- **THEN** startup aborts

### Requirement: Typed configuration namespaces
Configuration SHALL be exposed through typed namespaces `app`, `database`, `jwt`, `jira`, `crypto` and `webhook`.

#### Scenario: Reading a namespace
- **WHEN** a service asks for the `jwt` namespace
- **THEN** it receives the secret and the expiry as typed values

### Requirement: Committed environment files are safe and valid
`.env.example` SHALL list every variable with a comment and a safe sample value, and committed `.env.dev` and `.env.prod` SHALL contain no real secrets; `.env.example` and `.env.dev` SHALL pass the validation schema.

#### Scenario: Example file is valid
- **WHEN** the schema validates the values in `.env.example`
- **THEN** validation succeeds

#### Scenario: Production file has placeholders only
- **WHEN** a reader opens `.env.prod`
- **THEN** every secret is a `${...}` placeholder
