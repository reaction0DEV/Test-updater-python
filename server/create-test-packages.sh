#!/bin/bash
# create-test-packages.sh — Crée 3 paquets de test pour démonstration
# Lance ce script depuis le dossier racine du projet.

set -e

PACKAGES_DIR="$(dirname "$0")/../packages"

echo "=== Création des paquets de test ==="

for VERSION in 1.0.0 1.0.1 1.0.2; do
  DIR="$PACKAGES_DIR/$VERSION"
  mkdir -p "$DIR"

  # Crée un fichier zip factice représentant une mise à jour
  TMPFILE="/tmp/update-${VERSION}.zip"
  echo "Contenu factice de la mise à jour $VERSION — $(date)" > "/tmp/content-${VERSION}.txt"
  zip -j "$TMPFILE" "/tmp/content-${VERSION}.txt" 2>/dev/null

  cp "$TMPFILE" "$DIR/update-${VERSION}.zip"
  HASH=$(sha256sum "$DIR/update-${VERSION}.zip" | awk '{print $1}')
  SIZE=$(stat -c%s "$DIR/update-${VERSION}.zip")

  # Génère meta.json
  cat > "$DIR/meta.json" << EOF
{
  "filename": "update-${VERSION}.zip",
  "sha256": "${HASH}",
  "size": ${SIZE},
  "changelog": [
    "Version ${VERSION}",
    "$([ "$VERSION" = "1.0.0" ] && echo "Version initiale" || echo "Corrections et améliorations")"
  ],
  "released_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "min_client_version": "1.0.0"
}
EOF

  echo "✓ Paquet $VERSION créé (SHA-256: ${HASH:0:16}…)"
done

echo ""
echo "✓ 3 paquets de test disponibles dans packages/"
echo "  La version 1.0.2 sera proposée comme mise à jour."
