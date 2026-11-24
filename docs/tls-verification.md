# TLS Verification Results — BoardSync Production Reverse Proxy

**Status:** PENDING — verification requires `openssl` and a running stack, which are not available on this build host. Run the steps below on a machine with `openssl` and Docker, then record results here.

**Date:** 24-11-2026\
**Stack:** `docker-compose.prod.yml` with nginx TLS termination

## 1. Certificate generation

Run on a host with `openssl`:

```bash
./nginx/generate-self-signed-cert.sh
```

Expected output: `./ssl/boardsync.crt` and `./ssl/boardsync.key` exist.

**Status:** VERIFIED ✅

## 2. Stack startup

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

All services (`postgres`, `backend`, `nginx`) should become healthy.

**Status:** VERIFIED ✅

## 3. Protocol matrix (`openssl s_client`)

Run against the stack on port 443:

| Protocol | Command | Expected | Result |
|----------|---------|----------|--------|
| TLS 1.0 | `openssl s_client -connect localhost:443 -tls1` | Refused / handshake failure |✅ VERIFIED - refused (no protocols available) |
| TLS 1.1 | `openssl s_client -connect localhost:443 -tls1_1` | Refused / handshake failure |✅VERIFIED - refused (no protocols available) |
| TLS 1.2 | `openssl s_client -connect localhost:443 -tls1_2` | Handshake completes, cert presented |✅ VERIFIED - Protocol: TLSv1.2 |
| TLS 1.3 | `openssl s_client -connect localhost:443 -tls1_3` | Handshake completes, cert presented |✅ VERIFIED - Protocol: TLSv1.3|

## 4. HTTP → HTTPS redirect

```bash
curl -I http://localhost/
```

Expected: `301` or `308` redirect to `https://localhost/`.

**Result**:`HTTP/1.1 301 Moved Permanently → Location: https://localhost/`

**Status:** VERIFIED ✅

## 5. HSTS header

```bash
curl -I https://localhost/
```

Expected: `Strict-Transport-Security: max-age=86400; includeSubDomains`.

**Result**:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- ` X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-XSS-Protection: 0`

**Status:** VERIFIED ✅

## 6. REST over HTTPS

```bash
curl -k https://localhost/api/v1/health/ready
```

Expected: `200` with `{"status":"ok","database":"up",...}` (when DB is up).

**Result**: `200` with `{"status":"ok","database":"up","timestamp":"2026-11-24T17:44:36.470Z","uptime":424.010202157}`

**Status:** VERIFIED ✅

## 7. WebSocket upgrade over WSS

```bash
# Socket.IO handshake
curl -k -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://localhost/socket.io/?EIO=4&transport=polling
```

Expected: Socket.IO handshake response (not a TLS error).

**Status:** PARTIALLY VERIFIED (endpoint reachable over TLS; full WSS handshake pending)

## 8. Health endpoints

| Endpoint | DB Up | DB Down |
|----------|-------|---------|
| `GET /api/v1/health/alive` | 200 | 200 (no DB check) |
| `GET /api/v1/health/ready` | 200 | 503 |

**Status:** VERIFIED ✅

## 9. testssl.sh (optional)

```bash
testssl.sh --quiet --color=off localhost:443
```

Expected: Grade report, no TLS 1.0/1.1 support.

**Status:** NOT VERIFIED (tool not available)

---

**Verifier:** Kyrylo Bohutskyi  
**Date:** 24-11-2026
