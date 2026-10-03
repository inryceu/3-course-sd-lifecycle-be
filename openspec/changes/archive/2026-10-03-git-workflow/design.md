## Context

Both repos have `main` and `dev`, `KAN-<n>` branches, a CI workflow named "CI Pipeline (Cost-Free)" with check runs Lint, TypeCheck, Tests, Build, and an AGENTS.md that forbids agents from merging.

## Goals / Non-Goals

**Goals:** documented flow, review gates, ownership, identical configuration in both repos.
**Non-Goals:** changing CI jobs; configuring Jira (out of scope for this task).

## Decisions

1. **Branch protection as a script, not a manual checklist.** The `gh api` payload is versioned in the repo, so "configured identically" is reproducible and reviewable. The script is idempotent (PUT) and has `--dry-run` that prints the payloads.
2. **Required checks = `Lint`, `TypeCheck`, `Tests`, `Build`** (the check-run names GitHub reports today). `enforce_admins` stays off so the owner can recover from a bad rule; stale reviews are dismissed; conversations must be resolved.
3. **CODEOWNERS uses GitHub handles**: Pavlo `@inryceu`, Denys `@DenysP21`, Kyrylo `@KyryloBB`, Edward `@2heist`. The Edward mapping is inferred from the collaborator list (the README lists it as an open question) and must be confirmed.
4. **Template identical in both repos**, with one SOLID line per principle, as T-02 requires.
5. **Conflict-resolution flow** from AGENTS.md (`-dev` branches) is summarised in CONTRIBUTING.md, which links to AGENTS.md as the authority.

## Risks / Trade-offs

- Protection needs admin rights on both repos; if it cannot be applied the files still document the intended state.
- Required checks block merges if a check is renamed → the script keeps names in one variable.

## Migration Plan

Merge the files first, then an admin runs `scripts/setup-branch-protection.sh` once per repo. Roll back with `gh api -X DELETE` on the protection endpoint.

## Open Questions

- Confirm `@2heist` is Edward.
