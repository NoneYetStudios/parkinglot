# Global Leaderboard Architecture & Operations Guide

This document describes the server-backed Global Leaderboard implementation for **Parking Lot**, including its architecture, database schema, security & anti-cheat model, environment configuration, backup procedures, and verification commands.

---

## 1. Architecture & Data Flow

Parking Lot is a zero-dependency ES module application running on Node.js (`>= 22.13.0`). To avoid introducing third-party native dependencies or cloud vendor lock-in while providing durable ACID storage, the backend uses Node's built-in **`node:sqlite` (`DatabaseSync`)** module in Write-Ahead Logging (`WAL`) mode paired with Node's built-in `node:http` and `node:crypto` modules.

### End-to-End Flow

1. **Session Issuance (`POST /api/sessions`)**
   - When a player starts a round (`ParkingLotState.startNewLot()`), the browser client (`js/leaderboard.js`) asynchronously requests a signed game session token for the selected `{ lotId, modifiers }`.
   - If the server is unreachable (e.g., offline or static preview), the game continues seamlessly using local records (`localStorage`).
   - The server generates a random 128-bit hex `sessionId` (`crypto.randomBytes(16)`), records `issuedAtMs = Date.now()`, canonicalizes the modifiers, and signs the payload `{ sid, lot, mods, iat, exp }` using **HMAC-SHA256** (`server/leaderboard.js`).
2. **Gameplay & Score Snapshot (`js/state.js`)**
   - When the player commits to a parking stall (`commitToSelected()`), the game records a tamper-evident snapshot of the completed run (`lastRunSubmissionSnapshot`) containing the discrete scoring inputs (`lotId, modifiers, qualityId, outcomeId, unlocatedHazards, elapsedSeconds`) and the server-issued `sessionToken`.
   - Local records (`js/storage.js`) are updated immediately and independently of the global leaderboard.
3. **Score Verification & Submission (`POST /api/scores`)**
   - **Manual Submission (Default):** On the Results screen (`SCREEN 3`), when automatic submission is OFF, the player may enter or review their nickname and click **Submit Score**.
   - **Automatic Submission (Opt-in):** Players can toggle **"Automatically submit scores to global leaderboard"** on the main menu, in the global leaderboard modal, or directly on the results screen.
     - Defaults to **OFF** for first-time and existing players.
     - Persists in `localStorage` under `stabthefinger_parkinglot_v1_auto_submit` (alongside `stabthefinger_parkinglot_v1_nickname`).
     - When opted in, completing a round with a committed parking stall automatically reads and validates the saved nickname, and submits the score through the existing HMAC session-token mechanism.
     - If the nickname is invalid or missing, submission is skipped and the player is prompted without blocking gameplay.
     - If the server or network is unreachable, the score remains safely recorded in Local Records and a non-intrusive notification is shown.
   - The server verifies:
     - Payload size (`<= 2048` bytes) and `Content-Type: application/json`.
     - Rate limit budget for the client IP.
     - HMAC-SHA256 signature and expiration (`TTL = 2 hours`) of `sessionToken`.
     - Exact match between token `{ lot, mods }` and submitted `{ lotId, modifiers }`.
     - Wall-clock plausibility: `wallMs >= 2000ms` (minimum human round duration) and `elapsedSeconds * 1000 <= wallMs + 5000ms` (prevents submitting a fast `elapsedSeconds` time bonus after spending much less wall time, or forging negative/impossible times).
     - Exact score recomputation via `recomputeFinalScore()` (`js/scoring.js`), shared between client and server. Any mismatch between the client's claimed `score` and the server's recomputed score is rejected with `422 SCORE_MISMATCH`.
     - One-time session consumption: `session_id` has a `UNIQUE` constraint in SQLite; re-submitting the same completed round returns `409 DUPLICATE_SUBMISSION`.
   - Inside a `BEGIN IMMEDIATE` transaction, the server inserts the verified row and computes the player's exact 1-based rank (`rank`) and category total (`totalInScope`).
4. **Leaderboard Querying (`GET /api/leaderboard`)**
   - Supports filtering by `lot` (`all` or a specific lot ID) and `mods` (`all`, `standard`, `any_mods`, or an exact canonical modifier key like `BAD_PARKERS+CART_CHAOS`).
   - Uses bounded pagination (`limit` 1–50, default 20; `offset` 0–10,000).
   - Optionally accepts `highlightId` to compute and return the specific entry's rank even if it falls outside the current page.

---

## 2. Database Schema & Migrations

The SQLite database is managed automatically on server startup by `runMigrations(db)` in [`server/leaderboard.js`](../server/leaderboard.js). Applied migrations are tracked in the `schema_migrations` table inside acid transactions.

### `scores` Table Schema (Migration `1_initial_leaderboard_schema`)

```sql
CREATE TABLE IF NOT EXISTS scores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT    NOT NULL UNIQUE,
    nickname          TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 16),
    score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5000),
    lot_id            TEXT    NOT NULL CHECK (lot_id IN ('DOLLAR_STORE','GROCERY_STORE','BIG_BOX_STORE','THE_MALL','STADIUM')),
    modifiers_key     TEXT    NOT NULL DEFAULT 'NONE',
    modifiers_count   INTEGER NOT NULL DEFAULT 0 CHECK (modifiers_count BETWEEN 0 AND 3),
    quality_id        TEXT    NOT NULL CHECK (quality_id IN ('PREMIUM','DECENT','TERRIBLE')),
    outcome_id        TEXT    NOT NULL CHECK (outcome_id IN ('CLEAN','MINOR_DING','MAJOR_DAMAGE','TOWED')),
    unlocated_hazards INTEGER NOT NULL DEFAULT 0 CHECK (unlocated_hazards BETWEEN 0 AND 60),
    elapsed_seconds   INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 0 AND 86400),
    duration_ms       INTEGER NOT NULL CHECK (duration_ms >= 2000),
    created_at         TEXT   NOT NULL
);
```

### Deterministic Tie-Breaking & Indexes

Scores are ordered deterministically across all queries and rank calculations:
1. Higher score first (`score DESC`)
2. Earlier timestamp wins ties (`created_at ASC`)
3. Lower autoincrement ID breaks exact millisecond ties (`id ASC`)

Four composite indexes back every filter mode without full-table scans:
- `idx_scores_global_rank ON scores (score DESC, created_at ASC, id ASC)`
- `idx_scores_lot_rank ON scores (lot_id, score DESC, created_at ASC, id ASC)`
- `idx_scores_lot_mods_rank ON scores (lot_id, modifiers_key, score DESC, created_at ASC, id ASC)`
- `idx_scores_mods_count_rank ON scores (modifiers_count, score DESC, created_at ASC, id ASC)`

---

## 3. Security & Honest Anti-Cheat Assessment

### What Is Prevented
- **Arbitrary Score Forgery:** A player cannot simply `POST { score: 999999 }`. The server recomputes the exact score from `(lotId, modifiers, qualityId, outcomeId, unlocatedHazards, elapsedSeconds)` using [`recomputeFinalScore`](../js/scoring.js) and enforces the theoretical maximum (`<= 5000`).
- **Cross-Category / Modifier Spoofing:** The HMAC-SHA256 `sessionToken` binds `lotId` and `modifiers` at round start. A player cannot play on Dollar Store and submit the token as Stadium + 3 Modifiers.
- **Instant / Fabricated Timestamps:** The server compares `Date.now() - token.iat` against both a minimum human duration (`2000ms`) and the claimed `elapsedSeconds`, preventing 0-second bots or fake time bonuses that exceed actual wall-clock play time.
- **Replay & Duplicate Submissions:** Every token carries a 128-bit `session_id` stored with a `UNIQUE` constraint in SQLite. Once submitted, the token cannot be reused.
- **SQL Injection & XSS:** All SQL queries use prepared statements with bound parameters (`?`). Nicknames are NFKC-normalized, stripped of control characters and HTML/SQL metacharacters (`< > & " ' ; -- /* */`), restricted to `1..16` characters, and rendered exclusively via `textContent` under a strict `Content-Security-Policy`.
- **Database / File Exposure:** [`server.js`](../server.js) uses an explicit allowlist (`resolvePublicFile`) that serves only `/index.html`, `/css/*`, and `/js/*`. Requests for `/data/leaderboard.sqlite`, `/server.js`, `/.env`, or `/package.json` return `404 Not Found`.
- **Abuse / Flooding:** Per-IP fixed-window rate limiters restrict `POST /api/scores` (15/min), `POST /api/sessions` (40/min), and `GET /api/leaderboard` (120/min), and bodies over 2 KB are immediately terminated (`413 Payload Too Large`).

### Known Limitation (Client-Side Board Generation)
Because Parking Lot generates its board layout and resolves cell clicks in the browser (`js/board.js`, `js/state.js`), a determined user who inspects the JavaScript can wait 3+ seconds after obtaining a valid session token and submit fabricated component inputs (e.g., `qualityId: 'PREMIUM'`, `outcomeId: 'CLEAN'`, `unlocatedHazards: 0`) that match the recomputed formula for that lot and modifier set.

Eliminating client-side component fabrication entirely would require moving board generation, seed storage, and every cell-inspection click to the server (stateful server-authoritative Minesweeper). For this lightweight browser game, HMAC session binding + wall-clock verification + exact server-side formula recomputation provides a proportionate defense without breaking offline play or rewriting the game engine.

---

## 4. Environment Variables & Configuration

Configure the server via environment variables (never commit real secrets to git):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker/cloud containers) |
| `NODE_ENV` | `development` | Set to `production` in live deployments (requires `LEADERBOARD_SECRET`) |
| `LEADERBOARD_SECRET` | *(ephemeral in dev)* | **Required in production.** Secret string (`>= 16` chars) used for HMAC-SHA256 session tokens. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `LEADERBOARD_DB_PATH` | `./data/leaderboard.sqlite` | Path to the SQLite database file (`:memory:` supported for ephemeral tests) |
| `ALLOWED_ORIGIN` | *(same-origin)* | Optional CORS `Access-Control-Allow-Origin` header if hosting frontend on a separate domain |
| `TRUST_PROXY` | `false` | Set to `true` or `1` when behind a trusted reverse proxy (Nginx, Cloudflare, Fly.io, Render) so rate limiting uses `X-Forwarded-For` |

---

## 5. Deployment & Persistent Storage Notes

1. **Persistent Volume Required:** Because SQLite stores data on disk (`LEADERBOARD_DB_PATH`), deploy the Node process onto a host with persistent storage:
   - **VPS / VM (Ubuntu, Debian, EC2, DigitalOcean):** Store the database in `/var/lib/parkinglot/leaderboard.sqlite` and run under `systemd` or `pm2`.
   - **PaaS with Persistent Disks (Fly.io Volumes, Render Disks, Railway Volumes):** Mount a persistent volume (e.g., `/data`) and set `LEADERBOARD_DB_PATH=/data/leaderboard.sqlite`.
   - **Warning on Ephemeral Filesystems:** Do **not** point `LEADERBOARD_DB_PATH` at an ephemeral container filesystem (such as unmounted Heroku dynos or serverless lambdas), as scores will reset on container restart.
2. **Online Backups (WAL-Safe):**
   Because the database runs in `WAL` mode, always back up using SQLite's online backup command or `VACUUM INTO` rather than copying only the `.sqlite` file while writes are active:
   ```bash
   node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.LEADERBOARD_DB_PATH || './data/leaderboard.sqlite'); db.exec(\"VACUUM INTO './data/leaderboard-backup.sqlite'\"); db.close();"
   ```

---

## 6. Verification & Production Smoke Tests

### Automated Test Suites
```bash
# Run core puzzle verification + 48 API/security tests + 10 auto-submit preference tests
npm test

# Run only the auto-submit preference unit/integration test suite
npm run test:pref

# Run only the leaderboard API & anti-cheat test suite
npm run test:leaderboard

# Run headless Chrome E2E tests (gameplay + leaderboard UI + auto-submit E2E)
npm run test:e2e
```

### Live Endpoint Smoke Tests (`curl`)
```bash
# 1. Health check
curl -s http://127.0.0.1:8080/api/health

# 2. Fetch global top 20
curl -s "http://127.0.0.1:8080/api/leaderboard?lot=all&mods=all&limit=20&offset=0"

# 3. Verify database files are never exposed publicly (expects HTTP 404)
curl -i http://127.0.0.1:8080/data/leaderboard.sqlite
```
