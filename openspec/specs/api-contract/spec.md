# api-contract Specification

## Purpose
Establishes the OpenAPI and WebSocket contract as the single source of truth that backend and frontend are built against in two repositories.

## Requirements

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

### Requirement: Shared definitions
The spec SHALL define the error schema, the bearer-auth security scheme and the pagination parameters once under `components` and reference them from operations.

#### Scenario: Error responses reuse one schema
- **WHEN** two operations return a 404
- **THEN** both reference the same component response

#### Scenario: Protected operations declare bearer auth
- **WHEN** an operation requires login
- **THEN** it inherits the global bearer security requirement, and public operations explicitly override it with an empty requirement

### Requirement: WebSocket contract
`docs/api/ws-events.md` SHALL define the JWT handshake, the rooms `board:{boardId}`, the events `card.created`, `card.updated`, `card.moved`, `card.commented`, `board.updated` and `notification.created`, and a payload carrying `origin` with value `user` or `jira`.

#### Scenario: Reader implements a client
- **WHEN** a frontend developer reads the document
- **THEN** it states how to connect with a token, how to join a board room, each event name with its payload and the meaning of `origin`

### Requirement: Implementation status is visible
Operations that are not yet implemented SHALL be marked with an `x-implemented-in` extension naming the planned ticket.

#### Scenario: Planned endpoint
- **WHEN** a reader opens the assignee operation of a card
- **THEN** it carries `x-implemented-in` with the ticket that will build it

### Requirement: Client generation
A documented command SHALL generate frontend types from the spec, and regeneration from an unchanged spec SHALL produce byte-identical output.

#### Scenario: Regeneration is deterministic
- **WHEN** the generation command runs twice on the same spec
- **THEN** the generated files are identical

### Requirement: Implemented operations match the contract
Every operation implemented by the backend SHALL use the path, method, status codes and body shape defined in the spec.

#### Scenario: Registration response
- **WHEN** a client registers through `POST /auth/register`
- **THEN** it receives status 201 with `accessToken`, `expiresIn` and `user` as the spec defines

### Requirement: Jira import and status mapping operations
`docs/api/openapi.yaml` SHALL describe `POST /jira/import` with the result `{ imported, created, updated, skipped }`, `GET /jira/status-mappings`, `PUT /jira/status-mappings` and `GET /jira/mappings`, and these operations SHALL no longer be marked with `x-implemented-in`.

#### Scenario: Frontend types
- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraImportResult`, `JiraStatusMapping` and `PutJiraStatusMappingsRequest` are available

### Requirement: Jira project listing operation
`docs/api/openapi.yaml` SHALL describe `GET /jira/projects` with the `boardId` query parameter, answering an array of `JiraProject` (`id`, `key`, `name`), and 404, 409, 429 and 502 errors.

#### Scenario: Frontend types
- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraProject` is available

### Requirement: Notifications operations
`docs/api/openapi.yaml` SHALL describe `GET /notifications` returning `NotificationPage` and `POST /notifications/{notificationId}/read` returning `Notification` (404 for an unknown or another user's notification), and these operations SHALL no longer be marked with `x-implemented-in`.

#### Scenario: Contract matches the implementation
- **WHEN** a reader opens the notifications operations
- **THEN** they carry no `x-implemented-in` and document 200, 401 and (for mark read) 404

### Requirement: Jira webhook operation
`docs/api/openapi.yaml` SHALL describe `POST /jira/webhook` as public with an empty security requirement, a 200 response for processed or ignored deliveries, a 400 response for malformed JSON, and a 401 response for missing or invalid authenticity proof. The operation SHALL document the `X-Hub-Signature`, `X-Atlassian-Webhook-Identifier` and `X-Atlassian-Webhook-Retry` request headers and SHALL NOT carry `x-implemented-in`.

#### Scenario: Contract validates
- **WHEN** the spec is validated with an OpenAPI validator
- **THEN** the webhook operation is valid and included under the `jira` tag

#### Scenario: Public operation
- **WHEN** a reader opens `POST /jira/webhook`
- **THEN** it overrides the global bearer requirement with an empty security array

#### Scenario: Responses are documented
- **WHEN** a reader opens `POST /jira/webhook`
- **THEN** 200 is documented as processed or ignored, 400 as malformed JSON, and 401 as unauthenticated

#### Scenario: Malformed delivery body
- **WHEN** a caller posts malformed JSON to `POST /jira/webhook`
- **THEN** the documented response is 400

### Requirement: Jira conflict operations

`docs/api/openapi.yaml` SHALL describe `GET /jira/conflicts` (query `boardId`, `limit`, `cursor`; 200 `JiraConflictPage`, 401, 403, 404) and `POST /jira/conflicts/{conflictId}/resolve` (body `ResolveJiraConflictRequest` with `resolution: jira | boardsync`; 200 `JiraConflict`, 400, 401, 403, 404, 409, 429, 502), and neither operation SHALL carry `x-implemented-in`. `JiraConflict` SHALL include both versions (column id and status text), their change times, the resolution, the resolution time and the resolving user.

#### Scenario: Frontend types

- **WHEN** the frontend regenerates its types from the spec
- **THEN** `JiraConflict`, `JiraConflictPage` and `ResolveJiraConflictRequest` are available

#### Scenario: Contract matches the implementation

- **WHEN** a reader opens the conflict operations
- **THEN** they carry no `x-implemented-in` and document the responses the backend returns

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

### Requirement: Outbox entry schema

`OutboxEntry` SHALL define `id`, `boardId`, `cardId`, nullable `actorId`, `operation`, `status` (`PENDING`, `IN_PROGRESS`, `SENT`, `DEAD`), `attempts`, `availableAt`, nullable `lockedAt`, nullable sanitized `lastError`, `sequence` (decimal string), `createdAt` and `updatedAt`. It SHALL NOT define token, secret or raw Jira body fields.

#### Scenario: Frontend type is generated

- **WHEN** the frontend regenerates types from the spec
- **THEN** `OutboxEntry` is available with the documented fields

#### Scenario: Sensitive data is absent

- **WHEN** a reader inspects `OutboxEntry`
- **THEN** no token, secret or raw provider body field is defined

### Requirement: Outbox paging schema

`OutboxPage` SHALL define `items` and nullable `nextCursor`, referencing the shared error and paging components where applicable.

#### Scenario: Frontend page type is generated

- **WHEN** the frontend regenerates types from the spec
- **THEN** `OutboxPage` is available

#### Scenario: Schema validates

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** `OutboxPage` is valid

### Requirement: Outbox operations are board-Admin scoped

All outbox operations SHALL document 401 for an unauthenticated caller, 403 for a non-Admin member and 404 for an unknown or inaccessible board or row. None SHALL expose tokens, secrets or raw Jira bodies.

#### Scenario: Authorization responses are documented

- **WHEN** a reader opens any outbox operation
- **THEN** 401, 403 and the applicable 404 are documented

#### Scenario: Contract validation passes

- **WHEN** the spec is validated with the OpenAPI validator
- **THEN** all outbox operations and their schemas are valid

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

### Requirement: Jira sync outbox bulk requeue operation

`docs/api/openapi.yaml` SHALL describe `POST /jira/sync/outbox/requeue-dead` as a board-Admin operation with a required `boardId` query parameter, returning `OutboxRequeueSummary` (`requeued`, `skipped`), with 400, 401, 403 and 404.

#### Scenario: Bulk requeue is documented

- **WHEN** a reader opens `POST /jira/sync/outbox/requeue-dead`
- **THEN** the required `boardId`, the `OutboxRequeueSummary` response and 400/401/403/404 are documented
