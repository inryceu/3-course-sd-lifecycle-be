# Jira sandbox: manual checklist (T-50)

Run once against the real Jira sandbox. Tester fills the result columns.

**Preconditions:** sandbox project key: ____; BoardSync connected to the sandbox via OAuth; webhook registered; at least 3 issues in different statuses.

| # | Step | Expected | Result (pass/fail) | Latency observed | Date | Tester | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Link a board to the sandbox project and run import | All issues appear as cards in columns matching their statuses (FR-05) | | | | | |
| 2 | Run import again | No duplicate cards | | | | | |
| 3 | Move a linked card to another column in BoardSync | Issue status changes in Jira within 5 s (FR-06) | | | | | |
| 4 | Check the sync log for that card | Entry with outcome `transitioned` | | | | | |
| 5 | Change an issue status in Jira | Card moves on the board within 5 s without reload (FR-07) | | | | | |
| 6 | Move a card within the same column | No Jira change | | | | | |
| 7 | Create a card manually (no Jira issue) and move it | No Jira change, no error | | | | | |

**Latency method:** stopwatch from the action to the visible result in the other system.