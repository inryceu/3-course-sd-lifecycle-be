## Why

Lab 4 requires work in personal branches with mandatory code review. The team already uses `KAN-<n>` branches, but the rules live in AGENTS.md and chat; PRs #24–#26 were merged within an hour with no recorded review. T-01 formalises the flow and makes both repositories identical.

## What Changes

- Add `.github/pull_request_template.md` (Jira key, summary, OpenSpec change link, test evidence, SOLID/boundaries checklist) to both repos.
- Add `.github/CODEOWNERS` mapping paths to owners (auth → Denys, boards-cards → Pavlo, jira-sync → Edward, realtime and CI → Kyrylo) to both repos.
- Add `CONTRIBUTING.md` (branch naming `KAN-<n>`, Conventional Commits, PR flow, OpenSpec propose → implement → archive) to both repos.
- Add `scripts/setup-branch-protection.sh` (GitHub CLI) that applies identical protection to `main` and `dev` in both repos: PR required, at least 1 approval, required checks, no force-push. The script is documented and **not executed by this change**; applying it is a repository-admin action.

## Capabilities

### New Capabilities

- `repo-workflow`: branch, PR, review and ownership conventions enforced identically in both repositories.

### Modified Capabilities

- None.

## Impact

- New files in both repositories only; no runtime code.
- Branch protection takes effect only when an admin runs the script.
