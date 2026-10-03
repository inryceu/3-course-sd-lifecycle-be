## Jira

<!-- Ticket key, e.g. KAN-42 (the branch is named after it) -->
KAN-

## Summary

<!-- What changes and why, in 2-4 sentences. -->

## OpenSpec change

<!-- Link to the change folder (backend: openspec/changes/<name> or its archive). Frontend PRs link the backend change they implement. -->

## Test evidence

<!-- Paste the commands you ran and their results. -->
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- Other (e2e, manual steps, screenshots):

## Checklist

- [ ] Acceptance criteria of the ticket are met and demonstrable
- [ ] Unit tests for new logic are included
- [ ] `docs/api/openapi.yaml` / `docs/api/ws-events.md` / README updated if behaviour or setup changed
- [ ] No secrets, `.env` values or tokens are committed

## SOLID and module boundaries

- [ ] **S** - each class has a single responsibility (controller = HTTP, service = use case)
- [ ] **O** - new behaviour is added by extension (listener, adapter), not by editing unrelated services
- [ ] **L** - implementations honour their port's contract
- [ ] **I** - ports/interfaces are small and focused
- [ ] **D** - modules talk through exported ports (`AUTH_FACADE`, `BOARDS_FACADE`, `EVENT_PUBLISHER`), no cross-module entity/repository imports, no `forwardRef()`
