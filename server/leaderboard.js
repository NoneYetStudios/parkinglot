/**
 * Parking Lot - Global Leaderboard API (zero npm dependencies).
 *
 * Storage: SQLite via Node's built-in `node:sqlite` (Node >= 22.13 without flags).
 * All SQL uses bound parameters; the only SQL text assembled at runtime is chosen from
 * a fixed set of static fragments (never from user input).
 *
 * Endpoints (all JSON):
 *   POST /api/sessions     { lotId, modifiers[] }          -> { token, expiresAt }
 *   POST /api/scores       { token, nickname, ... score }  -> 201 { entry, ranks }
 *   GET  /api/leaderboard  ?lot=&mods=&limit=&offset=      -> { entries[], total, ... }
 *   GET  /api/health                                       -> { ok: true }
 *
 * Anti-cheat (honest summary): see docs/LEADERBOARD.md. The server re-computes the score from
 * claimed components with the same rules the client uses and checks a server-issued, HMAC-signed,
 * single-use session token for lot/modifier match and wall-clock plausibility. It cannot verify
 * that the client's claimed quality tier / outcome actually occurred in a real game.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { LOTS, MODIFIERS, QUALITY_TIERS, ACCIDENT_OUTCOMES } from '../js/config.js';
import { recomputeFinalScore } from '../js/scoring.js';
import { validateNickname } from '../js/leaderboard.js';
export { validateNickname };

export const LIMITS = {
  MAX_BODY_BYTES: 2048,
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 16,
  MAX_ELAPSED_SECONDS: 7200,
  TOKEN_TTL_MS: 3 * 60 * 60 * 1000,
  MIN_RUN_WALL_MS: 2000, // a real run cannot finish faster than this after the token was issued
  ELAPSED_SLACK_MS: 5000, // token is requested asynchronously just after the in-game timer starts
  PAGE_SIZE_DEFAULT: 25,
  PAGE_SIZE_MAX: 50,
  MAX_OFFSET: 10000
};

export const RATE_LIMITS = {
  sessions: { max: 20, windowMs: 60_000 },
  submit: { max: 6, windowMs: 60_000 },
  read: { max: 120, windowMs: 60_000 }
};

const ALLOWED_MODIFIER_IDS = Object.values(MODIFIERS)
  .filter((m) => !m.isBaseline)
  .map((m) => m.id)
  .sort();

const SUBMIT_FIELDS = new Set([
  'token',
  'nickname',
  'lotId',
  'modifiers',
  'qualityId',
  'outcomeId',
  'unlocatedHazards',
  'elapsedSeconds',
  'score'
]);

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Returns canonical comma-joined modifier key ('' for Standard) or null if invalid. */
export function canonicalModifiers(mods) {
  if (!Array.isArray(mods) || mods.length > ALLOWED_MODIFIER_IDS.length) return null;
  const seen = new Set();
  for (const m of mods) {
    if (typeof m !== 'string' || !ALLOWED_MODIFIER_IDS.includes(m) || seen.has(m)) return null;
    seen.add(m);
  }
  return [...seen].sort().join(',');
}

export function allModifierKeys() {
  const keys = [''];
  const n = ALLOWED_MODIFIER_IDS.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    keys.push(ALLOWED_MODIFIER_IDS.filter((_, i) => mask & (1 << i)).join(','));
  }
  return keys;
}



/* ------------------------------------------------------------------ */
/* Stateless signed session tokens                                     */
/* ------------------------------------------------------------------ */

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function createTokenSigner(secret, now = () => Date.now()) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest();
  return {
    issue(lotId, modsKey) {
      const payload = {
        v: 1,
        n: crypto.randomBytes(16).toString('hex'),
        l: lotId,
        m: modsKey,
        t: now()
      };
      const body = b64u(JSON.stringify(payload));
      return { token: `${body}.${b64u(sign(body))}`, expiresAt: payload.t + LIMITS.TOKEN_TTL_MS };
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 400) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [body, sig] = parts;
      let given;
      try {
        given = Buffer.from(sig, 'base64url');
      } catch {
        return null;
      }
      const expected = sign(body);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (p.v !== 1 || typeof p.n !== 'string' || typeof p.t !== 'number') return null;
        return p;
      } catch {
        return null;
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Rate limiter (in-memory fixed window; keys are never persisted)     */
/* ------------------------------------------------------------------ */

export function createRateLimiter(limits, now = () => Date.now()) {
  const buckets = new Map();
  return {
    /** Returns { allowed, retryAfterSec } */
    hit(kind, key) {
      const cfg = limits[kind];
      const t = now();
      if (buckets.size > 10000) {
        for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
      }
      const id = `${kind}|${key}`;
      let b = buckets.get(id);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + cfg.windowMs };
        buckets.set(id, b);
      }
      b.count += 1;
      return { allowed: b.count <= cfg.max, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
    }
  };
}

/* ------------------------------------------------------------------ */
/* SQLite store                                                        */
/* ------------------------------------------------------------------ */

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE scores (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id            TEXT    NOT NULL UNIQUE,
        nickname              TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 64),
        score                 INTEGER NOT NULL CHECK (score BETWEEN 50 AND 100000),
        lot_id                TEXT    NOT NULL CHECK (lot_id IN (${Object.keys(LOTS).map((k) => `'${k}'`).join(',')})),
        modifiers             TEXT    NOT NULL,
        difficulty_multiplier REAL    NOT NULL CHECK (difficulty_multiplier > 0),
        elapsed_seconds       INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 0 AND ${LIMITS.MAX_ELAPSED_SECONDS}),
        created_at            INTEGER NOT NULL
      );
      CREATE INDEX idx_scores_rank         ON scores (score DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_lot_rank     ON scores (lot_id, score DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_mods_rank    ON scores (modifiers, score DESC, created_at ASC, id ASC);
      CREATE INDEX idx_scores_lot_mods_rank ON scores (lot_id, modifiers, score DESC, created_at ASC, id ASC);
    `
  }
];

// Static WHERE fragments. Runtime selection is by which filters are present, never by user text.
const WHERE = {
  none: '',
  lot: 'WHERE lot_id = ?',
  mods: 'WHERE modifiers = ?',
  both: 'WHERE lot_id = ? AND modifiers = ?'
};
const RANK_COND = '(score > ? OR (score = ? AND created_at < ?) OR (score = ? AND created_at = ? AND id < ?))';

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function filterParts(filter) {
  const hasLot = Boolean(filter.lot);
  const hasMods = filter.mods !== null && filter.mods !== undefined;
  const key = hasLot && hasMods ? 'both' : hasLot ? 'lot' : hasMods ? 'mods' : 'none';
  const params = [];
  if (hasLot) params.push(filter.lot);
  if (hasMods) params.push(filter.mods);
  return { where: WHERE[key], params };
}

export function createStore(db) {
  const insertStmt = db.prepare(
    `INSERT INTO scores (session_id, nickname, score, lot_id, modifiers, difficulty_multiplier, elapsed_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function count(filter) {
    const { where, params } = filterParts(filter);
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM scores ${where}`).get(...params).n);
  }

  function rankOf(row, filter) {
    const { where, params } = filterParts(filter);
    const joiner = where ? `${where} AND` : 'WHERE';
    const sql = `SELECT COUNT(*) AS n FROM scores ${joiner} ${RANK_COND}`;
    const n = Number(
      db.prepare(sql).get(...params, row.score, row.score, row.created_at, row.score, row.created_at, row.id).n
    );
    return n + 1;
  }

  const toEntry = (r) => ({
    nickname: r.nickname,
    score: r.score,
    lotId: r.lot_id,
    modifiers: r.modifiers === '' ? [] : r.modifiers.split(','),
    difficultyMultiplier: r.difficulty_multiplier,
    elapsedSeconds: r.elapsed_seconds,
    createdAt: r.created_at
  });

  return {
    /** Inserts inside an immediate transaction. Throws ApiError(409) on duplicate session. */
    insertScore(rec) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let info;
        try {
          info = insertStmt.run(
            rec.sessionId,
            rec.nickname,
            rec.score,
            rec.lotId,
            rec.modifiers,
            rec.difficultyMultiplier,
            rec.elapsedSeconds,
            rec.createdAt
          );
        } catch (err) {
          if (/UNIQUE/i.test(String(err.message))) {
            throw new ApiError(409, 'duplicate', 'This game has already been submitted.');
          }
          throw err;
        }
        const row = {
          id: Number(info.lastInsertRowid),
          score: rec.score,
          created_at: rec.createdAt,
          nickname: rec.nickname,
          lot_id: rec.lotId,
          modifiers: rec.modifiers,
          difficulty_multiplier: rec.difficultyMultiplier,
          elapsed_seconds: rec.elapsedSeconds
        };
        const ranks = {
          global: rankOf(row, {}),
          lot: rankOf(row, { lot: rec.lotId }),
          category: rankOf(row, { lot: rec.lotId, mods: rec.modifiers })
        };
        db.exec('COMMIT');
        return { entry: toEntry(row), ranks };
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    },

    list(filter, limit, offset) {
      const { where, params } = filterParts(filter);
      const rows = db
        .prepare(
          `SELECT id, nickname, score, lot_id, modifiers, difficulty_multiplier, elapsed_seconds, created_at
           FROM scores ${where} ORDER BY score DESC, created_at ASC, id ASC LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);
      return {
        entries: rows.map((r, i) => ({ rank: offset + i + 1, ...toEntry(r) })),
        total: count(filter)
      };
    },

    count
  };
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

function clientKey(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1]; // entry appended by our own proxy
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      reject(new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.'));
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > LIMITS.MAX_BODY_BYTES) {
      reject(new ApiError(413, 'payload_too_large', 'Request body too large.'));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > LIMITS.MAX_BODY_BYTES) {
        aborted = true;
        reject(new ApiError(413, 'payload_too_large', 'Request body too large.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        resolve(parsed);
      } catch {
        reject(new ApiError(400, 'invalid_json', 'Request body must be a JSON object.'));
      }
    });
    req.on('error', () => reject(new ApiError(400, 'invalid_request', 'Request failed.')));
  });
}

function intParam(value, name, { min, max, def }) {
  if (value === null || value === undefined || value === '') return def;
  if (!/^\d{1,6}$/.test(value)) throw new ApiError(400, 'invalid_query', `Invalid "${name}".`);
  const n = Number(value);
  if (n < min || n > max) throw new ApiError(400, 'invalid_query', `"${name}" must be between ${min} and ${max}.`);
  return n;
}

/**
 * Creates the API request handler. `handle(req, res)` returns true if the request was an
 * /api/ request (and has been answered), false if the caller should serve something else.
 */
export function createLeaderboardApi({
  dbPath = ':memory:',
  secret,
  now = () => Date.now(),
  rateLimits = RATE_LIMITS,
  allowedOrigin = null,
  trustProxy = false
} = {}) {
  if (!secret || String(secret).length < 16) {
    throw new Error('LEADERBOARD_SECRET must be set to a random string of at least 16 characters.');
  }
  const db = openDatabase(dbPath);
  const store = createStore(db);
  const signer = createTokenSigner(secret, now);
  const limiter = createRateLimiter(rateLimits, now);
  const modKeys = new Set(allModifierKeys());

  function send(req, res, status, body, extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...extraHeaders
    };
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function enforce(kind, req) {
    const r = limiter.hit(kind, clientKey(req, trustProxy));
    if (!r.allowed) {
      const err = new ApiError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
      err.retryAfterSec = r.retryAfterSec;
      throw err;
    }
  }

  function parseSessionRequest(body) {
    const lotId = body.lotId;
    if (typeof lotId !== 'string' || !Object.prototype.hasOwnProperty.call(LOTS, lotId)) {
      throw new ApiError(400, 'invalid_lot', 'Unsupported lot type.');
    }
    const mods = canonicalModifiers(body.modifiers === undefined ? [] : body.modifiers);
    if (mods === null) throw new ApiError(400, 'invalid_modifiers', 'Unsupported modifiers.');
    return { lotId, mods };
  }

  async function createSession(req, res) {
    enforce('sessions', req);
    const body = await readJsonBody(req);
    const { lotId, mods } = parseSessionRequest(body);
    const { token, expiresAt } = signer.issue(lotId, mods);
    send(req, res, 201, { token, expiresAt });
  }

  async function submitScore(req, res) {
    enforce('submit', req);
    const body = await readJsonBody(req);

    for (const k of Object.keys(body)) {
      if (!SUBMIT_FIELDS.has(k)) throw new ApiError(400, 'unknown_field', `Unexpected field "${k}".`);
    }

    const claims = signer.verify(body.token);
    if (!claims) throw new ApiError(401, 'invalid_token', 'Invalid game session token.');
    const t = now();
    if (claims.t > t + 1000 || t - claims.t > LIMITS.TOKEN_TTL_MS) {
      throw new ApiError(401, 'token_expired', 'This game session has expired.');
    }

    if (typeof body.lotId !== 'string' || !Object.prototype.hasOwnProperty.call(LOTS, body.lotId)) {
      throw new ApiError(400, 'invalid_lot', 'Unsupported lot type.');
    }
    const mods = canonicalModifiers(body.modifiers);
    if (mods === null) throw new ApiError(400, 'invalid_modifiers', 'Unsupported modifiers.');
    if (body.lotId !== claims.l || mods !== claims.m) {
      throw new ApiError(422, 'session_mismatch', 'Submission does not match the game session.');
    }

    const nick = validateNickname(body.nickname);
    if (!nick.ok) throw new ApiError(422, 'invalid_nickname', nick.message);

    const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    if (!isInt(body.elapsedSeconds, 0, LIMITS.MAX_ELAPSED_SECONDS)) {
      throw new ApiError(400, 'invalid_elapsed', 'Invalid elapsed time.');
    }
    if (!isInt(body.unlocatedHazards ?? 0, 0, 8)) {
      throw new ApiError(400, 'invalid_field', 'Invalid unlocated hazard count.');
    }
    if (!isInt(body.score, 50, 100000)) {
      throw new ApiError(400, 'invalid_score', 'Score is out of range.');
    }
    if (!Object.values(QUALITY_TIERS).some((q) => q.id === body.qualityId)) {
      throw new ApiError(400, 'invalid_quality', 'Unsupported space quality.');
    }
    if (!Object.values(ACCIDENT_OUTCOMES).some((o) => o.id === body.outcomeId)) {
      throw new ApiError(400, 'invalid_outcome', 'Unsupported parking outcome.');
    }

    const recomputed = recomputeFinalScore({
      lotId: body.lotId,
      modifiers: mods === '' ? [] : mods.split(','),
      qualityId: body.qualityId,
      outcomeId: body.outcomeId,
      unlocatedHazards: body.unlocatedHazards ?? 0,
      elapsedSeconds: body.elapsedSeconds
    });
    if (!recomputed) throw new ApiError(422, 'invalid_components', 'Inconsistent score components.');
    if (recomputed.finalScore !== body.score) {
      throw new ApiError(422, 'score_mismatch', 'Score does not match the game rules for the submitted run.');
    }

    const wallMs = t - claims.t;
    if (wallMs < LIMITS.MIN_RUN_WALL_MS || body.elapsedSeconds * 1000 > wallMs + LIMITS.ELAPSED_SLACK_MS) {
      throw new ApiError(422, 'implausible_run', 'Run timing does not match the game session.');
    }

    const result = store.insertScore({
      sessionId: claims.n,
      nickname: nick.value,
      score: recomputed.finalScore,
      lotId: body.lotId,
      modifiers: mods,
      difficultyMultiplier: recomputed.difficultyMultiplier,
      elapsedSeconds: body.elapsedSeconds,
      createdAt: t
    });
    send(req, res, 201, result);
  }

  function getLeaderboard(req, res, url) {
    enforce('read', req);
    const q = url.searchParams;
    const lot = q.get('lot');
    if (lot !== null && lot !== '' && lot !== 'all' && !Object.prototype.hasOwnProperty.call(LOTS, lot)) {
      throw new ApiError(400, 'invalid_query', 'Unsupported lot filter.');
    }
    const modsParam = q.get('mods');
    let mods = null;
    if (modsParam !== null && modsParam !== 'all') {
      if (!modKeys.has(modsParam)) throw new ApiError(400, 'invalid_query', 'Unsupported difficulty filter.');
      mods = modsParam;
    }
    const limit = intParam(q.get('limit'), 'limit', { min: 1, max: LIMITS.PAGE_SIZE_MAX, def: LIMITS.PAGE_SIZE_DEFAULT });
    const offset = intParam(q.get('offset'), 'offset', { min: 0, max: LIMITS.MAX_OFFSET, def: 0 });
    const filter = { lot: lot && lot !== 'all' ? lot : null, mods };
    const { entries, total } = store.list(filter, limit, offset);
    send(req, res, 200, { entries, total, limit, offset, filter: { lot: filter.lot, mods: filter.mods } }, {
      'Cache-Control': 'public, max-age=5'
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;

    try {
      if (req.method === 'OPTIONS') {
        const headers = {};
        if (allowedOrigin && req.headers.origin === allowedOrigin) {
          headers['Access-Control-Allow-Origin'] = allowedOrigin;
          headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
          headers['Access-Control-Allow-Headers'] = 'Content-Type';
          headers['Access-Control-Max-Age'] = '600';
          headers.Vary = 'Origin';
        }
        res.writeHead(204, headers);
        res.end();
        return true;
      }

      const route = url.pathname;
      if (route === '/api/health') {
        if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        send(req, res, 200, { ok: true });
      } else if (route === '/api/leaderboard') {
        if (req.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        getLeaderboard(req, res, url);
      } else if (route === '/api/sessions') {
        if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        await createSession(req, res);
      } else if (route === '/api/scores') {
        if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
        await submitScore(req, res);
      } else {
        throw new ApiError(404, 'not_found', 'Unknown endpoint.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const extra = err.retryAfterSec ? { 'Retry-After': String(err.retryAfterSec) } : {};
        if (err.status === 405) extra.Allow = 'GET, POST, OPTIONS';
        send(req, res, err.status, { error: { code: err.code, message: err.message } }, extra);
      } else {
        console.error('Leaderboard internal error:', err?.message || err);
        send(req, res, 500, { error: { code: 'internal_error', message: 'Internal server error.' } });
      }
    }
    return true;
  }

  let closed = false;
  return {
    handle,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
    store
  };
}
