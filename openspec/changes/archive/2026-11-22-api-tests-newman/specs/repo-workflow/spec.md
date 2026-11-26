# Spec Delta

## ADDED Requirements

### Requirement: API tests in CI
A separate workflow SHALL start the full Compose stack, run the Postman collection in `test/postman/` with Newman against it, and upload the JUnit report whether the run passes or fails. The collection SHALL assert the status code of every request and validate every JSON response body against the schema generated from `docs/api/openapi.yaml`, and SHALL create its own unique users and data so it can run repeatedly on the same stack.

#### Scenario: Endpoint returns a body that breaks the contract
- **WHEN** a backend change makes an endpoint return a body that does not match its OpenAPI schema
- **THEN** the Newman run fails and the pull request check fails

#### Scenario: Role restriction regresses
- **WHEN** a Viewer is able to create a card
- **THEN** the "Viewer cannot create a card -> 403" request fails the run

#### Scenario: Run twice on the same stack
- **WHEN** the collection runs again against a stack that already holds the first run's users
- **THEN** it registers fresh users with unique e-mails and passes
