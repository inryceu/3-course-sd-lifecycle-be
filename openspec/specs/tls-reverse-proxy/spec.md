# tls-reverse-proxy Specification

## Purpose

Defines the production-like TLS reverse-proxy behavior for BoardSync: HTTPS termination at nginx, HTTP-to-HTTPS redirect, REST and WebSocket proxying to the backend, split liveness/readiness health probes, and verifiable TLS configuration.

## Requirements

### Requirement: TLS termination at the edge
The system SHALL terminate TLS at the reverse proxy on port 443, accepting only TLS 1.2 and above, and refusing TLS 1.0 and 1.1.

#### Scenario: TLS 1.2 connection succeeds
- **WHEN** a client connects to port 443 using TLS 1.2
- **THEN** the TLS handshake completes and the server presents a certificate

#### Scenario: TLS 1.3 connection succeeds
- **WHEN** a client connects to port 443 using TLS 1.3
- **THEN** the TLS handshake completes and the server presents a certificate

#### Scenario: TLS 1.1 connection is refused
- **WHEN** a client connects to port 443 using TLS 1.1
- **THEN** the TLS handshake is refused or the connection is terminated

#### Scenario: TLS 1.0 connection is refused
- **WHEN** a client connects to port 443 using TLS 1.0
- **THEN** the TLS handshake is refused or the connection is terminated

### Requirement: HTTP to HTTPS redirect
The system SHALL redirect all plaintext HTTP traffic on port 80 to HTTPS on port 443.

#### Scenario: HTTP request redirects to HTTPS
- **WHEN** a client sends an HTTP request to port 80
- **THEN** the response is a 301 or 308 redirect to the equivalent `https://` URL

### Requirement: REST and WebSocket proxying
The system SHALL proxy REST calls under `/api/v1/` and Socket.IO WebSocket upgrades under `/socket.io/` to the backend, forwarding upgrade headers so WebSocket connections succeed over `wss://`.

#### Scenario: REST request reaches backend over HTTPS
- **WHEN** a client sends `GET https://host/api/v1/health`
- **THEN** the request is proxied to the backend and the backend's response is returned to the client

#### Scenario: WebSocket upgrade reaches backend
- **WHEN** a client initiates a WebSocket upgrade to `wss://host/socket.io/` with `Upgrade: websocket`
- **THEN** the upgrade headers are forwarded to the backend and the socket is established

#### Scenario: Forwarded scheme is https
- **WHEN** a proxied request reaches the backend
- **THEN** the backend sees `X-Forwarded-Proto: https` so callback and webhook URLs are generated as `https://`

### Requirement: Security headers at the edge
The system SHALL set `Strict-Transport-Security` (HSTS) on all HTTPS responses from the reverse proxy; the backend SHALL continue to set its baseline Helmet headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, X-XSS-Protection) on every response.

#### Scenario: HSTS present on HTTPS responses
- **WHEN** a client receives a response over HTTPS from the reverse proxy
- **THEN** the response includes `Strict-Transport-Security` with `max-age` and `includeSubDomains`

#### Scenario: Baseline Helmet headers present
- **WHEN** a client receives any HTTP response from the backend
- **THEN** the response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `X-XSS-Protection: 0`

### Requirement: Split health probes
The system SHALL expose two health endpoints: liveness (process alive only) and readiness (database reachable, 503 when down). The compose healthcheck SHALL target readiness.

#### Scenario: Liveness answers when process is up
- **WHEN** the backend process is running
- **THEN** `GET /api/v1/health/alive` returns a successful status without checking the database

#### Scenario: Readiness answers 503 when database is down
- **WHEN** the database is unreachable
- **THEN** `GET /api/v1/health/ready` returns 503

#### Scenario: Compose healthcheck targets readiness
- **WHEN** compose evaluates the backend healthcheck
- **THEN** it calls `GET /api/v1/health/ready` and marks the service healthy only when the database is up

### Requirement: Restart policies and resource limits
The system SHALL run all production services with `restart: always` and `deploy.resources.limits`/`reservations`, including the reverse proxy.

#### Scenario: Nginx has restart and limits
- **WHEN** the production stack is defined
- **THEN** the nginx service declares `restart: always` and `deploy.resources.limits` with CPU and memory bounds

### Requirement: Self-signed certificate for local verification
The system SHALL provide a self-signed TLS certificate and key under `./ssl` for local verification, mounted read-only into the nginx container.

#### Scenario: Certificate and key exist locally
- **WHEN** the stack is prepared for local verification
- **THEN** `./ssl` contains a certificate and private key usable by nginx on port 443

### Requirement: TLS verification is recorded
The system SHALL record the result of TLS verification (protocol matrix, cipher, headers, WebSocket upgrade) in a document after bringing the stack up.

#### Scenario: Verification results are recorded
- **WHEN** `openssl s_client` confirms TLS 1.0/1.1 refused and TLS 1.2/1.3 accepted, plus HSTS and WebSocket upgrade over `wss://`
- **THEN** the outcome is written to `docs/tls-verification.md` with a timestamp
