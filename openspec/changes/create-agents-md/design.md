## Context

The BoardSync project uses a modular monolith architecture (NestJS/TypeScript backend, React/TypeScript frontend) with specification-driven development via OpenSpec. The project has existing documentation in ARCHITECTURE.md and OpenSpec workflows in `.agents/workflows/`, but lacks a root AGENTS.md file for AI agent guidance.

## Goals / Non-Goals

**Goals:**
- Create a comprehensive AGENTS.md at the repository root
- Document tech stack, architecture patterns, and module boundaries
- Provide commands for common development tasks (build, test, lint, OpenSpec workflows)
- Reference existing documentation to avoid duplication

**Non-Goals:**
- Modify any functional code
- Change API contracts or database schemas
- Create new OpenSpec capabilities or specs

## Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Place AGENTS.md at repo root | Standard location for agent instructions (like CLAUDE.md, AGENT.md) | Could place in `.github/` or `docs/`, but root is most discoverable |
| Reference ARCHITECTURE.md instead of duplicating | Single source of truth for architecture | Inline architecture summary - rejected to avoid drift |
| Document OpenSpec workflow commands | Team uses spec-driven development; agents need to know `/opsx-propose`, `/opsx-apply`, `/opsx-archive` | Assume agents know OpenSpec - rejected, project-specific commands differ |
| Include module boundary rules | Modular monolith requires strict module isolation (no cross-module Repository access) | Omit - rejected, critical for maintaining architecture |

## Risks / Trade-offs

- [Risk] AGENTS.md becomes outdated as project evolves → Mitigation: Add reminder to update AGENTS.md when architecture or workflows change; reference it in PR templates
- [Risk] Agents may not read root AGENTS.md → Mitigation: Document is concise and well-structured; standard location increases discovery

## Migration Plan

1. Create AGENTS.md at repository root
2. Commit to KAN-9 branch
3. Open PR for review
4. Merge to dev and main

## Open Questions

- Should frontend repository also have its own AGENTS.md, or share the backend's? (Frontend has different tech stack - React vs NestJS)