# Database Restore Runbook

Restores a BoardSync PostgreSQL backup onto an empty database, per Compose stack.
Backups are produced by the `backup` service in each stack (daily `pg_dump` at 3 am Europe/Kyiv, dated gzip filenames, 7-day retention).

## Prerequisites

- The stack is running (`docker compose up -d`) so the `postgres` service is reachable on its internal network.
- You have a backup file produced by the stack's `backup` service, e.g. `boardsync-boardsync_dev-2026-11-27_03-00.sql.gz`.
- The `psql` client is available on your machine, or you run restore commands inside the stack's `postgres` container via `docker compose exec`.

## Connection details per stack

| Stack | Compose file | Database | User | Password source | Network |
|-------|-------------|----------|------|-----------------|---------|
| Dev | `docker-compose.yml` | `boardsync_dev` | `postgres` | `postgres` (plain env) | `boardsync_dev_network` |
| Full local | `docker-compose.full.yml` | `boardsync` | `boardsync` | `DATABASE_PASSWORD` from `.env.full` | `boardsync_full` |
| Prod | `docker-compose.prod.yml` | `boardsync_prod` | `boardsync` | Docker secret `db_password` | `boardsync_prod_network` |

## Restore procedure

### Step 1 — Stop the backend (recommended)

Prevents writes during the restore.

```bash
# Dev
docker compose -f docker-compose.yml stop backend

# Full local
docker compose --env-file .env.full -f docker-compose.full.yml stop backend

# Prod
docker compose -f docker-compose.prod.yml stop backend
```

### Step 2 — Locate the backup file

Backups live in each stack's named backup volume. To list them:

```bash
# Dev
docker run --rm -v boardsync_postgres_dev_backups:/backups:ro alpine ls -la /backups

# Full local
docker run --rm -v boardsync-full-backups:/backups:ro alpine ls -la /backups

# Prod
docker run --rm -v boardsync_postgres_prod_backups:/backups:ro alpine ls -la /backups
```

Copy the file you want to restore onto your host (or note its name for in-container restore):

```bash
# Dev
docker run --rm -v boardsync_postgres_dev_backups:/backups:ro alpine cat /backups/<file>.sql.gz > <file>.sql.gz
```

### Step 3 — Restore onto an empty database

Restore into the stack's `postgres` service container so it uses the internal network and credentials.

**Dev:**

```bash
gunzip -c <file>.sql.gz | \
  docker compose -f docker-compose.yml exec -T postgres \
    psql -U postgres -d boardsync_dev
```

**Full local:**

```bash
gunzip -c <file>.sql.gz | \
  docker compose --env-file .env.full -f docker-compose.full.yml exec -T postgres \
    PGPASSWORD="${DATABASE_PASSWORD}" psql -U boardsync -d boardsync
```

**Prod:**

```bash
gunzip -c <file>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
    PGPASSWORD_FILE=/run/secrets/db_password psql -U boardsync -d boardsync_prod
```

If the target database already contains data and you want a truly empty restore, drop and recreate it first (this terminates existing connections):

```bash
# Dev example
docker compose -f docker-compose.yml exec postgres \
  psql -U postgres -d postgres -c "DROP DATABASE boardsync_dev;"
docker compose -f docker-compose.yml exec postgres \
  psql -U postgres -d postgres -c "CREATE DATABASE boardsync_dev;"
```

Then re-run the restore command above against the fresh database.

### Step 4 — Verify

Check that tables were restored:

```bash
# Dev
docker compose -f docker-compose.yml exec postgres \
  psql -U postgres -d boardsync_dev -c "\dt"
```

Or check a specific table count, e.g. `boards` or `cards`.

### Step 5 — Restart the backend

```bash
# Dev
docker compose -f docker-compose.yml start backend

# Full local
docker compose --env-file .env.full -f docker-compose.full.yml start backend

# Prod
docker compose -f docker-compose.prod.yml start backend
```

### Step 6 — Verify the stack is healthy

```bash
# Dev
docker compose -f docker-compose.yml ps

# Full local
docker compose --env-file .env.full -f docker-compose.full.yml ps

# Prod
docker compose -f docker-compose.prod.yml ps
```

All services should report `healthy` or `running`. The backend healthcheck (`/api/v1/health` or `/api/v1/health/ready`) confirms the database is reachable and the schema is intact.

## Notes

- Backups are gzip-compressed SQL dumps produced by `pg_dump`. They contain `CREATE TABLE`, `COPY`, and `ALTER TABLE` statements; no `CREATE DATABASE` is included, so restore into an existing database.
- The backup volume survives container restarts but is removed if you run `docker compose down -v`. Back up the volume contents off-host if you need longer retention than 7 days.
- The full-stack backup service requires `--env-file .env.full`; without it, `${DATABASE_PASSWORD:?}` fails fast with a clear Compose error.

## Verification Record

Restored onto an empty database and verified locally on 2026-11-27:

| Step | Stack | Result |
|------|-------|--------|
| Start postgres on empty volume | Dev (`docker-compose.yml`) | ✅ Healthy |
| Insert test data (3 rows in `boards`) | Dev | ✅ 3 rows inserted |
| Take `pg_dump` + gzip backup | Dev | ✅ Dump contains `CREATE TABLE`, `COPY 3`, `ALTER TABLE` |
| Drop and recreate empty database | Dev | ✅ Database recreated |
| Restore from gzip dump via `psql` | Dev | ✅ `COPY 3` rows restored |
| Verify data integrity (`SELECT count(*)`) | Dev | ✅ 3 rows match original (Board A, Board B, Board C) |

**Outcome:** Backup → wipe → restore cycle verified successfully on the dev stack. The same procedure applies to the full and prod stacks using their respective credentials and compose files (see the per-stack commands above).

