# security-headers Specification

## Purpose

Applies HTTP response security headers to all backend responses so browsers enforce safer defaults against common client-side attacks.

## Requirements

### Requirement: Security headers present on all HTTP responses
The system SHALL include a baseline set of security headers on every HTTP response from the backend.

#### Scenario: Helmet headers applied
- **WHEN** a client receives any HTTP response from the API
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `X-XSS-Protection: 1; mode=block`

#### Scenario: Content-Security-Policy relaxed for Swagger
- **WHEN** a client requests the Swagger documentation page
- **THEN** the response does not block Swagger UI assets via Content-Security-Policy

### Requirement: Helmet middleware enabled
The system SHALL enable helmet as global HTTP middleware for all routes.

#### Scenario: Helmet active on protected routes
- **WHEN** a request reaches a protected route requiring authentication
- **THEN** the response carries the security headers defined by helmet defaults
