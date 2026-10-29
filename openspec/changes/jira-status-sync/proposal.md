# Proposal

## Why

FR-06 (T-25, KAN-36) requires a card move on a BoardSync board to update the linked Jira issue's status. Today `card.moved` is published but only realtime consumes it, so imported Jira cards drift from their Jira workflow. The event (T-19), transition gateway (T-23) and status-to-column mapping (T-24) are now available, so the outbound sync can be built without new schema or API surface.

## What Changes

- **Outbound move listener.** `jira-sync` subscribes to `card.moved` and ignores events with `origin !== 'user'`, moves within the same column, and cards without a `jiraIssueKey` (debug log only for the latter).
- **Target status resolution.** For a moved card, read the issue's current status through a new `getIssue` gateway call (`GET /issue/{key}?fields=status`) and read its candidate transitions. If the current status maps to the destination column, the sync is a no-op. Otherwise filter available transitions whose target status maps to the destination column and choose:
  1. an explicit stored mapping,
  2. then the lowest `jiraStatusId`,
  3. then the lowest transition id.
  If no transition matches, record `no valid transition`; multi-step transitions are out of scope.
- **Single transition.** Resolve the chosen transition id and call `doTransition`; no retries and no intermediate workflow steps.
- **Sync logging.** Write `sync_logs` rows with direction `TO_JIRA`: `SUCCESS` on transition or no-op, `FAILED` on any sync error. Payloads carry `cardId`, `issueKey`, target column/status/transition and `latencyMs`; failures also carry a stable `reason`, and `errorMessage`; `mappingId` is set when the card ↔ issue mapping exists, otherwise null. Log errors with `Logger.error` and warn when latency exceeds 5000 ms.
- **Non-blocking listener.** The listener returns immediately and runs the service promise fire-and-forget with its own catch, so the card-move HTTP request is not delayed by Jira.
- **Bounded Jira calls.** Measure elapsed time from the event's `occurredAt` and pass the remaining 5-second budget to the gateway calls. Extend the `getIssue`, `listTransitions` and `doTransition` inputs with an optional per-call `timeBudgetMs` override so a slow Jira call is aborted rather than exceeding the budget.
- **Out of scope.** No `POST /jira/mappings` endpoint (the OpenAPI `x-implemented-in: T-25` marker is left for reviewer follow-up), no conflict resolution, no webhook/inbound sync, no retries, no queue, no multi-step transition paths.

## Capabilities

### New Capabilities

- `jira-status-sync`: listener-driven outbound card-move synchronization to Jira, target-transition selection, latency budget and sync-log records.

### Modified Capabilities

- `jira-gateway`: adds `getIssue` for reading an issue's current status and gives `getIssue`, `listTransitions` and `doTransition` an optional per-call time-budget override so callers can enforce a shorter deadline than the configured default.

## Impact

- Backend: `src/modules/jira-sync` (new listener and sync service, SyncLog writes, mapping read extension), `src/common/events` consumers, `JiraStatusMappingService`, gateway port and HTTP client (`getIssue` and per-call budget).
- Tests: unit tests for filtering, resolution, no-op, failure and logging; gateway stub-server tests for per-call budget; a component/E2E test with a stubbed gateway and real Postgres.
- API: no new or changed HTTP endpoints; no OpenAPI change for T-25.
- Database: no migration; `sync_logs` and `jira_issue_mappings` already exist.
- Dependencies: none.
