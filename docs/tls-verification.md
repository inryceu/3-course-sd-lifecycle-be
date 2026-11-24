# TLS Verification Results — BoardSync Production Reverse Proxy

**Status:** PENDING — verification requires `openssl` and a running stack, which are not available on this build host. Run the steps below on a machine with `openssl` and Docker, then record results here.

**Date:** 2026-11-24
**Stack:** `docker-compose.prod.yml` with nginx TLS termination

## 1. Certificate generation

Run on a host with `openssl`:

```bash
./nginx/generate-self-signed-cert.sh
```

Expected output: `./ssl/boardsync.crt` and `./ssl/boardsync.key` exist.

**Status:** NOT VERIFIED (openssl not available on this host)

## 2. Stack startup

```bash
docker compose -f docker-compose.prod.yml up --build
```

All services (`postgres`, `backend`, `nginx`) should become healthy.

**Status:** NOT VERIFIED

## 3. Protocol matrix (`openssl s_client`)

Run against the stack on port 443:

| Protocol | Command | Expected | Result |
|----------|---------|----------|--------|
| TLS 1.0 | `openssl s_client -connect localhost:443 -tls1` | Refused / handshake failure | NOT VERIFIED |
| TLS 1.1 | `openssl s_client -connect localhost:443 -tls1_1` | Refused / handshake failure | NOT VERIFIED |
| TLS 1.2 | `openssl s_client -connect localhost:443 -tls1_2` | Handshake completes, cert presented | NOT VERIFIED |
| TLS 1.3 | `openssl s_client -connect localhost:443 -tls1_3` | Handshake completes, cert presented | NOT VERIFIED |

## 4. HTTP → HTTPS redirect

```bash
curl -I http://localhost/
```

Expected: `301` or `308` redirect to `https://localhost/`.

**Status:** NOT VERIFIED

## 5. HSTS header

```bash
curl -I https://localhost/
```

Expected: `Strict-Transport-Security: max-age=86400; includeSubDomains`.

**Status:** NOT VERIFIED

## 6. REST over HTTPS

```bash
curl -k https://localhost/api/v1/health/ready
```

Expected: `200` with `{"status":"ok","database":"up",...}` (when DB is up).

**Status:** NOT VERIFIED

## 7. WebSocket upgrade over WSS

```bash
# Socket.IO handshake
curl -k -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://localhost/socket.io/?EIO=4&transport=polling
```

Expected: Socket.IO handshake response (not a TLS error).

**Status:** NOT VERIFIED

## 8. Health endpoints

| Endpoint | DB Up | DB Down |
|----------|-------|---------|
| `GET /api/v1/health/alive` | 200 | 200 (no DB check) |
| `GET /api/v1/health/ready` | 200 | 503 |

**Status:** NOT VERIFIED

## 9. testssl.sh (optional)

```bash
testssl.sh --quiet --color=off localhost:443
```

Expected: Grade report, no TLS 1.0/1.1 support.

**Status:** NOT VERIFIED (tool not available)

---

**Verifier:** ____________________  
**Date:** ____________________
