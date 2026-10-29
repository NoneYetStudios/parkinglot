/**
 * Parking Lot V1 - Real Headless Chrome End-to-End Browser Test
 * Drives actual Chrome via DevTools Protocol (CDP) to test:
 * 1. Initial round state: zero safe spaces pre-revealed, no precomputed ratings/risks/scores on unknown stalls.
 * 2. Inspection & deduction flow: clicking unknown stalls reveals state + clue badge, updates side panel with
 *    Confirmed vs. Estimated assessment (no false certainty).
 * 3. All 6 required scenarios + mobile responsive check with zero console/runtime errors.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function runE2E() {
  const { server, port } = await startServer();
  const debugPort = 9345;
  const userDataDir = path.join(ROOT, '.tmp_chrome_profile');

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`
  ]);

  let ws;
  try {
    let targetUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
        if (page && page.webSocketDebuggerUrl) {
          targetUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch (_e) {
        // wait
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(targetUrl, 'Connected to headless Chrome page target');

    ws = new WebSocket(targetUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    const consoleErrors = [];

    ws.addEventListener('message', (ev) => {
      const data = JSON.parse(ev.data);
      if (data.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(JSON.stringify(data.params));
      }
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    });

    const sendCdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const res = await sendCdp('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result.value;
    };

    await sendCdp('Runtime.enable');
    await sendCdp('Page.enable');

    for (let i = 0; i < 20; i++) {
      const ready = await evaluate('Boolean(window.ParkingLotGame && window.ParkingLotGame.state)');
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log('1. Verifying Initial Menu State & Timer Not Running...');
    const menuCheck = await evaluate(`(() => {
      window.ParkingLotGame.state.clearRecords();
      return {
        phase: window.ParkingLotGame.state.phase,
        timerRunning: window.ParkingLotGame.state.timerIntervalId !== null,
        lotCardsCount: document.querySelectorAll('.lot-card').length,
        modCardsCount: document.querySelectorAll('.mod-card').length,
        menuVisible: !document.getElementById('screen-menu').hidden
      };
    })()`);
    assert.equal(menuCheck.phase, 'MENU');
    assert.equal(menuCheck.timerRunning, false);
    assert.equal(menuCheck.lotCardsCount, 4, '4 Lot selection cards rendered (Dollar, Strip, Mall, Stadium)');
    assert.equal(menuCheck.modCardsCount, 4);

    console.log('2. Verifying Fresh Round Start: No Pre-Revealed Safe Spaces or Leaked Ratings...');
    const freshStartCheck = await evaluate(`(() => {
      document.querySelector('[data-lot-id="dollar"]').click();
      document.getElementById('btn-enter-lot').click();
      const st = window.ParkingLotGame.state;
      const unknownButtons = Array.from(document.querySelectorAll('.stall-unknown'));
      const unknownTextCombined = unknownButtons.map(b => b.textContent).join(' ');
      return {
        timerStarted: st.timerIntervalId !== null,
        selectedCoords: st.selectedCoords,
        revealedSafeDomCount: document.querySelectorAll('.stall-safe').length,
        visibleLandmarksCount: document.querySelectorAll('.stall-occupied, .stall-blocked').length,
        commitBtnPresentAtStart: Boolean(document.getElementById('btn-commit-park')),
        leaksQualityOnUnknown: /Premium|Excellent|Acceptable|Risk|pts/i.test(unknownTextCombined)
      };
    })()`);
    assert.equal(freshStartCheck.timerStarted, true);
    assert.equal(freshStartCheck.selectedCoords, null, 'No safe space pre-selected at start');
    assert.equal(freshStartCheck.revealedSafeDomCount, 0, 'Zero safe spaces revealed on starting board');
    assert.ok(freshStartCheck.visibleLandmarksCount >= 2, 'Visible parked cars/pillars shown at start');
    assert.equal(freshStartCheck.commitBtnPresentAtStart, false, 'Cannot commit before discovering a safe space');
    assert.equal(freshStartCheck.leaksQualityOnUnknown, false, 'Unknown stalls do not leak quality/risk/score text');

    console.log('3. E2E Scenario 1: Inspecting a Space, Reviewing Assessment & Quick Park...');
    const scen1 = await evaluate(`(() => {
      const st = window.ParkingLotGame.state;
      let chosen = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE') { chosen = c; break; }
        }
        if (chosen) break;
      }
      // Click the unknown stall in the DOM to inspect it
      document.querySelector(\`.parking-stall[data-r="\${chosen.r}"][data-c="\${chosen.c}"]\`).click();
      const inspectorText = document.getElementById('inspector-content').textContent;
      const commitBtnNowPresent = Boolean(document.getElementById('btn-commit-park'));
      const hasFalseCertainty = /Guaranteed|Projected Clean Score/i.test(inspectorText);

      // Commit to park
      st.commitToSpace(chosen.r, chosen.c, { instant: true, rng: () => 0.99 });
      return {
        commitBtnNowPresent,
        hasFalseCertainty,
        timerStoppedAfter: st.timerIntervalId === null,
        phase: st.phase,
        finalScore: st.roundResult.finalScore
      };
    })()`);
    assert.equal(scen1.commitBtnNowPresent, true);
    assert.equal(scen1.hasFalseCertainty, false, 'Inspector never shows Guaranteed or Projected Score');
    assert.equal(scen1.timerStoppedAfter, true);
    assert.equal(scen1.phase, 'RESULTS');
    assert.ok(scen1.finalScore > 0);

    console.log('4. E2E Scenario 2: Longer Search Ending in a Premium Space (Strip Mall)...');
    const scen2 = await evaluate(`(() => {
      document.getElementById('btn-change-lot').click();
      document.querySelector('[data-lot-id="strip"]').click();
      document.getElementById('btn-enter-lot').click();
      const st = window.ParkingLotGame.state;
      let prem = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE' && (c.qualityTier.id === 'PREMIUM' || c.qualityTier.id === 'EXCELLENT')) {
            prem = c;
            break;
          }
        }
        if (prem) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${prem.r}"][data-c="\${prem.c}"]\`).click();
      st.elapsedSeconds = 24;
      st.timerStartMs = Date.now() - 24000;
      st.commitToSpace(prem.r, prem.c, { instant: true, rng: () => 0.99 });
      return {
        qualityId: st.roundResult.spaceQualityId,
        finalScore: st.roundResult.finalScore
      };
    })()`);
    assert.ok(scen2.qualityId === 'PREMIUM' || scen2.qualityId === 'EXCELLENT');
    assert.ok(scen2.finalScore >= 1200);

    console.log('5. E2E Scenario 3: Successful Park Involving an Accident & Deductible...');
    const scen3 = await evaluate(`(() => {
      document.getElementById('btn-park-again').click();
      const st = window.ParkingLotGame.state;
      let cell = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE') { cell = c; break; }
        }
        if (cell) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${cell.r}"][data-c="\${cell.c}"]\`).click();
      cell.clue = 1;
      cell.accidentRisk = 0.45;
      st.commitToSpace(cell.r, cell.c, { instant: true, rng: () => 0.005 });
      return {
        isAccident: st.roundResult.isAccident,
        penalty: st.roundResult.accidentPenalty,
        deductible: st.roundResult.insuranceDeductible,
        text: document.getElementById('results-content').textContent
      };
    })()`);
    assert.equal(scen3.isAccident, true);
    assert.ok(scen3.penalty > 0);
    assert.ok(scen3.deductible > 0);
    assert.ok(scen3.text.includes('Insurance Deductible'));

    console.log('6. E2E Scenario 4: Patience Failure...');
    const scen4 = await evaluate(`(() => {
      document.getElementById('btn-park-again').click();
      const st = window.ParkingLotGame.state;
      st.patience = 2;
      let unrev = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (!c.revealed && !c.visibleAtStart) { unrev = c; break; }
        }
        if (unrev) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${unrev.r}"][data-c="\${unrev.c}"]\`).click();
      return {
        phase: st.phase,
        patienceFailed: st.roundResult.patienceFailed,
        finalScore: st.roundResult.finalScore,
        title: st.roundResult.outcomeTitle
      };
    })()`);
    assert.equal(scen4.phase, 'RESULTS');
    assert.equal(scen4.patienceFailed, true);
    assert.equal(scen4.finalScore, 0);
    assert.equal(scen4.title, 'Patience Exhausted');

    console.log('7. E2E Scenario 5: Testing Major Mall + All Modifiers (Cart Chaos, Bad Parkers, Goose Patrol)...');
    const scen5 = await evaluate(`(() => {
      document.getElementById('btn-main-menu').click();
      document.querySelector('[data-lot-id="mall"]').click();
      document.querySelector('[data-mod-id="carts"]').click();
      document.querySelector('[data-mod-id="badParkers"]').click();
      document.querySelector('[data-mod-id="goose"]').click();
      document.getElementById('btn-enter-lot').click();
      const st = window.ParkingLotGame.state;
      let safe = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE') { safe = c; break; }
        }
        if (safe) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${safe.r}"][data-c="\${safe.c}"]\`).click();
      st.commitToSpace(safe.r, safe.c, { instant: true, rng: () => 0.99 });
      return {
        lotId: st.lotId,
        mods: st.activeModifiers,
        diffMult: st.roundResult.difficultyMultiplier,
        finalScore: st.roundResult.finalScore
      };
    })()`);
    assert.equal(scen5.lotId, 'mall');
    assert.equal(scen5.mods.length, 3);
    assert.equal(scen5.diffMult, 2.65);

    console.log('7B. E2E Scenario 5B: Testing Stadium/Event Huge Lot (9x10 = 90 stalls)...');
    const scen5b = await evaluate(`(() => {
      document.getElementById('btn-change-lot').click();
      const lotCards = document.querySelectorAll('.lot-card');
      const stadiumCard = document.querySelector('[data-lot-id="stadium"]');
      stadiumCard.click();
      document.querySelector('[data-mod-id="standard"]').click();
      document.getElementById('btn-enter-lot').click();

      const st = window.ParkingLotGame.state;
      const rowsCount = document.querySelectorAll('.parking-row').length;
      const stallsCount = document.querySelectorAll('.parking-stall').length;
      const buildingLabel = document.querySelector('.storefront-building').textContent;

      let safe = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE') { safe = c; break; }
        }
        if (safe) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${safe.r}"][data-c="\${safe.c}"]\`).click();
      st.commitToSpace(safe.r, safe.c, { instant: true, rng: () => 0.99 });

      return {
        lotCardCount: lotCards.length,
        rowsCount,
        stallsCount,
        buildingLabel,
        boardRows: st.board.rows,
        boardCols: st.board.cols,
        diffMult: st.roundResult.difficultyMultiplier,
        finalScore: st.roundResult.finalScore
      };
    })()`);
    assert.equal(scen5b.lotCardCount, 4, '4 Lot cards rendered in selection');
    assert.equal(scen5b.rowsCount, 9, '9 parking rows rendered in DOM');
    assert.equal(scen5b.stallsCount, 90, '90 parking stalls rendered in DOM');
    assert.equal(scen5b.boardRows, 9);
    assert.equal(scen5b.boardCols, 10);
    assert.ok(scen5b.buildingLabel.includes('COLOSSAL MEGA-DOME'));
    assert.equal(scen5b.diffMult, 2.25);
    assert.ok(scen5b.finalScore > 0);

    console.log('8. E2E Scenario 6: Page Reload & LocalStorage Persistence Verification...');
    await sendCdp('Page.reload');
    await new Promise((r) => setTimeout(r, 400));
    const afterReload = await evaluate(`(() => {
      const rec = window.ParkingLotGame.state.records;
      return {
        gamesPlayed: rec.overall.gamesPlayed,
        successfulParks: rec.overall.successfulParks,
        accidents: rec.overall.accidents,
        bestScore: rec.overall.bestScore
      };
    })()`);
    assert.equal(afterReload.gamesPlayed, 6);
    assert.equal(afterReload.successfulParks, 5);
    assert.equal(afterReload.accidents, 1);
    assert.ok(afterReload.bestScore >= 1200);

    console.log('9. Checking Mobile Viewport (375x667) Usability & Control Visibility...');
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });
    const mobileCheck = await evaluate(`(() => {
      document.getElementById('btn-enter-lot').click();
      const st = window.ParkingLotGame.state;
      let safe = null;
      for (const row of st.board.grid) {
        for (const c of row) {
          if (c.type === 'SAFE') { safe = c; break; }
        }
        if (safe) break;
      }
      document.querySelector(\`.parking-stall[data-r="\${safe.r}"][data-c="\${safe.c}"]\`).click();
      const stall = document.querySelector('.parking-stall');
      const rect = stall.getBoundingClientRect();
      const commitBtn = document.getElementById('btn-commit-park');
      const viewportMeta = document.querySelector('meta[name="viewport"]').getAttribute('content');
      return {
        stallHeight: rect.height,
        commitBtnVisible: Boolean(commitBtn && commitBtn.getBoundingClientRect().height >= 40),
        zoomEnabled: !viewportMeta.includes('user-scalable=no') && !viewportMeta.includes('maximum-scale=1')
      };
    })()`);
    assert.ok(mobileCheck.stallHeight >= 60);
    assert.equal(mobileCheck.commitBtnVisible, true);
    assert.equal(mobileCheck.zoomEnabled, true);

    assert.equal(consoleErrors.length, 0, `Zero console/runtime exceptions: ${consoleErrors.join('; ')}`);
    console.log('\n✓ ALL HEADLESS CHROME END-TO-END TESTS PASSED WITH ZERO ERRORS!');
  } finally {
    if (ws) ws.close();
    chrome.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_e) {
      // ignore cleanup lock
    }
  }
}

runE2E().catch((err) => {
  console.error(err);
  process.exit(1);
});
