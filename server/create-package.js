#!/usr/bin/env node
/**
 * create-package.js — Crée un paquet de mise à jour signé
 * Usage: node create-package.js <version> <fichier_source>
 * Exemple: node create-package.js 1.0.1 /tmp/mon-app-v1.0.1.zip
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [,, version, sourceFile] = process.argv;

if (!version || !sourceFile) {
  console.error('Usage: node create-package.js <version> <fichier_source>');
  console.error('Exemple: node create-package.js 1.0.1 /tmp/mon-app.zip');
  process.exit(1);
}

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');
const versionDir = path.join(PACKAGES_DIR, version);

if (!fs.existsSync(sourceFile)) {
  console.error(`Fichier source introuvable: ${sourceFile}`);
  process.exit(1);
}

// Crée le dossier de la version
fs.mkdirSync(versionDir, { recursive: true });

const filename = path.basename(sourceFile);
const destPath = path.join(versionDir, filename);

// Copie le fichier
fs.copyFileSync(sourceFile, destPath);

// Calcule le SHA-256
const buf = fs.readFileSync(destPath);
const hash = crypto.createHash('sha256').update(buf).digest('hex');
const size = fs.statSync(destPath).size;

// Demande les infos changelog via stdin si pas interactif
const changelog = [
  `Version ${version} disponible`,
  'Corrections et améliorations'
];

const meta = {
  filename,
  sha256: hash,
  size,
  changelog,
  released_at: new Date().toISOString(),
  min_client_version: '1.0.0',
};

fs.writeFileSync(path.join(versionDir, 'meta.json'), JSON.stringify(meta, null, 2));

console.log(`\n✓ Paquet ${version} créé avec succès`);
console.log(`  Fichier  : ${filename}`);
console.log(`  SHA-256  : ${hash}`);
console.log(`  Taille   : ${(size / 1024).toFixed(1)} Ko`);
console.log(`  Dossier  : packages/${version}/\n`);
