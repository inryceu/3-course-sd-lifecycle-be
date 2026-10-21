#!/usr/bin/env bash
# Brings up docker-compose.full.yml and proves the T-12 acceptance criteria end to end:
# every service healthy, migrations applied, REST and WebSocket reachable through the web port.
#
#   ./scripts/full-stack-smoke.sh            # build, start, check, leave running
#   ./scripts/full-stack-smoke.sh --down     # ... then stop the stack and delete its volume
#
# Needs .env.full (copy .env.full.example) and the frontend repo next to this one.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.full}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE - copy .env.full.example first" >&2; exit 1; }
WEB_PORT="$(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
BASE="http://localhost:${WEB_PORT:-8080}"
compose() { docker compose --env-file "$ENV_FILE" -f docker-compose.full.yml "$@"; }

echo "== starting the stack (waits for every healthcheck)"
compose up --build -d --wait

echo "== migrations"
compose logs backend | grep -E "Applied [0-9]+ migration|Database is up to date"

echo "== REST through the web port: $BASE"
curl -fsS "$BASE/api/v1/health" | grep -q '"database":"up"'
EMAIL="smoke-$(date +%s)@example.com"
TOKEN="$(curl -fsS -X POST "$BASE/api/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-password\",\"displayName\":\"Smoke\"}" \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')"
curl -fsS "$BASE/api/v1/auth/me" -H "Authorization: Bearer $TOKEN" | grep -q "$EMAIL"

echo "== WebSocket (Socket.IO handshake) through the web port"
curl -fsS "$BASE/socket.io/?EIO=4&transport=polling" | grep -q '"sid"'

echo "== SPA served"
curl -fsS "$BASE/" | grep -qi '<!doctype html>'

echo "OK: postgres, backend and frontend are healthy; REST and WebSocket reach the backend via $BASE"

if [[ "${1:-}" == "--down" ]]; then
  compose down -v
fi
