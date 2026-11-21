# security-headers Specification

## Purpose

Applies HTTP response security headers to all backend responses so browsers enforce safer defaults against common client-side attacks.

## Requirements

### Requirement: Security headers present on all HTTP responses
The system SHALL include a baseline set of security headers on every HTTP response from the backend.

#### Scenario: Helmet headers applied
- **WHEN** a client receives any HTTP response from the API
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `X-XSS-Protection: 0` (the legacy filter is disabled on purpose)

#### Scenario: Content-Security-Policy relaxed for Swagger
- **WHEN** a client requests the Swagger documentation page
- **THEN** the response carries no Content-Security-Policy that blocks Swagger UI assets, while every other route keeps the default policy

### Requirement: Helmet middleware enabled
The system SHALL enable helmet as global HTTP middleware for all routes.

#### Scenario: Helmet active on protected routes
- **WHEN** a request reaches a protected route requiring authentication
- **THEN** the response carries the security headers defined by helmet defaults
