# Spec Delta

## ADDED Requirements

### Requirement: Rate limiting on registration endpoint
The system SHALL limit the number of registration attempts per client to prevent brute-force account creation.

#### Scenario: Registration within rate limit succeeds
- **WHEN** a client posts valid registration credentials within the allowed rate
- **THEN** the response is 201 with `accessToken`, `expiresIn`, and `user`

#### Scenario: Registration above rate limit rejected
- **WHEN** a client exceeds the allowed registration attempts within the time window
- **THEN** the response is 429 `Too Many Requests` and no account is created

### Requirement: Rate limiting on login endpoint
The system SHALL limit the number of login attempts per client to prevent brute-force credential guessing.

#### Scenario: Login within rate limit succeeds
- **WHEN** a client posts valid login credentials within the allowed rate
- **THEN** the response is 200 with `accessToken`, `expiresIn`, and `user`

#### Scenario: Login above rate limit rejected
- **WHEN** a client exceeds the allowed login attempts within the time window
- **THEN** the response is 429 `Too Many Requests`
