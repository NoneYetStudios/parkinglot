/**
 * Parking Lot server: static game files + global leaderboard API.
 *
 * Usage: node server.js [port]
 *
 * Environment (values are never logged):
 *   PORT                    Listen port (default 8080)
 *   HOST                    Bind address (default 127.0.0.1; use 0.0.0.0 in a container)
 *   LEADERBOARD_SECRET      REQUIRED in production: random string (>= 16 chars) used to sign session tokens
 *   LEADERBOARD_DB_PATH     SQLite file path (default ./data/leaderboard.sqlite). Keep it on durable storage.
 *   ALLOWED_ORIGIN          Optional: exact origin allowed to call the API cross-origin (e.g. a separate static host)
 *   TRUST_PROXY             Set to 1 only when behind exactly one trusted reverse proxy (uses X-Forwarded-For)
 *   NODE_ENV=production     Refuses to start without LEADERBOARD_SECRET
 *
 * Only index.html, css/ and js/ are served statically; the database, server code, tests and
 * package files are never reachable over HTTP.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const PUBLIC_DIRS = ['css', 'js'];
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

export function resolvePublicFile(urlPath, root = __dirname) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  rel = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const segments = rel.split('/');
  const allowed =
    rel === 'index.html' || (segments.length >= 2 && PUBLIC_DIRS.includes(segments[0]));
  if (!allowed || segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  if (!MIME_TYPES[path.extname(abs).toLowerCase()]) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}

export async function createAppServer(options = {}) {
  const env = options.env || process.env;
  let api = null;
  let apiError = null;

  const production = env.NODE_ENV === 'production';
  let secret = env.LEADERBOARD_SECRET;
  if (!secret) {
    if (production) {
      throw new Error('LEADERBOARD_SECRET is required when NODE_ENV=production.');
    }
    secret = crypto.randomBytes(32).toString('hex');
    if (!options.quiet) {
      console.warn('[leaderboard] LEADERBOARD_SECRET not set: using a random per-process secret (dev only).');
    }
  }

  try {
    const { createLeaderboardApi } = await import('./server/leaderboard.js');
    api = createLeaderboardApi({
      dbPath: options.dbPath || env.LEADERBOARD_DB_PATH || path.join(__dirname, 'data', 'leaderboard.sqlite'),
      secret,
      now: options.now,
      rateLimits: options.rateLimits,
      allowedOrigin: env.ALLOWED_ORIGIN || null,
      trustProxy: env.TRUST_PROXY === '1'
    });
  } catch (err) {
    apiError = err;
    if (production) throw err;
    console.error('[leaderboard] API disabled:', err.message);
  }

  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname.startsWith('/api/')) {
      if (!api) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'unavailable', message: 'Leaderboard is unavailable.' } }));
        return;
      }
      await api.handle(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed');
      return;
    }
    const filePath = resolvePublicFile(pathname);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      ...SECURITY_HEADERS
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });

  server.on('close', () => api?.close());
  server.leaderboardApiError = apiError;
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const PORT = Number(process.env.PORT || process.argv[2] || 8080);
  const HOST = process.env.HOST || '127.0.0.1';
  const server = await createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`Parking Lot running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
}
