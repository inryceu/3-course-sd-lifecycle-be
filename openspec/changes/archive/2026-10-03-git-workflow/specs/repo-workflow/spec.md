## Purpose

Defines how code reaches `dev` and `main` in both BoardSync repositories: branch naming, pull-request content, ownership and review gates, kept identical across the backend and frontend repos.

## ADDED Requirements

### Requirement: Branch and commit conventions
Contributors SHALL work in branches named `KAN-<n>` (conflict-resolution branches add the `-dev` suffix) and SHALL write Conventional Commit messages, and `CONTRIBUTING.md` SHALL document both.

#### Scenario: Contributor looks up the rules
- **WHEN** a contributor opens `CONTRIBUTING.md`
- **THEN** it states the branch pattern, the commit format, the PR flow and the OpenSpec propose → implement → archive flow

### Requirement: Pull-request template
Every pull request SHALL be created from a template containing the Jira key, a summary, a link to the OpenSpec change, test evidence and a SOLID/module-boundaries checklist.

#### Scenario: New PR is opened
- **WHEN** a pull request is opened on GitHub
- **THEN** the description is pre-filled with those sections

### Requirement: Code ownership
The repository SHALL map paths to owners in `CODEOWNERS`: auth to Denys, boards-cards to Pavlo, jira-sync to Edward, and realtime and CI to Kyrylo.

#### Scenario: Change touching auth
- **WHEN** a PR modifies files under the auth module
- **THEN** Denys is requested as reviewer automatically

### Requirement: Protected integration branches
`main` and `dev` SHALL require a pull request, at least one approval and passing required status checks, and SHALL reject force pushes; both repositories SHALL receive identical settings.

#### Scenario: Direct push to dev
- **WHEN** a contributor pushes directly to `dev`
- **THEN** GitHub rejects the push

#### Scenario: Merge without approval
- **WHEN** a PR has green checks but no approval
- **THEN** merging is blocked

#### Scenario: Settings are reproducible
- **WHEN** an admin runs the branch-protection script against either repository
- **THEN** the resulting protection is identical for both repositories
