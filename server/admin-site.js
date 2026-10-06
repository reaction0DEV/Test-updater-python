/**
 * admin-site.js — Interface web d'administration
 * Port 3001 — Publier une nouvelle version en quelques clics
 *
 * Usage: node admin-site.js
 */

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const os       = require('os');

const PORT       = 3001;
const BASE_DIR   = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(BASE_DIR, 'packages');
const KEYS_DIR   = path.join(BASE_DIR, 'keys');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return '127.0.0.1';
}

function getAdminToken() {
  if (!fs.existsSync(TOKENS_FILE)) return null;
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  for (const [token, info] of Object.entries(tokens))
    if (info.admin) return token;
  return null;
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function signData(data) {
  const keyPath = path.join(KEYS_DIR, 'private.pem');
  if (!fs.existsSync(keyPath)) throw new Error('Clé privée introuvable.');
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(data));
  return sign.sign(privateKey, 'base64');
}

function getVersions() {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  return fs.readdirSync(PACKAGES_DIR)
    .filter(d => fs.statSync(path.join(PACKAGES_DIR, d)).isDirectory()
              && fs.existsSync(path.join(PACKAGES_DIR, d, 'meta.json')))
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pb[i] || 0) - (pa[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
}

function getVersionInfo(version) {
  const metaPath = path.join(PACKAGES_DIR, version, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
}

// ── Authentification simple ───────────────────────────────────────────────────
function checkAuth(req) {
  const adminToken = getAdminToken();
  if (!adminToken) return false;
  const cookie = req.headers['cookie'] || '';
  const match  = cookie.match(/admin_token=([^;]+)/);
  return match && match[1] === adminToken;
}

// ── Parsing multipart/form-data ───────────────────────────────────────────────
function parseMultipart(buffer, boundary) {
  const result = { fields: {}, files: {} };
  const sep = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;

  for (let i = 0; i < buffer.length - sep.length; i++) {
    if (buffer.slice(i, i + sep.length).equals(sep)) {
      if (start > 0) parts.push(buffer.slice(start, i - 2));
      start = i + sep.length + 2;
      i += sep.length;
    }
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const body      = part.slice(headerEnd + 4);

    const nameMatch     = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (filenameMatch) {
      result.files[name] = {
        filename: filenameMatch[1],
        data: body,
      };
    } else {
      result.fields[name] = body.toString('utf8').trim();
    }
  }
  return result;
}

// ── Page HTML d'administration ────────────────────────────────────────────────
function renderAdmin(message, messageType) {
  const versions  = getVersions();
  const localIP   = getLocalIP();
  const latest    = versions[0] || null;

  const versionRows = versions.map((v, i) => {
    const meta = getVersionInfo(v);
    const isLatest = i === 0;
    return `
    <tr>
      <td>
        <span class="version-badge ${isLatest ? 'latest' : ''}">v${v}</span>
        ${isLatest ? '<span class="tag">● ACTIF</span>' : ''}
      </td>
      <td class="mono">${meta?.filename || '—'}</td>
      <td class="mono small">${(meta?.sha256 || '').slice(0,16)}…</td>
      <td>${((meta?.size || 0)/1024).toFixed(1)} Ko</td>
      <td class="small">${(meta?.released_at || '').slice(0,10)}</td>
      <td>
        <form method="POST" action="/delete" style="display:inline"
              onsubmit="return confirm('Supprimer v${v} ?')">
          <input type="hidden" name="version" value="${v}">
          <button type="submit" class="btn-del">✕ Supprimer</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const alertHtml = message ? `
    <div class="alert ${messageType}">
      ${messageType === 'success' ? '✓' : '✕'} ${message}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Gestionnaire de mises à jour</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     background:#0f1117;color:#e2e8f0;min-height:100vh}

/* Header */
.header{background:#1a1f2e;border-bottom:1px solid #2d3748;
        padding:0 32px;display:flex;align-items:center;
        justify-content:space-between;height:56px}
.header h1{font-size:16px;font-weight:700;color:#e2e8f0}
.header h1 span{color:#f6ad55}
.badge-admin{background:#744210;color:#f6ad55;font-size:11px;
             font-weight:700;padding:3px 10px;border-radius:20px;
             letter-spacing:.5px}
.server-info{color:#718096;font-size:12px}

/* Layout */
.container{max-width:960px;margin:0 auto;padding:32px 24px}

/* Alert */
.alert{padding:12px 18px;border-radius:8px;margin-bottom:24px;
       font-weight:600;font-size:14px}
.alert.success{background:#1a3d2b;color:#68d391;border:1px solid #276749}
.alert.error  {background:#3d1a1a;color:#fc8181;border:1px solid #822727}

/* Cards */
.card{background:#1a1f2e;border:1px solid #2d3748;border-radius:12px;
      margin-bottom:24px;overflow:hidden}
.card-header{padding:16px 24px;border-bottom:1px solid #2d3748;
             display:flex;align-items:center;gap:10px}
.card-header h2{font-size:15px;font-weight:700;color:#e2e8f0}
.card-header .icon{font-size:18px}
.card-body{padding:24px}

/* Form */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.form-group{display:flex;flex-direction:column;gap:6px}
.form-group.full{grid-column:1/-1}
label{font-size:12px;font-weight:600;color:#a0aec0;text-transform:uppercase;
      letter-spacing:.5px}
input[type=text],textarea{background:#0f1117;border:1px solid #2d3748;
  border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:14px;
  font-family:inherit;transition:border .2s;width:100%}
input[type=text]:focus,textarea:focus{outline:none;border-color:#185FA5}
textarea{resize:vertical;min-height:80px;font-family:inherit}

/* Upload zone */
.upload-zone{border:2px dashed #2d3748;border-radius:10px;
             padding:32px;text-align:center;cursor:pointer;
             transition:border .2s,background .2s;position:relative}
.upload-zone:hover,.upload-zone.drag{border-color:#185FA5;
             background:rgba(24,95,165,.08)}
.upload-zone input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.upload-zone .icon{font-size:32px;margin-bottom:8px}
.upload-zone p{color:#718096;font-size:14px}
.upload-zone .filename{color:#7EB8F7;font-weight:600;margin-top:6px;
                       font-size:13px;display:none}

/* Buttons */
.btn-primary{background:#185FA5;color:#fff;border:none;border-radius:8px;
             padding:12px 28px;font-size:14px;font-weight:700;cursor:pointer;
             transition:background .2s;width:100%;margin-top:8px}
.btn-primary:hover{background:#1a6fc4}
.btn-del{background:transparent;color:#718096;border:1px solid #2d3748;
         border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;
         transition:all .2s}
.btn-del:hover{background:#3d1a1a;color:#fc8181;border-color:#822727}

/* Table */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 14px;color:#718096;font-size:11px;
   font-weight:600;text-transform:uppercase;letter-spacing:.5px;
   border-bottom:1px solid #2d3748}
td{padding:12px 14px;border-bottom:1px solid #1a1f2e;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.version-badge{background:#1e3a5f;color:#7EB8F7;padding:3px 10px;
               border-radius:20px;font-weight:700;font-size:12px}
.version-badge.latest{background:#1a3d2b;color:#68d391}
.tag{background:#744210;color:#f6ad55;font-size:10px;font-weight:700;
     padding:2px 7px;border-radius:10px;margin-left:6px}
.mono{font-family:monospace;font-size:12px;color:#a0aec0}
.small{font-size:12px;color:#718096}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
.stat{background:#1a1f2e;border:1px solid #2d3748;border-radius:10px;
      padding:16px 20px}
.stat-val{font-size:28px;font-weight:700;color:#7EB8F7;margin-bottom:2px}
.stat-lbl{font-size:12px;color:#718096}

/* Dot statut */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;
     background:#48bb78;margin-right:6px;box-shadow:0 0 6px #48bb78}

@media(max-width:640px){
  .form-grid{grid-template-columns:1fr}
  .stats{grid-template-columns:1fr 1fr}
}
</style>
</head>
<body>

<div class="header">
  <h1>🛠 Admin <span>Mises à jour</span></h1>
  <div style="display:flex;align-items:center;gap:16px">
    <span class="server-info">
      <span class="dot"></span>${localIP}:3001
    </span>
    <span class="badge-admin">ADMIN</span>
    <a href="/logout" style="color:#718096;font-size:12px;text-decoration:none">
      Déconnexion
    </a>
  </div>
</div>

<div class="container">

  ${alertHtml}

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-val">${versions.length}</div>
      <div class="stat-lbl">Versions publiées</div>
    </div>
    <div class="stat">
      <div class="stat-val">${latest ? 'v' + latest : '—'}</div>
      <div class="stat-lbl">Version active</div>
    </div>
    <div class="stat">
      <div class="stat-val">${latest ? ((getVersionInfo(latest)?.size || 0)/1024).toFixed(0) + ' Ko' : '—'}</div>
      <div class="stat-lbl">Taille dernière version</div>
    </div>
  </div>

  <!-- Publier une nouvelle version -->
  <div class="card">
    <div class="card-header">
      <span class="icon">🚀</span>
      <h2>Publier une nouvelle version</h2>
    </div>
    <div class="card-body">
      <form method="POST" action="/publish" enctype="multipart/form-data">
        <div class="form-grid">

          <div class="form-group">
            <label>Numéro de version</label>
            <input type="text" name="version" placeholder="ex: 1.3" required
                   pattern="[0-9]+\\.[0-9]+(\\.[0-9]+)?"
                   title="Format : 1.0 ou 1.0.0">
          </div>

          <div class="form-group">
            <label>Nom du fichier affiché</label>
            <input type="text" name="display_name" placeholder="ex: MonApp v1.3 (optionnel)">
          </div>

          <div class="form-group full">
            <label>Changelog (une nouveauté par ligne)</label>
            <textarea name="changelog" placeholder="Nouvelle fonctionnalité X&#10;Correction du bug Y&#10;Amélioration des performances"></textarea>
          </div>

          <div class="form-group full">
            <label>Fichier à distribuer (.py, .zip, .exe…)</label>
            <div class="upload-zone" id="dropzone">
              <input type="file" name="package" required id="fileInput"
                     accept=".py,.zip,.exe,.tar.gz">
              <div class="icon">📦</div>
              <p>Glissez votre fichier ici ou cliquez pour choisir</p>
              <p class="filename" id="fname"></p>
            </div>
          </div>

        </div>
        <button type="submit" class="btn-primary">
          🚀 Publier la version
        </button>
      </form>
    </div>
  </div>

  <!-- Versions publiées -->
  <div class="card">
    <div class="card-header">
      <span class="icon">📋</span>
      <h2>Versions publiées</h2>
    </div>
    <div class="card-body" style="padding:0">
      ${versions.length === 0
        ? '<p style="padding:24px;color:#718096;text-align:center">Aucune version publiée.</p>'
        : `<table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Fichier</th>
                <th>SHA-256</th>
                <th>Taille</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>${versionRows}</tbody>
           </table>`
      }
    </div>
  </div>

  <!-- Liens rapides -->
  <div class="card">
    <div class="card-header">
      <span class="icon">🔗</span>
      <h2>Liens rapides</h2>
    </div>
    <div class="card-body">
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <a href="http://${localIP}:3000" target="_blank"
           style="color:#7EB8F7;font-size:13px">
          🌐 Site de téléchargement (:3000)
        </a>
        <a href="https://${localIP}:8443/health" target="_blank"
           style="color:#7EB8F7;font-size:13px">
          ⚡ API serveur (:8443)
        </a>
        <a href="https://${localIP}:8443/api/manifest" target="_blank"
           style="color:#7EB8F7;font-size:13px">
          📄 Manifeste actuel
        </a>
      </div>
    </div>
  </div>

</div>

<script>
// Affiche le nom du fichier sélectionné
document.getElementById('fileInput').addEventListener('change', function() {
  const fname = this.files[0]?.name || '';
  const el = document.getElementById('fname');
  el.textContent = '📦 ' + fname;
  el.style.display = fname ? 'block' : 'none';
});

// Drag & drop visuel
const zone = document.getElementById('dropzone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
zone.addEventListener('drop', e => { zone.classList.remove('drag'); });
</script>
</body>
</html>`;
}

// ── Page de login ─────────────────────────────────────────────────────────────
function renderLogin(error) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Admin — Connexion</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     background:#0f1117;color:#e2e8f0;min-height:100vh;
     display:flex;align-items:center;justify-content:center}
.card{background:#1a1f2e;border:1px solid #2d3748;border-radius:14px;
      padding:40px;width:360px;text-align:center}
h1{font-size:20px;margin-bottom:4px}
p{color:#718096;font-size:13px;margin-bottom:24px}
label{display:block;text-align:left;font-size:11px;font-weight:600;
      color:#a0aec0;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;background:#0f1117;border:1px solid #2d3748;border-radius:8px;
      padding:11px 14px;color:#e2e8f0;font-size:14px;font-family:monospace}
input:focus{outline:none;border-color:#185FA5}
.btn{width:100%;background:#185FA5;color:#fff;border:none;border-radius:8px;
     padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:16px}
.btn:hover{background:#1a6fc4}
.error{background:#3d1a1a;color:#fc8181;border-radius:6px;
       padding:10px;font-size:13px;margin-bottom:16px}
</style>
</head>
<body>
<div class="card">
  <div style="font-size:36px;margin-bottom:12px">🔐</div>
  <h1>Administration</h1>
  <p>Entrez votre token admin pour accéder</p>
  ${error ? `<div class="error">✕ Token incorrect</div>` : ''}
  <form method="POST" action="/login">
    <label>Token admin</label>
    <input type="password" name="token" placeholder="Collez votre token ici" autofocus>
    <button type="submit" class="btn">Connexion →</button>
  </form>
</div>
</body>
</html>`;
}

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // ── GET / → page admin ou login ──────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/') {
    if (!checkAuth(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderLogin());
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderAdmin());
  }

  // ── GET /logout ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/logout') {
    res.writeHead(302, {
      'Set-Cookie': 'admin_token=; Max-Age=0; Path=/',
      'Location': '/'
    });
    return res.end();
  }

  // Collecte le body pour les POST
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    body = Buffer.concat(body);

    // ── POST /login ─────────────────────────────────────────────────────────
    if (req.method === 'POST' && req.url === '/login') {
      const params = new URLSearchParams(body.toString());
      const token  = params.get('token')?.trim();
      const admin  = getAdminToken();

      if (token === admin) {
        res.writeHead(302, {
          'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly`,
          'Location': '/'
        });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderLogin(true));
    }

    // ── Vérifie l'auth pour les routes suivantes ─────────────────────────
    if (!checkAuth(req)) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }

    // ── POST /publish — Publie une nouvelle version ──────────────────────
    if (req.method === 'POST' && req.url === '/publish') {
      try {
        const ct       = req.headers['content-type'] || '';
        const boundaryMatch = ct.match(/boundary=(.+)$/);
        if (!boundaryMatch) throw new Error('Formulaire invalide.');

        const parsed   = parseMultipart(body, boundaryMatch[1]);
        const version  = (parsed.fields.version || '').trim();
        const changelog = (parsed.fields.changelog || '')
          .split('\n').map(l => l.trim()).filter(Boolean);
        const file     = parsed.files.package;

        if (!version) throw new Error('Version manquante.');
        if (!file || !file.data.length) throw new Error('Fichier manquant.');
        if (!/^\d+\.\d+(\.\d+)?$/.test(version))
          throw new Error('Format de version invalide (ex: 1.3 ou 1.3.0).');

        // Vérifie que la version n'existe pas déjà
        const versionDir = path.join(PACKAGES_DIR, version);
        if (fs.existsSync(versionDir))
          throw new Error(`La version ${version} existe déjà.`);

        // Crée le dossier et sauvegarde le fichier
        fs.mkdirSync(versionDir, { recursive: true });
        const destPath = path.join(versionDir, file.filename);
        fs.writeFileSync(destPath, file.data);

        // Calcule hash et taille
        const hash = crypto.createHash('sha256').update(file.data).digest('hex');
        const size = file.data.length;

        // Construit et signe le manifeste
        const meta = {
          filename:           file.filename,
          sha256:             hash,
          size,
          changelog:          changelog.length ? changelog : [`Version ${version}`],
          released_at:        new Date().toISOString(),
          min_client_version: '1.0',
        };
        meta.signature = signData(meta);
        fs.writeFileSync(
          path.join(versionDir, 'meta.json'),
          JSON.stringify(meta, null, 2)
        );

        console.log(`[ADMIN] Version ${version} publiée — ${file.filename} (${(size/1024).toFixed(1)} Ko)`);

        res.writeHead(302, { 'Location': '/?success=' + encodeURIComponent(
          `Version ${version} publiée avec succès ! (${(size/1024).toFixed(1)} Ko, SHA-256: ${hash.slice(0,16)}…)`
        )});
        return res.end();

      } catch (err) {
        console.error('[ADMIN] Erreur publication:', err.message);
        res.writeHead(302, { 'Location': '/?error=' + encodeURIComponent(err.message) });
        return res.end();
      }
    }

    // ── POST /delete — Supprime une version ─────────────────────────────
    if (req.method === 'POST' && req.url === '/delete') {
      try {
        const params  = new URLSearchParams(body.toString());
        const version = params.get('version')?.trim();
        if (!version) throw new Error('Version manquante.');

        const versions = getVersions();
        if (versions[0] === version)
          throw new Error('Impossible de supprimer la version active (la plus récente).');

        const versionDir = path.join(PACKAGES_DIR, version);
        if (!fs.existsSync(versionDir))
          throw new Error(`Version ${version} introuvable.`);

        fs.rmSync(versionDir, { recursive: true, force: true });
        console.log(`[ADMIN] Version ${version} supprimée.`);

        res.writeHead(302, { 'Location': '/?success=' + encodeURIComponent(
          `Version ${version} supprimée.`
        )});
        return res.end();

      } catch (err) {
        res.writeHead(302, { 'Location': '/?error=' + encodeURIComponent(err.message) });
        return res.end();
      }
    }

    // ── Gestion des messages de redirection ──────────────────────────────
    if (req.method === 'GET' && req.url.startsWith('/?')) {
      const params = new URLSearchParams(req.url.slice(2));
      const success = params.get('success');
      const error   = params.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderAdmin(
        success || error,
        success ? 'success' : 'error'
      ));
    }

    res.writeHead(404);
    res.end('Page introuvable.');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║      Interface d\'administration démarrée         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  URL : http://${localIP}:${PORT}`.padEnd(51) + '║');
  console.log('║  Token : voir server/tokens.json (admin:true)    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
