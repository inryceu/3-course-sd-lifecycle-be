## Tasks

- [x] 1.1 Verify KAN-14 acceptance criteria against existing contracts
  - Read `docs/api/openapi.yaml` and `docs/api/ws-events.md`
  - Run `pnpm api:validate`
  - Confirm all required tags, error schema, bearerAuth, pagination, WS envelope, origin field are present

- [x] 2.1 Confirm FE type generation command is documented
  - Check backend `README.md` documents `pnpm api:sync && pnpm api:generate`
  - Check frontend `README.md` documents the same commands and CI drift check

- [x] 3.1 Obtain approval from all four module owners
  - Verification: explicit **Approve** reviews on the PR

- [x] 4.1 Record any owner-requested changes in design.md
  - If owners request modifications during review, append decision and rationale to `design.md`
  - Verification: `design.md` updated with dated entries referencing the PR discussion