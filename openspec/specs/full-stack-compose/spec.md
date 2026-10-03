# full-stack-compose Specification

## Purpose
Lets any teammate start the complete BoardSync system locally (database, backend, frontend) with one command, with deterministic startup order and persistent data.

## Requirements

### Requirement: One-command start
A single `docker compose` command SHALL start PostgreSQL, the backend with its migrations applied, and the frontend served by nginx on a clean machine.

#### Scenario: Clean machine
- **WHEN** a developer with both repositories checked out runs the documented command
- **THEN** all three services become healthy and the web UI answers on the documented URL

### Requirement: Ordered, health-gated startup
Services SHALL define health checks and dependents SHALL wait for dependencies to be healthy before starting.

#### Scenario: Database not ready
- **WHEN** PostgreSQL is still starting
- **THEN** the backend does not start yet

#### Scenario: Backend not ready
- **WHEN** the backend is still migrating
- **THEN** the frontend is not started as healthy

### Requirement: Migrations before serving
The backend container SHALL apply pending migrations before it accepts requests and SHALL exit with an error if a migration fails.

#### Scenario: Fresh database
- **WHEN** the stack starts with an empty volume
- **THEN** the schema exists before the API reports healthy

#### Scenario: Failing migration
- **WHEN** a migration fails
- **THEN** the backend container exits non-zero and the API is not served

### Requirement: Persistent data
Database data SHALL live in a named volume and survive a restart of the stack.

#### Scenario: Restart
- **WHEN** the stack is stopped without removing volumes and started again
- **THEN** previously created users and boards still exist

### Requirement: Documented access URLs
The frontend SHALL reach the backend for both REST and WebSocket through documented URLs, and both repositories' READMEs SHALL contain the run instructions.

#### Scenario: REST through the web port
- **WHEN** a browser opens the web URL and the SPA calls the API path
- **THEN** the request reaches the backend through the frontend proxy

#### Scenario: WebSocket through the web port
- **WHEN** the SPA opens the realtime connection on the web origin
- **THEN** the connection is upgraded and reaches the backend

### Requirement: Secrets are not committed
The stack SHALL read secrets from a git-ignored file and SHALL fail fast with a clear message when a required secret is missing.

#### Scenario: Missing secret file
- **WHEN** the stack is started without the secrets file
- **THEN** compose reports which variable is missing instead of starting with defaults
