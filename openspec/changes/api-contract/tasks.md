## 1. REST contract

- [ ] 1.1 Write `docs/api/openapi.yaml` with info, servers, security scheme and shared components (Error, responses, pagination parameters); verify with an OpenAPI validator
- [ ] 1.2 Add auth, boards, columns and cards operations with schemas and `x-implemented-in` where planned; verify the validator passes
- [ ] 1.3 Add labels, comments, members, notifications and Jira operations; verify the tag list covers every product area
- [ ] 1.4 Add `pnpm api:validate` and a CI step running it; verify it fails on a broken spec

## 2. WebSocket contract

- [ ] 2.1 Write `docs/api/ws-events.md` (handshake, rooms, events, payload, origin rule, errors); verify event names equal the constants used by the code

## 3. Client generation

- [ ] 3.1 Document the generation command in the backend README; verify two consecutive runs in the frontend give identical output
- [ ] 3.2 Record the owner-approval checklist in the PR description; verify the four owners are listed
