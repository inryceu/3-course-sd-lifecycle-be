# Spec Delta

## MODIFIED Requirements

### Requirement: Strong secrets without defaults
Secrets (`JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`) SHALL be required with no built-in default, `JWT_SECRET` SHALL be at least 32 characters, `JWT_SECRET` SHALL NOT look like a placeholder value when `NODE_ENV` is `production`, and `TOKEN_ENCRYPTION_KEY` SHALL be exactly 64 hexadecimal characters (32 bytes).

#### Scenario: Short JWT secret
- **WHEN** `JWT_SECRET` has 15 characters
- **THEN** startup aborts

#### Scenario: Malformed encryption key
- **WHEN** `TOKEN_ENCRYPTION_KEY` is not 64 hex characters
- **THEN** startup aborts

#### Scenario: Placeholder JWT secret in production rejected
- **WHEN** `NODE_ENV` is `production` and `JWT_SECRET` matches a placeholder pattern such as `change-me`, `default`, `example`, `your-`, or `placeholder`
- **THEN** startup aborts with an error naming `JWT_SECRET`

#### Scenario: Placeholder JWT secret in development accepted
- **WHEN** `NODE_ENV` is `development` or `test` and `JWT_SECRET` matches a placeholder pattern
- **THEN** configuration is accepted
