## 1. Project Scaffold & Configuration

- [x] 1.1 Create package.json with NestJS, TypeORM, PostgreSQL, pnpm scripts (verify: `pnpm install` succeeds)
- [x] 1.2 Create tsconfig.json (strict mode) and nest-cli.json (verify: `pnpm build` compiles without errors)
- [x] 1.3 Create .env.example, .env.dev, .env.prod with required variables (verify: files exist with correct keys)
- [x] 1.4 Create directory structure: src/modules/{auth,boards-cards,jira-sync,realtime} with module scaffolding (verify: directories exist)

## 2. Docker Configuration

- [x] 2.1 Create multi-stage Dockerfile (base, deps, builder, runner) with non-root user (verify: `docker build -t boardsync-backend .` succeeds)
- [x] 2.2 Create docker-compose.yml for dev (hot reload, bind mounts, postgres service, dev env file) (verify: `docker compose up --build` starts API on localhost:3000 with hot reload)
- [x] 2.3 Create docker-compose.prod.yml for prod (optimized, no bind mounts, prod env file, health checks) (verify: `docker compose -f docker-compose.prod.yml up --build` starts API on localhost:3000)
- [x] 2.4 Create .dockerignore (verify: build context excludes node_modules, .git, dist, .env*)

## 3. NPM Scripts & Tooling

- [x] 3.1 Add scripts: `start:dev` (nest start --watch), `start:prod` (node dist/main), `build` (nest build), `test`, `test:e2e`, `test:cov`, `lint`, `format`, `typecheck` (verify: each script runs without error)
- [x] 3.2 Configure ESLint + Prettier with NestJS/TypeScript rules (verify: `pnpm lint` passes on clean code)
- [x] 3.3 Configure Jest for unit/e2e tests (verify: `pnpm test` runs)
- [x] 3.4 Add pnpm-lock.yaml and enable corepack (verify: `pnpm install` works in fresh clone)

## 4. GitHub Actions CI/CD

- [x] 4.1 Create .github/workflows/ci.yml with jobs: lint, typecheck, test, build, docker-build (verify: workflow file validates)
- [x] 4.2 Configure postgres service container for test job (verify: tests run against real DB in CI)
- [x] 4.3 Configure docker build job with cache (verify: docker build succeeds in CI)
- [x] 4.4 Add workflow dispatch and PR triggers (verify: CI runs on push/PR)

## 5. Verification & Documentation

- [ ] 5.1 Verify dev environment: `docker compose up --build` → API responds on :3000, hot reload works
- [ ] 5.2 Verify prod environment: `docker compose -f docker-compose.prod.yml up --build` → API responds on :3000
- [ ] 5.3 Verify CI pipeline passes on push to KAN-10 branch
- [ ] 5.4 Update AGENTS.md with new commands and Docker usage
- [ ] 5.5 Update README.md with getting started instructions

## 6. Frontend Parallel Setup (in frontend repo)

- [ ] 6.1 Scaffold React + Vite + TypeScript project with similar Docker/CI setup
- [ ] 6.2 Create multi-stage Dockerfile, docker-compose.yml, docker-compose.prod.yml
- [ ] 6.3 Add npm scripts: `dev`, `build`, `preview`, `test`, `lint`, `typecheck`
- [ ] 6.4 Create GitHub Actions CI/CD for frontend
- [ ] 6.5 Verify both dev and prod environments work independently