/**
 * download-site.js — Site web de distribution du client
 * HTTP sur le port 3000 (pas besoin de HTTPS pour cette page simple)
 *
 * Le client visite http://IP:3000, clique Télécharger,
 * et reçoit un ZIP contenant tout le nécessaire déjà configuré.
 *
 * Usage: node download-site.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const PORT       = 3000;
const BASE_DIR   = path.join(__dirname, '..');
const CLIENT_DIR = path.join(BASE_DIR, 'client');
const CERTS_DIR  = path.join(BASE_DIR, 'certs');
const KEYS_DIR   = path.join(BASE_DIR, 'keys');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// ── Détecte l'IP locale automatiquement ──────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ── Récupère le premier token client (non admin) ──────────────────────────────
function getClientToken() {
  if (!fs.existsSync(TOKENS_FILE)) return 'TOKEN_MANQUANT_lancez_setup-keys.js';
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  for (const [token, info] of Object.entries(tokens)) {
    if (!info.admin) return token;
  }
  return 'TOKEN_MANQUANT';
}

// ── Construit le ZIP client en mémoire avec les bons fichiers ────────────────
async function buildClientZip(localIP, token) {
  // On utilise le module natif Node.js (pas de dépendance externe)
  // Format ZIP minimal fait à la main
  const files = [];

  // 1. app.py v1.0 — l'application principale avec mise à jour intégrée
  const appPy = fs.readFileSync(path.join(CLIENT_DIR, 'app.py'));
  files.push({ name: 'update-client/app.py', data: appPy });

  // 2. requirements.txt
  const req = fs.readFileSync(path.join(CLIENT_DIR, 'requirements.txt'));
  files.push({ name: 'update-client/requirements.txt', data: req });

  // 3. config.ini pré-rempli
  const config = Buffer.from(
`[server]
url = https://${localIP}:8443
token = ${token}
server_cert = server.crt

[security]
public_key_path = public.pem

[update]
check_interval = 3600
`, 'utf8');
  files.push({ name: 'update-client/config.ini', data: config });

  // 5. Certificat SSL
  if (fs.existsSync(path.join(CERTS_DIR, 'server.crt'))) {
    files.push({
      name: 'update-client/server.crt',
      data: fs.readFileSync(path.join(CERTS_DIR, 'server.crt'))
    });
  }

  // 6. Clé publique RSA
  if (fs.existsSync(path.join(KEYS_DIR, 'public.pem'))) {
    files.push({
      name: 'update-client/public.pem',
      data: fs.readFileSync(path.join(KEYS_DIR, 'public.pem'))
    });
  }

  // 7. README rapide
  const readme = Buffer.from(
`# Client de mises à jour — Instructions

## Ce dont vous avez besoin
- Python 3.10 ou supérieur : https://python.org/downloads
  (cochez "Add Python to PATH" à l'installation)

## Installation (une seule fois)
1. Ouvrez un terminal / PowerShell dans ce dossier
2. Tapez : pip install -r requirements.txt
3. Appuyez sur Entrée et attendez la fin

## Lancer l'application
   python app.py

L'application vérifie automatiquement si une mise à jour est disponible.
Si oui, elle vous propose de l'installer en un clic.

## Ce dossier contient déjà :
- app.py            → application principale (v1.0)
- config.ini        → déjà configuré (serveur + token)
- server.crt        → certificat SSL du serveur
- public.pem        → clé publique pour vérifier les signatures
- requirements.txt  → dépendances Python

Serveur : https://${localIP}:8443
`, 'utf8');
  files.push({ name: 'update-client/LIRE-MOI.txt', data: readme });

  return buildZipBuffer(files);
}

// ── Constructeur ZIP minimal (format PKZIP) ───────────────────────────────────
function buildZipBuffer(files) {
  const crypto = require('crypto');
  const parts  = [];
  const centralDir = [];
  let offset = 0;

  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const size = file.data.length;

    // Local file header
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0);   // signature
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0, 6);            // flags
    lh.writeUInt16LE(0, 8);            // compression (store)
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);        // compressed size
    lh.writeUInt32LE(size, 22);        // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(lh, 30);

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);   // signature
    cd.writeUInt16LE(20, 4);           // version made by
    cd.writeUInt16LE(20, 6);           // version needed
    cd.writeUInt16LE(0, 8);            // flags
    cd.writeUInt16LE(0, 10);           // compression
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);           // extra
    cd.writeUInt16LE(0, 32);           // comment
    cd.writeUInt16LE(0, 34);           // disk start
    cd.writeUInt16LE(0, 36);           // internal attr
    cd.writeUInt32LE(0, 38);           // external attr
    cd.writeUInt32LE(offset, 42);      // offset of local header
    nameBytes.copy(cd, 46);

    parts.push(lh, file.data);
    centralDir.push(cd);
    offset += lh.length + size;
  }

  const cdBuf   = Buffer.concat(centralDir);
  const cdSize  = cdBuf.length;
  const cdOffset = offset;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
}

// CRC32 pour ZIP
function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Page HTML ─────────────────────────────────────────────────────────────────
function renderHTML(localIP, version, filesReady) {
  const warnings = [];
  if (!fs.existsSync(path.join(CERTS_DIR, 'server.crt')))
    warnings.push('Certificat SSL manquant — lancez <code>bash setup-certs.sh</code>');
  if (!fs.existsSync(path.join(KEYS_DIR, 'public.pem')))
    warnings.push('Clé publique manquante — lancez <code>node setup-keys.js</code>');
  if (!fs.existsSync(TOKENS_FILE))
    warnings.push('Tokens manquants — lancez <code>node setup-keys.js</code>');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Centre de mises à jour</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#0f1117;color:#e2e8f0;min-height:100vh;
       display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
  .card{background:#1a1f2e;border:1px solid #2d3748;border-radius:16px;
        padding:48px 40px;max-width:520px;width:100%;text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,0.5)}
  .badge{display:inline-block;background:#1e3a5f;color:#7eb8f7;
         font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;
         margin-bottom:20px;letter-spacing:0.5px}
  h1{font-size:26px;font-weight:700;color:#fff;margin-bottom:8px}
  .subtitle{color:#718096;font-size:14px;margin-bottom:32px;line-height:1.6}
  .version-box{background:#0d1117;border:1px solid #2d3748;border-radius:10px;
               padding:16px;margin-bottom:28px;display:flex;
               align-items:center;justify-content:space-between}
  .version-label{color:#718096;font-size:13px}
  .version-num{color:#48bb78;font-weight:700;font-size:18px;font-family:monospace}
  .btn{display:block;width:100%;padding:16px;background:#185fa5;
       color:#fff;font-size:16px;font-weight:600;border:none;
       border-radius:10px;cursor:pointer;text-decoration:none;
       transition:background 0.2s,transform 0.1s}
  .btn:hover{background:#1a6fc4;transform:translateY(-1px)}
  .btn:active{transform:translateY(0)}
  .btn.disabled{background:#2d3748;color:#4a5568;cursor:not-allowed;pointer-events:none}
  .btn svg{vertical-align:middle;margin-right:8px;margin-top:-2px}
  .steps{text-align:left;margin-top:32px;border-top:1px solid #2d3748;padding-top:24px}
  .steps h3{color:#a0aec0;font-size:12px;font-weight:600;text-transform:uppercase;
            letter-spacing:1px;margin-bottom:16px}
  .step{display:flex;gap:14px;margin-bottom:14px;align-items:flex-start}
  .step-num{background:#185fa5;color:#fff;width:24px;height:24px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-size:12px;font-weight:700;flex-shrink:0;margin-top:1px}
  .step-text{color:#cbd5e0;font-size:13.5px;line-height:1.5}
  .step-text code{background:#0d1117;color:#7eb8f7;padding:2px 6px;
                  border-radius:4px;font-family:monospace;font-size:12.5px}
  .warning{background:#2d1f00;border:1px solid #744210;border-radius:8px;
           padding:12px 16px;margin-bottom:20px;text-align:left;
           color:#f6ad55;font-size:13px;line-height:1.5}
  .warning code{color:#fbd38d;font-family:monospace}
  .footer{margin-top:28px;color:#4a5568;font-size:12px}
  .footer a{color:#185fa5;text-decoration:none}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;
       background:#48bb78;margin-right:6px;box-shadow:0 0 6px #48bb78}
</style>
</head>
<body>
<div class="card">
  <span class="badge">🏠 Réseau local — ${localIP}</span>
  <h1>Centre de mises à jour</h1>
  <p class="subtitle">Téléchargez le client en un clic.<br>
     Tout est déjà configuré — prêt à l'emploi.</p>

  ${warnings.map(w => `<div class="warning">⚠ ${w}</div>`).join('')}

  <div class="version-box">
    <div>
      <div class="version-label">Dernière version disponible</div>
      <div class="version-num">${version}</div>
    </div>
    <div style="text-align:right">
      <div class="version-label">Statut du serveur</div>
      <div style="color:#48bb78;font-size:13px;margin-top:4px">
        <span class="dot"></span>En ligne
      </div>
    </div>
  </div>

  <a href="/download-client" class="${filesReady ? 'btn' : 'btn disabled'}">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    Télécharger le client (ZIP)
  </a>

  <div class="steps">
    <h3>Après le téléchargement</h3>
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">
        Décompressez <code>update-client.zip</code> dans un dossier de votre choix
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">
        Installez Python 3.10+ si ce n'est pas fait →
        <a href="https://python.org/downloads" style="color:#7eb8f7">python.org</a><br>
        <span style="color:#718096;font-size:12px">(cochez "Add Python to PATH")</span>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">
        Ouvrez un terminal dans le dossier et lancez :<br>
        <code>pip install -r requirements.txt</code>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-text">
        Lancez l'application :<br>
        <code>python app.py</code>
      </div>
    </div>
  </div>

  <div class="footer">
    Serveur d'API : <a href="https://${localIP}:8443/health">https://${localIP}:8443</a><br>
    Le ZIP contient déjà config.ini, server.crt et public.pem pré-configurés.
  </div>
</div>
</body>
</html>`;
}

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const localIP = getLocalIP();
  const token   = getClientToken();

  // Détecte la dernière version disponible
  let latestVersion = 'N/A';
  const pkgDir = path.join(BASE_DIR, 'packages');
  if (fs.existsSync(pkgDir)) {
    const versions = fs.readdirSync(pkgDir)
      .filter(d => fs.statSync(path.join(pkgDir, d)).isDirectory())
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return 0;
      });
    if (versions.length) latestVersion = versions[0];
  }

  const filesReady =
    fs.existsSync(path.join(CLIENT_DIR, 'app.py')) &&
    fs.existsSync(path.join(CERTS_DIR, 'server.crt')) &&
    fs.existsSync(path.join(KEYS_DIR, 'public.pem')) &&
    fs.existsSync(TOKENS_FILE);

  // Route : page d'accueil
  if (req.url === '/' || req.url === '/index.html') {
    const html = renderHTML(localIP, latestVersion, filesReady);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Route : téléchargement du ZIP client
  if (req.url === '/download-client') {
    if (!filesReady) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Serveur non prêt — lancez setup-keys.js et setup-certs.sh d\'abord.');
      return;
    }
    try {
      console.log(`[${new Date().toISOString()}] Téléchargement client depuis ${req.socket.remoteAddress}`);
      const zip = await buildClientZip(localIP, token);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="update-client.zip"',
        'Content-Length': zip.length,
      });
      res.end(zip);
    } catch (err) {
      console.error('Erreur génération ZIP :', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Erreur interne.');
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Page introuvable.');
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║      Site de distribution du client démarré      ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  URL locale  : http://${localIP}:${PORT}`.padEnd(51) + '║');
  console.log(`║  Token client: ${getClientToken().slice(0, 16)}…`.padEnd(51) + '║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
