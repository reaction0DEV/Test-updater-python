/**
 * Serveur de mises à jour sécurisé — Node.js
 * Debian/Linux
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  PORT: 8443,
  HOST: '0.0.0.0',
  PACKAGES_DIR: path.join(__dirname, '..', 'packages'),
  KEYS_DIR: path.join(__dirname, '..', 'keys'),
  CERTS_DIR: path.join(__dirname, '..', 'certs'),
  LOG_FILE: path.join(__dirname, 'audit.log'),
  TOKENS_FILE: path.join(__dirname, 'tokens.json'),
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 min
  RATE_LIMIT_MAX: 30,
};

// ─── Logger ───────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: CONFIG.LOG_FILE }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ─── App Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Rate limiting global
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW,
  max: CONFIG.RATE_LIMIT_MAX,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' }
});
app.use(limiter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Charge les tokens valides depuis tokens.json
 */
function loadTokens() {
  if (!fs.existsSync(CONFIG.TOKENS_FILE)) return {};
  return JSON.parse(fs.readFileSync(CONFIG.TOKENS_FILE, 'utf8'));
}

/**
 * Middleware d'authentification Bearer
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Tentative sans token', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const token = authHeader.slice(7);
  const tokens = loadTokens();
  if (!tokens[token]) {
    logger.warn('Token invalide', { ip: req.ip, token: token.slice(0, 8) + '…' });
    return res.status(403).json({ error: 'Token invalide.' });
  }
  req.clientName = tokens[token].name;
  next();
}

/**
 * Calcule le SHA-256 d'un fichier
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Signe un objet JSON avec la clé privée RSA
 */
function signData(data) {
  const keyPath = path.join(CONFIG.KEYS_DIR, 'private.pem');
  if (!fs.existsSync(keyPath)) {
    throw new Error('Clé privée introuvable. Lancez setup-keys.js d\'abord.');
  }
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const sign = crypto.createSign('SHA256');
  sign.update(JSON.stringify(data));
  return sign.sign(privateKey, 'base64');
}

/**
 * Retourne la liste des versions disponibles triée
 */
function getVersions() {
  if (!fs.existsSync(CONFIG.PACKAGES_DIR)) return [];
  return fs.readdirSync(CONFIG.PACKAGES_DIR)
    .filter(d => fs.statSync(path.join(CONFIG.PACKAGES_DIR, d)).isDirectory())
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
}

/**
 * Construit le manifeste pour une version donnée
 */
function buildManifest(version) {
  const versionDir = path.join(CONFIG.PACKAGES_DIR, version);
  const metaPath = path.join(versionDir, 'meta.json');

  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta.json introuvable pour la version ${version}`);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const packageFile = path.join(versionDir, meta.filename);

  if (!fs.existsSync(packageFile)) {
    throw new Error(`Fichier paquet introuvable: ${meta.filename}`);
  }

  const hash = sha256File(packageFile);
  const size = fs.statSync(packageFile).size;

  const manifest = {
    version,
    filename: meta.filename,
    sha256: hash,
    size,
    changelog: meta.changelog || [],
    released_at: meta.released_at || new Date().toISOString(),
    min_client_version: meta.min_client_version || '1.0.0',
  };

  manifest.signature = signData(manifest);
  return manifest;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Santé du serveur (sans auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manifeste de la dernière version
app.get('/api/manifest', authMiddleware, (req, res) => {
  try {
    const versions = getVersions();
    if (versions.length === 0) {
      return res.status(404).json({ error: 'Aucun paquet disponible.' });
    }
    const latest = versions[0];
    const manifest = buildManifest(latest);

    logger.info('Manifeste consulté', {
      client: req.clientName,
      ip: req.ip,
      version: latest
    });

    res.json(manifest);
  } catch (err) {
    logger.error('Erreur manifeste', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Manifeste d'une version spécifique
app.get('/api/manifest/:version', authMiddleware, (req, res) => {
  try {
    const manifest = buildManifest(req.params.version);
    logger.info('Manifeste version spécifique', {
      client: req.clientName,
      ip: req.ip,
      version: req.params.version
    });
    res.json(manifest);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Liste de toutes les versions
app.get('/api/versions', authMiddleware, (req, res) => {
  const versions = getVersions();
  logger.info('Liste des versions consultée', { client: req.clientName, ip: req.ip });
  res.json({ versions });
});

// Téléchargement d'un paquet
app.get('/api/download/:version/:filename', authMiddleware, (req, res) => {
  const { version, filename } = req.params;

  // Sécurité : empêcher path traversal
  const safeVersion = path.basename(version);
  const safeFilename = path.basename(filename);
  const filePath = path.join(CONFIG.PACKAGES_DIR, safeVersion, safeFilename);

  if (!filePath.startsWith(CONFIG.PACKAGES_DIR)) {
    return res.status(400).json({ error: 'Chemin invalide.' });
  }

  if (!fs.existsSync(filePath)) {
    logger.warn('Fichier introuvable', { client: req.clientName, version, filename });
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }

  const fileSize = fs.statSync(filePath).size;
  logger.info('Téléchargement démarré', {
    client: req.clientName,
    ip: req.ip,
    version,
    filename,
    size: fileSize
  });

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', fileSize);
  res.setHeader('X-File-Hash', sha256File(filePath));

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  stream.on('end', () => {
    logger.info('Téléchargement terminé', { client: req.clientName, version, filename });
  });
});

// Logs d'audit (admin)
app.get('/api/admin/logs', authMiddleware, (req, res) => {
  const tokens = loadTokens();
  const token = req.headers['authorization'].slice(7);
  if (!tokens[token]?.admin) {
    return res.status(403).json({ error: 'Accès admin requis.' });
  }

  if (!fs.existsSync(CONFIG.LOG_FILE)) {
    return res.json({ logs: [] });
  }

  const lines = fs.readFileSync(CONFIG.LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-100)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  res.json({ logs: lines });
});

// ─── Démarrage HTTPS ──────────────────────────────────────────────────────────
const certPath = path.join(CONFIG.CERTS_DIR, 'server.crt');
const keyPath  = path.join(CONFIG.CERTS_DIR, 'server.key');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  logger.error('Certificats SSL introuvables. Lancez setup-certs.sh d\'abord.');
  process.exit(1);
}

const httpsOptions = {
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
};

https.createServer(httpsOptions, app).listen(CONFIG.PORT, CONFIG.HOST, () => {
  logger.info(`Serveur de mises à jour démarré sur https://${CONFIG.HOST}:${CONFIG.PORT}`);
  logger.info(`Packages disponibles: ${getVersions().join(', ') || 'aucun'}`);
});
