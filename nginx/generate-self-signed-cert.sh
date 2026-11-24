#!/usr/bin/env bash
# Generate a self-signed TLS certificate + key for local verification only.
# NOT for production. Production must rotate in a real cert/key into ./ssl.
#
# Usage: ./nginx/generate-self-signed-cert.sh   (Linux, macOS, Git Bash on Windows)
# Outputs: ssl/boardsync.crt  ssl/boardsync.key

set -euo pipefail

SSL_DIR="$(dirname "${BASH_SOURCE[0]}")/../ssl"
mkdir -p "$SSL_DIR"
SSL_DIR="$(cd "$SSL_DIR" && pwd)"

if [[ -f "$SSL_DIR/boardsync.crt" && -f "$SSL_DIR/boardsync.key" ]]; then
  echo "Certificate and key already exist at $SSL_DIR. Skipping generation."
  exit 0
fi

# Git Bash rewrites arguments that look like paths ("/CN=..." for -subj), so switch that off for
# openssl, and hand it bare file names from inside ssl/ (a native openssl cannot open /c/... paths).
cd "$SSL_DIR"
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout boardsync.key -out boardsync.crt \
  -subj "/CN=boardsync.local/O=BoardSync/C=UA" \
  -addext "subjectAltName=DNS:boardsync.local,DNS:localhost,IP:127.0.0.1"

chmod 600 boardsync.key
chmod 644 boardsync.crt

echo "Generated self-signed cert: $SSL_DIR/boardsync.crt"
echo "Generated private key:      $SSL_DIR/boardsync.key"
