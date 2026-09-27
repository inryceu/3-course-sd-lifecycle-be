# BoardSync — AGENTS.md (Backend)

> **CRITICAL: AI agents are PROHIBITED from modifying this file.** This file is the single source of truth for agent context, conventions, and workflows. Any changes must be made by human developers only.

> **CRITICAL: AI agents are PROHIBITED from merging ANY PRs.** Agents may only open, close, modify, or comment on PRs. Merging requires explicit human approval.

---

## Project Overview

**BoardSync** — Kanban board with bidirectional Jira synchronization.
- **Backend**: TypeScript, NestJS, TypeORM, PostgreSQL (modular monolith)
- **Frontend**: TypeScript, React 18+, Vite (separate repo: `3-course-sd-lifecycle-fe`)
- **Architecture**: Modular monolith with 4 modules: `auth`, `boards-cards`, `jira-sync`, `realtime`
- **Methodology**: Spec-driven development via OpenSpec (specs live in **backend only**)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict mode) |
| Backend Framework | NestJS 10+ |
| ORM | TypeORM 0.3+ |
| Database | PostgreSQL 15+ |
| Frontend Framework | React 18+ (separate repo) |
| Real-time | WebSocket (NestJS Gateways / Socket.IO) |
| Jira Integration | Jira REST API v3, OAuth 2.0 (3LO) |
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions (lint, typecheck, test, build only — **no deploy**) |
| Spec Management | OpenSpec (`openspec/` directory) |
| Package Manager | pnpm 9+ |

---

## Architecture Rules (Modular Monolith)

**Hard constraints — agents MUST enforce these:**

1. **Module isolation**: Each module owns its tables/entities. No direct Repository/Entity access across modules.
   - ✅ Allowed: Inject `BoardsService` into `JiraSyncService` via DI
   - ❌ Forbidden: `jira-sync` module importing `BoardRepository` from `boards-cards`

2. **Cross-module communication**:
   - Synchronous: Inject module's public service via NestJS DI
   - Asynchronous: Internal event bus (e.g., `jira-sync` emits `card.status.changed`, `realtime` subscribes)

3. **Database**: Single PostgreSQL instance. Logical separation via TypeORM entities per module. No cross-module FKs.

4. **Module structure** (each module):
   ```
   src/modules/<module-name>/
   ├── <module-name>.module.ts
   ├── controllers/
   ├── services/
   ├── dto/
   ├── entities/
   └── events/ (if emitting)
   ```

5. **Forbidden patterns**:
   - Circular module dependencies
   - Direct SQL/Repository access to another module's tables
   - Business logic in controllers (use services)

---

## Coding Conventions

- **TypeScript**: `strict: true`, no `any`, prefer `interface` over `type` for objects
- **Naming**: PascalCase for classes/interfaces, camelCase for variables/functions, UPPER_SNAKE_CASE for constants
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **Branching**: Feature branches from `main` (e.g., `KAN-10`, `feat/user-auth`)
- **PRs**: Required reviews, CI must pass, squash merge

---

## Key Documentation

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Architectural decision record (modular monolith justification) |
| `openspec/config.yaml` | OpenSpec configuration (schema: spec-driven) |
| `.agents/workflows/` | OpsX workflow definitions (propose, apply, archive, sync) |
| `openspec/specs/` | Main specifications (single source of truth) |
| `openspec/changes/` | In-flight changes with proposals, designs, tasks |

---

## OpenSpec Workflows (OpsX)

**All specification work happens on backend only.** Frontend consumes specs via API contracts.

### Propose a Change
```bash
/opsx-propose <change-name>        # Create change + generate all planning artifacts
# or via CLI:
openspec new change "<name>"
```

### Apply a Change
```bash
/opsx-apply <change-name>          # Implement tasks from the change
# or via CLI:
openspec status --change "<name>" --json
openspec instructions apply --change "<name>" --json
```

### Archive a Change
```bash
/opsx-archive <change-name>        # Sync specs to main, move change to archive
# or via CLI:
openspec archive "<name>" --yes
```

### Other Useful Commands
```bash
openspec list --json               # List active changes
openspec status --change "<name>" --json  # Check artifact progress
openspec validate "<name>" --json  # Validate change artifacts
openspec list --specs --json       # List main capabilities/specs
```

---

## Development Commands (Local Only)

### Backend (run from `3-course-sd-lifecycle-be/`)
```bash
# Install
pnpm install

# Development (hot reload)
pnpm start:dev

# Production build
pnpm build

# Run production build locally
pnpm start:prod

# Test
pnpm test            # Unit tests
pnpm test:e2e        # E2E tests
pnpm test:cov        # Coverage

# Lint/Format
pnpm lint
pnpm format

# Type check
pnpm typecheck

# Database
pnpm prisma:migrate
pnpm prisma:studio

# Docker (local development)
docker compose up --build        # Dev environment with hot reload
docker compose -f docker-compose.prod.yml up --build  # Prod-like environment
```

---

## Module Responsibilities

| Module | Responsibility | Key Entities |
|--------|---------------|--------------|
| `auth` | JWT authentication, OAuth 2.0 with Jira, user management | `User`, `JiraToken` |
| `boards-cards` | Boards, columns, cards, labels, comments, drag-and-drop | `Board`, `Column`, `Card`, `Label`, `Comment`, `BoardMembership` |
| `jira-sync` | Bidirectional Jira sync, issue mapping, status sync, conflict resolution | `JiraIssueMapping`, `SyncLog` |
| `realtime` | WebSocket connections, live updates, presence | `WebSocketGateway`, `Presence` |

---

## Common Agent Tasks

### Adding a New Feature
1. Run `/opsx-propose <feature-name>` on backend
2. Complete proposal.md, design.md, tasks.md (specs skipped for pure refactor/docs)
3. Commit planning artifacts
4. Run `/opsx-apply <feature-name>` to implement
5. Run `/opsx-archive <feature-name>` to sync specs and archive

### Updating Documentation
- Edit files directly (no OpenSpec change needed for pure docs)
- Follow Conventional Commits: `docs: update AGENTS.md`

### Refactoring Within a Module
- No OpenSpec change needed if no behavioral change
- Ensure module boundaries remain intact
- Run tests: `pnpm test`

---

## Verification Checklist

Before marking any task complete, verify:
- [ ] Code follows modular monolith rules (no cross-module Repository access)
- [ ] TypeScript compiles without errors (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] OpenSpec validation passes (`openspec validate "<change>" --json`)

---

## Frontend Notes

- Frontend repo: `3-course-sd-lifecycle-fe/`
- Diagrams in `docs/declarative/` (PlantUML) and `docs/image/` (rendered PNG)
- Current diagrams: component, class (boards-cards), sequence (jira-sync, oauth, realtime), state
- Frontend does NOT have OpenSpec — consumes backend API contracts

---

## CI/CD Pipeline (GitHub Actions) — Cost-Free Configuration

**IMPORTANT**: The CI pipeline runs **only lint, typecheck, test, and build**. No Docker images are pushed to registries. No deployment jobs run. All development happens locally.

```yaml
# .github/workflows/ci.yml runs on push/PR to main and dev
# Jobs: lint → typecheck → test → build
# NO: docker push, deploy-staging, deploy-production
```

---

## Git Workflow Rules

### Conflict Resolution Branches
- When conflicts exist between a feature branch and `dev`, create a conflict-resolution branch with `-dev` suffix (e.g., `KAN-10-dev` from `dev`)
- Resolve all conflicts in the `-dev` branch
- Open PR from `-dev` branch into `dev`
- Open PR from original feature branch (e.g., `KAN-10`) into `main` only

### Conflict Resolution Strategy
- **If a change affects a different part of the code** (non-overlapping): select that version (no conflict)
- **If a change affects the current part of the code** (overlapping): choose "both" if changes are complementary, or "select this one" based on context
- **If ambiguous**: escalate to a human — do not choose at random

### PR Management
- Agents may **only**: open, close, modify, or comment on PRs
- Agents are **PROHIBITED** from merging ANY PRs
- Merging requires explicit human approval

---

## Questions?

- Architecture decisions → `ARCHITECTURE.md`
- Spec-driven workflow → `.agents/workflows/opsx-*.md`
- Current specs → `openspec list --specs --json`
- Active changes → `openspec list --json`