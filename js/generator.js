/**
 * Parking Lot V1 - Minesweeper-Style Puzzle Generator, Logical Solver & Space Evaluator
 */

import {
  LOTS,
  MODIFIERS,
  QUALITY_TIERS,
  CELL_TYPES,
  HAZARD_SUBTYPES,
  OBSTACLE_SUBTYPES
} from './config.js';

let lastGeneratedSignature = null;

/**
 * Returns valid 8-connected neighbor coordinates for (r, c).
 */
export function getNeighbors(r, c, rows, cols) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        result.push([nr, nc]);
      }
    }
  }
  return result;
}

/**
 * Normalizes entrances into a structured array of entrance objects:
 * [{ id, edge: 'top'|'bottom'|'left'|'right', label, doorRow, doorCol }]
 */
export function normalizeEntrances(entrances, lot) {
  if (Array.isArray(entrances) && entrances.length > 0 && typeof entrances[0] === 'object' && entrances[0] !== null && 'edge' in entrances[0]) {
    return entrances;
  }
  const eCols = Array.isArray(entrances) && entrances.length > 0
    ? entrances
    : (lot.entranceCols || [Math.floor(lot.cols / 2)]);
  return eCols.map((c, idx) => ({
    id: `door_${idx}`,
    edge: 'top',
    label: lot.name ? `${lot.name} Entrance` : 'Main Entrance',
    doorRow: 0,
    doorCol: c
  }));
}

/**
 * Calculates true traversable walking distance from a cell (r, c) to the nearest entrance door.
 */
export function getCellWalkingDistance(r, c, entrances, rows, cols) {
  if (!entrances || entrances.length === 0) {
    return { minDistance: (r + 0.5) * 1.15, closestEntrance: null };
  }

  let minDistance = Infinity;
  let closestEntrance = entrances[0];

  for (const ent of entrances) {
    let vDist, hDist;
    if (ent.edge === 'top') {
      vDist = (r + 0.5) * 1.15;
      hDist = Math.abs(c - ent.doorCol) * 0.9;
    } else if (ent.edge === 'bottom') {
      vDist = (rows - 0.5 - r) * 1.15;
      hDist = Math.abs(c - ent.doorCol) * 0.9;
    } else if (ent.edge === 'left') {
      vDist = Math.abs(r - ent.doorRow) * 1.15;
      hDist = (c + 0.5) * 0.9 + 0.5;
    } else if (ent.edge === 'right') {
      vDist = Math.abs(r - ent.doorRow) * 1.15;
      hDist = (cols - 0.5 - c) * 0.9 + 0.5;
    } else {
      vDist = (r + 0.5) * 1.15;
      hDist = Math.abs(c - (ent.doorCol || 0)) * 0.9;
    }
    const dist = Math.hypot(vDist, hDist);
    if (dist < minDistance) {
      minDistance = dist;
      closestEntrance = ent;
    }
  }

  return { minDistance, closestEntrance };
}

/**
 * Calculates distance from a cell (r, c) to the nearest storefront entrance door.
 */
export function getEntranceDistance(r, c, lot, entranceColsOverride = null) {
  const ents = normalizeEntrances(entranceColsOverride, lot);
  const { minDistance } = getCellWalkingDistance(r, c, ents, lot.rows, lot.cols);
  return minDistance;
}

/**
 * Computes the base location quality score (0-100) from position alone.
 */
export function computePositionScore(r, c, lot, entranceColsOverride = null) {
  const rows = lot.rows;
  const cols = lot.cols;
  const ents = normalizeEntrances(entranceColsOverride, lot);
  const maxDist = Math.hypot((rows - 0.5) * 1.15, (cols - 0.5) * 0.9) || 1;
  const { minDistance } = getCellWalkingDistance(r, c, ents, rows, cols);
  const normalizedDist = Math.min(1, minDistance / maxDist);

  let posScore = Math.round(92 - normalizedDist * 62);
  if (minDistance <= 1.25) {
    posScore += 6;
  } else if (minDistance <= 2.2) {
    posScore += 3;
  }
  if (normalizedDist >= 0.88) {
    posScore -= 10;
  }
  return Math.max(10, Math.min(100, posScore));
}

/**
 * Maps a numeric quality score (0-100) to one of the 5 QUALITY_TIERS.
 */
export function scoreToQualityTier(scorePoints) {
  if (scorePoints >= QUALITY_TIERS.PREMIUM.minScorePoints) return QUALITY_TIERS.PREMIUM;
  if (scorePoints >= QUALITY_TIERS.EXCELLENT.minScorePoints) return QUALITY_TIERS.EXCELLENT;
  if (scorePoints >= QUALITY_TIERS.ACCEPTABLE.minScorePoints) return QUALITY_TIERS.ACCEPTABLE;
  if (scorePoints >= QUALITY_TIERS.TECHNICALLY_LEGAL.minScorePoints) return QUALITY_TIERS.TECHNICALLY_LEGAL;
  return QUALITY_TIERS.DEEPLY_UNFORTUNATE;
}

/**
 * Determines whether a cell is a Hidden Hazard for the Minesweeper clue system.
 *
 * Design Rule:
 * - Visibly Occupied (`OCCUPIED`) and Physically Blocked (`BLOCKED`) stalls are visible from the start
 *   (`visibleAtStart = true`). They are physical obstacles you can see, NOT hidden hazards.
 * - Unknown (`?`) stalls are strictly either `SAFE` (available parking spaces) or `HAZARD` (hidden hazards).
 * - Every cell's numerical clue (`0`-`8`) equals the EXACT number of adjacent Hidden Hazards (`type === 'HAZARD'`).
 */
export function isTroubleCell(cell) {
  if (!cell) return false;
  return cell.type === CELL_TYPES.HAZARD;
}

/**
 * Computes exact 8-neighbor Hidden Hazard clues, underlying space quality ratings,
 * and baseline maneuvering risks for every cell on the board.
 */
export function computeBoardMetrics(grid, lot, activeModifierIds = [], entranceColsOverride = null) {
  const rows = lot.rows;
  const cols = lot.cols;
  const ents = normalizeEntrances(entranceColsOverride, lot);
  const hasCartsMod = activeModifierIds.includes('carts');
  const hasBadParkersMod = activeModifierIds.includes('badParkers');
  const hasGooseMod = activeModifierIds.includes('goose');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      const neighbors = getNeighbors(r, c, rows, cols);

      let hazardCount = 0;
      let badParkerCount = 0;
      let blockedCount = 0;
      let gooseNeighborCount = 0;
      let cartNeighborCount = 0;
      let occupiedNeighborCount = 0;

      const riskFactors = [];
      const qualityFactors = [];

      for (const [nr, nc] of neighbors) {
        const nCell = grid[nr][nc];
        if (nCell.type === CELL_TYPES.HAZARD) {
          hazardCount++;
          if (nCell.subtype === 'GOOSE') gooseNeighborCount++;
          if (nCell.subtype === 'CART') cartNeighborCount++;
        } else if (nCell.type === CELL_TYPES.BLOCKED) {
          blockedCount++;
        } else if (nCell.type === CELL_TYPES.OCCUPIED) {
          occupiedNeighborCount++;
          if (nCell.isBadParker) badParkerCount++;
        }
      }

      // Exact Minesweeper clue: number of adjacent Hidden Hazards (0-8)
      cell.clue = hazardCount;
      cell.neighborStats = {
        troubleCount: hazardCount,
        hazardCount,
        badParkerCount,
        blockedCount,
        gooseNeighborCount,
        cartNeighborCount,
        occupiedNeighborCount
      };

      const posScore = computePositionScore(r, c, lot, ents);
      cell.positionScore = posScore;
      cell.estimatedTier = scoreToQualityTier(posScore);

      const { minDistance, closestEntrance } = getCellWalkingDistance(r, c, ents, rows, cols);
      cell.distanceSteps = Math.round(minDistance * 18) + 8;
      cell.closestEntrance = closestEntrance;

      if (minDistance <= 1.25) {
        qualityFactors.push(`Direct ${closestEntrance ? closestEntrance.label : 'Entrance'} proximity`);
      } else if (minDistance <= 2.4) {
        qualityFactors.push(`Convenient walk to ${closestEntrance ? closestEntrance.label : 'Entrance'}`);
      } else if (minDistance >= 4.5) {
        qualityFactors.push(`Distant trek to ${closestEntrance ? closestEntrance.label : 'Entrance'}`);
      } else {
        qualityFactors.push(`Moderate approach to ${closestEntrance ? closestEntrance.label : 'Entrance'}`);
      }

      // Space Quality Score: Combines entrance proximity with physical stall clearance & door access.
      // Note: Hidden hazards (carts/geese) affect deduction & maneuvering risk, NOT the intrinsic quality of the stall.
      let finalQualityScore = posScore;
      if (badParkerCount === 0 && blockedCount === 0) {
        finalQualityScore += 4;
        qualityFactors.push('Unobstructed stall entry');
      } else {
        const physicalObstaclePenalty = badParkerCount * 7 + blockedCount * 4;
        finalQualityScore -= physicalObstaclePenalty;
        if (badParkerCount > 0) {
          qualityFactors.push(`${badParkerCount} encroaching bad parker${badParkerCount > 1 ? 's' : ''} cramping door clearance`);
        }
        if (blockedCount > 0) {
          qualityFactors.push(`${blockedCount} adjacent barrier/pillar${blockedCount > 1 ? 's' : ''}`);
        }
      }

      const leftNeighbor = c > 0 ? grid[r][c - 1] : null;
      const rightNeighbor = c < cols - 1 ? grid[r][c + 1] : null;
      const leftTight = leftNeighbor && leftNeighbor.type !== CELL_TYPES.SAFE;
      const rightTight = rightNeighbor && rightNeighbor.type !== CELL_TYPES.SAFE;

      if (leftTight && rightTight) {
        finalQualityScore -= 5;
        qualityFactors.push('Narrow squeeze between flanking vehicles');
      } else if (!leftTight && !rightTight) {
        finalQualityScore += 4;
        qualityFactors.push('Generous side door clearance');
      }

      // A stall cannot be 5-star Premium if an encroaching bad parker is crowding its lines
      if (badParkerCount > 0 && finalQualityScore >= QUALITY_TIERS.PREMIUM.minScorePoints) {
        finalQualityScore = QUALITY_TIERS.PREMIUM.minScorePoints - 2; // Capped at Excellent (4 stars)
      }

      cell.qualityScore = Math.max(5, Math.min(100, finalQualityScore));
      cell.qualityTier = scoreToQualityTier(cell.qualityScore);
      cell.qualityFactors = qualityFactors;

      // Calculate baseline Maneuvering Accident Risk (when hazards are known/accounted for)
      let risk = 0;
      if (hazardCount === 0 && badParkerCount === 0 && !(leftTight && rightTight)) {
        risk = 0;
        riskFactors.push('Clear approach once surroundings are verified');
      } else {
        if (leftTight && rightTight) {
          risk += 0.05;
          riskFactors.push('Tight side-by-side clearance on both doors');
        }
        for (const [nr, nc] of neighbors) {
          const nCell = grid[nr][nc];
          const isSideNeighbor = nr === r && Math.abs(nc - c) === 1;
          const weight = isSideNeighbor ? 1.2 : 0.75;

          if (nCell.type === CELL_TYPES.HAZARD) {
            const sub = HAZARD_SUBTYPES[nCell.subtype];
            const contrib = (sub ? sub.riskContribution : 0.08) * weight * 0.65;
            risk += contrib;
          } else if (nCell.type === CELL_TYPES.OCCUPIED && nCell.isBadParker) {
            const sub = OBSTACLE_SUBTYPES[nCell.subtype];
            const contrib = (sub ? sub.riskContribution : 0.10) * weight;
            risk += contrib;
          } else if (nCell.type === CELL_TYPES.BLOCKED) {
            const sub = OBSTACLE_SUBTYPES[nCell.subtype];
            const contrib = (sub ? sub.riskContribution : 0.05) * weight * 0.6;
            risk += contrib;
          }
        }

        if (cartNeighborCount > 0) {
          if (hasCartsMod) risk += MODIFIERS.carts.adjacentCartRiskBonus * 0.6;
          riskFactors.push(`${cartNeighborCount} nearby loose cart${cartNeighborCount > 1 ? 's' : ''}`);
        }
        if (badParkerCount > 0) {
          if (hasBadParkersMod) risk += MODIFIERS.badParkers.adjacentSqueezeRiskBonus;
          riskFactors.push(`${badParkerCount} encroaching bad parker${badParkerCount > 1 ? 's' : ''}`);
        }
        if (gooseNeighborCount > 0) {
          if (hasGooseMod) risk += MODIFIERS.goose.adjacentGooseRiskBonus * 0.6;
          riskFactors.push('The Goose glaring from an adjacent stall');
        }
        if (blockedCount > 0) {
          riskFactors.push(`${blockedCount} nearby structural obstruction${blockedCount > 1 ? 's' : ''}`);
        }
      }

      cell.accidentRisk = Math.min(0.55, Math.round(risk * 100) / 100);
      cell.riskFactors = riskFactors;
    }
  }
}

/**
 * Evaluates what the player ACTUALLY knows vs. estimates about a cell based strictly on
 * currently revealed/flagged cells on the board.
 * Also computes `effectiveAccidentRisk`: if a cell has adjacent hidden hazards (`cell.clue > 0`)
 * that the player has NOT located (neither revealed nor flagged), pulling into the space carries
 * a substantial unverified-hazard risk penalty!
 */
export function getObservedSpaceEvaluation(board, cell) {
  const lot = LOTS[board.lotId] || LOTS.dollar;
  const ents = normalizeEntrances(board.entrances || board.entranceCols, lot);
  const { minDistance, closestEntrance } = getCellWalkingDistance(cell.r, cell.c, ents, board.rows, board.cols);
  const steps = Math.round(minDistance * 18) + 8;
  const neighbors = getNeighbors(cell.r, cell.c, board.rows, board.cols);

  let unknownNeighborCount = 0;
  let revealedHazardNeighbors = 0;
  let flaggedNeighbors = 0;
  let accuratelyFlaggedHazards = 0;
  let visibleBadParkerNeighbors = 0;
  let visibleBlockedNeighbors = 0;

  // Entrance distance description (observable from lot geometry)
  const entName = closestEntrance ? closestEntrance.label : 'Entrance';
  let proximityLabel = `Moderate Walk (${steps} steps to ${entName})`;
  if (minDistance <= 1.25) {
    proximityLabel = `Prime Spot (${steps} steps from ${entName})`;
  } else if (minDistance <= 2.4) {
    proximityLabel = `Convenient Spot (${steps} steps to ${entName})`;
  } else if (minDistance >= 4.5) {
    proximityLabel = `Distant Stall (${steps} steps to ${entName})`;
  }

  for (const [nr, nc] of neighbors) {
    const nCell = board.grid[nr][nc];
    if (nCell.visibleAtStart) {
      if (nCell.type === CELL_TYPES.OCCUPIED && nCell.isBadParker) {
        visibleBadParkerNeighbors++;
      } else if (nCell.type === CELL_TYPES.BLOCKED) {
        visibleBlockedNeighbors++;
      }
    } else if (nCell.revealed) {
      if (nCell.type === CELL_TYPES.HAZARD) {
        revealedHazardNeighbors++;
      }
    } else {
      unknownNeighborCount++;
      if (nCell.flagged) {
        flaggedNeighbors++;
        if (nCell.type === CELL_TYPES.HAZARD) {
          accuratelyFlaggedHazards++;
        }
      }
    }
  }

  const accountedHazards = revealedHazardNeighbors + accuratelyFlaggedHazards;
  const unlocatedHazards = Math.max(0, cell.clue - accountedHazards);
  const perceivedUnlocatedHazards = Math.max(0, cell.clue - (revealedHazardNeighbors + flaggedNeighbors));
  const isSurroundingsVerified = cell.revealed && unlocatedHazards === 0 && flaggedNeighbors <= cell.clue;

  // Effective accident risk when committing right now:
  // If adjacent hazards are NOT accounted for, each unlocated hazard adds +0.18 risk!
  const unverifiedRiskPenalty = unlocatedHazards * 0.18;
  let effectiveAccidentRisk = Math.min(0.65, Math.round((cell.accidentRisk + unverifiedRiskPenalty) * 100) / 100);
  if (cell.clue === 0 && visibleBadParkerNeighbors === 0 && unlocatedHazards === 0) {
    effectiveAccidentRisk = 0;
  }

  // Quality score estimation based on known position + visible obstacles
  const isQualityConfirmed = cell.revealed;
  const qualityDisplayLabel = `${cell.qualityTier.stars} ${cell.qualityTier.label}`;
  const qualityStatusBadge = isQualityConfirmed ? 'Confirmed' : 'Estimated';

  let riskBandLabel = 'Low Maneuver Risk (Surroundings Verified)';
  let riskBandClass = 'text-safe';
  let riskStatusNote = '';

  if (cell.clue === 0 && visibleBadParkerNeighbors === 0) {
    riskBandLabel = 'Low Maneuver Risk (0 Adjacent Hazards)';
    riskBandClass = 'text-safe';
    riskStatusNote = 'Clue 0 confirms no hidden hazards in any of the 8 surrounding spaces.';
  } else if (perceivedUnlocatedHazards > 0) {
    riskBandLabel = `Unverified Surroundings (${perceivedUnlocatedHazards} Unlocated Hazard${perceivedUnlocatedHazards > 1 ? 's' : ''})`;
    riskBandClass = 'text-danger';
    riskStatusNote = `Clue ${cell.clue} warns of ${perceivedUnlocatedHazards} hidden hazard${
      perceivedUnlocatedHazards > 1 ? 's' : ''
    } in the ${unknownNeighborCount} unknown (?) neighbor${
      unknownNeighborCount > 1 ? 's' : ''
    }. Deduce and flag (⚠️) the hazard or find a 0-clue spot to avoid a blind-spot mishap!`;
  } else if (visibleBadParkerNeighbors > 0) {
    riskBandLabel = `⚠️ Squeeze Caution (${visibleBadParkerNeighbors} Encroaching Bad Parker${visibleBadParkerNeighbors > 1 ? 's' : ''})`;
    riskBandClass = 'text-warn';
    riskStatusNote = cell.clue === 0
      ? `Clue 0 confirms 0 hidden hazards (no carts or geese), but ${visibleBadParkerNeighbors} adjacent Bad Parker is straddling the line into this stall. High squeeze risk on pull-in!`
      : `${visibleBadParkerNeighbors} adjacent Bad Parker is crowding the stall lines. Maneuvering squeeze caution required.`;
  } else if (cell.accidentRisk >= 0.20) {
    riskBandLabel = 'Moderate Squeeze Caution (Crowded Stall)';
    riskBandClass = 'text-warn';
    riskStatusNote = 'Adjacent obstacles are identified, but tight clearance requires a careful pull-in.';
  } else {
    riskBandLabel = 'Low Maneuver Risk (Hazards Accounted For)';
    riskBandClass = 'text-safe';
    riskStatusNote = 'You have accounted for the adjacent hazards around this stall.';
  }

  const observedNotes = [
    `Entrance proximity: ${proximityLabel}`,
    `Hazard Clue (${cell.clue}): ${
      cell.clue === 0
        ? '0 hidden hazards in the 8 adjacent stalls'
        : `${cell.clue} hidden hazard${cell.clue === 1 ? '' : 's'} in the 8 adjacent stalls (${revealedHazardNeighbors} revealed, ${flaggedNeighbors} flagged)`
    }`
  ];

  if (visibleBadParkerNeighbors > 0) {
    observedNotes.push(`⚠️ ${visibleBadParkerNeighbors} visibly encroaching Bad Parker crowding into this stall's clearance`);
  }
  if (unknownNeighborCount > 0) {
    observedNotes.push(`${unknownNeighborCount} adjacent stall${unknownNeighborCount === 1 ? ' is' : 's are'} still unknown (?)`);
  } else {
    observedNotes.push('All 8 adjacent stalls have been identified');
  }

  return {
    proximityLabel,
    totalNeighbors: neighbors.length,
    inspectedNeighborCount: neighbors.length - unknownNeighborCount,
    uninspectedNeighborCount: unknownNeighborCount,
    knownTroubleCount: revealedHazardNeighbors + flaggedNeighbors,
    unaccountedTrouble: perceivedUnlocatedHazards,
    unlocatedHazards,
    isSurroundingsVerified,
    effectiveAccidentRisk,
    isQualityConfirmed,
    qualityDisplayLabel,
    qualityStatusBadge,
    displayTier: cell.qualityTier,
    riskBandLabel,
    riskBandClass,
    riskStatusNote,
    observedNotes
  };
}

/**
 * True Minesweeper Logical Deduction Solver.
 * Starting strictly from the initially revealed cells at 00:00, iteratively applies:
 * 1. Single-cell completion rules (all remaining unknowns are SAFE if remainingClue === 0;
 *    all remaining unknowns are HAZARD if remainingClue === unknowns.length).
 * 2. Pairwise subset and overlap deduction rules across any pair of revealed clue cells (A, B).
 *
 * Returns detailed solvability metrics so `validateBoard` only accepts genuine logical puzzles.
 */
export function solveBoardLogically(grid, lot) {
  const rows = lot.rows;
  const cols = lot.cols;

  // Track solver's knowledge state
  const simRevealed = Array.from({ length: rows }, () => Array(cols).fill(false));
  const deducedSafe = Array.from({ length: rows }, () => Array(cols).fill(false));
  const deducedHazard = Array.from({ length: rows }, () => Array(cols).fill(false));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell.revealed) {
        simRevealed[r][c] = true;
        if (cell.type === CELL_TYPES.SAFE) {
          deducedSafe[r][c] = true;
        } else if (cell.type === CELL_TYPES.HAZARD) {
          deducedHazard[r][c] = true;
        }
      }
    }
  }

  // Helper: get unknown (?) neighbors of (r, c) that are not yet deducedSafe or deducedHazard
  const getActiveConstraint = (r, c) => {
    const cell = grid[r][c];
    const neighbors = getNeighbors(r, c, rows, cols);
    const unknowns = [];
    let knownHazardsAround = 0;

    for (const [nr, nc] of neighbors) {
      const nCell = grid[nr][nc];
      if (nCell.visibleAtStart) {
        // Visibly occupied/blocked cells are known not to be hidden hazards
        continue;
      }
      if (deducedHazard[nr][nc]) {
        knownHazardsAround++;
      } else if (simRevealed[nr][nc] || deducedSafe[nr][nc]) {
        // Known safe
      } else {
        unknowns.push([nr, nc]);
      }
    }

    const remainingClue = cell.clue - knownHazardsAround;
    return { unknowns, remainingClue };
  };

  let waves = 0;
  let progress = true;

  while (progress) {
    progress = false;
    let waveFoundNew = false;

    // Collect all currently revealed cells (plus visible occupied cars adjacent to revealed SAFE spaces
    // whose clues the player can glance at)
    const activeClueCells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (simRevealed[r][c]) {
          activeClueCells.push([r, c]);
        } else if (grid[r][c].visibleAtStart) {
          // If this visible car touches at least one revealed cell, a player can glance at its clue too
          const adjRevealed = getNeighbors(r, c, rows, cols).some(([nr, nc]) => simRevealed[nr][nc]);
          if (adjRevealed) {
            simRevealed[r][c] = true;
            activeClueCells.push([r, c]);
          }
        }
      }
    }

    // Pass 1: Single-cell rules
    for (const [r, c] of activeClueCells) {
      const { unknowns, remainingClue } = getActiveConstraint(r, c);
      if (unknowns.length === 0) continue;

      if (remainingClue === 0) {
        for (const [ur, uc] of unknowns) {
          if (!deducedSafe[ur][uc]) {
            deducedSafe[ur][uc] = true;
            simRevealed[ur][uc] = true;
            progress = true;
            waveFoundNew = true;
          }
        }
      } else if (remainingClue === unknowns.length) {
        for (const [ur, uc] of unknowns) {
          if (!deducedHazard[ur][uc]) {
            deducedHazard[ur][uc] = true;
            progress = true;
            waveFoundNew = true;
          }
        }
      }
    }

    // Pass 2: Pairwise subset / overlap Minesweeper deduction rules
    const constraints = activeClueCells
      .map(([r, c]) => ({ r, c, ...getActiveConstraint(r, c) }))
      .filter((item) => item.unknowns.length > 0);

    for (let i = 0; i < constraints.length; i++) {
      for (let j = 0; j < constraints.length; j++) {
        if (i === j) continue;
        const A = constraints[i];
        const B = constraints[j];

        const setA = new Set(A.unknowns.map(([ur, uc]) => `${ur},${uc}`));
        const setB = new Set(B.unknowns.map(([ur, uc]) => `${ur},${uc}`));

        // Check if A and B share at least one unknown cell
        let shared = 0;
        for (const k of setA) {
          if (setB.has(k)) shared++;
        }
        if (shared === 0) continue;

        const diffBA = B.unknowns.filter(([ur, uc]) => !setA.has(`${ur},${uc}`));
        const diffAB = A.unknowns.filter(([ur, uc]) => !setB.has(`${ur},${uc}`));

        // Identity: R_B - R_A = hazards(diffBA) - hazards(diffAB)
        // Upper bound on R_B - R_A is |diffBA| (when all of diffBA are hazards and none of diffAB are hazards)
        if (B.remainingClue - A.remainingClue === diffBA.length && (diffBA.length > 0 || diffAB.length > 0)) {
          for (const [ur, uc] of diffBA) {
            if (!deducedHazard[ur][uc]) {
              deducedHazard[ur][uc] = true;
              progress = true;
              waveFoundNew = true;
            }
          }
          for (const [ur, uc] of diffAB) {
            if (!deducedSafe[ur][uc]) {
              deducedSafe[ur][uc] = true;
              simRevealed[ur][uc] = true;
              progress = true;
              waveFoundNew = true;
            }
          }
        }
      }
    }

    if (waveFoundNew) {
      waves++;
    }
  }

  let deducedSafeCount = 0;
  let deducedHazardCount = 0;
  let deducedUpperRowSafeCount = 0;
  let deducedHighQualitySafeCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (deducedSafe[r][c] && cell.type === CELL_TYPES.SAFE) {
        deducedSafeCount++;
        if (r <= 1) deducedUpperRowSafeCount++;
        if (cell.qualityTier && (cell.qualityTier.id === 'PREMIUM' || cell.qualityTier.id === 'EXCELLENT')) {
          deducedHighQualitySafeCount++;
        }
      }
      if (deducedHazard[r][c] && cell.type === CELL_TYPES.HAZARD) {
        deducedHazardCount++;
      }
    }
  }

  return {
    waves,
    deducedSafeCount,
    deducedHazardCount,
    deducedUpperRowSafeCount,
    deducedHighQualitySafeCount,
    deducedSafe,
    deducedHazard
  };
}

/**
 * Validates that a generated board satisfies all V1 fairness, variety, and Minesweeper deduction rules.
 */
export function validateBoard(board, lot, activeModifierIds = []) {
  if (!board || !board.grid) {
    return { valid: false, reason: 'Missing board grid' };
  }
  const { grid } = board;
  if (grid.length !== lot.rows || grid[0].length !== lot.cols) {
    return { valid: false, reason: 'Dimension mismatch' };
  }

  let safeCount = 0;
  let preRevealedSafeCount = 0;
  let highQualitySafeCount = 0;
  let frontRowHazardCount = 0;
  let entranceAdjacentHazardCount = 0;
  let totalHazardCount = 0;
  let gooseCount = 0;
  let startingClueVantages = 0;
  const safeTierSet = new Set();
  const ents = normalizeEntrances(board.entrances || board.entranceCols, lot);

  for (let r = 0; r < lot.rows; r++) {
    for (let c = 0; c < lot.cols; c++) {
      const cell = grid[r][c];
      const neighbors = getNeighbors(r, c, lot.rows, lot.cols);
      const actualHazards = neighbors.filter(([nr, nc]) => isTroubleCell(grid[nr][nc])).length;
      if (cell.clue !== actualHazards) {
        return {
          valid: false,
          reason: `Clue mismatch at (${r},${c}): expected ${actualHazards}, got ${cell.clue}`
        };
      }

      if (cell.type === CELL_TYPES.SAFE) {
        safeCount++;
        if (cell.revealed || cell.visibleAtStart) {
          preRevealedSafeCount++;
        }
        if (cell.qualityTier) {
          safeTierSet.add(cell.qualityTier.id);
          if (cell.qualityTier.id === 'PREMIUM' || cell.qualityTier.id === 'EXCELLENT') {
            highQualitySafeCount++;
          }
        }
      } else if (cell.type === CELL_TYPES.HAZARD) {
        totalHazardCount++;
        if (r === 0) frontRowHazardCount++;
        const { minDistance } = getCellWalkingDistance(r, c, ents, lot.rows, lot.cols);
        if (minDistance <= 1.85) {
          entranceAdjacentHazardCount++;
        }
        if (cell.subtype === 'GOOSE') gooseCount++;
        if (cell.revealed || cell.visibleAtStart) {
          return { valid: false, reason: 'Hidden hazards must never be revealed at start' };
        }
      }

      if (cell.revealed) {
        startingClueVantages++;
      }
    }
  }

  if (preRevealedSafeCount > 0) {
    return { valid: false, reason: 'Safe spaces must not be pre-revealed at game start' };
  }
  if (safeCount < lot.minSafeSpaces) {
    return { valid: false, reason: `Insufficient safe spaces (${safeCount} < ${lot.minSafeSpaces})` };
  }
  if (highQualitySafeCount < 1) {
    return { valid: false, reason: 'No Premium or Excellent safe space available' };
  }
  if (entranceAdjacentHazardCount < 2) {
    return {
      valid: false,
      reason: `Entrance zone must contain at least 2 hidden hazards (${entranceAdjacentHazardCount}/2 found) so blind entrance clicking is dangerous`
    };
  }
  if (safeTierSet.size < 2) {
    return { valid: false, reason: 'Insufficient variety in safe space quality tiers' };
  }
  const minGeese = activeModifierIds.includes('goose') ? 2 : 1;
  if (gooseCount < minGeese) {
    return { valid: false, reason: `Insufficient geese (${gooseCount} < ${minGeese})` };
  }
  if (startingClueVantages < 1) {
    return { valid: false, reason: 'Missing starting clue vantage in entry zone' };
  }

  // Verify with the Minesweeper logical solver!
  const solved = solveBoardLogically(grid, lot);
  const minDeducedSafe = Math.max(4, Math.floor(safeCount * 0.55));
  if (solved.deducedSafeCount < minDeducedSafe) {
    return {
      valid: false,
      reason: `Logical solver only deduced ${solved.deducedSafeCount}/${minDeducedSafe} required safe spaces`
    };
  }
  if (solved.deducedHighQualitySafeCount < 1) {
    return {
      valid: false,
      reason: 'Logical solver could not reach any prime/high-quality safe space without guessing'
    };
  }
  if (solved.deducedHazardCount < 1) {
    return {
      valid: false,
      reason: 'Logical solver must be able to pinpoint at least 1 hidden hazard through clue combination'
    };
  }

  return {
    valid: true,
    safeCount,
    highQualitySafeCount,
    totalHazardCount,
    frontRowHazardCount,
    entranceAdjacentHazardCount,
    gooseCount,
    solver: {
      waves: solved.waves,
      deducedSafeCount: solved.deducedSafeCount,
      deducedHazardCount: solved.deducedHazardCount,
      deducedUpperRowSafeCount: solved.deducedUpperRowSafeCount,
      deducedHighQualitySafeCount: solved.deducedHighQualitySafeCount
    }
  };
}

/**
 * Legacy helper maintained for compatibility; returns count of logically deducible safe spaces.
 */
export function checkDeductionFoothold(grid, lot) {
  return solveBoardLogically(grid, lot).deducedSafeCount;
}

function pickRandom(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeBoardSignature(grid) {
  return grid
    .map((row) => row.map((c) => `${c.type[0]}${c.r}${c.c}`).join(''))
    .join('|');
}

/**
 * Selects an appropriate layout template and builds explicit perimeter entrance objects.
 */
export function selectLayoutTemplateAndEntrances(lot, rng = Math.random, templateOverride = null, edgeOverride = null) {
  const supported = lot.supportedTemplates || ['conventional'];
  const templateId = templateOverride && supported.includes(templateOverride)
    ? templateOverride
    : pickRandom(supported, rng);

  const rows = lot.rows;
  const cols = lot.cols;
  const entrances = [];
  let sectionDividerRow = null;

  if (templateId === 'conventional') {
    const edge = edgeOverride || (rng() < 0.65 ? 'top' : 'bottom');
    const doorCol = Math.max(1, Math.min(cols - 2, Math.floor(cols / 2) + (Math.floor(rng() * 3) - 1)));
    if (edge === 'bottom') {
      entrances.push({
        id: 'door_south',
        edge: 'bottom',
        label: `${lot.name} South Entrance`,
        doorRow: rows - 1,
        doorCol
      });
    } else {
      entrances.push({
        id: 'door_north',
        edge: 'top',
        label: `${lot.name} Main Entrance`,
        doorRow: 0,
        doorCol
      });
    }
  } else if (templateId === 'side') {
    const edge = edgeOverride || (rng() < 0.5 ? 'left' : 'right');
    const doorRow = Math.max(1, Math.min(rows - 2, Math.floor(rows / 2) + (Math.floor(rng() * 3) - 1)));
    if (edge === 'left') {
      entrances.push({
        id: 'door_west',
        edge: 'left',
        label: `${lot.name} West Arcade`,
        doorRow,
        doorCol: 0
      });
    } else {
      entrances.push({
        id: 'door_east',
        edge: 'right',
        label: `${lot.name} East Plaza`,
        doorRow,
        doorCol: cols - 1
      });
    }
  } else if (templateId === 'multiple') {
    const doorCol1 = Math.max(1, Math.floor(cols * 0.3));
    const doorCol2 = Math.min(cols - 2, Math.floor(cols * 0.7));
    entrances.push({
      id: 'door_north',
      edge: 'top',
      label: `${lot.name} North Gate`,
      doorRow: 0,
      doorCol: doorCol1
    });
    entrances.push({
      id: 'door_south',
      edge: 'bottom',
      label: `${lot.name} South Gate`,
      doorRow: rows - 1,
      doorCol: doorCol2
    });
  } else if (templateId === 'sectioned') {
    sectionDividerRow = Math.floor(rows / 2) - 1;
    const doorCol = Math.floor(cols / 2);
    entrances.push({
      id: 'door_concourse',
      edge: 'top',
      label: `${lot.name} Concourse Gate`,
      doorRow: 0,
      doorCol
    });
    if (rows >= 8) {
      entrances.push({
        id: 'door_south_concourse',
        edge: 'bottom',
        label: `${lot.name} South Annex`,
        doorRow: rows - 1,
        doorCol: Math.max(1, Math.min(cols - 2, doorCol + 1))
      });
    }
  }

  return { templateId, entrances, sectionDividerRow };
}

/**
 * Generates a candidate board for the given lot and active modifiers:
 * - Uses configurable layout templates (conventional, side entrance, multiple, sectioned).
 * - Models explicit perimeter entrance doors and destinations.
 * - Places an entry vantage SEDAN far from the entrance/target.
 * - Builds a winding deduction spine leading to prime spaces near the entrance.
 * - Places Hidden Hazards (`HAZARD`) guarding entrance doors so blind proximity clicking fails.
 */
function buildCandidateBoard(lot, activeModifierIds = [], rng = Math.random, templateOverride = null, edgeOverride = null) {
  const rows = lot.rows;
  const cols = lot.cols;
  const total = rows * cols;

  const hasCarts = activeModifierIds.includes('carts');
  const hasBadParkers = activeModifierIds.includes('badParkers');
  const hasGoose = activeModifierIds.includes('goose');

  const { templateId, entrances, sectionDividerRow } = selectLayoutTemplateAndEntrances(lot, rng, templateOverride, edgeOverride);

  let hazardRatio = lot.targetHazardRatio;
  let blockedRatio = lot.targetBlockedRatio;
  let occupiedRatio = lot.targetOccupiedRatio;

  if (hasCarts) {
    hazardRatio += MODIFIERS.carts.extraCartHazards;
    blockedRatio += MODIFIERS.carts.extraBlockedSpaces;
  }
  if (hasBadParkers) {
    occupiedRatio += MODIFIERS.badParkers.extraBadParkers * 0.5;
  }
  if (hasGoose) {
    hazardRatio += MODIFIERS.goose.extraGeese;
  }

  let hazardCount = Math.max(4, Math.round(total * hazardRatio));
  let blockedCount = Math.max(1, Math.round(total * blockedRatio));
  let occupiedCount = Math.max(4, Math.round(total * occupiedRatio));

  const maxNonSafe = total - (lot.minSafeSpaces + 2);
  while (hazardCount + blockedCount + occupiedCount > maxNonSafe) {
    if (occupiedCount > 4) occupiedCount--;
    else if (hazardCount > 4) hazardCount--;
    else if (blockedCount > 1) blockedCount--;
    else break;
  }

  // Initialize empty SAFE grid
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const stallId = `${String.fromCharCode(65 + r)}${c + 1}`;
      row.push({
        r,
        c,
        id: stallId,
        type: CELL_TYPES.SAFE,
        subtype: null,
        title: 'Open Parking Space',
        description: 'Unoccupied, freshly striped asphalt.',
        isBadParker: false,
        visibleAtStart: false,
        revealed: false,
        flagged: false,
        clue: 0,
        carColorIndex: Math.floor(rng() * 5)
      });
    }
    grid.push(row);
  }

  // 1. Calculate walking distance to closest entrance for every stall
  const distMap = [];
  let minDistOverall = Infinity;
  let maxDistOverall = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { minDistance } = getCellWalkingDistance(r, c, entrances, rows, cols);
      distMap.push({ r, c, dist: minDistance });
      if (minDistance < minDistOverall) minDistOverall = minDistance;
      if (minDistance > maxDistOverall) maxDistOverall = minDistance;
    }
  }

  // 2. Prime targets: spaces with walking distance within 1.35 of the minimum
  const primeTargets = distMap.filter((p) => p.dist <= minDistOverall + 1.35);
  shuffle(primeTargets, rng);
  const targetStall = primeTargets[0] || distMap[0];
  const targetCellCoord = [targetStall.r, targetStall.c];

  // 3. Entry vantage point: space situated far from the target / entrance
  const farCandidates = distMap.filter((p) => p.dist >= maxDistOverall - 2.2);
  shuffle(farCandidates, rng);
  const startStall = farCandidates[0] || distMap[distMap.length - 1];
  const startRow = startStall.r;
  const startCol = startStall.c;

  // 4. Build winding spine from startStall to targetStall
  let currR = startRow;
  let currC = startCol;
  const spine = [[currR, currC]];
  while (currR !== targetStall.r || currC !== targetStall.c) {
    const canMoveR = currR !== targetStall.r;
    const canMoveC = currC !== targetStall.c;
    let moveR = false;
    if (canMoveR && canMoveC) {
      moveR = rng() < 0.52;
    } else if (canMoveR) {
      moveR = true;
    } else {
      moveR = false;
    }
    if (moveR) currR += Math.sign(targetStall.r - currR);
    else currC += Math.sign(targetStall.c - currC);
    spine.push([currR, currC]);
  }

  // 5. Build hazardFreeZone
  const hazardFreeZone = new Set();
  // Clear all neighbors around starting entry vantage so start clue is 0
  hazardFreeZone.add(`${startRow},${startCol}`);
  for (const [nr, nc] of getNeighbors(startRow, startCol, rows, cols)) {
    hazardFreeZone.add(`${nr},${nc}`);
  }

  // Along spine
  for (let i = 0; i < spine.length; i++) {
    const [sr, sc] = spine[i];
    hazardFreeZone.add(`${sr},${sc}`);
    if (i < 2) {
      for (const [nr, nc] of getNeighbors(sr, sc, rows, cols)) {
        hazardFreeZone.add(`${nr},${nc}`);
      }
    } else if (i < spine.length - 1 && rng() < 0.6) {
      for (const [nr, nc] of getNeighbors(sr, sc, rows, cols)) {
        if (Math.hypot(nr - targetStall.r, nc - targetStall.c) >= 1.5) {
          hazardFreeZone.add(`${nr},${nc}`);
        }
      }
    }
  }
  // Ensure the stepping stone before target is safe
  if (spine.length >= 2) {
    const [penultR, penultC] = spine[spine.length - 2];
    hazardFreeZone.add(`${penultR},${penultC}`);
    for (const [nr, nc] of getNeighbors(penultR, penultC, rows, cols)) {
      if (Math.hypot(nr - targetStall.r, nc - targetStall.c) >= 1.4 && rng() < 0.5) {
        hazardFreeZone.add(`${nr},${nc}`);
      }
    }
  }
  hazardFreeZone.add(`${targetStall.r},${targetStall.c}`);

  // Place our primary entry vantage SEDAN at (startRow, startCol)
  const vantageCell = grid[startRow][startCol];
  vantageCell.type = CELL_TYPES.OCCUPIED;
  vantageCell.subtype = 'SEDAN';
  vantageCell.isBadParker = false;
  vantageCell.visibleAtStart = true;
  vantageCell.revealed = true;
  vantageCell.title = OBSTACLE_SUBTYPES.SEDAN.name;
  vantageCell.description = OBSTACLE_SUBTYPES.SEDAN.description;
  occupiedCount = Math.max(0, occupiedCount - 1);

  // Hidden Hazard placement:
  // Sort eligible cells outside hazardFreeZone so cells closest to ANY entrance door get placed first!
  const hazardEligible = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (hazardFreeZone.has(key)) continue;
      hazardEligible.push([r, c]);
    }
  }
  shuffle(hazardEligible, rng);
  hazardEligible.sort((a, b) => {
    const distA = distMap.find((p) => p.r === a[0] && p.c === a[1]).dist;
    const distB = distMap.find((p) => p.r === b[0] && p.c === b[1]).dist;
    return distA - distB + (rng() - 0.5) * 0.7;
  });

  // 1. Place The Goose (at least 1 in standard, 2-4 in Goose Patrol)
  const gooseTarget = hasGoose ? Math.min(4, Math.max(2, Math.round(total * 0.08))) : 1;
  let geesePlaced = 0;
  let hIdx = 0;

  while (geesePlaced < gooseTarget && hazardCount > 0 && hIdx < hazardEligible.length) {
    const [r, c] = hazardEligible[hIdx++];
    if (r === targetStall.r && c === targetStall.c) continue;
    const cell = grid[r][c];
    if (cell.type !== CELL_TYPES.SAFE) continue;
    cell.type = CELL_TYPES.HAZARD;
    cell.subtype = 'GOOSE';
    cell.title = HAZARD_SUBTYPES.GOOSE.name;
    cell.description = pickRandom(HAZARD_SUBTYPES.GOOSE.descriptions, rng);
    geesePlaced++;
    hazardCount--;
  }

  // 2. Place remaining Hidden Hazards
  const otherHazardTypes = hasCarts
    ? ['CART', 'CART', 'CART', 'ETERNAL_REVERSE', 'MYSTERY_STAIN']
    : ['CART', 'ETERNAL_REVERSE', 'MYSTERY_STAIN'];

  while (hazardCount > 0 && hIdx < hazardEligible.length) {
    const [r, c] = hazardEligible[hIdx++];
    if (r === targetStall.r && c === targetStall.c) continue;
    const cell = grid[r][c];
    if (cell.type !== CELL_TYPES.SAFE) continue;
    const hKey = pickRandom(otherHazardTypes, rng);
    const hDef = HAZARD_SUBTYPES[hKey];
    cell.type = CELL_TYPES.HAZARD;
    cell.subtype = hKey;
    cell.title = hDef.name;
    cell.description = pickRandom(hDef.descriptions, rng);
    hazardCount--;
  }

  // 3. Place Physically Blocked Stalls (`CONCRETE_PILLAR` and `CART_CORRAL_OVERFLOW`)
  const remainingCoords = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].type === CELL_TYPES.SAFE && !(r === targetStall.r && c === targetStall.c)) {
        remainingCoords.push([r, c]);
      }
    }
  }
  shuffle(remainingCoords, rng);

  let rIdx = 0;
  const blockedTypes = hasCarts
    ? ['CART_CORRAL_OVERFLOW', 'CONCRETE_PILLAR']
    : ['CONCRETE_PILLAR', 'CART_CORRAL_OVERFLOW'];

  while (blockedCount > 0 && rIdx < remainingCoords.length) {
    const [r, c] = remainingCoords[rIdx++];
    if (hazardFreeZone.has(`${r},${c}`)) continue;
    const cell = grid[r][c];
    const bKey = pickRandom(blockedTypes, rng);
    const bDef = OBSTACLE_SUBTYPES[bKey];
    cell.type = CELL_TYPES.BLOCKED;
    cell.subtype = bKey;
    cell.visibleAtStart = true;
    cell.title = bDef.name;
    cell.description = bDef.description;
    blockedCount--;
  }

  // 4. Place Visibly Occupied Vehicles (`SEDAN`, `OVERSIZED_TRUCK`, `LINE_STRADDLER`)
  const badParkerTarget = hasBadParkers
    ? Math.max(3, Math.round(occupiedCount * 0.55))
    : Math.max(1, Math.round(occupiedCount * 0.28));

  let badParkersPlaced = 0;
  let secondaryVantagesRevealed = 0;

  while (occupiedCount > 0 && rIdx < remainingCoords.length) {
    const [r, c] = remainingCoords[rIdx++];
    if (hazardFreeZone.has(`${r},${c}`) && rng() < 0.75) continue;

    const cell = grid[r][c];
    if (cell.type !== CELL_TYPES.SAFE) continue;

    if (badParkersPlaced < badParkerTarget && !hazardFreeZone.has(`${r},${c}`)) {
      const bpKey = rng() < 0.55 ? 'OVERSIZED_TRUCK' : 'LINE_STRADDLER';
      const bpDef = OBSTACLE_SUBTYPES[bpKey];
      cell.type = CELL_TYPES.OCCUPIED;
      cell.subtype = bpKey;
      cell.isBadParker = true;
      cell.visibleAtStart = true;
      cell.title = bpDef.name;
      cell.description = bpDef.description;
      badParkersPlaced++;
    } else {
      const sDef = OBSTACLE_SUBTYPES.SEDAN;
      cell.type = CELL_TYPES.OCCUPIED;
      cell.subtype = 'SEDAN';
      cell.isBadParker = false;
      cell.visibleAtStart = true;
      cell.title = sDef.name;
      cell.description = sDef.description;

      const pDist = distMap.find((p) => p.r === r && p.c === c)?.dist || 0;
      if (pDist > minDistOverall + 1.5 && secondaryVantagesRevealed < 2 && rng() < 0.45) {
        cell.revealed = true;
        secondaryVantagesRevealed++;
      }
    }
    occupiedCount--;
  }

  computeBoardMetrics(grid, lot, activeModifierIds, entrances);

  return {
    lotId: lot.id,
    modifiers: [...activeModifierIds],
    layoutTemplate: templateId,
    entrances,
    entranceCols: entrances.filter((e) => e.edge === 'top').map((e) => e.doorCol),
    sectionDividerRow,
    rows,
    cols,
    grid,
    startCell: [startRow, startCol],
    targetCell: targetCellCoord,
    signature: computeBoardSignature(grid)
  };
}

/**
 * Inspects a single cell (r, c) without auto-cascading across the board.
 */
export function revealWithCascade(grid, startR, startC) {
  const newlyRevealed = [];
  const startCell = grid[startR]?.[startC];
  if (!startCell || startCell.revealed) return newlyRevealed;

  startCell.revealed = true;
  startCell.flagged = false;
  newlyRevealed.push(startCell);
  return newlyRevealed;
}

/**
 * Generates and validates a board using the Minesweeper logical solver,
 * automatically rejecting and regenerating any layout that fails solvability,
 * front-row hazard requirements, or duplicates the previous round's layout.
 */
export function generateValidBoard(
  lotId = 'dollar',
  activeModifierIds = [],
  rng = Math.random,
  templateOverride = null,
  edgeOverride = null
) {
  const lot = LOTS[lotId] || LOTS.dollar;
  const sanitizedModifiers = validateModifierCombination(activeModifierIds);

  const maxAttempts = 120;
  let lastBoard = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = buildCandidateBoard(lot, sanitizedModifiers, rng, templateOverride, edgeOverride);
    if (lastGeneratedSignature && candidate.signature === lastGeneratedSignature && attempt < maxAttempts) {
      continue;
    }
    const check = validateBoard(candidate, lot, sanitizedModifiers);
    lastBoard = candidate;
    if (check.valid) {
      lastGeneratedSignature = candidate.signature;
      candidate.validation = {
        ...check,
        attempts: attempt
      };
      return candidate;
    }
  }

  ensureFallbackValidity(lastBoard, lot, sanitizedModifiers);
  lastGeneratedSignature = lastBoard.signature;
  lastBoard.validation = {
    ...validateBoard(lastBoard, lot, sanitizedModifiers),
    attempts: maxAttempts
  };
  return lastBoard;
}

export function validateModifierCombination(modifierIds = []) {
  if (!Array.isArray(modifierIds)) return [];
  const validExtras = ['carts', 'badParkers', 'goose'];
  const filtered = [];
  for (const id of modifierIds) {
    if (validExtras.includes(id) && !filtered.includes(id)) {
      filtered.push(id);
    }
  }
  return filtered;
}

function ensureFallbackValidity(board, lot, activeModifierIds) {
  const { grid, rows, cols } = board;
  const eCols = board.entranceCols || lot.entranceCols;
  const safeFrontCol = eCols[0] ?? Math.min(cols - 1, 2);
  const hazardFrontCol1 = safeFrontCol === 0 ? cols - 1 : 0;
  const hazardFrontCol2 = safeFrontCol === cols - 1 ? 1 : cols - 1;

  for (const hc of [hazardFrontCol1, hazardFrontCol2]) {
    grid[0][hc].type = CELL_TYPES.HAZARD;
    grid[0][hc].subtype = hc === hazardFrontCol1 ? 'GOOSE' : 'CART';
    grid[0][hc].title = HAZARD_SUBTYPES[grid[0][hc].subtype].name;
    grid[0][hc].description = HAZARD_SUBTYPES[grid[0][hc].subtype].descriptions[0];
    grid[0][hc].visibleAtStart = false;
    grid[0][hc].revealed = false;
  }

  grid[0][safeFrontCol].type = CELL_TYPES.SAFE;
  grid[0][safeFrontCol].subtype = null;
  grid[0][safeFrontCol].isBadParker = false;
  grid[0][safeFrontCol].visibleAtStart = false;
  grid[0][safeFrontCol].revealed = false;

  // Clear neighbors of (0, safeFrontCol) so it is guaranteed Premium/Excellent and deducible
  for (const [nr, nc] of getNeighbors(0, safeFrontCol, rows, cols)) {
    if (nr === 0 && (nc === hazardFrontCol1 || nc === hazardFrontCol2)) continue;
    grid[nr][nc].type = CELL_TYPES.SAFE;
    grid[nr][nc].subtype = null;
    grid[nr][nc].isBadParker = false;
    grid[nr][nc].visibleAtStart = false;
    grid[nr][nc].revealed = false;
  }

  // Clear a deduction corridor from row (rows-2) up to row 0 around safeFrontCol
  for (let r = 1; r < rows; r++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = safeFrontCol + dc;
      if (c < 0 || c >= cols) continue;
      const cell = grid[r][c];
      if (r === rows - 2 && dc === 0) {
        cell.type = CELL_TYPES.OCCUPIED;
        cell.subtype = 'SEDAN';
        cell.isBadParker = false;
        cell.visibleAtStart = true;
        cell.revealed = true;
      } else if (r === 1 && dc === -1) {
        cell.type = CELL_TYPES.OCCUPIED;
        cell.subtype = 'SEDAN';
        cell.isBadParker = false;
        cell.visibleAtStart = true;
        cell.revealed = true;
      } else {
        cell.type = CELL_TYPES.SAFE;
        cell.subtype = null;
        cell.isBadParker = false;
        cell.visibleAtStart = false;
        cell.revealed = false;
      }
    }
  }

  computeBoardMetrics(grid, lot, activeModifierIds, board.entrances || board.entranceCols);
  board.signature = computeBoardSignature(grid);
}
