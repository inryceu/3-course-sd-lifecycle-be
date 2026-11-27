# Design

## Context

BoardSync runs PostgreSQL in three Compose stacks (dev, full local, prod), each with a persistent named data volume. There is currently no backup mechanism (T-42 was a non-goal of the original compose-stack change). Each stack exposes its database to the backup container via its internal Compose network, reachable by the `postgres` service name. Credentials differ per stack: dev uses a plain env password, the full stack reads `DATABASE_PASSWORD` from `.env.full`, and prod uses a Docker secret mounted at `/run/secrets/db_password`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- A `backup` service added to all three Compose stacks
- Daily `pg_dump` at 3 am Europe/Kyiv with dated gzip filenames
- 7-day retention via `find -mtime +7` cleanup
- Step-by-step restore runbook (`docs/runbooks/db-restore.md`) for restoring onto an empty database

**Non-Goals:**
- Off-site or remote storage of backup files (local named volume only)
- Point-in-time recovery (daily snapshots only)
- Encryption of backup files at rest
- Backup for any database other than PostgreSQL

## Decisions

1. **Backup image: `postgres:16-alpine`** — matches the database image exactly, ships `pg_dump`, `psql`, `pg_isready`, and `crond` out of the box, and keeps the stack on a single image family. Alternative: a minimal `postgresql-client` image was considered but adds a second image to build and maintain for one backup job.

2. **Schedule via `crond` inside the backup container, `TZ=Europe/Kyiv`, `0 3 * * *`** — no new Node.js dependency (the project avoids adding dependencies for a single scheduled job, as seen in the deadline-reminders design which rejected `@nestjs/schedule`). `tzdata` is installed via `apk add --no-cache tzdata` so `TZ=Europe/Kyiv` resolves correctly across DST.

3. **Dated filenames with `find -mtime +7` cleanup** — simpler than fixed rotation and matches the confirmed requirement. Files older than 7 days are deleted after each dump.

4. **Credentials passed per stack** — dev: `PGPASSWORD=postgres`; full stack: `PGPASSWORD=${DATABASE_PASSWORD:?}` (fail fast if `.env.full` is missing, consistent with the stack's existing secret handling); prod: `PGPASSWORD_FILE=/run/secrets/db_password` with the `db_password` secret granted to the backup service.

5. **Named backup volume per stack** — `boardsync_postgres_dev_backups`, `boardsync-full-backups`, `boardsync_postgres_prod_backups`, each mounted at `/backups`. Keeps backups co-located with their stack and survives container restarts.

## Risks / Trade-offs

- [Backup container cannot reach `postgres` if the stack's network is misconfigured] → Mitigation: the backup service joins the same Compose network as postgres and declares `depends_on: postgres: condition: service_healthy`.
- [Full-stack backup fails if `.env.full` is not passed via `--env-file`] → Mitigation: `${DATABASE_PASSWORD:?}` interpolation produces a clear Compose error, consistent with existing behavior for that stack.
- [7-day retention loses older backups] → Mitigation: acceptable per the confirmed 7-day retention requirement; operators needing longer retention can copy files off the volume manually.

## Migration Plan

Additive only: each Compose file gains a `backup` service and a named volume; no existing service, network, or volume definition is modified. No database migration or data change is required. Rollback is removing the `backup` service and its volume from each compose file.

## Open Questions

None.
