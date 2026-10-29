/**
 * Parking Lot V1 - Comprehensive Automated Verification Suite
 * Verifies all requirements from the Fundamental Gameplay Correction:
 * 1. True Minesweeper-style deduction (binary unknown cells: SAFE vs HAZARD; exact 8-neighbor hazard clues).
 * 2. Every round generates a meaningfully different hazard arrangement, front-row layout, and deduction path.
 * 3. Logical Solver (`solveBoardLogically`) proves multi-step logical solvability without guessing across 180 boards.
 * 4. Blind front-row clicking strategy fails/suffers heavy penalties compared to logical clue deduction.
 * 5. Unverified surroundings cannot receive a guaranteed clean park.
 * 6. Early park vs. continued search produces meaningful score trade-offs.
 * 7. All 6 core scenarios & LocalStorage persistence work.
 */

import assert from 'node:assert/strict';
import { LOTS, MODIFIERS, CELL_TYPES, QUALITY_TIERS, LAYOUT_TEMPLATES } from '../js/config.js';
import {
  generateValidBoard,
  validateBoard,
  getNeighbors,
  isTroubleCell,
  solveBoardLogically,
  getObservedSpaceEvaluation,
  normalizeEntrances,
  getCellWalkingDistance,
  computePositionScore
} from '../js/generator.js';
import {
  calculateDifficultyMultiplier,
  calculateScoreBreakdown
} from '../js/scoring.js';
import {
  STORAGE_KEY,
  loadRecords,
  recordRoundResult,
  resetRecords
} from '../js/storage.js';
import { ParkingLotState, GAME_PHASES } from '../js/state.js';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  },
  matchMedia: () => ({ matches: true })
};

console.log('=== 1. Verifying 240 Boards: Clue Accuracy, Binary Unknowns & Solver Solvability (Dollar, Strip, Mall, Stadium) ===');
const lotIds = ['dollar', 'strip', 'mall', 'stadium'];
const modCombos = [
  [],
  ['carts'],
  ['badParkers'],
  ['goose'],
  ['carts', 'badParkers'],
  ['carts', 'badParkers', 'goose']
];

for (const lotId of lotIds) {
  const lot = LOTS[lotId];
  const signatures = new Set();
  const templatesObserved = new Set();
  const startVantagePositions = new Set();
  let entranceHazardsCountTotal = 0;

  for (const mods of modCombos) {
    for (let i = 0; i < 10; i++) {
      const board = generateValidBoard(lotId, mods);
      const v = validateBoard(board, lot, mods);
      assert.equal(v.valid, true, `Board invalid for ${lotId} [${mods}]: ${v.reason}`);

      signatures.add(board.signature);
      templatesObserved.add(board.layoutTemplate);
      startVantagePositions.add(`${board.startCell[0]},${board.startCell[1]}`);
      entranceHazardsCountTotal += v.entranceAdjacentHazardCount;

      for (let r = 0; r < lot.rows; r++) {
        for (let c = 0; c < lot.cols; c++) {
          const cell = board.grid[r][c];

          // Unknown (?) cells must be strictly SAFE or HAZARD; OCCUPIED/BLOCKED are visibleAtStart
          if (!cell.visibleAtStart) {
            assert.ok(
              cell.type === CELL_TYPES.SAFE || cell.type === CELL_TYPES.HAZARD,
              `Unknown cell at (${r},${c}) must be SAFE or HAZARD, got ${cell.type}`
            );
            assert.equal(cell.revealed, false, 'Unknown cell must not be pre-revealed at start');
          }

          // Exact clue check: number of adjacent HIDDEN HAZARDS
          const neighbors = getNeighbors(r, c, lot.rows, lot.cols);
          const expectedClue = neighbors.filter(
            ([nr, nc]) => board.grid[nr][nc].type === CELL_TYPES.HAZARD
          ).length;
          assert.equal(cell.clue, expectedClue, `Clue mismatch at (${r},${c})`);
        }
      }
    }
  }

  assert.ok(signatures.size >= 50, `Expected high board diversity for ${lotId}, got ${signatures.size}/60 unique layouts`);
  assert.ok(templatesObserved.size >= Math.min(2, lot.supportedTemplates.length), `Expected supported templates generated for ${lotId}`);
  assert.ok(startVantagePositions.size >= 3, `Starting entry vantage must vary across rounds in ${lotId}`);
  assert.ok(entranceHazardsCountTotal >= 120, `Entrance perimeter must be reliably guarded by hidden hazards in ${lotId}`);
}
console.log('✓ All 240 boards verified: diverse layouts, binary unknowns, exact clues, and multi-step logical solvability.');

console.log('=== 2. Comparing Blind Front-Row/Entrance Clicking vs. Logical Clue Deduction (40 Rounds) ===');
{
  let blindTotalScore = 0;
  let blindHazardsHit = 0;
  let blindCleanParks = 0;

  let deductionTotalScore = 0;
  let deductionHazardsHit = 0;
  let deductionCleanParks = 0;

  for (let round = 0; round < 40; round++) {
    // Play with Blind Entrance Proximity Clicker
    const blindState = new ParkingLotState();
    blindState.selectLot('dollar');
    blindState.startRound();

    // Blindly click unknown stalls closest to the entrance without deduction until SAFE, then park immediately
    const ents = normalizeEntrances(blindState.board.entrances || blindState.board.entranceCols, blindState.getLot());
    const candidates = [];
    for (let r = 0; r < blindState.board.rows; r++) {
      for (let c = 0; c < blindState.board.cols; c++) {
        const cell = blindState.board.grid[r][c];
        if (!cell.visibleAtStart && !cell.revealed) {
          const { minDistance } = getCellWalkingDistance(r, c, ents, blindState.board.rows, blindState.board.cols);
          candidates.push({ r, c, dist: minDistance });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    outerBlind: for (const cand of candidates) {
      blindState.inspectOrSelectSpace(cand.r, cand.c);
      if (blindState.phase !== GAME_PHASES.PLAYING) break outerBlind;
      const cell = blindState.board.grid[cand.r][cand.c];
      if (cell.type === CELL_TYPES.SAFE) {
        blindState.elapsedSeconds = 12;
        blindState.commitToSpace(cand.r, cand.c, { instant: true });
        break outerBlind;
      }
    }
    blindHazardsHit += blindState.hazardsTriggered;
    blindTotalScore += blindState.roundResult ? blindState.roundResult.finalScore : 0;
    if (blindState.roundResult && blindState.roundResult.outcomeId === 'CLEAN') {
      blindCleanParks++;
    }

    // Play with Logical Clue Deducer
    const smartState = new ParkingLotState();
    smartState.selectLot('dollar');
    smartState.startRound();

    const solved = solveBoardLogically(smartState.board.grid, smartState.getLot());
    // Flag all logically deduced hazards so surroundings are verified!
    for (let r = 0; r < smartState.board.rows; r++) {
      for (let c = 0; c < smartState.board.cols; c++) {
        if (solved.deducedHazard[r][c]) {
          smartState.toggleFlag(r, c);
        }
      }
    }
    // Pick the highest-quality logically deduced SAFE space
    let bestDeducedCell = null;
    for (let r = 0; r < smartState.board.rows; r++) {
      for (let c = 0; c < smartState.board.cols; c++) {
        const cell = smartState.board.grid[r][c];
        if (solved.deducedSafe[r][c] && cell.type === CELL_TYPES.SAFE) {
          if (!bestDeducedCell || cell.qualityScore > bestDeducedCell.qualityScore) {
            bestDeducedCell = cell;
          }
        }
      }
    }
    assert.ok(bestDeducedCell, 'Logical solver must find a safe cell');
    smartState.inspectOrSelectSpace(bestDeducedCell.r, bestDeducedCell.c);
    smartState.elapsedSeconds = 20;
    smartState.timerStartMs = Date.now() - 20000;
    smartState.commitToSpace(bestDeducedCell.r, bestDeducedCell.c, { instant: true });

    deductionHazardsHit += smartState.hazardsTriggered;
    deductionTotalScore += smartState.roundResult.finalScore;
    if (smartState.roundResult.outcomeId === 'CLEAN') {
      deductionCleanParks++;
    }
  }

  assert.equal(deductionHazardsHit, 0, 'Logical deduction player hits 0 hidden hazards');
  assert.ok(blindHazardsHit >= 15, `Blind entrance clicker must hit many hazards (hit ${blindHazardsHit})`);
  assert.ok(
    deductionTotalScore > blindTotalScore,
    `Logical deduction score (${deductionTotalScore}) must beat blind entrance clicking (${blindTotalScore})`
  );
  assert.ok(
    deductionCleanParks > blindCleanParks,
    `Logical deduction achieves more Clean Parks (${deductionCleanParks} vs ${blindCleanParks})`
  );
  console.log(
    `✓ 40-Round Simulation: Logical Deducer avg ${Math.round(deductionTotalScore / 40)} pts (0 hazards hit, ${deductionCleanParks} clean parks) vs Blind Entrance Clicker avg ${Math.round(blindTotalScore / 40)} pts (${blindHazardsHit} hazards hit, ${blindCleanParks} clean parks).`
  );
}

console.log('=== 3. Verifying Unverified Surroundings Cannot Get Guaranteed Clean Park ===');
{
  const state = new ParkingLotState();
  state.selectLot('strip');
  state.startRound();

  // Find a SAFE cell that has clue >= 1
  let cellWithAdjacentHazard = null;
  for (const row of state.board.grid) {
    for (const c of row) {
      if (c.type === CELL_TYPES.SAFE && c.clue >= 1) {
        cellWithAdjacentHazard = c;
        break;
      }
    }
    if (cellWithAdjacentHazard) break;
  }
  assert.ok(cellWithAdjacentHazard, 'Found a safe space adjacent to at least 1 hidden hazard');

  // Inspect ONLY that cell without locating or flagging its adjacent hazard
  state.inspectOrSelectSpace(cellWithAdjacentHazard.r, cellWithAdjacentHazard.c);
  const evalUnverified = getObservedSpaceEvaluation(state.board, cellWithAdjacentHazard);
  assert.ok(evalUnverified.unlocatedHazards >= 1, 'Adjacent hazard is unlocated');

  // Commit with rng = () => 0.99 (even with best possible roll, unverified adjacent hazard prevents CLEAN park!)
  state.commitToSpace(cellWithAdjacentHazard.r, cellWithAdjacentHazard.c, {
    instant: true,
    rng: () => 0.99
  });
  assert.notEqual(
    state.roundResult.outcomeId,
    'CLEAN',
    'Unverified space with unlocated adjacent hazards cannot receive a guaranteed CLEAN park'
  );
  assert.ok(state.roundResult.accidentPenalty > 0, 'Unverified maneuver incurs a penalty');
}
console.log('✓ Unverified surroundings rule verified.');

console.log('=== 3B. Verifying Clean Park Has Strictly 0 Accident Penalty & 0 Deductible ===');
{
  const state = new ParkingLotState();
  state.selectLot('dollar');
  let cleanSafeCell = null;
  let solved = null;
  for (let attempt = 0; attempt < 20 && !cleanSafeCell; attempt++) {
    state.startRound();

    // Intentionally trigger a hazard during search to lose patience
    for (const row of state.board.grid) {
      for (const c of row) {
        if (c.type === CELL_TYPES.HAZARD) {
          state.inspectOrSelectSpace(c.r, c.c);
          break;
        }
      }
      if (state.hazardsTriggered > 0) break;
    }

    // Now find a safe space with clue 0
    solved = solveBoardLogically(state.board.grid, state.getLot());
    for (let r = 0; r < state.board.rows; r++) {
      for (let c = 0; c < state.board.cols; c++) {
        if (solved.deducedHazard[r][c]) {
          state.toggleFlag(r, c);
        }
      }
    }

    for (let r = 0; r < state.board.rows; r++) {
      for (let c = 0; c < state.board.cols; c++) {
        const cell = state.board.grid[r][c];
        if (solved.deducedSafe[r][c] && cell.type === CELL_TYPES.SAFE && cell.clue === 0) {
          cleanSafeCell = cell;
          break;
        }
      }
      if (cleanSafeCell) break;
    }
  }
  assert.ok(state.hazardsTriggered >= 1, 'Inspected a hazard during search');
  assert.ok(cleanSafeCell, 'Found a logically deduced safe space with clue 0');

  state.inspectOrSelectSpace(cleanSafeCell.r, cleanSafeCell.c);
  // Even with the lowest possible RNG roll (0.00001), a verified 0-clue stall must never roll an accident!
  state.commitToSpace(cleanSafeCell.r, cleanSafeCell.c, {
    instant: true,
    rng: () => 0.00001
  });

  assert.equal(state.roundResult.outcomeId, 'CLEAN', 'Outcome is Clean Park');
  assert.equal(state.roundResult.accidentPenalty, 0, 'Accident Penalty must be 0 on a Clean Park');
  assert.equal(state.roundResult.insuranceDeductible, 0, 'Insurance Deductible must be 0 on a Clean Park');
  assert.equal(state.roundResult.isAccident, false, 'isAccident must be false on a Clean Park');
}
console.log('✓ Clean Park strictly 0 accident penalty verified.');

console.log('=== 4. Verifying Early Park vs. Continued Search Trade-off ===');
{
  const state = new ParkingLotState();
  state.selectLot('mall');
  state.startRound();

  let distantSafe = null;
  let primeSafe = null;
  for (const row of state.board.grid) {
    for (const c of row) {
      if (c.type === CELL_TYPES.SAFE) {
        if ((c.qualityTier.id === 'ACCEPTABLE' || c.qualityTier.id === 'TECHNICALLY_LEGAL' || c.qualityTier.id === 'DEEPLY_UNFORTUNATE') && !distantSafe) {
          distantSafe = c;
        }
        if ((c.qualityTier.id === 'PREMIUM' || c.qualityTier.id === 'EXCELLENT') && !primeSafe) {
          primeSafe = c;
        }
      }
    }
  }
  assert.ok(distantSafe && primeSafe, 'Found both distant and prime entrance safe options');

  const earlyParkScore = calculateScoreBreakdown({
    lotId: 'mall',
    activeModifierIds: [],
    elapsedSeconds: 14,
    patienceRemaining: 105,
    selectedCell: distantSafe,
    parkingResolution: { outcomeId: 'CLEAN', title: 'Clean Park', isAccident: false, penalty: 0, deductible: 0 }
  }).finalScore;

  const efficientPrimeSearchScore = calculateScoreBreakdown({
    lotId: 'mall',
    activeModifierIds: [],
    elapsedSeconds: 45,
    patienceRemaining: 75,
    selectedCell: primeSafe,
    parkingResolution: { outcomeId: 'CLEAN', title: 'Clean Park', isAccident: false, penalty: 0, deductible: 0 }
  }).finalScore;

  const overlySlowMistakeSearchScore = calculateScoreBreakdown({
    lotId: 'mall',
    activeModifierIds: [],
    elapsedSeconds: 380,
    patienceRemaining: 15,
    selectedCell: primeSafe,
    parkingResolution: { outcomeId: 'SERIOUS_MISHAP', title: 'Serious Mishap', isAccident: true, penalty: 420, deductible: 350 }
  }).finalScore;

  assert.ok(
    efficientPrimeSearchScore > earlyParkScore,
    `Efficient deduction to prime space (${efficientPrimeSearchScore}) beats immediate distant park (${earlyParkScore})`
  );
  assert.ok(
    earlyParkScore > overlySlowMistakeSearchScore,
    `Quick back-row park (${earlyParkScore}) beats slow blunder-filled search (${overlySlowMistakeSearchScore})`
  );
}
console.log('✓ Early park vs. continued search trade-off verified.');

console.log('=== 5. Verifying Patience Failure, Modifiers & LocalStorage Persistence ===');
{
  resetRecords();
  const state = new ParkingLotState();
  state.selectLot('dollar');
  state.startRound();
  state.patience = 4;

  let unrev = null;
  for (const row of state.board.grid) {
    for (const c of row) {
      if (!c.revealed && !c.visibleAtStart) { unrev = c; break; }
    }
    if (unrev) break;
  }
  state.inspectOrSelectSpace(unrev.r, unrev.c);
  assert.equal(state.phase, GAME_PHASES.RESULTS);
  assert.equal(state.roundResult.patienceFailed, true);

  recordRoundResult({ lotId: 'dollar', success: true, finalScore: 1480, isAccident: false });
  const loaded = loadRecords();
  assert.equal(loaded.overall.bestScore, 1480);

  globalThis.window.localStorage.setItem(STORAGE_KEY, '{corrupted_json');
  assert.ok(loadRecords());
  assert.equal(resetRecords().overall.bestScore, 0);
}
console.log('✓ Patience failure, modifiers, and persistence verified.');

console.log('=== 6. Verifying 1-5 Star System & Separation of Desirability from Hazard Clues ===');
{
  // Verify tier configuration
  assert.equal(QUALITY_TIERS.PREMIUM.stars, '★★★★★');
  assert.equal(QUALITY_TIERS.EXCELLENT.stars, '★★★★☆');
  assert.equal(QUALITY_TIERS.ACCEPTABLE.stars, '★★★☆☆');
  assert.equal(QUALITY_TIERS.TECHNICALLY_LEGAL.stars, '★★☆☆☆');
  assert.equal(QUALITY_TIERS.DEEPLY_UNFORTUNATE.stars, '★☆☆☆☆');

  const state = new ParkingLotState();
  state.selectLot('strip');
  state.startRound();

  const foundTiers = new Set();
  for (const row of state.board.grid) {
    for (const cell of row) {
      if (cell.type === CELL_TYPES.SAFE) {
        foundTiers.add(cell.qualityTier.id);
        assert.ok(cell.qualityTier.stars, 'Cell has stars defined');
        assert.ok(cell.qualityTier.stars.length === 5, 'Star string is exactly 5 characters');
      }
    }
  }
  assert.ok(foundTiers.size >= 2, 'Board contains diverse quality tiers across rows');

  // Verify that an entrance-adjacent space retains high desirability (4 or 5 stars)
  // regardless of adjacent hazard counts
  const ents = normalizeEntrances(state.board.entrances || state.board.entranceCols, state.getLot());
  let primeSafe = null;
  let minD = Infinity;
  for (const row of state.board.grid) {
    for (const c of row) {
      if (c.type === CELL_TYPES.SAFE) {
        const { minDistance } = getCellWalkingDistance(c.r, c.c, ents, state.board.rows, state.board.cols);
        if (minDistance < minD) {
          minD = minDistance;
          primeSafe = c;
        }
      }
    }
  }
  if (primeSafe) {
    assert.ok(
      primeSafe.qualityTier.starsCount >= 4,
      `Entrance-adjacent stall should be 4 or 5 stars, got ${primeSafe.qualityTier.starsCount} stars`
    );
  }
}
console.log('✓ 1-5 star scale and quality/hazard separation verified.');

console.log('=== 7. Verifying Stadium/Event Huge Lot Configuration & Scale ===');
{
  const lot = LOTS.stadium;
  assert.ok(lot, 'Stadium lot exists in LOTS config');
  assert.equal(lot.rows, 9, 'Stadium has 9 rows');
  assert.equal(lot.cols, 10, 'Stadium has 10 columns');
  assert.equal(lot.totalSpaces, 90, 'Stadium has 90 total spaces');
  assert.equal(lot.baseDifficultyMultiplier, 2.25, 'Stadium has 2.25x difficulty multiplier');
  assert.equal(lot.basePatience, 130, 'Stadium provides 130 base patience');
  assert.equal(lot.inspectCost, 3, 'Stadium has reduced inspect cost for huge lot scale');
  assert.ok(lot.entranceCols.length >= 2, 'Stadium has multiple entrance gates');

  // Verify board generation on state
  const state = new ParkingLotState();
  state.selectLot('stadium');
  state.startRound();

  assert.equal(state.board.rows, 9, 'Generated board has 9 rows');
  assert.equal(state.board.cols, 10, 'Generated board has 10 columns');
  assert.equal(state.board.grid.length, 9);
  assert.equal(state.board.grid[0].length, 10);

  // Check row letters span A through I
  assert.equal(state.board.grid[0][0].id, 'A1');
  assert.equal(state.board.grid[8][9].id, 'I10');

  // Verify diverse quality tiers in a 90-stall lot
  const tiers = new Set();
  let foundPremium = false;
  let foundDistant = false;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = state.board.grid[r][c];
      if (cell.type === CELL_TYPES.SAFE) {
        tiers.add(cell.qualityTier.id);
        if (cell.qualityTier.id === 'PREMIUM') foundPremium = true;
        if (cell.qualityTier.id === 'DEEPLY_UNFORTUNATE' || cell.qualityTier.id === 'TECHNICALLY_LEGAL') {
          foundDistant = true;
        }
      }
    }
  }

  assert.ok(tiers.size >= 3, `Stadium lot must feature at least 3 distinct quality tiers across 90 stalls (got ${tiers.size})`);
  assert.ok(foundPremium, 'Stadium lot includes Premium entrance-adjacent stalls');
  assert.ok(foundDistant || tiers.has('ACCEPTABLE'), 'Stadium lot includes distant/unfortunate stalls far from entrance gates');

  // Verify scoring calculation uses Stadium multiplier (2.25x)
  const diffInfo = calculateDifficultyMultiplier('stadium', []);
  assert.equal(diffInfo.totalMultiplier, 2.25, 'Stadium difficulty multiplier is 2.25x');
}
console.log('✓ Stadium/Event configuration, dimensions, solvability, and scoring verified.');

console.log('=== 8. Verifying Variable Lot Geometry, Layout Templates & Walking Distance Trade-offs ===');
{
  // 1. Configured layout templates
  assert.ok(LAYOUT_TEMPLATES.conventional, 'conventional template exists');
  assert.ok(LAYOUT_TEMPLATES.side, 'side template exists');
  assert.ok(LAYOUT_TEMPLATES.multiple, 'multiple template exists');
  assert.ok(LAYOUT_TEMPLATES.sectioned, 'sectioned template exists');

  for (const lotId of ['dollar', 'strip', 'mall', 'stadium']) {
    const lot = LOTS[lotId];
    const minTemplates = lotId === 'dollar' ? 1 : 2;
    assert.ok(Array.isArray(lot.supportedTemplates) && lot.supportedTemplates.length >= minTemplates, `${lotId} supports required templates`);
  }

  // 2. Test Conventional Top vs Bottom on Dollar Store (4x5)
  const topBoard = generateValidBoard('dollar', [], Math.random, 'conventional', 'top');
  assert.equal(topBoard.layoutTemplate, 'conventional');
  assert.equal(topBoard.entrances[0].edge, 'top');
  const topV = validateBoard(topBoard, LOTS.dollar, []);
  assert.equal(topV.valid, true, `Top board valid: ${topV.reason}`);
  // In top board, Row 0 stalls near entrance door have high positionScore, Row 3 has low positionScore
  const topScoreRow0 = computePositionScore(0, topBoard.entrances[0].doorCol, LOTS.dollar, topBoard.entrances);
  const topScoreRow3 = computePositionScore(3, topBoard.entrances[0].doorCol, LOTS.dollar, topBoard.entrances);
  assert.ok(topScoreRow0 >= 90, `Top board row 0 score should be >= 90, got ${topScoreRow0}`);
  assert.ok(topScoreRow3 <= 55, `Top board row 3 score should be <= 55, got ${topScoreRow3}`);

  const bottomBoard = generateValidBoard('dollar', [], Math.random, 'conventional', 'bottom');
  assert.equal(bottomBoard.layoutTemplate, 'conventional');
  assert.equal(bottomBoard.entrances[0].edge, 'bottom');
  const bottomV = validateBoard(bottomBoard, LOTS.dollar, []);
  assert.equal(bottomV.valid, true, `Bottom board valid: ${bottomV.reason}`);
  // In bottom board, Row 3 stalls near entrance door have high positionScore, Row 0 has low positionScore!
  const bottomScoreRow3 = computePositionScore(3, bottomBoard.entrances[0].doorCol, LOTS.dollar, bottomBoard.entrances);
  const bottomScoreRow0 = computePositionScore(0, bottomBoard.entrances[0].doorCol, LOTS.dollar, bottomBoard.entrances);
  assert.ok(bottomScoreRow3 >= 90, `Bottom board row 3 score should be >= 90, got ${bottomScoreRow3}`);
  assert.ok(bottomScoreRow0 <= 55, `Bottom board row 0 score should be <= 55, got ${bottomScoreRow0}`);

  // 3. Test Side Entrance (Left vs Right) on Strip Mall (6x6)
  const leftBoard = generateValidBoard('strip', [], Math.random, 'side', 'left');
  assert.equal(leftBoard.layoutTemplate, 'side');
  assert.equal(leftBoard.entrances[0].edge, 'left');
  const leftV = validateBoard(leftBoard, LOTS.strip, []);
  assert.equal(leftV.valid, true, `Left board valid: ${leftV.reason}`);
  const leftScoreCol0 = computePositionScore(leftBoard.entrances[0].doorRow, 0, LOTS.strip, leftBoard.entrances);
  const leftScoreCol5 = computePositionScore(leftBoard.entrances[0].doorRow, 5, LOTS.strip, leftBoard.entrances);
  assert.ok(leftScoreCol0 >= 90, `Left entrance Col 0 score should be >= 90, got ${leftScoreCol0}`);
  assert.ok(leftScoreCol5 <= 55, `Left entrance Col 5 score should be <= 55, got ${leftScoreCol5}`);

  const rightBoard = generateValidBoard('strip', [], Math.random, 'side', 'right');
  assert.equal(rightBoard.layoutTemplate, 'side');
  assert.equal(rightBoard.entrances[0].edge, 'right');
  const rightV = validateBoard(rightBoard, LOTS.strip, []);
  assert.equal(rightV.valid, true, `Right board valid: ${rightV.reason}`);
  const rightScoreCol5 = computePositionScore(rightBoard.entrances[0].doorRow, 5, LOTS.strip, rightBoard.entrances);
  const rightScoreCol0 = computePositionScore(rightBoard.entrances[0].doorRow, 0, LOTS.strip, rightBoard.entrances);
  assert.ok(rightScoreCol5 >= 90, `Right entrance Col 5 score should be >= 90, got ${rightScoreCol5}`);
  assert.ok(rightScoreCol0 <= 55, `Right entrance Col 0 score should be <= 55, got ${rightScoreCol0}`);

  // 4. Test Multiple Entrances on Strip Mall (6x6)
  const multiBoard = generateValidBoard('strip', [], Math.random, 'multiple');
  assert.equal(multiBoard.layoutTemplate, 'multiple');
  assert.ok(multiBoard.entrances.length >= 2, 'Multiple template has at least 2 entrances');
  const multiV = validateBoard(multiBoard, LOTS.strip, []);
  assert.equal(multiV.valid, true, `Multi board valid: ${multiV.reason}`);

  // 5. Test Sectioned Lot on Stadium (9x10) and Major Mall (7x8)
  for (const lotId of ['mall', 'stadium']) {
    const secBoard = generateValidBoard(lotId, [], Math.random, 'sectioned');
    assert.equal(secBoard.layoutTemplate, 'sectioned');
    assert.ok(secBoard.sectionDividerRow != null, 'Sectioned board has sectionDividerRow');
    const secV = validateBoard(secBoard, LOTS[lotId], []);
    assert.equal(secV.valid, true, `Sectioned board valid for ${lotId}: ${secV.reason}`);
    assert.ok(secV.solver.deducedSafeCount >= 6, `Sectioned solver found ${secV.solver.deducedSafeCount} safe stalls`);
  }

  // 6. Test Walking Distance & Inspector Evaluation
  const evalTest = getObservedSpaceEvaluation(bottomBoard, bottomBoard.grid[3][bottomBoard.entrances[0].doorCol]);
  assert.ok(evalTest.proximityLabel.includes('Prime Spot') || evalTest.proximityLabel.includes('Convenient'), `Expected prime/convenient proximity label, got ${evalTest.proximityLabel}`);
  assert.ok(evalTest.proximityLabel.includes('steps'), 'Proximity label includes walking steps');
}
console.log('✓ All 4 layout templates, flexible edges, walking distance models, and anti-exploit geometry verified.');

console.log('\nALL AUTOMATED TESTS PASSED SUCCESSFULLY!');
// Round timers started by ParkingLotState keep the event loop alive; exit explicitly so `npm test` can chain.
process.exit(0);
