# Spec Delta

## Purpose

Defines daily PostgreSQL backups with 7-day retention and a restore procedure onto an empty database for all BoardSync Compose stacks.

## ADDED Requirements

### Requirement: Daily scheduled backup
The system SHALL run a PostgreSQL backup once per day at 3 am Europe/Kyiv against each Compose stack's database.

#### Scenario: Backup runs at scheduled time
- **WHEN** the backup container's scheduler reaches 3 am Europe/Kyiv
- **THEN** it executes `pg_dump` against the stack's PostgreSQL service and writes a gzip file to the backup volume

### Requirement: Dated backup filenames
Each backup SHALL be written to a dated filename so backups from different days do not overwrite one another.

#### Scenario: Backup filename includes date and time
- **WHEN** a backup is produced
- **THEN** the file is named `boardsync-<db>-YYYY-MM-DD_HH-MM.sql.gz`

### Requirement: Seven-day retention
The system SHALL delete backup files older than 7 days so the backup volume does not grow without bound.

#### Scenario: Old backup is cleaned up
- **WHEN** a backup file is older than 7 days
- **THEN** the retention cleanup removes it and it is no longer present in the backup volume

### Requirement: Restore onto an empty database
The system SHALL document a restore procedure that loads a backup dump into an empty PostgreSQL database and verifies the result.

#### Scenario: Restore onto empty database
- **WHEN** an operator follows the restore runbook against an empty database
- **THEN** the database contains the backed-up data and the stack's healthcheck passes
