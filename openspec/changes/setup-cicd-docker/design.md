## Context

The backend repository currently contains only OpenSpec configuration and documentation. No NestJS project exists yet. We need to scaffold a minimal NestJS project with proper infrastructure for spec-driven development.

## Goals / Non-Goals

**Goals:**
- Scaffold minimal NestJS project with modular architecture (auth, boards-cards, jira-sync, realtime)
- Multi-stage Dockerfile for dev (hot reload) and prod (optimized)
- Separate docker-compose files for dev and prod with complete isolation
- GitHub Actions CI/CD pipeline (lint, typecheck, test, build, docker)
- Standardized npm scripts for dev/prod separation
- Environment variable management with .env files per environment

**Non-Goals:**
- Implement business logic for modules (separate changes)
- Database migrations (handled per module)
- Frontend implementation (separate repo)
- Kubernetes/Helm (future work)

## Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| **Multi-stage Dockerfile** (base → deps → builder → runner) | Optimizes layer caching, reduces prod image size, separates build-time vs runtime deps | Single-stage Dockerfile - rejected (larger images, no caching benefits) |
| **Separate docker-compose.yml (dev) and docker-compose.prod.yml** | Complete isolation: different networks, volumes, env files, no port conflicts | Single compose with profiles - rejected (risk of env leakage, complex overrides) |
| **GitHub Actions for CI/CD** | Native GitHub integration, free for public repos, matrix support | GitLab CI, CircleCI - rejected (repo is on GitHub) |
| **npm scripts: `start:dev`, `start:prod`, `build`, `test`, `lint`, `typecheck`** | Standard Node.js conventions, clear separation | Makefile, scripts - rejected (less portable) |
| **Environment files: .env.dev, .env.prod, .env.example** | Explicit per-environment config, .env.example for onboarding | Single .env with overrides - rejected (risk of prod secrets in dev) |
| **Non-root user in Docker** | Security best practice | Root user - rejected (security risk) |
| **pnpm over npm/yarn** | Faster installs, disk efficient, strict dependencies | npm, yarn - rejected (pnpm is modern standard) |

## Risks / Trade-offs

- [Risk] Dev and prod docker-compose files may drift → Mitigation: Shared base config in docker-compose.base.yml, extend in each
- [Risk] pnpm not available in all CI environments → Mitigation: Use `corepack enable pnpm` in CI setup
- [Risk] Hot reload in Docker requires volume mounts → Mitigation: Use bind mounts only in dev compose, not prod
- [Risk] Database migrations in CI need test DB → Mitigation: Use postgres service container in GitHub Actions

## Migration Plan

1. Create all infrastructure files
2. Verify `docker compose -f docker-compose.yml up --build` works for dev
3. Verify `docker compose -f docker-compose.prod.yml up --build` works for prod
4. Push to GitHub, verify CI pipeline runs
5. Document in AGENTS.md and README.md

## Open Questions

- Should CI push Docker images to GHCR on main branch merges? (Deferred - can add later)
- Exact PostgreSQL version for prod? (Use 16-alpine for now)
- Redis for caching/sessions? (Deferred - not needed for MVP)