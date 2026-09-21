# BoardSync — Backend

> Kanban board service with two-way Jira synchronization. Backend repository (NestJS + TypeORM + PostgreSQL).

## Concept

BoardSync closes the gap between Jira's issue tracking and a team's day-to-day kanban view. Instead of manually mirroring status changes between two tools, BoardSync keeps a kanban board and its linked Jira project in sync automatically, in both directions.

This repository implements the backend: REST API, a WebSocket gateway for real-time updates, PostgreSQL persistence via TypeORM, and the Jira synchronization engine.

## Approach

- **Spec-driven development.** Every module starts from an agreed requirements/API spec before implementation begins (see the project's *Специфікація вимог* document). Changing behavior means updating the spec first, code follows.
- **Modular architecture.** The backend is organized as independent feature modules (`auth`, `boards`, `cards`, `jira-sync`, `realtime`), each owning its own routes, services, entities and tests, so modules can be built and reviewed independently.
- **Contract-first Jira integration.** OAuth 2.0 (3LO) connects to a Jira Cloud project. Synchronization is two-way: moving a card updates the linked issue's status, and status changes made directly in Jira update the card's column.

## Key modules

| Module | Responsibility |
| --- | --- |
| `auth` | Registration/login, JWT issuance, roles (Admin / Member / Viewer) |
| `boards` | Boards and columns CRUD |
| `cards` | Cards CRUD, labels, deadlines, comments |
| `jira-sync` | OAuth connection, two-way status sync, conflict logging |
| `realtime` | WebSocket gateway broadcasting board changes to connected clients |

## Tech stack

- **Language:** TypeScript
- **Framework:** NestJS
- **ORM:** TypeORM
- **Database:** PostgreSQL
- **Real-time:** WebSocket (NestJS Gateways)
- **Containerization:** Docker / Docker Compose
- **CI/CD:** pipeline for this repository (provider TBD)

## Team

| Name | Role |
| --- | --- |
| Pavlo | PM + Fullstack developer — boards & cards module |
| Edward | Fullstack developer — Jira integration module |
| Denys | Fullstack developer — auth & users module |
| Kyrylo | Fullstack developer — realtime module, DevOps/CI-CD |

## Getting started

> 🚧 Placeholder — to be filled in once the initial project scaffold is committed.

```bash
# clone
git clone <repo-url>
cd boardsync-backend

# install dependencies
npm install

# run in development
npm run start:dev

# run with Docker
docker compose up --build
```

## Environment variables

> 🚧 To be documented: database connection string, JWT secret, Jira OAuth client id/secret, Jira redirect URI.

## API documentation / user guide

> 🚧 To be added — will include the REST API reference and a setup guide for connecting a Jira project.

## Related

- Frontend repository: `boardsync-frontend`
- Requirements specification: `Специфікація_вимог_BoardSync.md`
