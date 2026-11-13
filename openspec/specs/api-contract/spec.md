# api-contract Specification

## Purpose
Establishes the OpenAPI and WebSocket contract as the single source of truth that backend and frontend are built against in two repositories.

## Requirements

### Requirement: REST contract coverage
The repository SHALL contain `docs/api/openapi.yaml` describing every REST area of the product: auth, boards, columns, cards (create, update, move, assign), labels, comments, members and roles, Jira (connect start and callback, status, disconnect, mapping, import, webhook, conflicts) and notifications.

#### Scenario: Spec is valid
- **WHEN** the spec is validated with an OpenAPI validator
- **THEN** validation succeeds without errors

#### Scenario: Every product area present
- **WHEN** a reader lists the spec's tags
- **THEN** auth, boards, columns, cards, labels, comments, members, jira and notifications are present

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
