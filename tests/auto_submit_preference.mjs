/**
 * Focused test suite for Global Leaderboard Auto-Submission Preference.
 * Covers:
 * - Defaults to OFF when no preference exists
 * - Opting in and saving a nickname persists
 * - Opting out stops auto-submission
 * - Completed round submits exactly once when opted in
 * - Manual submission still works when auto-submission is OFF
 * - Invalid or missing nicknames prevent submission and prompt the user
 * - Network failures preserve local records and do not cause duplicate submissions
 *
 * Run: node tests/auto_submit_preference.mjs
 */

import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';
import { LOTS } from '../js/config.js';
import {
  AUTO_SUBMIT_KEY,
  NICKNAME_KEY,
  loadAutoSubmitPreference,
  saveAutoSubmitPreference,
  loadSavedNickname,
  saveNickname,
  validateNickname,
  generateDefaultNickname
} from '../js/leaderboard.js';
import { ParkingLotState, GAME_PHASES } from '../js/state.js';
import { loadRecords } from '../js/storage.js';

// Mock minimal browser window / localStorage environment for pure Node testing
const mockStorage = new Map();
globalThis.window = {
  fetch: globalThis.fetch.bind(globalThis),
  localStorage: {
    getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear()
  },
  matchMedia: () => ({ matches: false }),
  PARKINGLOT_API_BASE: ''
};

const results = { passed: 0, failed: 0, failures: [] };
async function check(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.failures.push({ name, message: err.message });
    console.log(`  ✗ ${name}\n      ${err.stack}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n=== Global Leaderboard Auto-Submission Preference Tests ===\n');

  // 1. Storage & Preference Defaults
  await check('Automatic submission defaults to OFF for first-time / existing players', () => {
    mockStorage.clear();
    const pref = loadAutoSubmitPreference();
    assert.equal(pref, false, 'Expected auto-submit preference to default to false');
  });

  await check('Opting in and saving a nickname persists across calls', () => {
    mockStorage.clear();
    saveAutoSubmitPreference(true);
    saveNickname('LuckyDriver42');

    assert.equal(loadAutoSubmitPreference(), true);
    assert.equal(loadSavedNickname(), 'LuckyDriver42');
    assert.equal(mockStorage.get(AUTO_SUBMIT_KEY), 'true');
    assert.equal(mockStorage.get(NICKNAME_KEY), 'LuckyDriver42');
  });

  await check('Opting out updates storage without deleting the saved nickname', () => {
    saveAutoSubmitPreference(false);
    assert.equal(loadAutoSubmitPreference(), false);
    assert.equal(loadSavedNickname(), 'LuckyDriver42', 'Nickname must not be deleted when opting out');
  });

  await check('generateDefaultNickname produces a valid, compliant nickname within 16 chars', () => {
    for (let i = 0; i < 20; i++) {
      const nick = generateDefaultNickname();
      assert.ok(nick.length >= 1 && nick.length <= 16, `Nickname length ${nick.length} out of bounds`);
      const val = validateNickname(nick);
      assert.equal(val.ok, true, `Generated nickname "${nick}" failed validation: ${val.message}`);
    }
  });

  await check('validateNickname rejects empty, invalid characters, HTML, and >16 chars', () => {
    assert.equal(validateNickname('').ok, false);
    assert.equal(validateNickname('   ').ok, false);
    assert.equal(validateNickname('<b>Name</b>').ok, false);
    assert.equal(validateNickname('Name\nNewline').ok, false);
    assert.equal(validateNickname('12345678901234567').ok, false); // 17 chars
    assert.equal(validateNickname('ValidName_99').ok, true);
    assert.equal(validateNickname('  Spaced  Name  ').value, 'Spaced Name');
  });

  // 2. Integration with real HTTP server & game state
  const server = await createAppServer({
    dbPath: ':memory:',
    quiet: true,
    env: { LEADERBOARD_SECRET: 'test-secret-auto-submit-987654321' }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  window.PARKINGLOT_API_BASE = `http://127.0.0.1:${port}`;

  try {
    await check('When auto-submission is OFF: round completion does NOT submit; manual submit works', async () => {
      mockStorage.clear();
      saveAutoSubmitPreference(false);
      saveNickname('ManualChamp');

      const state = new ParkingLotState();
      state.selectLot('dollar');
      state.startRound();

      // Wait for session token
      for (let i = 0; i < 30 && state.sessionStatus === 'pending'; i++) await sleep(50);
      assert.equal(state.sessionStatus, 'ready');

      // Find a safe cell
      let safeCell = null;
      for (const row of state.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') {
            safeCell = cell;
            break;
          }
        }
        if (safeCell) break;
      }
      assert.ok(safeCell, 'Found a safe cell');

      // Inspect and commit
      state.inspectOrSelectSpace(safeCell.r, safeCell.c);
      await sleep(2100); // satisfy server MIN_RUN_WALL_MS requirement
      state.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      assert.equal(state.phase, GAME_PHASES.RESULTS);
      assert.equal(state.submission.status, 'idle', 'Must remain idle when auto-submit is OFF');

      // Check DB: 0 entries
      const res1 = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
      assert.equal(res1.total, 0, 'No entry should be submitted automatically');

      // Manual submit should succeed
      const submitRes = await state.submitToLeaderboard('ManualChamp');
      assert.ok(submitRes && submitRes.ok, 'Manual submit succeeded');
      assert.equal(state.submission.status, 'done');

      const res2 = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
      assert.equal(res2.total, 1, 'Manual submission recorded');
      assert.equal(res2.entries[0].nickname, 'ManualChamp');
    });

    await check('When auto-submission is ON: completed round submits exactly once with rank', async () => {
      saveAutoSubmitPreference(true);
      saveNickname('AutoMaster');

      const state = new ParkingLotState();
      state.selectLot('dollar');
      state.startRound();

      for (let i = 0; i < 30 && state.sessionStatus === 'pending'; i++) await sleep(50);
      assert.equal(state.sessionStatus, 'ready');

      let safeCell = null;
      for (const row of state.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') {
            safeCell = cell;
            break;
          }
        }
        if (safeCell) break;
      }

      state.inspectOrSelectSpace(safeCell.r, safeCell.c);
      await sleep(2100);
      state.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      // Wait for auto-submission to resolve
      for (let i = 0; i < 40 && state.submission.status === 'submitting'; i++) await sleep(50);

      assert.equal(state.submission.status, 'done');
      assert.equal(state.submission.isAuto, true);
      assert.match(state.submission.message, /Score automatically submitted/i);

      // Check single submission in DB
      const res = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
      assert.equal(res.total, 2, 'Total entries in DB should now be 2');
      const entry = res.entries.find((e) => e.nickname === 'AutoMaster');
      assert.ok(entry, 'AutoMaster entry found in leaderboard');

      // Rapid repeat call should be rejected by single-flight protection
      const dupRes = await state.submitToLeaderboard('AutoMaster');
      assert.equal(dupRes, null, 'Duplicate submission blocked by single-flight protection');
      const resAfter = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
      assert.equal(resAfter.total, 2, 'No duplicate entry added to DB');
    });

    await check('Opting out stops subsequent rounds from automatically submitting', async () => {
      saveAutoSubmitPreference(false);

      const state = new ParkingLotState();
      state.selectLot('dollar');
      state.startRound();

      for (let i = 0; i < 30 && state.sessionStatus === 'pending'; i++) await sleep(50);
      let safeCell = null;
      for (const row of state.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') { safeCell = cell; break; }
        }
        if (safeCell) break;
      }
      state.inspectOrSelectSpace(safeCell.r, safeCell.c);
      await sleep(2100);
      state.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      assert.equal(state.submission.status, 'idle', 'Auto-submit must not trigger after opting out');
      const res = await (await fetch(`http://127.0.0.1:${port}/api/leaderboard`)).json();
      assert.equal(res.total, 2, 'Total entries must remain unchanged');
    });

    await check('Missing or invalid nickname prevents auto-submission and prompts user', async () => {
      saveAutoSubmitPreference(true);
      saveNickname(''); // empty nickname

      const state = new ParkingLotState();
      state.selectLot('dollar');
      state.startRound();

      for (let i = 0; i < 30 && state.sessionStatus === 'pending'; i++) await sleep(50);
      let safeCell = null;
      for (const row of state.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') { safeCell = cell; break; }
        }
        if (safeCell) break;
      }
      state.inspectOrSelectSpace(safeCell.r, safeCell.c);
      await sleep(2100);
      state.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      assert.equal(state.submission.status, 'error');
      assert.match(state.submission.message, /Auto-submit skipped: Please enter a nickname/i);

      // Now with invalid characters
      saveNickname('<<<bad>>>');
      const state2 = new ParkingLotState();
      state2.selectLot('dollar');
      state2.startRound();
      for (let i = 0; i < 30 && state2.sessionStatus === 'pending'; i++) await sleep(50);
      safeCell = null;
      for (const row of state2.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') { safeCell = cell; break; }
        }
        if (safeCell) break;
      }
      state2.inspectOrSelectSpace(safeCell.r, safeCell.c);
      await sleep(2100);
      state2.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      assert.equal(state2.submission.status, 'error');
      assert.match(state2.submission.message, /Auto-submit skipped/i);
    });

    await check('Network failure preserves local records and reports nonintrusive error without blocking', async () => {
      saveAutoSubmitPreference(true);
      saveNickname('ResilientUser');

      // Point API to unreachable port
      window.PARKINGLOT_API_BASE = 'http://127.0.0.1:54321';

      const initialRecords = loadRecords();
      const initialGames = initialRecords.overall.gamesPlayed;

      const state = new ParkingLotState();
      state.selectLot('dollar');
      state.startRound();

      let safeCell = null;
      for (const row of state.board.grid) {
        for (const cell of row) {
          if (cell.type === 'SAFE') { safeCell = cell; break; }
        }
        if (safeCell) break;
      }
      state.inspectOrSelectSpace(safeCell.r, safeCell.c);
      state.commitToSpace(safeCell.r, safeCell.c, { instant: true });

      // Wait for fetch failure to resolve asynchronously
      for (let i = 0; i < 40 && state.submission.status === 'submitting'; i++) await sleep(50);

      // Local records must be preserved
      const updatedRecords = loadRecords();
      assert.equal(updatedRecords.overall.gamesPlayed, initialGames + 1, 'Local records must record round outcome');
      assert.equal(state.phase, GAME_PHASES.RESULTS, 'Game continues unblocked to RESULTS screen');

      // Submission status indicates non-intrusive offline error
      assert.equal(state.submission.status, 'error');
      assert.match(state.submission.message, /unavailable|Could not reach/i);
    });

  } finally {
    server.close();
  }

  console.log(`\nResults: ${results.passed} passed, ${results.failed} failed.`);
  if (results.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
