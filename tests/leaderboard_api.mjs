/**
 * Global leaderboard verification suite.
 * Exercises the SERVER directly over real HTTP (no UI), the SQLite constraints, the client module's
 * failure handling, and an end-to-end flow through ParkingLotState.
 *
 * Run: node tests/leaderboard_api.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { LOTS } from '../js/config.js';
import { recomputeFinalScore } from '../js/scoring.js';
import { createAppServer, resolvePublicFile } from '../server.js';
import {
  openDatabase,
  migrate,
  createStore,
  createTokenSigner,
  validateNickname,
  canonicalModifiers,
  LIMITS
} from '../server/leaderboard.js';

const results = { passed: 0, failed: 0, failures: [] };
async function check(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ name, message: err.message });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}
const section = (t) => console.log(`\n=== ${t} ===`);

/* ---------- harness ---------- */
const SECRET = 'test-secret-0123456789abcdef';
const BIG_LIMITS = {
  sessions: { max: 100000, windowMs: 60000 },
  submit: { max: 100000, windowMs: 60000 },
  read: { max: 100000, windowMs: 60000 }
};

async function startServer({ rateLimits = BIG_LIMITS, clock = { offset: 0 }, env = {} } = {}) {
  const server = await createAppServer({
    dbPath: ':memory:',
    quiet: true,
    now: () => Date.now() + clock.offset,
    rateLimits: rateLimits === 'default' ? undefined : rateLimits,
    env: { LEADERBOARD_SECRET: SECRET, ...env }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((r) => server.close(r));
  return { server, base, clock, stop };
}

async function api(base, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}

async function newToken(ctx, lotId = 'dollar', modifiers = []) {
  const r = await api(ctx.base, 'POST', '/api/sessions', { lotId, modifiers });
  assert.equal(r.status, 201, `session issue failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

function buildPayload(token, over = {}) {
  const comp = {
    lotId: 'dollar',
    modifiers: [],
    qualityId: 'EXCELLENT',
    outcomeId: 'CLEAN',
    unlocatedHazards: 0,
    elapsedSeconds: 20,
    ...over
  };
  const rc = recomputeFinalScore(comp);
  return { token, nickname: 'Tester', ...comp, score: rc.finalScore, ...over.__extra };
}

/** Issue token, advance the server clock, submit. */
async function submitRun(ctx, over = {}, { wait = 30_000, lot = 'dollar', mods = [] } = {}) {
  const token = await newToken(ctx, lot, mods);
  ctx.clock.offset += wait;
  const payload = buildPayload(token, { lotId: lot, modifiers: mods, ...over });
  return api(ctx.base, 'POST', '/api/scores', payload);
}

/* ======================================================================= */
section('1. Schema, migrations & database-level constraints');
{
  await check('migration is idempotent and creates ranking indexes', () => {
    const db = openDatabase(':memory:');
    migrate(db); // second run must be a no-op
    migrate(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_scores_%'").all();
    assert.equal(idx.length, 4);
    db.close();
  });
  await check('database CHECK constraints reject impossible rows even if the API were bypassed', () => {
    const db = openDatabase(':memory:');
    const ins = db.prepare(
      'INSERT INTO scores (session_id,nickname,score,lot_id,modifiers,difficulty_multiplier,elapsed_seconds,created_at) VALUES (?,?,?,?,?,?,?,?)'
    );
    assert.throws(() => ins.run('a', 'ok', 5, 'dollar', '', 1, 10, 1), /CHECK/i); // score too low
    assert.throws(() => ins.run('b', 'ok', 500, 'nolot', '', 1, 10, 1), /CHECK/i); // bad lot
    assert.throws(() => ins.run('c', '', 500, 'dollar', '', 1, 10, 1), /CHECK/i); // empty nickname
    assert.throws(() => ins.run('d', 'ok', 500, 'dollar', '', 1, -1, 1), /CHECK/i); // negative time
    ins.run('e', 'ok', 500, 'dollar', '', 1, 10, 1);
    assert.throws(() => ins.run('e', 'ok', 600, 'dollar', '', 1, 10, 2), /UNIQUE/i); // duplicate session
    db.close();
  });
}

/* ======================================================================= */
section('2. Pure validation helpers');
{
  await check('nickname: trims, collapses spaces, accepts unicode letters', () => {
    assert.deepEqual(validateNickname('  Park   Master  '), { ok: true, value: 'Park Master' });
    assert.equal(validateNickname('Zoë_99').ok, true);
  });
  await check('nickname: rejects empty, too long, HTML, SQL metacharacters, control chars, non-strings', () => {
    for (const bad of ['', '   ', 'x'.repeat(17), '<script>alert(1)</script>', "Robert'); DROP TABLE scores;--", 'a\u0000b', 'a\nb', '\u200bzero', '😀😀', 12, null, {}, ['a']]) {
      assert.equal(validateNickname(bad).ok, false, `should reject ${JSON.stringify(bad)}`);
    }
  });
  await check('canonicalModifiers: sorts, dedupes-by-rejection, rejects unknown', () => {
    assert.equal(canonicalModifiers([]), '');
    assert.equal(canonicalModifiers(['goose', 'carts']), 'carts,goose');
    assert.equal(canonicalModifiers(['carts', 'carts']), null);
    assert.equal(canonicalModifiers(['standard']), null);
    assert.equal(canonicalModifiers(['hacks']), null);
    assert.equal(canonicalModifiers('carts'), null);
  });
  await check('recomputeFinalScore matches game scoring for a known run', () => {
    // dollar x1.0, EXCELLENT 1.35, <=14s => 1.35 => round(1000*1.35*1.0*1.35)=1823 ; CLEAN no penalty
    const r = recomputeFinalScore({ lotId: 'dollar', modifiers: [], qualityId: 'EXCELLENT', outcomeId: 'CLEAN', elapsedSeconds: 10 });
    assert.equal(r.finalScore, 1823);
    assert.equal(recomputeFinalScore({ lotId: 'dollar', qualityId: 'NOPE', outcomeId: 'CLEAN', elapsedSeconds: 1 }), null);
  });
}

/* ======================================================================= */
section('3. Valid submissions, duplicates & session-token checks (HTTP)');
{
  const ctx = await startServer();
  await check('health endpoint', async () => {
    const r = await api(ctx.base, 'GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });
  let firstToken;
  await check('valid submission is accepted and returns entry + ranks', async () => {
    firstToken = await newToken(ctx);
    ctx.clock.offset += 30_000;
    const r = await api(ctx.base, 'POST', '/api/scores', buildPayload(firstToken, { nickname: '  Valid  Player ' }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.entry.nickname, 'Valid Player');
    assert.equal(r.json.entry.lotId, 'dollar');
    assert.deepEqual(r.json.ranks, { global: 1, lot: 1, category: 1 });
  });
  await check('duplicate submission of the same game is rejected with 409 and stored once', async () => {
    const r = await api(ctx.base, 'POST', '/api/scores', buildPayload(firstToken));
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'duplicate');
    const list = await api(ctx.base, 'GET', '/api/leaderboard');
    assert.equal(list.json.total, 1);
  });
  await check('modifier order is canonicalised (goose,carts == carts,goose)', async () => {
    const r = await submitRun(ctx, { modifiers: ['goose', 'carts'] }, { mods: ['carts', 'goose'] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.entry.modifiers, ['carts', 'goose']);
  });
  await check('forged / tampered / foreign-secret tokens are rejected (401)', async () => {
    const good = await newToken(ctx);
    ctx.clock.offset += 30_000;
    const [body, sig] = good.split('.');
    const forged = [
      `${body}.${sig.slice(0, -2)}AA`,
      `${Buffer.from(JSON.stringify({ v: 1, n: 'x', l: 'stadium', m: '', t: Date.now() })).toString('base64url')}.${sig}`,
      'garbage',
      '',
      createTokenSigner('another-secret-0123456789', () => Date.now() + ctx.clock.offset - 30_000).issue('dollar', '').token
    ];
    for (const t of forged) {
      const r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t));
      assert.equal(r.status, 401, `token ${t.slice(0, 20)} -> ${r.status}`);
    }
    const missing = buildPayload(good);
    delete missing.token;
    assert.equal((await api(ctx.base, 'POST', '/api/scores', missing)).status, 401);
  });
  await check('expired token is rejected', async () => {
    const t = await newToken(ctx);
    ctx.clock.offset += LIMITS.TOKEN_TTL_MS + 60_000;
    const r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t));
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, 'token_expired');
  });
  await check('submission must match the lot/modifiers the session was issued for', async () => {
    const t = await newToken(ctx, 'dollar', []);
    ctx.clock.offset += 30_000;
    let r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t, { lotId: 'stadium' }));
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'session_mismatch');
    r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t, { modifiers: ['goose'] }));
    assert.equal(r.status, 422);
  });
  await check('timing: too-fast submissions and elapsed > wall-clock are rejected', async () => {
    const t1 = await newToken(ctx);
    let r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t1)); // submitted immediately
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'implausible_run');
    const t2 = await newToken(ctx);
    ctx.clock.offset += 10_000;
    r = await api(ctx.base, 'POST', '/api/scores', buildPayload(t2, { elapsedSeconds: 600 })); // claims 10 min after 10s
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'implausible_run');
  });
  await ctx.stop();
}

/* ======================================================================= */
section('4. Invalid scores, nicknames, payloads, lots, modifiers (HTTP)');
{
  const ctx = await startServer();
  const submitWith = async (mutate, { lot = 'dollar', mods = [] } = {}) => {
    const t = await newToken(ctx, lot, mods);
    ctx.clock.offset += 30_000;
    const p = buildPayload(t, { lotId: lot, modifiers: mods });
    mutate(p);
    return api(ctx.base, 'POST', '/api/scores', p);
  };

  await check('score not matching the game rules for the claimed run → 422 score_mismatch', async () => {
    const r = await submitWith((p) => (p.score += 1));
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'score_mismatch');
  });
  await check('inflated components (claims PREMIUM score with EXCELLENT tier) → mismatch', async () => {
    const r = await submitWith((p) => (p.score = 9999));
    assert.equal(r.status, 422);
  });
  await check('out-of-range / wrong-type scores → 400', async () => {
    for (const bad of [-1, 0, 49, 100001, 1e12, 1.5, '1500', null, NaN, Infinity, [1500], { a: 1 }]) {
      const r = await submitWith((p) => (p.score = bad));
      assert.equal(r.status, 400, `score ${JSON.stringify(bad)} -> ${r.status}`);
    }
  });
  await check('invalid elapsedSeconds (negative, fractional, huge, string) → 400', async () => {
    for (const bad of [-5, 2.5, 99999, '20', null]) {
      const r = await submitWith((p) => (p.elapsedSeconds = bad));
      assert.equal(r.status, 400, `elapsed ${JSON.stringify(bad)} -> ${r.status}`);
    }
  });
  await check('invalid nicknames → 422 with a helpful message', async () => {
    for (const bad of ['', '   ', 'x'.repeat(40), '<img src=x onerror=alert(1)>', "x'; DROP TABLE scores;--", 'bad\u0007name']) {
      const r = await submitWith((p) => (p.nickname = bad));
      assert.equal(r.status, 422, `nickname ${JSON.stringify(bad)} -> ${r.status}`);
      assert.equal(r.json.error.code, 'invalid_nickname');
      assert.ok(r.json.error.message.length > 5);
    }
    const r = await submitWith((p) => (p.nickname = 12345));
    assert.equal(r.status, 422);
  });
  await check('unsupported lot types → 400 (session and submit)', async () => {
    for (const bad of ['nolot', '', "dollar' OR 1=1", '__proto__', 'constructor', 7, null]) {
      const s = await api(ctx.base, 'POST', '/api/sessions', { lotId: bad, modifiers: [] });
      assert.equal(s.status, 400, `session lot ${JSON.stringify(bad)} -> ${s.status}`);
    }
    const r = await submitWith((p) => (p.lotId = 'nolot'));
    assert.equal(r.status, 400);
  });
  await check('unsupported / duplicate / malformed modifiers → 400', async () => {
    for (const bad of [['hacks'], ['carts', 'carts'], 'carts', [1], ['standard'], null, { 0: 'carts' }]) {
      const s = await api(ctx.base, 'POST', '/api/sessions', { lotId: 'dollar', modifiers: bad });
      assert.equal(s.status, 400, `modifiers ${JSON.stringify(bad)} -> ${s.status}`);
    }
  });
  await check('unsupported quality tier / outcome → 400', async () => {
    assert.equal((await submitWith((p) => (p.qualityId = 'GODLIKE'))).status, 400);
    assert.equal((await submitWith((p) => (p.outcomeId = 'FLAWLESS_PLUS'))).status, 400);
  });
  await check('unlocatedHazards only valid with AWKWARD outcome; AWKWARD penalty is verified', async () => {
    assert.equal((await submitWith((p) => (p.unlocatedHazards = 2))).status, 422); // CLEAN with hazards
    const t = await newToken(ctx);
    ctx.clock.offset += 30_000;
    const p = buildPayload(t, { outcomeId: 'AWKWARD', unlocatedHazards: 2 });
    assert.equal((await api(ctx.base, 'POST', '/api/scores', p)).status, 201);
  });
  await check('unknown fields (client-chosen rank / id / created_at / user_id) → 400', async () => {
    for (const extra of ['rank', 'id', 'createdAt', 'created_at', 'userId', 'session_id', '__proto__']) {
      const t = await newToken(ctx);
      ctx.clock.offset += 30_000;
      const p = buildPayload(t);
      Object.defineProperty(p, extra, { value: 1, enumerable: true });
      const r = await api(ctx.base, 'POST', '/api/scores', JSON.stringify(p));
      assert.equal(r.status, 400, `extra ${extra} -> ${r.status}`);
    }
  });
  await check('oversized body (declared length) → 413', async () => {
    const r = await api(ctx.base, 'POST', '/api/scores', { token: 'x', nickname: 'y'.repeat(5000) });
    assert.equal(r.status, 413);
  });
  await check('oversized body (chunked, no content-length) → 413', async () => {
    const status = await new Promise((resolve, reject) => {
      const u = new URL(ctx.base + '/api/scores');
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
      req.write('{"token":"');
      req.write('a'.repeat(4000));
      req.end('"}');
    });
    assert.equal(status, 413);
  });
  await check('non-JSON content type → 415; malformed / non-object JSON → 400', async () => {
    assert.equal((await api(ctx.base, 'POST', '/api/scores', 'hello', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await api(ctx.base, 'POST', '/api/scores', '{not json')).status, 400);
    assert.equal((await api(ctx.base, 'POST', '/api/scores', '[1,2,3]')).status, 400);
    assert.equal((await api(ctx.base, 'POST', '/api/scores', 'null')).status, 400);
  });
  await check('SQL injection attempts are inert; table is intact afterwards', async () => {
    const before = (await api(ctx.base, 'GET', '/api/leaderboard')).json.total;
    const r = await submitWith((p) => (p.nickname = "'); DELETE FROM scores;--"));
    assert.equal(r.status, 422);
    for (const q of ["lot=dollar' OR '1'='1", "mods=x' OR 1=1--", 'limit=1;DROP TABLE scores', 'offset=0 UNION SELECT 1']) {
      const g = await api(ctx.base, 'GET', `/api/leaderboard?${encodeURIComponent(q.split('=')[0])}=${encodeURIComponent(q.split('=').slice(1).join('='))}`);
      assert.equal(g.status, 400, `${q} -> ${g.status}`);
    }
    assert.equal((await api(ctx.base, 'GET', '/api/leaderboard')).json.total, before);
  });
  await ctx.stop();
}

/* ======================================================================= */
section('5. Leaderboard sorting, ties, filtering & pagination');
{
  const ctx = await startServer();
  const db = openDatabase(':memory:'); // direct store (deterministic seeding of timestamps)
  const store = createStore(db);
  const mk = (i, over) => ({
    sessionId: `s${i}`,
    nickname: `P${i}`,
    score: 1000,
    lotId: 'dollar',
    modifiers: '',
    difficultyMultiplier: 1,
    elapsedSeconds: 20,
    createdAt: 1_000_000 + i,
    ...over
  });

  await check('ordering: score DESC, then earlier created_at, then lower id (deterministic tie-breaker)', () => {
    store.insertScore(mk(1, { score: 900 }));
    store.insertScore(mk(2, { score: 1500 }));
    store.insertScore(mk(3, { score: 1500, createdAt: 1_000_002 })); // same score & same ms as #2 -> id decides
    store.insertScore(mk(4, { score: 1500, createdAt: 999_000 })); // same score, earlier -> first
    const { entries } = store.list({}, 10, 0);
    assert.deepEqual(entries.map((e) => e.nickname), ['P4', 'P2', 'P3', 'P1']);
    assert.deepEqual(entries.map((e) => e.rank), [1, 2, 3, 4]);
  });
  await check('rank returned on insert agrees with list position, including ties', () => {
    const r = store.insertScore(mk(5, { score: 1500, createdAt: 1_000_002 }));
    assert.equal(r.ranks.global, 4); // after P4,P2,P3 (same score+ms, lower ids)
    const { entries } = store.list({}, 10, 0);
    assert.equal(entries[3].nickname, 'P5');
  });
  await check('filters: lot, modifiers, and combined; totals are filter-specific', () => {
    store.insertScore(mk(10, { lotId: 'strip', modifiers: 'carts', score: 2000 }));
    store.insertScore(mk(11, { lotId: 'strip', modifiers: '', score: 1800 }));
    store.insertScore(mk(12, { lotId: 'mall', modifiers: 'carts,goose', score: 3000 }));
    assert.equal(store.list({ lot: 'strip' }, 50, 0).total, 2);
    assert.equal(store.list({ mods: 'carts' }, 50, 0).total, 1);
    assert.equal(store.list({ mods: '' }, 50, 0).total, 6); // standard runs: P1-P5 + strip standard
    assert.equal(store.list({ lot: 'strip', mods: '' }, 50, 0).entries[0].nickname, 'P11');
    assert.equal(store.list({}, 1, 0).entries[0].nickname, 'P12');
  });
  await check('pagination: bounded pages, no overlap, ranks continue across pages', () => {
    for (let i = 100; i < 160; i++) store.insertScore(mk(i, { score: 2000 + (i % 7) * 10, lotId: 'stadium' }));
    const p1 = store.list({ lot: 'stadium' }, 25, 0);
    const p2 = store.list({ lot: 'stadium' }, 25, 25);
    const p3 = store.list({ lot: 'stadium' }, 25, 50);
    assert.equal(p1.total, 60);
    assert.equal(p1.entries.length, 25);
    assert.equal(p3.entries.length, 10);
    assert.equal(p2.entries[0].rank, 26);
    const names = new Set([...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.nickname));
    assert.equal(names.size, 60);
    const scores = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
  db.close();

  await check('HTTP: limit/offset bounds enforced; default page size applies; empty result handled', async () => {
    const empty = await api(ctx.base, 'GET', '/api/leaderboard?lot=mall');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.entries, []);
    assert.equal(empty.json.total, 0);
    assert.equal(empty.json.limit, 25);
    for (const q of ['limit=0', 'limit=51', 'limit=-1', 'limit=abc', 'offset=-1', 'offset=10001', 'offset=1.5', 'limit=999999999999', 'lot=nolot', 'mods=carts,carts', 'mods=bogus']) {
      const r = await api(ctx.base, 'GET', `/api/leaderboard?${q}`);
      assert.equal(r.status, 400, `${q} -> ${r.status}`);
    }
  });
  await check('HTTP: end-to-end ordering of real submissions + modifier filter', async () => {
    assert.equal((await submitRun(ctx, { qualityId: 'ACCEPTABLE', elapsedSeconds: 10 })).status, 201);
    assert.equal((await submitRun(ctx, { qualityId: 'PREMIUM', elapsedSeconds: 10 })).status, 201);
    assert.equal((await submitRun(ctx, { qualityId: 'PREMIUM', elapsedSeconds: 10 }, { lot: 'strip', mods: ['goose'] })).status, 201);
    const all = (await api(ctx.base, 'GET', '/api/leaderboard')).json;
    assert.equal(all.total, 3);
    assert.deepEqual(all.entries.map((e) => e.rank), [1, 2, 3]);
    assert.ok(all.entries[0].score >= all.entries[1].score && all.entries[1].score >= all.entries[2].score);
    const g = (await api(ctx.base, 'GET', '/api/leaderboard?mods=goose')).json;
    assert.equal(g.total, 1);
    assert.deepEqual(g.entries[0].modifiers, ['goose']);
    assert.equal(g.entries[0].lotId, 'strip');
  });
  await ctx.stop();
}

/* ======================================================================= */
section('6. Permission boundaries: no public write/delete, no file or DB exposure');
{
  const ctx = await startServer();
  await check('no update/delete routes exist (405 for PUT/PATCH/DELETE; GET on write endpoints)', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/scores', '/api/scores/1', '/api/leaderboard', '/api/sessions']) {
        const r = await api(ctx.base, method, path, method === 'DELETE' ? undefined : {});
        assert.ok([404, 405].includes(r.status), `${method} ${path} -> ${r.status}`);
      }
    }
    assert.equal((await api(ctx.base, 'GET', '/api/scores')).status, 405);
    assert.equal((await api(ctx.base, 'GET', '/api/sessions')).status, 405);
    assert.equal((await api(ctx.base, 'POST', '/api/leaderboard', {})).status, 405);
    assert.equal((await api(ctx.base, 'GET', '/api/nope')).status, 404);
  });
  await check('a score cannot be overwritten or inserted without a valid session (no token → rejected)', async () => {
    const r = await api(ctx.base, 'POST', '/api/scores', { nickname: 'Hacker', lotId: 'dollar', modifiers: [], score: 100000 });
    assert.ok([400, 401].includes(r.status));
    assert.equal((await api(ctx.base, 'GET', '/api/leaderboard')).json.total, 0);
  });
  await check('static server never exposes the database, server code, tests, package files or dotfiles', async () => {
    for (const p of [
      '/data/leaderboard.sqlite', '/data/leaderboard.sqlite-wal', '/leaderboard.sqlite', '/server/leaderboard.js', '/server.js',
      '/package.json', '/tests/leaderboard_api.mjs', '/README.md', '/.git/config', '/.env', '/js/../server.js',
      '/%2e%2e/server.js', '/js/%2e%2e/package.json', '/js%5C..%5Cserver.js', '/js/', '/css', '/js/.hidden'
    ]) {
      const res = await fetch(ctx.base + p);
      assert.equal(res.status, 404, `${p} -> ${res.status}`);
      await res.arrayBuffer();
    }
  });
  await check('game files are still served (index.html, css, js) with security headers', async () => {
    for (const p of ['/', '/index.html', '/css/style.css', '/js/main.js', '/js/leaderboard.js']) {
      const res = await fetch(ctx.base + p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      await res.arrayBuffer();
    }
    assert.ok(resolvePublicFile('/js/config.js'));
    assert.equal(resolvePublicFile('/data/x.js'), null);
  });
  await check('CORS is closed by default (no Allow-Origin header for foreign origins)', async () => {
    const r = await fetch(ctx.base + '/api/leaderboard', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    await r.arrayBuffer();
  });
  await check('production mode refuses to start without LEADERBOARD_SECRET', async () => {
    await assert.rejects(() => createAppServer({ dbPath: ':memory:', quiet: true, env: { NODE_ENV: 'production' } }), /LEADERBOARD_SECRET/);
    await assert.rejects(() => createAppServer({ dbPath: ':memory:', quiet: true, env: { NODE_ENV: 'production', LEADERBOARD_SECRET: 'short' } }));
  });
  await ctx.stop();
}

/* ======================================================================= */
section('7. Rate limiting');
{
  await check('score submissions are rate limited per client (429 + Retry-After), reads and sessions have own budgets', async () => {
    const ctx = await startServer({ rateLimits: 'default' }); // production defaults
    const statuses = [];
    let last;
    for (let i = 0; i < 8; i++) {
      last = await api(ctx.base, 'POST', '/api/scores', { token: 'x' });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses.slice(0, 6), [401, 401, 401, 401, 401, 401]);
    assert.deepEqual(statuses.slice(6), [429, 429]);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
    assert.equal(last.json.error.code, 'rate_limited');
    // sessions budget is separate and still available
    assert.equal((await api(ctx.base, 'POST', '/api/sessions', { lotId: 'dollar', modifiers: [] })).status, 201);
    await ctx.stop();
  });
  await check('session issuing and leaderboard reads are rate limited too; window resets', async () => {
    const clock = { offset: 0 };
    const ctx = await startServer({
      rateLimits: { sessions: { max: 2, windowMs: 60000 }, submit: { max: 6, windowMs: 60000 }, read: { max: 3, windowMs: 60000 } },
      clock
    });
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await api(ctx.base, 'POST', '/api/sessions', { lotId: 'dollar', modifiers: [] })).status);
    assert.deepEqual(s, [201, 201, 429]);
    const g = [];
    for (let i = 0; i < 4; i++) g.push((await api(ctx.base, 'GET', '/api/leaderboard')).status);
    assert.deepEqual(g, [200, 200, 200, 429]);
    clock.offset += 61_000;
    assert.equal((await api(ctx.base, 'GET', '/api/leaderboard')).status, 200);
    await ctx.stop();
  });
}

/* ======================================================================= */
section('8. Client resilience: backend unavailable, local records & gameplay unaffected');
{
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    matchMedia: () => ({ matches: true })
  };
  const lb = await import('../js/leaderboard.js');
  const { ParkingLotState, GAME_PHASES } = await import('../js/state.js');
  const { CELL_TYPES } = await import('../js/config.js');
  const { solveBoardLogically } = await import('../js/generator.js');
  const { loadRecords } = await import('../js/storage.js');

  async function playOneRound(state) {
    state.selectLot('dollar');
    state.startRound();
    const solved = solveBoardLogically(state.board.grid, state.getLot());
    for (let r = 0; r < state.board.rows; r++)
      for (let c = 0; c < state.board.cols; c++) if (solved.deducedHazard[r][c]) state.toggleFlag(r, c);
    let best = null;
    for (const row of state.board.grid)
      for (const cell of row)
        if (solved.deducedSafe[cell.r][cell.c] && cell.type === CELL_TYPES.SAFE && (!best || cell.qualityScore > best.qualityScore)) best = cell;
    state.inspectOrSelectSpace(best.r, best.c);
    state.commitToSpace(best.r, best.c, { instant: true });
  }

  await check('no fetch available → client reports offline; game works; submit is a safe no-op', async () => {
    delete globalThis.window.fetch;
    assert.equal((await lb.fetchLeaderboard()).ok, false);
    assert.equal(await lb.createSession('dollar', []), null);
    const state = new ParkingLotState();
    await playOneRound(state);
    assert.equal(state.phase, GAME_PHASES.RESULTS);
    assert.equal(state.sessionStatus, 'unavailable');
    assert.equal(state.canSubmitGlobally(), false);
    assert.equal(await state.submitToLeaderboard('Nick'), null);
    assert.equal(loadRecords().overall.gamesPlayed, 1); // local records still updated
  });
  await check('network failure (fetch rejects) → graceful { ok:false }, never throws', async () => {
    globalThis.window.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const res = await lb.fetchLeaderboard();
    assert.equal(res.ok, false);
    assert.equal(res.code, 'network_error');
    assert.equal(await lb.createSession('dollar', []), null);
    const sub = await lb.submitScore({});
    assert.equal(sub.ok, false);
  });
  await check('non-JSON error page / 500 from backend handled gracefully', async () => {
    globalThis.window.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    const res = await lb.fetchLeaderboard();
    assert.equal(res.ok, false);
    assert.equal(res.status, 502);
  });
  await check('server unreachable at submit time → status "error", retry allowed, local records intact', async () => {
    const live = await startServer();
    globalThis.window.fetch = globalThis.fetch;
    globalThis.window.PARKINGLOT_API_BASE = live.base;
    const state = new ParkingLotState();
    await playOneRound(state);
    for (let i = 0; i < 50 && state.sessionStatus === 'pending'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(state.sessionStatus, 'ready');
    live.clock.offset += 30_000;
    await live.stop(); // backend goes away
    const res = await state.submitToLeaderboard('Offline Ollie');
    assert.equal(res.ok, false);
    assert.equal(state.submission.status, 'error');
    assert.ok(state.submission.message.length > 0);
    assert.equal(state.canSubmitGlobally(), true); // can retry later
    assert.ok(loadRecords().overall.gamesPlayed >= 2);
  });
  await check('full flow through ParkingLotState: submit once, repeat clicks create no duplicates, local records preserved', async () => {
    const clock = { offset: 0 };
    const live = await startServer({ clock });
    globalThis.window.fetch = globalThis.fetch;
    globalThis.window.PARKINGLOT_API_BASE = live.base;
    const state = new ParkingLotState();
    const played = loadRecords().overall.gamesPlayed;
    await playOneRound(state);
    for (let i = 0; i < 50 && state.sessionStatus === 'pending'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(state.canSubmitGlobally(), true);
    clock.offset += 30_000; // simulate real play time server-side
    const [a, b, c] = await Promise.all([
      state.submitToLeaderboard('Flow Tester'),
      state.submitToLeaderboard('Flow Tester'),
      state.submitToLeaderboard('Flow Tester')
    ]);
    assert.ok(a && a.ok, JSON.stringify(a));
    assert.equal(b, null);
    assert.equal(c, null); // concurrent repeat clicks never produce extra requests
    assert.equal(state.submission.status, 'done');
    assert.equal(await state.submitToLeaderboard('Flow Tester'), null); // later clicks ignored
    const list = await api(live.base, 'GET', '/api/leaderboard');
    assert.equal(list.json.total, 1);
    assert.equal(list.json.entries[0].nickname, 'Flow Tester');
    assert.equal(list.json.entries[0].score, state.roundResult.finalScore);
    assert.equal(loadRecords().overall.gamesPlayed, played + 1);
    assert.equal(window.localStorage.getItem(lb.NICKNAME_KEY), 'Flow Tester');
    await live.stop();
  });
  await check('invalid nickname via the client path surfaces the server message and allows correction', async () => {
    const clock = { offset: 0 };
    const live = await startServer({ clock });
    globalThis.window.fetch = globalThis.fetch;
    globalThis.window.PARKINGLOT_API_BASE = live.base;
    const state = new ParkingLotState();
    await playOneRound(state);
    for (let i = 0; i < 50 && state.sessionStatus === 'pending'; i++) await new Promise((r) => setTimeout(r, 20));
    clock.offset += 30_000;
    const bad = await state.submitToLeaderboard('<b>x</b>');
    assert.equal(bad.ok, false);
    assert.equal(state.submission.status, 'error');
    assert.match(state.submission.message, /letters|Nickname/i);
    const good = await state.submitToLeaderboard('Fixed Name');
    assert.equal(good.ok, true);
    await live.stop();
  });
}

/* ======================================================================= */
console.log(`\nLeaderboard tests: ${results.passed} passed, ${results.failed} failed`);
if (results.failed) {
  for (const f of results.failures) console.log(` - ${f.name}: ${f.message}`);
  process.exit(1);
}
console.log('ALL LEADERBOARD TESTS PASSED');
process.exit(0);
