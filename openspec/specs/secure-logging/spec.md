# secure-logging Specification

## Purpose

Redacts secrets, tokens, and passwords from all application log output before writing, so sensitive data never appears in logs.

## Requirements

### Requirement: Secrets redacted from log output
The system SHALL redact known secret keys from every log entry before writing it.

#### Scenario: JWT secret redacted
- **WHEN** application code logs a message containing `JWT_SECRET`
- **THEN** the written log output replaces the secret value with a redaction marker

#### Scenario: Access token redacted
- **WHEN** application code logs a message containing an `accessToken`
- **THEN** the written log output replaces the token value with a redaction marker

#### Scenario: Password redacted
- **WHEN** application code logs a message containing a `password` field
- **THEN** the written log output replaces the password value with a redaction marker

#### Scenario: Database password redacted
- **WHEN** application code logs a message containing `DATABASE_PASSWORD`
- **THEN** the written log output replaces the secret value with a redaction marker
