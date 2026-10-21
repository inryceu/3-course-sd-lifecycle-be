# BoardSync — process

How the plan is tracked in Jira and when a ticket counts as done. Code-level rules (branches, commits, PR flow, OpenSpec) are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Jira project

| Item | Value |
| --- | --- |
| Site / project | `kanban-proj.atlassian.net`, project key `KAN` |
| Issue type | Task (flat backlog, one ticket = one branch `KAN-<n>`) |
| Estimation | Story points, linear (1 SP ≈ 3–4 focused hours) |
| Dependencies | Issue links *blocks / is blocked by*, taken from each ticket's *Depends on / Blocks* fields |
| Repository link | GitHub for Jira app connected to `inryceu/3-course-sd-lifecycle-be` and `inryceu/3-course-sd-lifecycle-fe`; a branch, commit or PR that contains `KAN-<n>` appears on the ticket |

### Workflow

`To Do` → `In Progress` → `In Review` → `Done`

| Status | Enter when | Leave when |
| --- | --- | --- |
| To Do | Ticket is planned in a sprint | Work starts and the `KAN-<n>` branch exists |
| In Progress | Branch exists, OpenSpec change proposed (if behaviour changes) | PR is opened |
| In Review | PR into `dev` is open | PR approved by the ticket's Reviewer, CI green, merged |
| Done | Merged into `dev`, Definition of Done met | — |

A ticket goes back to *In Progress* when the review requests changes.

### Sprints

One-week sprints, Monday to Sunday. `dev` is merged into `main` at the end of each sprint.

| Sprint | Dates | Goal |
| --- | --- | --- |
| 2 — Foundations & Contracts | 28 Sep – 04 Oct | Lock the working agreement and the technical foundation: Git workflow, module boundaries, typed config, migrations and the API/WebSocket contract. |
| 3 — Identity & Core Domain | 05 Oct – 11 Oct | Users can register and log in; the domain model is in the database; the FE shell, event bus and full local Docker stack run; the Jira OAuth app and token vault are ready. |
| 4 — Boards, Cards & Jira Plumbing | 12 Oct – 18 Oct | Boards, columns and cards with roles and drag and drop; the Jira API client works and Jira issues can be imported. Lab 4 README delivered. |
| 5 — Two-Way Sync & Real-Time | 19 Oct – 25 Oct | Board ↔ Jira sync within 5 s, live updates over WebSocket, labels, comments, deadlines, Jira connection UI. |
| 6 — Resilience & Integration | 26 Oct – 01 Nov | Conflicts, outage recovery, comment mirroring, security, TLS, backups, CI gates, dependency hygiene, contract conformance. Lab 5 README delivered. |
| 7 — Test Automation | 02 Nov – 08 Nov | Unit, component and E2E tests automated in CI; load and performance evidence for the NFRs. |
| 8 — Stabilization & Final Delivery | 09 Nov – 15 Nov | FR/NFR validation with evidence, defect fixes, test report and recommendations, v1.0.0 and the demo. |

## Definition of Done

A ticket is Done when all of these hold:

1. The acceptance criteria are met and can be demonstrated.
2. Unit tests for new logic are included (component and E2E suites are separate tickets from Sprint 7).
3. Lint, typecheck, tests and build pass in CI.
4. `docs/api/openapi.yaml`, `docs/api/ws-events.md` and the README are updated if behaviour or setup changed.
5. The PR was reviewed and approved by the ticket's Reviewer, merged into `dev`, and the Jira ticket moved to Done.

## Risk register

Likelihood and impact: L = low, M = medium, H = high. Reviewed at every sprint planning.

| # | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R1 | **Jira sandbox access.** Nobody can reach a Jira Cloud site with admin rights, so the sync cannot be developed or demonstrated. | M | H | Create a free Jira Cloud site for the team (T-14); every member gets access; integration tests use a stubbed Atlassian server, so CI never needs the real site. | Edward |
| R2 | **Jira API rate limits.** Bulk import or a burst of card moves exceeds Atlassian's per-app limits (HTTP 429), changes are lost. | M | M | Outbound calls go through one client that honours `Retry-After`; changes are queued and retried (T-35); import is paged. | Edward |
| R3 | **OAuth app setup.** The 3LO app is missing a scope (`offline_access`, write) or a callback URL, so the connect flow fails or tokens expire after an hour. | M | H | App configuration is documented in [docs/jira-sandbox.md](./jira-sandbox.md); scopes are in config and checked by tests; a refresh flow is part of the Jira client ticket (T-23). | Edward |
| R4 | **Credentials leak.** Client secret, tokens or the encryption key end up in Git or in logs. | L | H | Secrets only in git-ignored `.env.local` / `.env.full` and a password manager; tokens stored AES-256-GCM encrypted and never logged; config refuses to start without them. | Denys |
| R5 | **Schedule.** The Jira sync path (OAuth → client → import → sync → conflicts) has one owner and is the critical path; a slip there delays Sprints 5–7. | M | H | Pavlo and Denys review every Jira PR and can take over; scope is cut from the bottom of the priority list (FR-13, then FR-08..FR-10) before the sync core. | Pavlo |
| R6 | **Webhooks cannot reach a laptop.** Jira cannot call `localhost`, so Jira → board sync cannot be tested locally. | H | M | Tunnel setup documented in [docs/jira-sandbox.md](./jira-sandbox.md); polling fallback as a follow-up. | Kyrylo |
| R7 | **Load target not reproducible.** 500 concurrent users cannot be generated on student laptops. | H | L | Load test report states hardware and the measured ceiling honestly (T-53). | Kyrylo |
