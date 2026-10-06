#!/bin/bash
# setup-certs.sh — Génère un certificat SSL auto-signé pour le réseau local
# À lancer sur le serveur Debian AVANT de démarrer le serveur.

set -e

CERTS_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERTS_DIR"

echo "=== Génération du certificat SSL auto-signé ==="
echo ""

# Récupère l'IP locale automatiquement
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "IP locale détectée : $LOCAL_IP"
echo "(Vous pouvez la changer dans ce script si besoin)"
echo ""

# Génère la clé privée et le certificat
openssl req -x509 -newkey rsa:4096 \
  -keyout "$CERTS_DIR/server.key" \
  -out "$CERTS_DIR/server.crt" \
  -days 3650 \
  -nodes \
  -subj "/CN=update-server/O=HomeServer/C=FR" \
  -addext "subjectAltName=IP:${LOCAL_IP},IP:127.0.0.1,DNS:localhost,DNS:update-server"

chmod 600 "$CERTS_DIR/server.key"
chmod 644 "$CERTS_DIR/server.crt"

echo ""
echo "✓ Certificat généré (valide 10 ans)"
echo "  Clé     : certs/server.key"
echo "  Certificat : certs/server.crt"
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ACTION REQUISE côté client Windows                        │"
echo "│                                                             │"
echo "│  Copiez certs/server.crt sur votre PC Windows              │"
echo "│  et renseignez son chemin dans client/config.ini           │"
echo "│  (paramètre server_cert)                                    │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "IP du serveur pour config.ini : $LOCAL_IP"
