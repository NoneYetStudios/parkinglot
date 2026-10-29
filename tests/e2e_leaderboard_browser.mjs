/**
 * Real headless Chrome check of the global leaderboard UI against the REAL server
 * (static files + API + in-memory SQLite). Run: node tests/e2e_leaderboard_browser.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await createAppServer({ dbPath: ':memory:', quiet: true, env: { LEADERBOARD_SECRET: 'e2e-secret-0123456789abcdef' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const debugPort = 9346;
  const userDataDir = path.join(process.cwd(), '.tmp_chrome_profile_lb');

  const chrome = spawn(CHROME_PATH, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`,
    `http://127.0.0.1:${port}/`
  ]);

  let ws;
  try {
    let wsUrl = null;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const page = list.find((t) => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
        if (page) wsUrl = page.webSocketDebuggerUrl;
      } catch { /* wait */ }
      await sleep(150);
    }
    assert.ok(wsUrl, 'connected to Chrome');
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    let id = 1;
    const pending = new Map();
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const d = JSON.parse(ev.data);
      if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails?.exception?.description || d.params));
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
        errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (d.id && pending.has(d.id)) {
        const { res, rej } = pending.get(d.id);
        pending.delete(d.id);
        d.error ? rej(new Error(d.error.message)) : res(d.result);
      }
    });
    const cdp = (method, params = {}) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expression) => {
      const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    for (let i = 0; i < 30 && !(await ev('Boolean(window.ParkingLotGame)')); i++) await sleep(100);

    console.log('1. Header button opens Global Leaderboard modal with filters; empty state is friendly...');
    const open1 = await ev(`(async () => {
      document.getElementById('btn-global').click();
      for (let i = 0; i < 50 && document.getElementById('global-status').textContent.includes('Loading'); i++) await new Promise(r => setTimeout(r, 50));
      return {
        visible: !document.getElementById('modal-global').hidden,
        lots: document.getElementById('global-filter-lot').options.length,
        mods: document.getElementById('global-filter-mods').options.length,
        status: document.getElementById('global-status').textContent,
        rows: document.querySelectorAll('#global-table-body tr').length,
        scopeNote: document.querySelector('.global-scope-note').textContent
      };
    })()`);
    assert.equal(open1.visible, true);
    assert.equal(open1.lots, 5);
    assert.equal(open1.mods, 9);
    assert.match(open1.status, /No global scores yet/);
    assert.equal(open1.rows, 0);
    assert.match(open1.scopeNote, /Global records/);
    await ev(`document.querySelector('#modal-global [data-close-modal]').click()`);

    console.log('2. Play a round; submit panel appears on results; invalid nickname shows error...');
    await ev(`(() => { document.querySelector('[data-lot-id="dollar"]').click(); document.getElementById('btn-enter-lot').click(); })()`);
    for (let i = 0; i < 50 && (await ev('window.ParkingLotGame.state.sessionStatus')) === 'pending'; i++) await sleep(100);
    assert.equal(await ev('window.ParkingLotGame.state.sessionStatus'), 'ready');
    await sleep(2400); // server requires a plausible minimum run time between session issue and submit
    const played = await ev(`(() => {
      const { state, generator } = window.ParkingLotGame;
      const solved = generator.solveBoardLogically(state.board.grid, state.getLot());
      for (let r = 0; r < state.board.rows; r++) for (let c = 0; c < state.board.cols; c++) if (solved.deducedHazard[r][c]) state.toggleFlag(r, c);
      let best = null;
      for (const row of state.board.grid) for (const cell of row) {
        if (solved.deducedSafe[cell.r][cell.c] && cell.type === 'SAFE' && (!best || cell.qualityScore > best.qualityScore)) best = cell;
      }
      state.inspectOrSelectSpace(best.r, best.c);
      state.commitToSpace(best.r, best.c, { instant: true });
      return { phase: state.phase, score: state.roundResult.finalScore };
    })()`);
    assert.equal(played.phase, 'RESULTS');
    const panel1 = await ev(`(() => {
      const p = document.getElementById('global-submit-panel');
      return { hidden: p.hidden, text: p.textContent, hasInput: Boolean(p.querySelector('input[name=nickname]')), localRecords: document.getElementById('results-content').textContent.includes('Overall Best') };
    })()`);
    assert.equal(panel1.hidden, false);
    assert.equal(panel1.hasInput, true);
    assert.match(panel1.text, new RegExp(`${played.score.toLocaleString('en-US').replace(',', ',?')}`));
    assert.match(panel1.text, /Nothing is uploaded unless you press Submit/);
    assert.equal(panel1.localRecords, true, 'local records strip still shown');

    const bad = await ev(`(async () => {
      const p = document.getElementById('global-submit-panel');
      const input = p.querySelector('input[name=nickname]');
      input.value = '<b>Bad</b>'; input.dispatchEvent(new Event('input'));
      p.querySelector('form').requestSubmit();
      for (let i = 0; i < 50 && !document.querySelector('#global-submit-panel .is-error'); i++) await new Promise(r => setTimeout(r, 50));
      const err = document.querySelector('#global-submit-panel .is-error');
      return { error: err ? err.textContent : null, inputValue: document.querySelector('#global-submit-panel input[name=nickname]').value };
    })()`);
    assert.ok(bad.error && /letters|Nickname/i.test(bad.error), `got ${bad.error}`);
    assert.equal(bad.inputValue, '<b>Bad</b>', 'typed text preserved after failed submit so the player can fix it');

    console.log('3. Valid nickname submits once even with rapid repeated clicks; rank shown...');
    const good = await ev(`(async () => {
      const p = document.getElementById('global-submit-panel');
      const input = p.querySelector('input[name=nickname]');
      input.value = 'Browser Bob'; input.dispatchEvent(new Event('input'));
      const form = p.querySelector('form');
      form.requestSubmit(); form.requestSubmit(); form.requestSubmit();
      for (let i = 0; i < 80 && !document.querySelector('#global-submit-panel .is-success'); i++) await new Promise(r => setTimeout(r, 50));
      const ok = document.querySelector('#global-submit-panel .is-success');
      return ok ? ok.textContent : null;
    })()`);
    assert.ok(good && /Score submitted/.test(good) && /Rank #1/.test(good), `got ${good}`);
    const total = (await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json()).total;
    assert.equal(total, 1, 'exactly one row stored despite triple click');

    console.log('4. Global modal shows the entry (as text) and is separate from local records...');
    const view = await ev(`(async () => {
      document.querySelector('#global-submit-panel .btn-nav').click();
      for (let i = 0; i < 50 && document.querySelectorAll('#global-table-body tr').length === 0; i++) await new Promise(r => setTimeout(r, 50));
      const tr = document.querySelector('#global-table-body tr');
      return { cells: Array.from(tr.children).map(td => td.textContent), lotFilter: document.getElementById('global-filter-lot').value, pager: document.getElementById('global-page-info').textContent, next: document.getElementById('global-next').disabled };
    })()`);
    assert.equal(view.cells[0], '1');
    assert.equal(view.cells[1], 'Browser Bob');
    assert.equal(view.cells[3], 'Dollar Store');
    assert.match(view.cells[4], /Standard \(1\.00×\)/);
    assert.equal(view.lotFilter, 'dollar');
    assert.match(view.pager, /1–1 of 1/);
    assert.equal(view.next, true);

    const filtered = await ev(`(async () => {
      const sel = document.getElementById('global-filter-lot');
      sel.value = 'stadium'; sel.dispatchEvent(new Event('change'));
      for (let i = 0; i < 50 && document.getElementById('global-status').textContent.includes('Loading'); i++) await new Promise(r => setTimeout(r, 50));
      return { rows: document.querySelectorAll('#global-table-body tr').length, status: document.getElementById('global-status').textContent };
    })()`);
    assert.equal(filtered.rows, 0);
    assert.match(filtered.status, /No global scores yet/);

    console.log('4B. Auto-submission preference toggle, persistence & round auto-submit...');
    await ev(`document.querySelector('#modal-global [data-close-modal]').click()`);
    await ev(`document.getElementById('btn-main-menu').click()`);
    const prefInit = await ev(`(() => {
      const toggle = document.getElementById('toggle-auto-submit');
      const group = document.getElementById('nickname-config-group');
      return { checked: toggle.checked, hidden: group.hidden };
    })()`);
    assert.equal(prefInit.checked, false, 'Auto-submit toggle defaults to OFF');
    assert.equal(prefInit.hidden, true, 'Nickname group hidden when toggle is OFF');

    // Turn ON auto-submit
    const prefOn = await ev(`(() => {
      const toggle = document.getElementById('toggle-auto-submit');
      toggle.click();
      const group = document.getElementById('nickname-config-group');
      const input = document.getElementById('input-leaderboard-nickname');
      input.value = 'AutoBrowserBob';
      input.dispatchEvent(new Event('input'));
      return {
        checked: toggle.checked,
        hidden: group.hidden,
        val: input.value,
        savedPref: window.ParkingLotGame.leaderboard.loadAutoSubmitPreference(),
        savedNick: window.ParkingLotGame.leaderboard.loadSavedNickname()
      };
    })()`);
    assert.equal(prefOn.checked, true);
    assert.equal(prefOn.hidden, false);
    assert.equal(prefOn.savedPref, true);
    assert.equal(prefOn.savedNick, 'AutoBrowserBob');

    // Play a round with auto-submit ON
    await ev(`(() => { document.querySelector('[data-lot-id="dollar"]').click(); document.getElementById('btn-enter-lot').click(); })()`);
    for (let i = 0; i < 50 && (await ev('window.ParkingLotGame.state.sessionStatus')) === 'pending'; i++) await sleep(100);
    await sleep(2400);
    const playedAuto = await ev(`(() => {
      const { state, generator } = window.ParkingLotGame;
      const solved = generator.solveBoardLogically(state.board.grid, state.getLot());
      for (let r = 0; r < state.board.rows; r++) for (let c = 0; c < state.board.cols; c++) if (solved.deducedHazard[r][c]) state.toggleFlag(r, c);
      let best = null;
      for (const row of state.board.grid) for (const cell of row) {
        if (solved.deducedSafe[cell.r][cell.c] && cell.type === 'SAFE' && (!best || cell.qualityScore > best.qualityScore)) best = cell;
      }
      state.inspectOrSelectSpace(best.r, best.c);
      state.commitToSpace(best.r, best.c, { instant: true });
      return { phase: state.phase };
    })()`);
    assert.equal(playedAuto.phase, 'RESULTS');

    // Wait for auto-submission to resolve
    for (let i = 0; i < 60 && (await ev('window.ParkingLotGame.state.submission.status')) === 'submitting'; i++) await sleep(100);
    const autoStatus = await ev(`(() => {
      const p = document.getElementById('global-submit-panel');
      const sub = window.ParkingLotGame.state.submission;
      return { status: sub.status, isAuto: sub.isAuto, text: p.textContent };
    })()`);
    assert.equal(autoStatus.status, 'done');
    assert.equal(autoStatus.isAuto, true);
    assert.match(autoStatus.text, /Auto-submitted to Global Leaderboard/);

    const totalAfterAuto = (await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json()).total;
    assert.equal(totalAfterAuto, 2, 'auto-submitted row added to DB');

    // Open modal to verify it shows the auto-submitted score
    await ev(`(async () => {
      document.querySelector('#global-submit-panel .btn-nav').click();
      for (let i = 0; i < 50 && document.querySelectorAll('#global-table-body tr').length < 2; i++) await new Promise(r => setTimeout(r, 50));
    })()`);

    console.log('5. Mobile viewport (375x667): modal usable, page does not overflow horizontally...');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
    const mobile = await ev(`(async () => {
      const sel = document.getElementById('global-filter-lot');
      sel.value = 'all'; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 400));
      const dlg = document.querySelector('#modal-global .modal-dialog').getBoundingClientRect();
      return { docScroll: document.documentElement.scrollWidth, vw: window.innerWidth, dlgRight: dlg.right, rows: document.querySelectorAll('#global-table-body tr').length, prevVisible: document.getElementById('global-prev').getBoundingClientRect().width > 0 };
    })()`);
    assert.ok(mobile.docScroll <= mobile.vw + 1, `page overflows horizontally: ${mobile.docScroll} > ${mobile.vw}`);
    assert.ok(mobile.dlgRight <= mobile.vw + 1, 'dialog fits viewport');
    assert.equal(mobile.rows, 2);
    assert.equal(mobile.prevVisible, true);

    console.log('6. Server unreachable: leaderboard shows an error, local records intact...');
    await ev(`document.querySelector('#modal-global [data-close-modal]').click()`);
    await new Promise((r) => server.close(r));
    await sleep(5500); // leaderboard GETs are cacheable for 5s; wait so the browser actually has to hit the (now dead) network
    const down = await ev(`(async () => {
      document.getElementById('btn-global').click();
      for (let i = 0; i < 100 && document.getElementById('global-status').textContent.includes('Loading'); i++) await new Promise(r => setTimeout(r, 50));
      return { status: document.getElementById('global-status').textContent, isError: document.getElementById('global-status').classList.contains('is-error'), localGames: window.ParkingLotGame.storage.loadRecords().overall.gamesPlayed };
    })()`);
    assert.equal(down.isError, true);
    assert.match(down.status, /local records are unaffected/i);
    assert.ok(down.localGames >= 1);

    assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_CONNECTION|Failed to fetch/i.test(e)), [], 'no unexpected console/runtime errors');
    console.log('\n✓ GLOBAL LEADERBOARD BROWSER E2E PASSED');
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    chrome.kill();
    try { server.close(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
