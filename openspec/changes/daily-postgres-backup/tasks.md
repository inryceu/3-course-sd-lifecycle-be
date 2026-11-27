# Tasks

## 1. Backup service in all three Compose stacks

- [x] 1.1 Add `backup` service + `boardsync_postgres_dev_backups` named volume to `docker-compose.yml` (dev, `PGPASSWORD=postgres`) and verify `docker compose -f docker-compose.yml config` succeeds
- [x] 1.2 Add `backup` service + `boardsync-full-backups` named volume to `docker-compose.full.yml` (full, `PGPASSWORD=${DATABASE_PASSWORD:?}`) and verify `docker compose -f docker-compose.full.yml config --env-file .env.full` succeeds
- [x] 1.3 Add `backup` service + `boardsync_postgres_prod_backups` named volume + `db_password` secret grant to `docker-compose.prod.yml` (prod, `PGPASSWORD_FILE=/run/secrets/db_password`) and verify `docker compose -f docker-compose.prod.yml config` succeeds

## 2. Restore runbook

- [x] 2.1 Create `docs/runbooks/db-restore.md` with step-by-step restore onto an empty database per stack and verify each documented command runs as written

## 3. Local verification of backup and restore

- [x] 3.1 Bring up a stack on an empty volume, take a backup, wipe the database, restore from the dump, verify data integrity, and record the result (date, stack, outcome) in `docs/runbooks/db-restore.md`
