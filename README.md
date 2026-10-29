# Parking Lot — A Stab The Finger Game

A Minesweeper-style parking deduction and time-management comedy game. Inspect stalls, use trouble clues to dodge stray carts, bad parkers, and **The Goose**, and decide whether to take an acceptable spot now or keep hunting for front-row glory before you lose your patience.

Playable online at [parkinglot.stabthefinger.com](https://parkinglot.stabthefinger.com/).

---

## Game Highlights & Features

- **Minesweeper-Style Trouble Clues**: Every inspected stall displays the exact count (`0`–`8`) of adjacent Trouble Stalls (Loose Carts, The Goose, Eternal Reverse Drivers, Mystery Stains, Encroaching Bad Parkers, and Concrete Pillars).
- **Flag Hazard Mode**: Flag stalls you deduce to contain hazards (`⚠️`) to safely evaluate maneuvers into adjacent open spaces without risking collisions.
- **Space Quality Star Rating System**:
  - **★★★★★ Excellent (Gold)** — Prime front-row spots near entrances (1.65× score multiplier).
  - **★★★★☆ Great (Green)** — High-convenience spots with minimal walk (1.35× score multiplier).
  - **★★★☆☆ Good (Cyan)** — Solid, dependable middle-class parking (1.05× score multiplier).
  - **★★☆☆☆ Tight (Orange)** — Safe and legal, but requires a hike or tight clearance squeeze (0.80× score multiplier).
  - **★☆☆☆☆ Risky (Red)** — Distant or unfortunate stalls far from entrances (0.55× score multiplier).
  - Unfilled stars are styled in dim grey (`rgba(255, 255, 255, 0.15)`) for clean visual contrast.
- **Variable Lot Geometries**:
  - **Dollar Store** (5×6, Single Top Entrance)
  - **Strip Mall** (6×7, Multi-Door Arcade)
  - **The Mall** (7×8, Split North/South Entrances)
  - **Stadium / Event** (9×10, 90 stalls with multi-gate perimeter access)
- **Difficulty Modifiers**: *Cart Chaos*, *Bad Parkers*, and *Goose Patrol* for custom risk and score multipliers.
- **Streamlined Results Screen**: Score Calculation Breakdown and Round Summary cards with action buttons (**Park Again**, **Change Lot**, **Main Menu**) placed right below the cards for fast replayability.
- **Dual Leaderboard Architecture**:
  - **Local Records**: Completely private, persistent local personal bests tracked in `localStorage`.
  - **Global Leaderboard**: Secure, server-backed global high scores with anti-cheat formula verification, HMAC-SHA256 session tokens, optional automatic score submission, and ACID SQLite WAL storage.
- **Zero External Dependencies**: Pure ES modules running entirely on standard Web APIs and Node.js built-ins (`node:sqlite`, `node:http`, `node:crypto`).

---

## Requirements

- **Node.js `>= 22.13.0`** (uses built-in `node:sqlite`, `node:http`, and `node:crypto` — no `npm install` needed).
- Modern web browser (Chrome, Firefox, Safari, Edge) with ES modules and SVG support.

---

## Quick Start (Local Development)

```bash
# Start the local game & leaderboard server (default: http://127.0.0.1:8080)
npm start
```

Visit `http://localhost:8080` in your browser.

---

## Deployment

### Option A: Node.js Server (Full App with Global Leaderboard)

When running the Node.js application server:

```bash
export NODE_ENV=production
export PORT=8080
export HOST=0.0.0.0
export TRUST_PROXY=1  # Enable when behind Nginx, Caddy, Cloudflare, or JetHost reverse proxy
export LEADERBOARD_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export LEADERBOARD_DB_PATH="/var/lib/parkinglot/leaderboard.sqlite"

npm start
```

See [`docs/LEADERBOARD.md`](docs/LEADERBOARD.md) for full details on database schema, migrations, anti-cheat validation, backups, and security headers.

### Option B: Static Web Hosting (cPanel / JetHost / Cloudflare Pages / Netlify)

The game is completely static-compatible. Upload the following directly into your subdomain document root (e.g. `public_html/parkinglot/`):
- `index.html`
- `css/`
- `js/`

The game mechanics, sound effects, deduction puzzles, and Local Personal Records will function 100% in the browser. When static-only, Global Leaderboard network queries cleanly report offline without disrupting gameplay.

---

## Running Tests

The test suite requires no external test frameworks and runs directly via Node:

```bash
# Run puzzle generator/solver tests + 48 leaderboard API tests + 10 auto-submit preference tests
npm test

# Run only the auto-submit preference test suite
npm run test:pref

# Run only the leaderboard API & anti-cheat test suite
npm run test:leaderboard

# Run headless Chrome end-to-end tests
npm run test:e2e
```

---

## License

This project is licensed under the [MIT License](LICENSE).
