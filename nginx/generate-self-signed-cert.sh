#!/usr/bin/env bash
# Generate a self-signed TLS certificate + key for local verification only.
# NOT for production. Production must rotate in a real cert/key into ./ssl.
#
# Usage: ./nginx/generate-self-signed-cert.sh
# Outputs: ssl/boardsync.crt  ssl/boardsync.key

set -euo pipefail

SSL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../ssl" && pwd)"
mkdir -p "$SSL_DIR"

CERT="$SSL_DIR/boardsync.crt"
KEY="$SSL_DIR/boardsync.key"

if [[ -f "$CERT" && -f "$KEY" ]]; then
  echo "Certificate and key already exist at $SSL_DIR. Skipping generation."
  exit 0
fi

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$KEY" -out "$CERT" \
  -subj "/CN=boardsync.local/O=BoardSync/C=US" \
  -addext "subjectAltName=DNS:boardsync.local,DNS:localhost,IP:127.0.0.1"

chmod 600 "$KEY"
chmod 644 "$CERT"

echo "Generated self-signed cert: $CERT"
echo "Generated private key:      $KEY"
