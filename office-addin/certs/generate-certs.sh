#!/usr/bin/env bash
# Regenerate the OVC localhost TLS certificates.
#
# Run this script from the repo root or from inside office-addin/certs/:
#
#   bash office-addin/certs/generate-certs.sh
#
# Requirements: openssl (any modern version that supports genpkey)
#
# Output files  (written into the same directory as this script):
#   ovc-localhost-ca.key   — CA private key      [NOT committed to git]
#   ovc-localhost-ca.crt   — CA certificate       [committed]
#   ovc-localhost.key      — Server private key   [NOT committed to git]
#   ovc-localhost.crt      — Server certificate   [committed]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DAYS=3650   # 10 years

echo "Generating CA key (PKCS#8)..."
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out ovc-localhost-ca.key 2>/dev/null

echo "Generating self-signed CA certificate..."
openssl req -new -x509 -days "$DAYS" \
  -key ovc-localhost-ca.key \
  -subj "/CN=OVC Localhost CA" \
  -out ovc-localhost-ca.crt

echo "Generating server key (PKCS#8)..."
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out ovc-localhost.key 2>/dev/null

echo "Generating server certificate signing request..."
openssl req -new \
  -key ovc-localhost.key \
  -subj "/CN=localhost" \
  -out ovc-localhost.csr

echo "Signing server certificate with CA..."
openssl x509 -req -days "$DAYS" \
  -in ovc-localhost.csr \
  -CA ovc-localhost-ca.crt \
  -CAkey ovc-localhost-ca.key \
  -CAcreateserial \
  -extfile <(printf '[SAN]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n') \
  -extensions SAN \
  -out ovc-localhost.crt

rm -f ovc-localhost.csr ovc-localhost-ca.srl

echo ""
echo "Done. Files written to: $SCRIPT_DIR"
echo "  ovc-localhost-ca.key  (private — do NOT commit)"
echo "  ovc-localhost-ca.crt  (public  — commit)"
echo "  ovc-localhost.key     (private — do NOT commit)"
echo "  ovc-localhost.crt     (public  — commit)"
echo ""
echo "If you already installed the old CA certificate on Windows, re-run:"
echo "  .\\office-addin\\uninstall-office-addin-cert.ps1"
echo "  .\\office-addin\\setup-office-addin.ps1"
