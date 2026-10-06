#!/bin/bash
# start-all.sh — Démarre les 3 serveurs en même temps
# - API mises à jour  : HTTPS :8443
# - Site téléchargement: HTTP  :3000
# - Admin             : HTTP  :3001
# Arrêt: Ctrl+C

set -e
SERVER_DIR="$(dirname "$0")"
mkdir -p "$SERVER_DIR/../logs"

LOG_API="$SERVER_DIR/../logs/api.log"
LOG_SITE="$SERVER_DIR/../logs/site.log"
LOG_ADMIN="$SERVER_DIR/../logs/admin.log"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       Démarrage du système de mises à jour           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if ! command -v node &> /dev/null; then
  echo "❌ Node.js introuvable."
  exit 1
fi
if [ ! -f "$SERVER_DIR/../keys/private.pem" ]; then
  echo "❌ Clés RSA manquantes — lancez : node setup-keys.js"
  exit 1
fi
if [ ! -f "$SERVER_DIR/../certs/server.crt" ]; then
  echo "❌ Certificat SSL manquant — lancez : bash setup-certs.sh"
  exit 1
fi

LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "✓ Clés RSA       : OK"
echo "✓ Certificat SSL  : OK"
echo "✓ IP locale       : $LOCAL_IP"
echo ""

cleanup() {
  echo ""
  echo "Arrêt des serveurs..."
  kill "$PID_API" "$PID_SITE" "$PID_ADMIN" 2>/dev/null
  echo "✓ Arrêtés."
  exit 0
}
trap cleanup SIGINT SIGTERM

node "$SERVER_DIR/server.js"     2>&1 | tee "$LOG_API"   & PID_API=$!
sleep 0.5
node "$SERVER_DIR/download-site.js" 2>&1 | tee "$LOG_SITE" & PID_SITE=$!
sleep 0.5
node "$SERVER_DIR/admin-site.js" 2>&1 | tee "$LOG_ADMIN" & PID_ADMIN=$!
sleep 1

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Les 3 serveurs sont démarrés !                             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  📦 API mises à jour   : https://%-26s ║\n" "$LOCAL_IP:8443"
printf "║  🌐 Site téléchargement : http://%-27s ║\n" "$LOCAL_IP:3000"
printf "║  🛠  Admin              : http://%-27s ║\n" "$LOCAL_IP:3001"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Clients → http://$LOCAL_IP:3000"
echo "║  Publier v1.3 → http://$LOCAL_IP:3001"
echo "║  Ctrl+C pour tout arrêter"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

wait "$PID_API" "$PID_SITE" "$PID_ADMIN"
