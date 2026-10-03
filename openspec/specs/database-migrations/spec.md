# database-migrations Specification

## Purpose
Defines how the PostgreSQL schema is created and evolved: one shared data source, migration-only changes, a common base for all entities and migrations that apply and revert cleanly in every environment.

## Requirements

### Requirement: Single data source
The application and the TypeORM CLI SHALL use the same data source definition and the application SHALL hold exactly one database connection pool.

#### Scenario: CLI and app agree
- **WHEN** the data source options are read by the CLI and by the application
- **THEN** they are the same object definition

### Requirement: Schema changes only through migrations
Automatic schema synchronisation SHALL be disabled in every environment and the schema SHALL change only through migrations.

#### Scenario: Synchronise requested
- **WHEN** an environment variable asks for schema synchronisation
- **THEN** it has no effect and the schema is not changed on startup

### Requirement: Migration scripts
The project SHALL provide scripts to generate, run and revert migrations, and a production-safe runner usable from the compiled build.

#### Scenario: Run in a production image
- **WHEN** the compiled backend runs its migration runner against an empty database
- **THEN** all pending migrations are applied and the process exits with status 0

### Requirement: Base entity
Every persisted entity SHALL have a UUID primary key and `createdAt` and `updatedAt` timestamps with time zone.

#### Scenario: Insert sets timestamps
- **WHEN** a row is inserted without explicit values
- **THEN** an id, `createdAt` and `updatedAt` are generated

### Requirement: Reversible migrations
Migrations SHALL apply cleanly to an empty PostgreSQL database and SHALL be fully revertible, and the CI pipeline SHALL run them against a PostgreSQL service container.

#### Scenario: Apply, revert, apply
- **WHEN** all migrations are run, then reverted, then run again on an empty database
- **THEN** each step succeeds and the final schema matches the first run

### Requirement: Module-owned entities
Entities SHALL stay owned by their module and be registered by that module, while the data source and migration tooling are shared.

#### Scenario: Entity discovery
- **WHEN** the CLI loads entities
- **THEN** it finds only entity files under module infrastructure folders and never files in build output or dependencies
