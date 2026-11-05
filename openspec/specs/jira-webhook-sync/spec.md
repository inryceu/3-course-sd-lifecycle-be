# jira-webhook-sync Specification

## Purpose
Receives authenticated Jira webhook deliveries and reflects Jira issue status changes on BoardSync cards in near real time, while keeping the dynamic webhook registration alive.

## Requirements

### Requirement: Authenticated webhook deliveries
The webhook endpoint SHALL accept a delivery only when it proves authenticity with an `X-Hub-Signature: sha256=<hex>` HMAC-SHA256 of the raw request body using `WEBHOOK_SECRET`, or with a Bearer JWT signed with `JIRA_CLIENT_SECRET` for dynamic OAuth webhooks. HMAC values SHALL be compared in constant time. Missing or invalid proof SHALL answer 401 before any board data is read or changed.

#### Scenario: Valid HMAC signature
- **WHEN** a delivery carries `X-Hub-Signature: sha256=<correct HMAC>` for the raw body
- **THEN** the delivery is processed

#### Scenario: Valid dynamic webhook JWT
- **WHEN** a dynamic webhook delivery carries a Bearer JWT signed with the configured client secret and not expired
- **THEN** the delivery is processed

#### Scenario: Invalid or missing proof
- **WHEN** the signature is absent, malformed, uses an unsupported method, or does not match the body, and no valid Bearer JWT is present
- **THEN** the response is 401 and no card or event is changed

#### Scenario: Body is verified before parsing changes it
- **WHEN** the request body is re-encoded or modified after signing
- **THEN** the signature check fails with 401

### Requirement: Delivery deduplication
The system SHALL derive a delivery key from `X-Atlassian-Webhook-Identifier`, falling back to a SHA-256 hash of the event, issue id and changelog id, or the raw body when no changelog is present. It SHALL store keys under a unique constraint with a retention period. A delivery whose key is already stored SHALL be ignored with 200. A delivery whose processing fails SHALL release its key so a Jira retry can be processed.

#### Scenario: Duplicate delivery
- **WHEN** the same delivery is posted twice while the first is stored
- **THEN** the second answers 200, and the card is moved and the event published only once

#### Scenario: Replay without the identifier header
- **WHEN** two deliveries have the same event, issue id and changelog id but no webhook identifier
- **THEN** they produce the same fallback key and the second is ignored

#### Scenario: Delivery without a changelog
- **WHEN** a delivery has no changelog and no webhook identifier
- **THEN** the fallback key is derived from the raw body

#### Scenario: Retry after a processing failure
- **WHEN** processing a delivery fails after its key was claimed
- **THEN** the key is released, the response is 5xx, and Jira's retry is processed normally

### Requirement: Jira status changes move the linked card
For a `jira:issue_updated` delivery whose changelog contains a `status` item, the system SHALL resolve the board from the issue-key mapping, resolve the target column from the stored status mapping or the status-category default, and move the card through `BoardsFacade.moveCardFromExternal`. It SHALL publish a `card.moved` event with `origin: "jira"` and SHALL NOT send the change back to Jira. Updates without a status change, unknown issues and no-op moves SHALL answer 200 without side effects.

#### Scenario: Mapped status change
- **WHEN** a linked issue changes to a status mapped to another column
- **THEN** its card moves to that column and a `card.moved` event with `origin: "jira"` is published

#### Scenario: Unmapped status
- **WHEN** the new status has no stored mapping
- **THEN** the card moves to the default column for the status category

#### Scenario: Non-status update
- **WHEN** the changelog changes only summary or assignee
- **THEN** the response is 200 and no card moves

#### Scenario: Unknown issue
- **WHEN** no card ↔ issue mapping exists for the delivered issue key
- **THEN** the response is 200, the delivery is ignored, and no error is returned to Jira

#### Scenario: No synchronisation loop
- **WHEN** the move publishes its event with `origin: "jira"`
- **THEN** no outbound Jira call is made for that event

### Requirement: Five-second completion budget
From receipt of a valid status-change delivery, the card move and event publication SHALL complete within 5 seconds without synchronous calls to the Jira API for the payload itself.

#### Scenario: Simulated delivery timing
- **WHEN** a valid status-change delivery is posted for an existing card
- **THEN** the card is visible in the new column and the event is published within 5 seconds

#### Scenario: Slow board persistence
- **WHEN** the board move cannot complete within the budget
- **THEN** the delivery fails and its deduplication key is released so Jira can retry

### Requirement: Register a webhook when a project is linked
When a board has a Jira connection and a linked project key, the system SHALL register a dynamic webhook for `jira:issue_updated` with JQL `project = "<KEY>"` through `POST /rest/api/3/webhook`, and SHALL store its webhook id, project key, receiver URL and expiration. Registration SHALL run on connect when a project is already linked, and on project link/import otherwise. A registration failure SHALL NOT fail the connect or import; reconciliation SHALL retry it.

#### Scenario: Connect with an existing project link
- **WHEN** the Admin reconnects a board that already has a Jira project key
- **THEN** a webhook is registered and its id and expiration are stored

#### Scenario: Project linked after connect
- **WHEN** the Admin imports or links a project on an already connected board
- **THEN** the webhook is registered for that project key

#### Scenario: Missing webhook scope
- **WHEN** the connection lacks `manage:jira-webhook`
- **THEN** connect/import still succeeds, the failure is logged without secrets, and reconciliation retries after the board reconnects with the scope

### Requirement: Refresh webhooks before expiry
Jira dynamic webhooks expire 30 days after creation or the last refresh. A scheduled job SHALL refresh stored webhooks that expire within 7 days through `PUT /rest/api/3/webhook/refresh`, update the stored expiration, and register webhooks missing for linked boards. Refresh failures SHALL be logged without secrets and retried on the next run.

#### Scenario: Near expiry
- **WHEN** a stored webhook expires within 7 days
- **THEN** it is refreshed and the new expiration is stored

#### Scenario: Far from expiry
- **WHEN** a stored webhook expires in more than 7 days
- **THEN** no refresh call is made

#### Scenario: Missing registration
- **WHEN** a connected board has a linked project but no stored webhook
- **THEN** the job registers it

### Requirement: Secret and transport safety
`WEBHOOK_SECRET` and `JIRA_CLIENT_SECRET` SHALL come from validated configuration and SHALL never appear in logs, errors or responses. The webhook receiver URL used for registration SHALL use HTTPS in production, and the endpoint SHALL remain unauthenticated by the user JWT guard.

#### Scenario: Rejected delivery is logged safely
- **WHEN** an invalid signature is rejected
- **THEN** the log names the failure but contains neither the configured secret nor the received signature

#### Scenario: Production receiver URL
- **WHEN** the application runs in production with a non-HTTPS webhook URL
- **THEN** startup or registration is refused
