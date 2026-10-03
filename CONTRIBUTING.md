# Contributing to BoardSync

BoardSync lives in two repositories with the **same rules**: `3-course-sd-lifecycle-be` (NestJS) and `3-course-sd-lifecycle-fe` (React). Specs and the API contract live in the backend repository.

## Workflow in one picture

```
Jira ticket KAN-<n>  ->  branch KAN-<n> (from dev)  ->  OpenSpec propose  ->  implement  ->  PR into dev  ->  review + green CI  ->  merge  ->  OpenSpec archive
```

## Branches

- One branch per ticket, named after the Jira key: **`KAN-<n>`** (e.g. `KAN-42`). Create it from `dev`.
- Conflicts with `dev` are resolved in a branch with the `-dev` suffix (`KAN-42-dev`, cut from `dev`); open the PR from `KAN-42-dev` into `dev`. Details: [AGENTS.md](./AGENTS.md#git-workflow-rules) is the authority.
- `dev` -> `main` happens at the end of each sprint.
- Never push directly to `main` or `dev`; they are protected (see below).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <summary>`.

| Type | Use |
| --- | --- |
| `feat` | new behaviour |
| `fix` | bug fix |
| `docs` | documentation, specs, diagrams |
| `refactor` | no behaviour change |
| `test` | tests only |
| `chore` / `ci` | tooling, dependencies, pipelines |

Mention the ticket in the scope or footer: `feat(KAN-17): add column reordering`.

## Spec-driven flow (OpenSpec)

Behaviour changes update the spec first, in the **backend** repo (the frontend repo has no OpenSpec):

1. **Propose** - `openspec new change "<name>"`, write `proposal.md`, `design.md`, `specs/<capability>/spec.md`, `tasks.md`; `openspec validate "<name>" --strict`.
2. **Implement** - work through `tasks.md`, ticking each task only after its verification passes.
3. **Archive** - after the PR is merged, `openspec archive "<name>" --yes` merges the delta into `openspec/specs/`.

Pure refactors and documentation do not need a change.

## Pull requests

1. Open a PR into `dev` from your `KAN-<n>` branch; the template is pre-filled - fill every section (Jira key, summary, OpenSpec link, test evidence, SOLID/boundaries checklist).
2. CI must be green: **Lint**, **TypeCheck**, **Tests**, **Build**.
3. At least **one approval** from the ticket's Reviewer (`CODEOWNERS` requests the module owner automatically). Stale approvals are dismissed on new commits; conversations must be resolved.
4. Squash-merge. Move the Jira ticket to Done.
5. AI agents may open, comment on and edit PRs but **never merge** them.

## Ownership

| Area | Owner |
| --- | --- |
| auth | Denys |
| boards-cards | Pavlo |
| jira-sync | Edward |
| realtime, CI/DevOps | Kyrylo |

## Local checks before pushing

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # backend; add `pnpm test:e2e` with Postgres running
```

Backend module rules (layout, public API, allowed dependencies) are in [docs/architecture/module-structure.md](./docs/architecture/module-structure.md); the lint step enforces them.

## Protected branches

`main` and `dev` require a pull request, one approval, the four status checks above and forbid force pushes. The settings are versioned, so both repositories stay identical:

```bash
# needs admin rights on the repository; review the payload first
./scripts/setup-branch-protection.sh --dry-run
./scripts/setup-branch-protection.sh               # applies to both repositories
```
