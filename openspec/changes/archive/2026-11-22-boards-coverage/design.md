## Context

KAN-51 added a global 70 % line gate in both repos and, in the backend, `scripts/check-service-coverage.mjs` because a Jest path/glob threshold removes the matched files from the global figure. Vitest 1.6 behaves the same way: with `thresholds['src/features/boards/**']` set, the global figure is computed over the remaining files and falls to 69.9 %, below the repo gate, although the module itself is at 99 %.

## Decisions

### Measured before and after

| Scope | Before (`dev`) | After | Gate |
| --- | --- | --- | --- |
| BE `src/modules/boards/**`, lines | 70.74 % (branches 59.71 %) | 91.88 % | 90 % |
| BE boards services, lowest | `notifications.service` 29.03 % | `members.service` 83.6 % | 80 % each |
| BE whole repo, lines | 72.02 % | 78.39 % | 75 % (was 70 %) |
| FE `src/features/boards/**`, lines / branches | `BoardHeader` 60 %, `ColumnView` 82 % lines | 98.96 % / 97.33 % | 95 % / 90 % |
| FE `src/features/cards/**`, lines / branches | 92-100 % per file | 97.13 % / 90.91 % | 95 % / 85 % |
| FE whole repo, lines | 80.62 % | about 83 % | 75 % (was 70 %) |

Gates sit just below the measured values and above the backlog's 70 % proposal. Lines are gated (plus branches for the frontend features), matching the agreement of KAN-51.

### Backend: extend the existing script instead of a Jest path threshold
The script becomes a small rule table (file pattern, per-file minimum and/or module total) and prints every rule's result, so the boards bar shows up in the `pnpm test:cov` log of the Tests job. The global Jest threshold stays meaningful because no file leaves the global pool.

### Frontend: a script for the same reason
`scripts/check-module-coverage.mjs` reads `coverage/coverage-summary.json` after `vitest --coverage`, prints a table and exits 1 below a gate; `pnpm test:coverage` chains it. A CI step with `if: always()` appends the table to the run summary.

### Tests assert behaviour at the service boundary
Specs use hand-made repositories and a recording query builder, as the existing specs do. Each test checks an outcome that the guarded code decides (refused before any write, nothing published, which neighbours shift, which position is allowed), not that a line ran. Mutation probes (a guard removed or a boundary shifted) are reported in the PR.

## Risks

- The frontend `members-assign` test needs more than Vitest's default 5 s under coverage on a slow Windows machine; it passes in CI-class environments and is left unchanged.
