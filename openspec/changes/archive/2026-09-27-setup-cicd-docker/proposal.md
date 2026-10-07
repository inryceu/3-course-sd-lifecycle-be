## Why

The project lacks a proper CI/CD pipeline, Docker configuration, and environment separation. This prevents automated testing, consistent deployments, and clean separation between development/staging and production environments. Setting up this infrastructure now enables the team to work efficiently with spec-driven development.

## What Changes

- Scaffold minimal NestJS project structure with TypeScript, TypeORM, PostgreSQL
- Create multi-stage Dockerfile following best practices (build, dev, prod stages)
- Create docker-compose.yml for development (with hot reload) and docker-compose.prod.yml for production
- Add npm scripts: `start:dev` (dev), `start:prod` (production), `build`, `test`, `lint`, `typecheck`
- Configure GitHub Actions CI/CD pipeline (lint, typecheck, test, build, docker build)
- Set up environment variable management (.env.dev, .env.prod, .env.example)
- Ensure dev and prod environments are completely isolated (separate containers, networks, volumes)
- Frontend: Similar setup with React/Vite, multi-stage Dockerfile, CI/CD

## Capabilities

### New Capabilities

- `infrastructure/ci-cd`: CI/CD pipeline configuration and Docker infrastructure
- `infrastructure/docker`: Multi-stage Docker builds and docker-compose for dev/prod
- `infrastructure/npm-scripts`: Standardized npm scripts for dev/prod separation

### Modified Capabilities

- None (greenfield infrastructure setup)

## Impact

- New files: package.json, tsconfig.json, nest-cli.json, Dockerfile, docker-compose.yml, docker-compose.prod.yml, .github/workflows/ci.yml, .env.example, .env.dev, .env.prod
- New directory structure: src/ modules per architecture (auth, boards-cards, jira-sync, realtime)
- No API changes (infrastructure only)
- Enables consistent local development and automated CI/CD