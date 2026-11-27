# Proposal

## Why

BoardSync runs PostgreSQL in three Docker Compose stacks (dev, full local, prod) with persistent named volumes, but has no backup mechanism. If data is lost or corrupted, there is no way to restore the database to a recent state. Backups (ticket T-42) were explicitly a non-goal of the original compose-stack change, and Week 6 ("Resilience & Integration") lists backups as a sprint goal. This change adds daily PostgreSQL backups with 7-day retention to all three stacks, plus a documented restore procedure.

## What Changes

- Add a `backup` service (image `postgres:16-alpine`) to `docker-compose.yml`, `docker-compose.full.yml`, and `docker-compose.prod.yml`, each with a named volume mounted at `/backups`.
- Each backup container runs `pg_dump` daily at 3 am Europe/Kyiv, producing a dated gzip file (`boardsync-<db>-YYYY-MM-DD_HH-MM.sql.gz`) and cleaning up files older than 7 days with `find -mtime +7`.
- Pass stack-specific credentials to the backup container: dev uses `PGPASSWORD=postgres`; full stack uses `PGPASSWORD=${DATABASE_PASSWORD:?}` from `.env.full`; prod mounts the `db_password` Docker secret and uses `PGPASSWORD_FILE=/run/secrets/db_password`.
- Add `docs/runbooks/db-restore.md` with step-by-step instructions to restore a dump onto an empty database, per stack.

## Capabilities

### New Capabilities

- `database-backup`: scheduled daily PostgreSQL backup with dated filenames and 7-day retention, plus a documented restore procedure onto an empty database.

### Modified Capabilities

- None. The existing compose specs (`full-stack-compose`) gain a new service but their requirements (one-command start, ordered healthy startup, migrations before serving, persistent data, secrets not committed) are unchanged.

## Impact

- Three compose files each gain a `backup` service and a named backup volume.
- `docs/runbooks/db-restore.md` is new.
- CI is unaffected: no image publishing, no new dependencies, no test changes.
- The full-stack backup service requires `--env-file .env.full` when started without it, consistent with the stack's existing "secrets fail fast" behavior.
