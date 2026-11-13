## Context

The web client keeps the access token in `sessionStorage` (`accessToken`), not in a cookie or `localStorage`. The full stack (`docker-compose.full.yml` in the backend repository) serves the web client and proxies `/api/v1` from one origin, builds the frontend from a sibling checkout (`../3-course-sd-lifecycle-fe`), and starts with the placeholder secrets of `.env.full.example`. Board membership has an API (`POST /boards/{id}/members`, invite by e-mail and role). Drag and drop in the board uses native HTML5 drag events.

## Goals / Non-Goals

**Goals:**
- One Playwright suite in the frontend repository, run locally against any running stack (`PLAYWRIGHT_BASE_URL`) and in CI against a freshly built Compose stack.
- Fixtures later tickets can extend: an API client for seeding and a stored signed-in session.

**Non-Goals:**
- Jira flows (need a real Atlassian site), real-time multi-tab updates, visual regression, mobile viewports.
- Starting the stack from Playwright (`webServer`): the stack is owned by Compose.

## Decisions

- **Stored auth state = saved token injected into `sessionStorage`.** Playwright's `storageState` persists cookies and `localStorage` only. A `setup` project registers a user through the API and writes `{ email, password, token }` to `e2e/.auth/user.json` (git-ignored); the shared `test` fixture adds an init script that puts the token into `sessionStorage` before the app loads. Alternative (switch the app to `localStorage`) was rejected: it changes app security behaviour for a test concern.
- **Seeding through `APIRequestContext`.** `e2e/fixtures.ts` exposes `api` helpers (register, create board, add card, invite member) built on Playwright's `request` against `<baseURL>/api/v1`; e-mails are `pw-<timestamp>-<random>@example.com`. No database access, so the suite works against any deployment.
- **Journeys each create their own board** so tests are independent and can run in parallel and in all browsers against one stack.
- **Drag and drop with `locator.dragTo`**, which dispatches the HTML5 drag events in all three engines; the assertion reloads the page so it checks the backend state, not only the optimistic UI.
- **Locators by role/label** (`New board title`, `Create board`, `New card in <column>`, `Column <title>` regions, `Members (n)`); no `data-testid` was needed.
- **Projects:** `setup`, then `chromium`, `firefox`, `msedge` (`channel: 'msedge'`), each depending on `setup`. Locally a missing Edge is a Playwright error, so `--project=chromium` is documented for quick runs.
- **CI in a separate `e2e.yml`** (the quality-gate workflow `ci.yml` is owned by another ticket): check out the frontend into `3-course-sd-lifecycle-fe` and the backend (same target branch, falling back to `dev`) into `3-course-sd-lifecycle-be`, `docker compose --env-file .env.full.example -f docker-compose.full.yml up -d --build --wait`, install browsers with `playwright install --with-deps chromium firefox msedge` (Edge stable installs on the Ubuntu runner), run, upload `playwright-report/` and `test-results/` with `if: failure()`, print Compose logs on failure.
- **Failure evidence:** `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, one retry in CI.
- **Vitest separation:** Vitest already only collects `src/**/*.{test,spec}.*`; the e2e files live in `e2e/` with their own `tsconfig.json`, and ESLint gets them through that project.

## Risks / Trade-offs

- [Native drag and drop differs between engines] → `dragTo` plus a reload assertion; if an engine proves flaky, fall back to dispatching drag events manually.
- [CI builds two images (~5–8 min)] → only one job, Docker layer cache from the runner; acceptable for the PR gate.
- [Backend branch drift: a frontend PR can need an unmerged backend change] → the backend ref follows the PR's base branch; cross-repo changes are merged backend-first.
- [Edge channel unavailable on a runner] → `playwright install msedge` installs it on `ubuntu-latest`; if that ever fails the step fails loudly rather than skipping silently.
