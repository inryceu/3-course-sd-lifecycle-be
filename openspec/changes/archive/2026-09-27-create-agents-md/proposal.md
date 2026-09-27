## Why

The project lacks a root AGENTS.md file to provide consistent instructions and context for AI agents (Claude Code, GitHub Copilot, OpenCode, etc.) working on the BoardSync codebase. This leads to inconsistent agent behavior, repeated context gathering, and suboptimal code generation. Creating a standardized AGENTS.md establishes a single source of truth for agent instructions across the team.

## What Changes

- Create `AGENTS.md` at the repository root with project-specific agent instructions
- Document tech stack, architecture patterns, coding conventions, and workflow commands
- Include references to key documentation (ARCHITECTURE.md, OpenSpec workflows, module boundaries)
- No functional code changes - documentation only

## Capabilities

### New Capabilities

- None - this is a documentation/tooling change

### Modified Capabilities

- None - no existing capability requirements are changing

## Impact

- Affected files: New `AGENTS.md` at repository root
- No API changes, no dependency changes, no database migrations
- Improves agent-assisted development consistency across the team
- References existing documentation: ARCHITECTURE.md, openspec workflows (.agents/workflows/), module structure (auth, boards-cards, jira-sync, realtime)