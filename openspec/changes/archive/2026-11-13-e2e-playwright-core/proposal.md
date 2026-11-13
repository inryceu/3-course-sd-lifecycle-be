## Why

The core user journeys (FR-01 sign-up/sign-in, FR-03 boards, FR-04 cards and drag & drop, FR-12 board roles) are covered only by backend e2e tests and frontend unit tests; nothing proves they work end to end in a real browser against the real stack. T-47 (KAN-58) introduces the system-test framework that later system-test tickets (T-50, T-52, T-54) reuse.

## What Changes

- Frontend repository: Playwright system tests under `e2e/` with a config, API seeding fixtures (unique users and boards per run), stored auth state, and browser projects for Chromium, Firefox and Microsoft Edge.
- Scenarios: register → login → create board → add cards → drag a card between columns → role restrictions for a board Viewer.
- A separate GitHub Actions workflow (`e2e.yml`) in the frontend repository that checks out the backend repository next to the frontend, starts `docker-compose.full.yml` (PostgreSQL + backend + frontend), runs the suite in every browser project and uploads the HTML report, traces and screenshots when a test fails.
- Vitest unit tests stay separate (they only collect `src/**`); no application code changes.

## Capabilities

### New Capabilities
- `system-tests`: browser-level system tests of the core user journeys against the full Compose stack, their seeding/auth fixtures, browser coverage and CI reporting.

### Modified Capabilities
<!-- none: the web client's behaviour does not change -->

## Impact

- Frontend: `e2e/`, `playwright.config.ts`, `@playwright/test` dev dependency, `.github/workflows/e2e.yml`, ESLint/TypeScript config for the test files, README section.
- Backend: none besides this OpenSpec change; the CI job reuses `docker-compose.full.yml` and `.env.full.example` placeholders as-is.
- CI time: one extra job (~10 min) on pull requests and pushes to `dev`/`main` in the frontend repository.
