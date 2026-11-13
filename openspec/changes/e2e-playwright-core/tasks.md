## 1. Setup (frontend repository)

- [x] 1.1 Add `@playwright/test` as a dev dependency with pnpm and `e2e` scripts; verify `pnpm install --frozen-lockfile` succeeds
- [x] 1.2 Add `playwright.config.ts` (baseURL from `PLAYWRIGHT_BASE_URL`, `setup` + `chromium`/`firefox`/`msedge` projects, trace/screenshot on failure, CI retry) and `e2e/tsconfig.json`; verify `pnpm exec playwright test --list` lists every journey per project
- [x] 1.3 Keep Vitest, ESLint and TypeScript working with the new files; verify `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` pass and Vitest collects no `e2e/` file

## 2. Fixtures

- [x] 2.1 `e2e/fixtures.ts`: API seeding helpers (unique users, boards, cards, members) and a `test` fixture that injects the stored session token; verify by the journeys below
- [x] 2.2 `e2e/auth.setup.ts`: register a user through the API and store the session in `e2e/.auth/user.json` (git-ignored); verify the board journeys start on the boards page without signing in

## 3. Journeys (spec: system-tests)

- [x] 3.1 Register → log out → sign in journey; verify it passes against the local stack
- [x] 3.2 Create board → add two cards → drag a card to the next column → reload journey; verify it passes against the local stack
- [x] 3.3 Viewer restrictions journey (Admin seeds board + card and invites a Viewer through the API); verify it passes against the local stack
- [x] 3.4 Run the suite in Chromium, Firefox and Edge locally against `http://localhost:8090`; record the per-project result

## 4. CI

- [x] 4.1 `.github/workflows/e2e.yml`: on pull requests and pushes to `dev`/`main`, check out the backend next to the frontend, start `docker-compose.full.yml`, install the three browsers, run the suite, upload report/traces/screenshots on failure; verify the job is green on the KAN-58 pull requests
- [x] 4.2 Document how to run the system tests locally and in CI in the frontend README; verify the commands in the README match the scripts
