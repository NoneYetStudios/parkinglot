# Parking Lot — A Stab The Finger Game

A Minesweeper-style parking deduction game featuring variable lot geometries, realistic walking-distance trade-offs, difficulty modifiers (*Cart Chaos*, *Bad Parkers*, *Goose Patrol*), local personal records, and a server-backed **Global Leaderboard**.

## Requirements

- **Node.js `>= 22.13.0`** (uses built-in `node:sqlite`, `node:http`, and `node:crypto` — zero external npm dependencies required).

## Quick Start

```bash
# Start the local game & leaderboard server (default: http://127.0.0.1:8080)
npm start
```

### Production Configuration

Set `NODE_ENV=production` and provide a strong `LEADERBOARD_SECRET` (at least 16 characters) along with a persistent path for `LEADERBOARD_DB_PATH`:

```bash
export NODE_ENV=production
export PORT=8080
export HOST=0.0.0.0
export LEADERBOARD_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export LEADERBOARD_DB_PATH="/var/lib/parkinglot/leaderboard.sqlite"

npm start
```

See [`docs/LEADERBOARD.md`](docs/LEADERBOARD.md) for full details on architecture, database schema, migrations, backups, security headers, and anti-cheat design.

## Running Tests

```bash
# Run puzzle generator/solver tests + 48 leaderboard API tests + 10 auto-submit preference tests
npm test

# Run only the auto-submit preference test suite
npm run test:pref

# Run only the leaderboard API & security tests
npm run test:leaderboard

# Run headless Chrome E2E tests (both gameplay and leaderboard UI suites)
npm run test:e2e
```
