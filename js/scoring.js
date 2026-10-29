/**
 * Parking Lot V1 - Scoring, Time Efficiency & Parking Resolution
 * Formula: Final Score = Base Score × Space Quality × Difficulty × Time Efficiency − Penalties
 */

import {
  LOTS,
  MODIFIERS,
  ACCIDENT_OUTCOMES,
  QUALITY_TIERS,
  GOOSE_QUIPS
} from './config.js';

export const BASE_SCORE = 1000;

/** Extra penalty per unlocated adjacent hazard on an AWKWARD (unverified) park. */
export const UNVERIFIED_HAZARD_PENALTY = 160;

/**
 * Pure re-computation of a successful round's final score from its components.
 * Used by the leaderboard server to verify client-claimed scores with the exact same
 * rules as the client (same config, same formula). Returns null for invalid components.
 */
export function recomputeFinalScore({
  lotId,
  modifiers = [],
  qualityId,
  outcomeId,
  unlocatedHazards = 0,
  elapsedSeconds
}) {
  const lot = LOTS[lotId];
  const tier = Object.values(QUALITY_TIERS).find((t) => t.id === qualityId);
  const outcome = Object.values(ACCIDENT_OUTCOMES).find((o) => o.id === outcomeId);
  if (!lot || !tier || !outcome) return null;
  if (!Number.isInteger(elapsedSeconds) || elapsedSeconds < 0) return null;
  if (!Number.isInteger(unlocatedHazards) || unlocatedHazards < 0 || unlocatedHazards > 8) return null;
  if (unlocatedHazards > 0 && outcome.id !== 'AWKWARD') return null;

  const diff = calculateDifficultyMultiplier(lotId, modifiers);
  const time = calculateTimeEfficiency(elapsedSeconds, lotId);
  const gross = Math.round(BASE_SCORE * tier.multiplier * diff.totalMultiplier * time.multiplier);
  const penalty = outcome.penalty + (outcome.id === 'AWKWARD' ? unlocatedHazards * UNVERIFIED_HAZARD_PENALTY : 0);
  const deductible = outcome.deductible || 0;
  return {
    finalScore: Math.max(50, gross - penalty - deductible),
    difficultyMultiplier: diff.totalMultiplier,
    grossScore: gross,
    penalty,
    deductible
  };
}

/**
 * Calculates total difficulty multiplier from lot base difficulty and active modifiers.
 * Avoids double-counting and keeps the formula transparent.
 */
export function calculateDifficultyMultiplier(lotId, activeModifierIds = []) {
  const lot = LOTS[lotId] || LOTS.dollar;
  let modBonus = 0;
  const activeModDetails = [];

  for (const id of activeModifierIds) {
    const mod = MODIFIERS[id];
    if (mod && !mod.isBaseline) {
      modBonus += mod.multiplierBonus;
      activeModDetails.push({
        id: mod.id,
        name: mod.name,
        bonus: mod.multiplierBonus
      });
    }
  }

  const totalMultiplier = Math.round((lot.baseDifficultyMultiplier + modBonus) * 100) / 100;
  return {
    lotMultiplier: lot.baseDifficultyMultiplier,
    modifierBonus: Math.round(modBonus * 100) / 100,
    totalMultiplier,
    activeModDetails
  };
}

/**
 * Calculates a bounded Time Efficiency Multiplier between 0.55x and 1.35x.
 * - <= maxEfficiencyBonusTime: 1.35x (Quick decisive park)
 * - == parTimeSeconds: 1.00x (On par)
 * - >= parTimeSeconds * 2.5: 0.55x (Floor — never drops to 0 or negative)
 */
export function calculateTimeEfficiency(elapsedSeconds, lotId) {
  const lot = LOTS[lotId] || LOTS.dollar;
  const t = Math.max(0, Number(elapsedSeconds) || 0);
  const fastTime = lot.maxEfficiencyBonusTime;
  const parTime = lot.parTimeSeconds;
  const slowCap = parTime * 2.5;

  let multiplier;
  let ratingLabel;

  if (t <= fastTime) {
    multiplier = 1.35;
    ratingLabel = 'Lightning Commuter';
  } else if (t <= parTime) {
    const ratio = (t - fastTime) / Math.max(1, parTime - fastTime);
    multiplier = 1.35 - ratio * 0.35; // 1.35 down to 1.00
    ratingLabel = ratio < 0.5 ? 'Brisk & Decisive' : 'Reasonable Search';
  } else if (t <= slowCap) {
    const ratio = (t - parTime) / Math.max(1, slowCap - parTime);
    multiplier = 1.00 - ratio * 0.45; // 1.00 down to 0.55
    ratingLabel = ratio < 0.5 ? 'Lingering Prowl' : 'Suburban Orbit';
  } else {
    multiplier = 0.55;
    ratingLabel = 'Geological Epoch';
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    ratingLabel
  };
}

/**
 * Builds a physically specific, context-aware narrative describing exactly what occurred
 * during the parking maneuver (which obstacle was clipped, which hazard was triggered,
 * or whether the maneuver was blind into unverified hazards).
 */
export function buildIncidentNarrative(outcomeDef, cell, evalInfo = null, rng = Math.random) {
  const stats = cell?.neighborStats || {};
  const stallId = cell ? `Stall ${cell.id}` : 'the stall';
  const unlocated = evalInfo ? evalInfo.unlocatedHazards : 0;
  const roll = rng();

  if (outcomeDef.id === 'SERIOUS_MISHAP') {
    if (unlocated > 0 && stats.badParkerCount > 0) {
      return `Blind entry collision: While pulling into ${stallId} without verifying ${unlocated} adjacent hazard${unlocated > 1 ? 's' : ''}, you clipped the extended tow mirror of an encroaching truck and crumpled your front quarter panel.`;
    }
    if (unlocated > 0 && stats.cartNeighborCount > 0) {
      return `Unverified hazard collision: Entering ${stallId} with ${unlocated} unlocated hazard${unlocated > 1 ? 's' : ''} pushed a concealed shopping cart violently into an adjacent car's door panel with an unmistakable crunch.`;
    }
    if (unlocated > 0) {
      return `Blind-spot impact: Committing to ${stallId} with ${unlocated} uninspected hazard${unlocated > 1 ? 's' : ''} caused a direct collision with an unseen obstacle, setting off multiple car alarms.`;
    }
    if (stats.gooseNeighborCount > 0) {
      return `Territorial Goose panic: A furious hiss from the Goose nesting beside ${stallId} caused an abrupt overcorrection, backing hard into a concrete barrier and shattering a taillight.`;
    }
    if (stats.badParkerCount > 0) {
      return `Severe squeeze impact: Wedging into ${stallId} beside an encroaching oversized vehicle folded your driver-side mirror backward and creased two body panels.`;
    }
    if (stats.cartNeighborCount > 0) {
      return `Runaway cart collision: An unstable cluster of metal shopping carts caught your front bumper at full lock, cracking the front grille and dislodging trim.`;
    }
    if (stats.blockedCount > 0) {
      return `Pillar collision: Misjudging the approach around the concrete light pole flanking ${stallId} resulted in a resonant bumper scrape and dented rim.`;
    }
    return `Major parking scrape: An aggressive turn into ${stallId} resulted in an audible crunch and deep paint transfer against the adjacent vehicle's bumper.`;
  }

  if (outcomeDef.id === 'CART_COLLISION') {
    if (unlocated > 0) {
      return `Unlocated cart strike: An unverified shopping cart lurking beside ${stallId} rolled into your front passenger door just as you came to a halt.`;
    }
    const cartTexts = [
      `A rogue shopping cart with a seized wheel caught your front bumper at point-blank range while parking in ${stallId}.`,
      `Metallic clang in ${stallId}: an abandoned steel cart rolled off the curb and bounced hard off your front fender.`,
      `You steered into ${stallId} cleanly, but a drifting shopping cart struck your rear quarter panel with a sharp hollow thud.`
    ];
    return cartTexts[Math.floor(roll * cartTexts.length)];
  }

  if (outcomeDef.id === 'FENDER_BENDER') {
    if (unlocated > 0 && stats.badParkerCount > 0) {
      return `Unverified clearance scrape: Maneuvering into ${stallId} with ${unlocated} unlocated hazard${unlocated > 1 ? 's' : ''} led to a low-speed fender scrape against the vehicle straddling the line.`;
    }
    if (unlocated > 0) {
      return `Blind-spot scrape: Entering ${stallId} without verifying ${unlocated} neighboring hazard${unlocated > 1 ? 's' : ''} ended in a low-speed bumper contact with an unseen obstacle.`;
    }
    if (stats.badParkerCount > 0) {
      return `Tight clearance contact: The diagonal line-straddler next to ${stallId} left virtually zero margin; your rear bumper kissed their quarter panel as you straightened out.`;
    }
    if (stats.gooseNeighborCount > 0) {
      return `Goose distraction: While warily tracking the Goose guarding the adjacent stall, you gently nudged the concrete curb at 3 mph.`;
    }
    if (stats.blockedCount > 0) {
      return `Obstacle scrape: You clipped the painted yellow base of the concrete light pole beside ${stallId} while squaring up your wheels.`;
    }
    const benderTexts = [
      `Low-speed bumper contact in ${stallId}: plastic met plastic with an unmistakable hollow thud and fresh bumper scuffs.`,
      `A miscalculated swing into ${stallId} left noticeable paint transfer and an awkward note under an adjacent windshield wiper.`,
      `Slight misjudgment on entry: your front bumper grazed the neighboring vehicle's bumper corner while straightening out in ${stallId}.`
    ];
    return benderTexts[Math.floor(roll * benderTexts.length)];
  }

  if (outcomeDef.id === 'AWKWARD') {
    if (unlocated > 0) {
      return `Unverified surroundings: You committed to ${stallId} without locating ${unlocated} adjacent hidden hazard${unlocated > 1 ? 's' : ''}, forcing a tense, crooked crawl between the lines.`;
    }
    if (stats.badParkerCount > 0) {
      return `Cramped squeeze: You successfully wedged into ${stallId} beside an encroaching oversized vehicle, but you will be exhaling deeply to squeeze through your door.`;
    }
    const awkwardTexts = [
      `Crooked alignment in ${stallId}: completely legal, technically between the lines, but your dignity took minor damage.`,
      `It took a three-point correction in front of two staring pedestrians, but you are parked without physical damage in ${stallId}.`,
      `You parked at a noticeable 12-degree tilt in ${stallId}, stepped out, sighed, and decided to live with it.`
    ];
    return awkwardTexts[Math.floor(roll * awkwardTexts.length)];
  }

  // CLEAN
  const cleanTexts = [
    `Crisp alignment in ${stallId}. Equal margin on both sides, zero paint transfer, and your dignity intact.`,
    `Parked in ${stallId} with a single fluid motion. A passerby offered a quiet nod of respect.`,
    `Centered between the lines of ${stallId} with ample door clearance. A flawless parking maneuver.`
  ];
  return cleanTexts[Math.floor(roll * cleanTexts.length)];
}

/**
 * Builds a concise, punchy lead-in line for the top banner header,
 * keeping the detailed collision narrative in the Incident Report card below.
 */
export function buildHeaderLead(outcomeDef, cell, evalInfo = null) {
  const unlocated = evalInfo ? evalInfo.unlocatedHazards : 0;
  const stallId = cell ? `Stall ${cell.id}` : 'the space';

  if (outcomeDef.id === 'SERIOUS_MISHAP') {
    return unlocated > 0
      ? `Blind maneuver into ${stallId} triggered a multi-point collision.`
      : `High-impact collision while securing ${stallId}.`;
  }
  if (outcomeDef.id === 'CART_COLLISION') {
    return `Struck by an unanchored shopping cart while entering ${stallId}.`;
  }
  if (outcomeDef.id === 'FENDER_BENDER') {
    return unlocated > 0
      ? `Blind entry into ${stallId} led to low-speed bumper contact.`
      : `Low-speed bumper contact while squaring up in ${stallId}.`;
  }
  if (outcomeDef.id === 'AWKWARD') {
    return unlocated > 0
      ? `Parked legally, but ${unlocated} unverified hazard${unlocated > 1 ? 's' : ''} forced a tense, crooked crawl.`
      : `Parked legally between the lines, but with an awkward multi-point correction.`;
  }
  return `Flawless alignment in ${stallId} with zero paint transfer.`;
}

/**
 * Resolves the immediate parking outcome when the player commits to a safe space.
 * Uses both the space's baseline risk and whether the player verified adjacent hazards via deduction.
 */
export function resolveParkingOutcome(cell, activeModifierIds = [], rng = Math.random, evalInfo = null) {
  const unlocatedHazards = evalInfo ? evalInfo.unlocatedHazards : 0;
  const risk = evalInfo && typeof evalInfo.effectiveAccidentRisk === 'number'
    ? evalInfo.effectiveAccidentRisk
    : (cell.accidentRisk || 0);
  const roll = rng();

  if (risk > 0 && roll < risk) {
    // An accident occurred! Choose the specific incident based on adjacent hazards
    const stats = cell.neighborStats || {};
    let outcomeDef;

    if (risk >= 0.32 && rng() < 0.35) {
      outcomeDef = ACCIDENT_OUTCOMES.SERIOUS_MISHAP;
    } else if (stats.cartNeighborCount > 0 && (stats.badParkerCount === 0 || rng() < 0.6)) {
      outcomeDef = ACCIDENT_OUTCOMES.CART_COLLISION;
    } else {
      outcomeDef = ACCIDENT_OUTCOMES.FENDER_BENDER;
    }

    const headerLead = buildHeaderLead(outcomeDef, cell, evalInfo);
    const incidentReport = buildIncidentNarrative(outcomeDef, cell, evalInfo, rng);
    const gooseLine = GOOSE_QUIPS.resultAccident[Math.floor(rng() * GOOSE_QUIPS.resultAccident.length)];

    return {
      outcomeId: outcomeDef.id,
      title: outcomeDef.title,
      isAccident: true,
      penalty: outcomeDef.penalty,
      deductible: outcomeDef.deductible,
      totalPenalty: outcomeDef.penalty + outcomeDef.deductible,
      badgeClass: outcomeDef.badgeClass,
      headerLead,
      incidentReport,
      message: incidentReport,
      gooseLine
    };
  }

  // Requirement 4: Do not allow a guaranteed clean-park result for a space with unverified adjacent hazards!
  const isTightSqueeze = unlocatedHazards > 0 || (risk >= 0.14 && roll < risk + 0.18);
  if (isTightSqueeze) {
    const outcomeDef = ACCIDENT_OUTCOMES.AWKWARD;
    const extraUnverifiedPenalty = unlocatedHazards * UNVERIFIED_HAZARD_PENALTY;
    const totalAwkwardPenalty = outcomeDef.penalty + extraUnverifiedPenalty;
    const headerLead = buildHeaderLead(outcomeDef, cell, evalInfo);
    const incidentReport = buildIncidentNarrative(outcomeDef, cell, evalInfo, rng);
    const gooseLine = GOOSE_QUIPS.resultAwkward[Math.floor(rng() * GOOSE_QUIPS.resultAwkward.length)];
    return {
      outcomeId: outcomeDef.id,
      title: outcomeDef.title,
      isAccident: false,
      penalty: totalAwkwardPenalty,
      deductible: 0,
      totalPenalty: totalAwkwardPenalty,
      badgeClass: outcomeDef.badgeClass,
      headerLead,
      incidentReport,
      message: incidentReport,
      gooseLine
    };
  }

  const outcomeDef = ACCIDENT_OUTCOMES.CLEAN;
  const headerLead = buildHeaderLead(outcomeDef, cell, evalInfo);
  const incidentReport = buildIncidentNarrative(outcomeDef, cell, evalInfo, rng);
  const gooseLine = GOOSE_QUIPS.resultClean[Math.floor(rng() * GOOSE_QUIPS.resultClean.length)];
  return {
    outcomeId: outcomeDef.id,
    title: outcomeDef.title,
    isAccident: false,
    penalty: 0,
    deductible: 0,
    totalPenalty: 0,
    badgeClass: outcomeDef.badgeClass,
    headerLead,
    incidentReport,
    message: incidentReport,
    gooseLine
  };
}

/**
 * Computes the complete score breakdown for a completed round.
 */
export function calculateScoreBreakdown({
  lotId,
  activeModifierIds = [],
  elapsedSeconds = 0,
  patienceRemaining = 100,
  selectedCell = null,
  parkingResolution = null,
  patienceFailed = false
}) {
  const diffInfo = calculateDifficultyMultiplier(lotId, activeModifierIds);
  const timeInfo = calculateTimeEfficiency(elapsedSeconds, lotId);

  if (patienceFailed || !selectedCell) {
    const gooseLine =
      GOOSE_QUIPS.resultPatienceFail[
        Math.floor(Math.random() * GOOSE_QUIPS.resultPatienceFail.length)
      ];
    return {
      success: false,
      patienceFailed: true,
      baseScore: 0,
      spaceQualityLabel: 'None (Drove Home)',
      spaceQualityMultiplier: 0,
      difficultyMultiplier: diffInfo.totalMultiplier,
      difficultyDetails: diffInfo,
      timeEfficiencyMultiplier: timeInfo.multiplier,
      timeEfficiencyLabel: timeInfo.ratingLabel,
      grossScore: 0,
      accidentPenalty: 0,
      insuranceDeductible: 0,
      totalPenalties: 0,
      finalScore: 0,
      patienceRemaining: 0,
      outcomeTitle: 'Patience Exhausted',
      outcomeMessage:
        'You circled the lot one time too many, muttered dark prophecies about urban planning, and drove home empty-handed.',
      gooseLine,
      humorousSummary:
        'Zero items purchased. Zero spaces parked in. The Goose considers this a decisive victory.'
    };
  }

  const qualityTier = selectedCell.qualityTier;
  const qualityMult = qualityTier.multiplier;
  const diffMult = diffInfo.totalMultiplier;
  const timeMult = timeInfo.multiplier;

  // Core formula: Base Score × Space Quality × Difficulty × Time Efficiency − Penalties
  const grossScore = Math.round(BASE_SCORE * qualityMult * diffMult * timeMult);

  // Accidents and deductibles strictly reflect the parking maneuver resolution
  const accidentPenalty = parkingResolution ? (parkingResolution.penalty || 0) : 0;
  const insuranceDeductible = parkingResolution ? (parkingResolution.deductible || 0) : 0;
  const totalPenalties = accidentPenalty + insuranceDeductible;

  const finalScore = Math.max(50, grossScore - totalPenalties);

  const humorousSummary = buildHumorousSummary({
    qualityTier,
    elapsedSeconds,
    lotId,
    parkingResolution,
    patienceRemaining
  });

  return {
    success: true,
    patienceFailed: false,
    baseScore: BASE_SCORE,
    stallId: selectedCell.id,
    spaceQualityId: qualityTier.id,
    spaceQualityStars: qualityTier.stars || '★★★☆☆',
    spaceQualityLabel: qualityTier.label,
    spaceQualityMultiplier: qualityMult,
    difficultyMultiplier: diffMult,
    difficultyDetails: diffInfo,
    timeEfficiencyMultiplier: timeMult,
    timeEfficiencyLabel: timeInfo.ratingLabel,
    grossScore,
    accidentPenalty,
    insuranceDeductible,
    totalPenalties,
    finalScore,
    patienceRemaining,
    outcomeId: parkingResolution ? parkingResolution.outcomeId : 'CLEAN',
    outcomeTitle: parkingResolution ? parkingResolution.title : 'Clean Park',
    headerLead: parkingResolution ? (parkingResolution.headerLead || '') : '',
    incidentReport: parkingResolution ? (parkingResolution.incidentReport || parkingResolution.message || '') : '',
    outcomeMessage: parkingResolution ? parkingResolution.message : '',
    penaltyLabel: (parkingResolution && parkingResolution.isAccident)
      ? '− Accident Damage Penalty'
      : (accidentPenalty > 0)
      ? '− Parking Anxiety Penalty'
      : '− Penalty',
    isAccident: Boolean(parkingResolution && parkingResolution.isAccident),
    gooseLine: parkingResolution ? parkingResolution.gooseLine : GOOSE_QUIPS.resultClean[0],
    humorousSummary
  };
}

/**
 * Generates a context-sensitive humorous summary based on the actual outcome.
 */
function buildHumorousSummary({
  qualityTier,
  elapsedSeconds,
  lotId,
  parkingResolution,
  patienceRemaining
}) {
  const lot = LOTS[lotId] || LOTS.dollar;
  const isFast = elapsedSeconds <= lot.maxEfficiencyBonusTime + 6;
  const isSlow = elapsedSeconds > lot.parTimeSeconds * 1.25;
  const isAccident = parkingResolution && parkingResolution.isAccident;

  if (isAccident) {
    if (qualityTier.id === 'PREMIUM' || qualityTier.id === 'EXCELLENT') {
      return 'You found a front-row space, but the deductible found you.';
    }
    if (qualityTier.id === 'DEEPLY_UNFORTUNATE' || qualityTier.id === 'TECHNICALLY_LEGAL') {
      return 'You parked in the far reaches of civilization AND still filed an insurance claim. Remarkable.';
    }
    return 'You have successfully converted a routine shopping trip into an actuarial event.';
  }

  if (qualityTier.id === 'PREMIUM') {
    if (isFast) {
      return 'Premium spot. Minimal waiting. Your insurance agent remains unaware.';
    }
    if (isSlow) {
      return 'You waited long enough to watch seasons change, but you did land the VIP spot.';
    }
    return 'Front-row luxury secured. You are walking through the automatic doors like royalty.';
  }

  if (qualityTier.id === 'EXCELLENT') {
    if (isFast) {
      return 'Swift, sensible, and steps from the door. Clinical parking execution.';
    }
    return 'An excellent space with zero drama. The Goose is struggling to find fault.';
  }

  if (qualityTier.id === 'ACCEPTABLE') {
    if (isFast) {
      return 'You saw an acceptable spot and took it immediately. Peak emotional maturity.';
    }
    if (isSlow) {
      return 'Acceptable parking after a deeply philosophical tour of the asphalt.';
    }
    return 'Acceptable parking. Questionable excitement, undeniable efficiency.';
  }

  if (qualityTier.id === 'TECHNICALLY_LEGAL') {
    if (isSlow) {
      return `You spent ${Math.round(elapsedSeconds)} seconds finding a space that added three minutes to your walk.`;
    }
    return 'Technically legal. You may need hiking boots to reach the entrance, but the car is safe.';
  }

  // DEEPLY_UNFORTUNATE
  if (patienceRemaining <= 20) {
    return 'Desperation parking in the outer wastelands, but you survived with your sanity barely intact.';
  }
  return 'You voluntarily parked in the shadowlands. Even the shopping carts are afraid to roll out this far.';
}
