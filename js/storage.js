/**
 * Parking Lot V1 - LocalStorage Persistence & Records Manager
 * Persists only: Best score, Games played, Successful parks, Accidents (overall & per-lot), plus sound mute setting.
 */

import { LOTS } from './config.js';

export const STORAGE_KEY = 'stabthefinger_parkinglot_v1_records';

function createEmptyStats() {
  return {
    bestScore: 0,
    gamesPlayed: 0,
    successfulParks: 0,
    accidents: 0
  };
}

export function createDefaultRecords() {
  const byLot = {};
  for (const lotId of Object.keys(LOTS)) {
    byLot[lotId] = createEmptyStats();
  }
  return {
    version: 1,
    muted: false,
    overall: createEmptyStats(),
    byLot
  };
}

let inMemoryFallback = createDefaultRecords();

function sanitizeStatsObject(raw) {
  const clean = createEmptyStats();
  if (!raw || typeof raw !== 'object') return clean;

  const numOrZero = (val) => {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  clean.bestScore = numOrZero(raw.bestScore);
  clean.gamesPlayed = numOrZero(raw.gamesPlayed);
  clean.successfulParks = numOrZero(raw.successfulParks);
  clean.accidents = numOrZero(raw.accidents);
  return clean;
}

export function sanitizeRecords(raw) {
  const defaults = createDefaultRecords();
  if (!raw || typeof raw !== 'object') return defaults;

  defaults.muted = Boolean(raw.muted);
  defaults.overall = sanitizeStatsObject(raw.overall);

  if (raw.byLot && typeof raw.byLot === 'object') {
    for (const lotId of Object.keys(LOTS)) {
      defaults.byLot[lotId] = sanitizeStatsObject(raw.byLot[lotId]);
    }
  }
  return defaults;
}

export function loadRecords() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return sanitizeRecords(inMemoryFallback);
    }
    const rawStr = window.localStorage.getItem(STORAGE_KEY);
    if (!rawStr) {
      return sanitizeRecords(inMemoryFallback);
    }
    const parsed = JSON.parse(rawStr);
    const sanitized = sanitizeRecords(parsed);
    inMemoryFallback = sanitized;
    return sanitized;
  } catch (_err) {
    // Graceful recovery on malformed JSON or blocked LocalStorage
    return sanitizeRecords(inMemoryFallback);
  }
}

export function saveRecords(records) {
  const sanitized = sanitizeRecords(records);
  inMemoryFallback = sanitized;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    }
  } catch (_err) {
    // Keep playing with in-memory fallback if storage quota or privacy mode blocks writes
  }
  return sanitized;
}

/**
 * Records the outcome of a completed round and returns updated records + whether a new personal best was set.
 */
export function recordRoundResult({
  lotId,
  success,
  finalScore = 0,
  isAccident = false
}) {
  const records = loadRecords();
  const safeLotId = LOTS[lotId] ? lotId : 'dollar';
  const lotStats = records.byLot[safeLotId] || createEmptyStats();

  const scoreVal = success ? Math.max(0, Math.floor(Number(finalScore) || 0)) : 0;
  const previousLotBest = lotStats.bestScore;
  const previousOverallBest = records.overall.bestScore;

  records.overall.gamesPlayed += 1;
  lotStats.gamesPlayed += 1;

  if (success) {
    records.overall.successfulParks += 1;
    lotStats.successfulParks += 1;

    if (scoreVal > records.overall.bestScore) {
      records.overall.bestScore = scoreVal;
    }
    if (scoreVal > lotStats.bestScore) {
      lotStats.bestScore = scoreVal;
    }
  }

  if (isAccident) {
    records.overall.accidents += 1;
    lotStats.accidents += 1;
  }

  records.byLot[safeLotId] = lotStats;
  const saved = saveRecords(records);

  return {
    records: saved,
    isNewLotBest: success && scoreVal > previousLotBest,
    isNewOverallBest: success && scoreVal > previousOverallBest,
    previousLotBest,
    previousOverallBest
  };
}

export function resetRecords() {
  const current = loadRecords();
  const fresh = createDefaultRecords();
  fresh.muted = current.muted; // Preserve sound preference
  return saveRecords(fresh);
}

export function setMutedPreference(muted) {
  const records = loadRecords();
  records.muted = Boolean(muted);
  return saveRecords(records);
}
