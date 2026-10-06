#!/usr/bin/env node
/**
 * setup-keys.js — Génère les clés RSA + tokens d'authentification
 * À lancer UNE SEULE FOIS sur le serveur.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

console.log('=== Génération des clés RSA 4096 bits ===');

// Crée le dossier keys si besoin
if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

// Génère la paire de clés RSA
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(path.join(KEYS_DIR, 'private.pem'), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(KEYS_DIR, 'public.pem'), publicKey);

console.log('✓ Clé privée  → keys/private.pem  (NE PAS PARTAGER)');
console.log('✓ Clé publique → keys/public.pem   (à copier sur les clients)');

// Génère les tokens d'authentification
console.log('\n=== Génération des tokens ===');

const existingTokens = fs.existsSync(TOKENS_FILE)
  ? JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
  : {};

const newTokens = { ...existingTokens };

// Token admin
const adminToken = crypto.randomBytes(32).toString('hex');
newTokens[adminToken] = {
  name: 'admin',
  admin: true,
  created_at: new Date().toISOString(),
};

// Token client Windows de test
const clientToken = crypto.randomBytes(32).toString('hex');
newTokens[clientToken] = {
  name: 'windows-pc-test',
  admin: false,
  created_at: new Date().toISOString(),
};

fs.writeFileSync(TOKENS_FILE, JSON.stringify(newTokens, null, 2), { mode: 0o600 });

console.log('\n✓ Tokens générés et sauvegardés dans server/tokens.json');
console.log('\n┌─────────────────────────────────────────────────────────────┐');
console.log('│  TOKENS À NOTER (affichés une seule fois ici)               │');
console.log('├─────────────────────────────────────────────────────────────┤');
console.log(`│  Admin  : ${adminToken}`);
console.log(`│  Client : ${clientToken}`);
console.log('└─────────────────────────────────────────────────────────────┘');
console.log('\n→ Copiez le token CLIENT dans client/config.ini côté Windows.');
console.log('→ Copiez keys/public.pem vers le client Windows.\n');
