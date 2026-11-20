## MODIFIED Requirements

### Requirement: REST contract coverage
The repository SHALL contain `docs/api/openapi.yaml` describing every REST area of the product: auth, boards, columns, cards (create, update, move, assign), labels, comments, members and roles, Jira (connect start and callback, status, disconnect, mapping, import, webhook, conflicts, sync outbox administration) and notifications.

#### Scenario: Spec is valid
- **WHEN** the spec is validated with an OpenAPI validator
- **THEN** validation succeeds without errors

#### Scenario: Every product area present
- **WHEN** a reader lists the spec's tags
- **THEN** auth, boards, columns, cards, labels, comments, members, jira and notifications are present, including the outbox operations under the `jira` tag

#### Scenario: Outbox operations are present
- **WHEN** a reader opens the `jira` tag
- **THEN** the outbox list, single requeue and bulk requeue operations are documented

## ADDED Requirements

### Requirement: Jira sync outbox list operation

`docs/api/openapi.yaml` SHALL describe `GET /jira/sync/outbox` as a board-Admin operation under the `jira` tag, with a required `boardId`, optional `status` (default `DEAD`), `limit` and `cursor`, returning `OutboxPage`. It SHALL document 400, 401, 403 and 404, and SHALL NOT carry `x-implemented-in` once implemented.

#### Scenario: Admin list is documented

- **WHEN** a reader opens `GET /jira/sync/outbox`
- **THEN** the required `boardId`, default `DEAD` status, paging and 400/401/403/404 responses are documented

#### Scenario: Outbox list contract validates

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** the list operation and `OutboxPage` are valid

### Requirement: Jira sync outbox requeue operation

`docs/api/openapi.yaml` SHALL describe `POST /jira/sync/outbox/{outboxId}/requeue` as a board-Admin operation returning `OutboxEntry`, with 401, 403, 404 for an unknown row and 409 when the row is not `DEAD` or is blocked by an earlier non-`SENT` row. It SHALL NOT carry `x-implemented-in` once implemented.

#### Scenario: Single requeue is documented

- **WHEN** a reader opens `POST /jira/sync/outbox/{outboxId}/requeue`
- **THEN** 200, 401, 403, 404 and 409 are documented with the requeued `OutboxEntry`

#### Scenario: Requeue contract validates

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** the requeue operation is valid

### Requirement: Jira sync outbox bulk requeue operation

`docs/api/openapi.yaml` SHALL describe `POST /jira/sync/outbox/requeue` as a board-Admin operation with a required `boardId`, returning `RequeueOutboxResult` `{ requeued }`. It SHALL document 200, 400, 401, 403 and 404, SHALL be documented separately from `{outboxId}`, and SHALL NOT carry `x-implemented-in` once implemented.

#### Scenario: Bulk requeue is documented

- **WHEN** a reader opens `POST /jira/sync/outbox/requeue`
- **THEN** the required `boardId`, 200, 400, 401, 403 and 404 are documented with `{ requeued }`

#### Scenario: Bulk requeue contract validates

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** the bulk requeue operation and `RequeueOutboxResult` are valid

### Requirement: Outbox entry schema

`OutboxEntry` SHALL define `id`, `boardId`, `cardId`, nullable `actorId`, `operation`, `status` (`PENDING`, `IN_PROGRESS`, `SENT`, `DEAD`), `attempts`, `throttledCount`, `availableAt`, nullable `lockedAt`, nullable sanitized `lastError`, `sequence` (decimal string), `createdAt` and `updatedAt`. It SHALL NOT define token, secret or raw Jira body fields.

#### Scenario: Frontend type is generated

- **WHEN** the frontend regenerates types from the spec
- **THEN** `OutboxEntry` is available with the documented fields

#### Scenario: Sensitive data is absent

- **WHEN** a reader inspects `OutboxEntry`
- **THEN** no token, secret or raw provider body field is defined

### Requirement: Outbox paging and bulk result schemas

`OutboxPage` SHALL define `items` and nullable `nextCursor`; `RequeueOutboxResult` SHALL define `requeued`. Both SHALL reference the shared error and paging components where applicable.

#### Scenario: Frontend page and result types are generated

- **WHEN** the frontend regenerates types from the spec
- **THEN** `OutboxPage` and `RequeueOutboxResult` are available

#### Scenario: Schemas validate

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** both schemas are valid

### Requirement: Outbox operations are board-Admin scoped

All outbox operations SHALL document 401 for an unauthenticated caller, 403 for a non-Admin member and 404 for an unknown or inaccessible board or row. None SHALL expose tokens, secrets or raw Jira bodies.

#### Scenario: Authorization responses are documented

- **WHEN** a reader opens any outbox operation
- **THEN** 401, 403 and the applicable 404 are documented

#### Scenario: Contract validation passes

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** all three outbox operations and their schemas are valid

### Requirement: Dead-letter notification contract

`docs/api/openapi.yaml` SHALL include `jira.sync.failed` in the `Notification` type enum and SHALL document that it is delivered by `notification.created` with a payload containing `outboxId`, `boardId`, `cardId`, `jiraIssueKey`, `operation`, `attempts` and `errorCode`, without tokens or raw Jira bodies. `docs/api/ws-events.md` SHALL document the same payload for the existing `notification.created` event.

#### Scenario: Notification enum is extended

- **WHEN** a frontend regenerates types from the spec
- **THEN** `jira.sync.failed` is a valid `NotificationType`

#### Scenario: WebSocket payload is documented

- **WHEN** a reader opens the `notification.created` section
- **THEN** it lists the dead-letter payload fields and states that it is board-scoped and recipient-specific

#### Scenario: Frontend can render a dead letter

- **WHEN** a client receives a `jira.sync.failed` notification
- **THEN** the documented fields identify the board, card, issue, operation, attempt count and stable error code
