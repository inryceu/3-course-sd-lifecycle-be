# Spec Delta

## ADDED Requirements

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
