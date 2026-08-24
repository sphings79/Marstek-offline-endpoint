#!/bin/sh
set -e

CERT_DIR="${CERT_DIR:-/certs}"
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.key" ] || [ ! -f "$CERT_DIR/server.crt" ]; then
  echo "generating a self-signed certificate (the device does not verify it)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
    -subj "/CN=api-eu.marstekcloud.com" \
    -addext "subjectAltName=DNS:api-eu.marstekcloud.com,DNS:*.marstekcloud.com,DNS:*.hamedata.com" \
    >/dev/null 2>&1
  echo "certificate written to $CERT_DIR"
fi

exec node /app/server.cjs
