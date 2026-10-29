/**
 * Parking Lot - Global Leaderboard client (browser side).
 * Thin, defensive wrapper around the /api endpoints. All functions resolve (never throw) with
 * { ok: true, data } or { ok: false, status, code, message } so the game never breaks if the
 * backend is unreachable. Local records (storage.js) are unaffected by anything here.
 */

import { ACCIDENT_OUTCOMES } from './config.js';
import { UNVERIFIED_HAZARD_PENALTY } from './scoring.js';

export const AUTO_SUBMIT_KEY = 'stabthefinger_parkinglot_v1_auto_submit';
export const NICKNAME_KEY = 'stabthefinger_parkinglot_v1_nickname';
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 16;
const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;

const DEFAULT_NICK_ADJECTIVES = [
  'Swift', 'Careful', 'Nimble', 'Clever', 'Brave', 'Steady', 'Lucky', 'Keen',
  'Sharp', 'Quick', 'Smooth', 'Alert', 'Calm', 'Bright', 'Bold', 'Deft'
];
const DEFAULT_NICK_NOUNS = [
  'Parker', 'Driver', 'Cruiser', 'Goose', 'Scout', 'Navigator', 'Pilot',
  'Rider', 'Spotter', 'Racer', 'Captain', 'Guide', 'Ranger', 'Pro'
];

/**
 * Generates a friendly, valid default nickname (e.g. "SwiftParker42")
 * guaranteed to start with a letter and satisfy all nickname rules.
 */
export function generateDefaultNickname() {
  const adj = DEFAULT_NICK_ADJECTIVES[Math.floor(Math.random() * DEFAULT_NICK_ADJECTIVES.length)];
  const noun = DEFAULT_NICK_NOUNS[Math.floor(Math.random() * DEFAULT_NICK_NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  const candidate = `${adj}${noun}${num}`;
  return candidate.length > NICKNAME_MAX ? candidate.slice(0, NICKNAME_MAX) : candidate;
}

/**
 * Normalises and validates a nickname. Returns { ok: true, value } or { ok: false, message }.
 * Enforces NFKC normalisation, rejects control/format characters, trims redundant whitespace,
 * enforces 1–16 character limits, and verifies allowed character classes.
 */
export function validateNickname(raw) {
  if (typeof raw !== 'string') return { ok: false, message: 'Nickname must be text.' };
  const normalized = raw.normalize('NFKC');
  if (/\p{C}/u.test(normalized)) {
    return { ok: false, message: 'Nickname contains characters that are not allowed.' };
  }
  const value = normalized.trim().replace(/ {2,}/g, ' ');
  const len = [...value].length;
  if (len < NICKNAME_MIN) return { ok: false, message: 'Please enter a nickname.' };
  if (len > NICKNAME_MAX) {
    return { ok: false, message: `Nickname must be ${NICKNAME_MAX} characters or fewer.` };
  }
  if (!NICKNAME_RE.test(value)) {
    return {
      ok: false,
      message: "Nickname may only use letters, numbers, spaces and _ . ' - (and must start with a letter or number)."
    };
  }
  return { ok: true, value };
}

let inMemoryAutoSubmit = false;
let inMemoryNickname = '';

export function loadAutoSubmitPreference() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(AUTO_SUBMIT_KEY) === 'true';
    }
    return inMemoryAutoSubmit;
  } catch {
    return inMemoryAutoSubmit;
  }
}

export function saveAutoSubmitPreference(enabled) {
  const val = Boolean(enabled);
  inMemoryAutoSubmit = val;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AUTO_SUBMIT_KEY, val ? 'true' : 'false');
    }
  } catch {
    /* storage blocked: inMemoryAutoSubmit handles gracefully */
  }
  return val;
}

const REQUEST_TIMEOUT_MS = 8000;

function apiBase() {
  const base = typeof window !== 'undefined' && window.PARKINGLOT_API_BASE;
  return typeof base === 'string' ? base.replace(/\/+$/, '') : '';
}

export function isNetworkAvailable() {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

async function request(method, pathAndQuery, body) {
  if (!isNetworkAvailable()) {
    return { ok: false, status: 0, code: 'offline', message: 'Global leaderboard is not available here.' };
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await window.fetch(`${apiBase()}${pathAndQuery}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit'
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: json?.error?.code || 'http_error',
        message: json?.error?.message || `Request failed (${res.status}).`
      };
    }
    return { ok: true, data: json };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      code: aborted ? 'timeout' : 'network_error',
      message: aborted ? 'The leaderboard took too long to respond.' : 'Could not reach the leaderboard.'
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Asks the server for a signed, single-use game session token. Resolves to a token string or null. */
export async function createSession(lotId, modifiers) {
  const res = await request('POST', '/api/sessions', { lotId, modifiers });
  return res.ok && typeof res.data?.token === 'string' ? res.data.token : null;
}

export function submitScore(payload) {
  return request('POST', '/api/scores', payload);
}

export function fetchLeaderboard({ lot = 'all', mods = 'all', limit = 25, offset = 0 } = {}) {
  const q = new URLSearchParams({ lot, mods, limit: String(limit), offset: String(offset) });
  return request('GET', `/api/leaderboard?${q.toString()}`);
}

/**
 * Builds the submission payload from a finished round. The server re-computes `score` from the
 * components and rejects any mismatch, so these are claims, not trusted values.
 */
export function buildSubmissionPayload({ token, nickname, lotId, modifiers, roundResult, elapsedSeconds }) {
  const outcomeId = roundResult.outcomeId;
  let unlocatedHazards = 0;
  if (outcomeId === 'AWKWARD') {
    const base = ACCIDENT_OUTCOMES.AWKWARD.penalty;
    unlocatedHazards = Math.max(0, Math.round((roundResult.accidentPenalty - base) / UNVERIFIED_HAZARD_PENALTY));
  }
  return {
    token,
    nickname,
    lotId,
    modifiers: [...modifiers],
    qualityId: roundResult.spaceQualityId,
    outcomeId,
    unlocatedHazards,
    elapsedSeconds,
    score: roundResult.finalScore
  };
}

export function loadSavedNickname() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(NICKNAME_KEY);
      if (typeof stored === 'string') {
        inMemoryNickname = stored;
        return stored;
      }
    }
    return inMemoryNickname;
  } catch {
    return inMemoryNickname;
  }
}

export function saveNickname(nickname) {
  const str = typeof nickname === 'string' ? nickname : '';
  inMemoryNickname = str;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(NICKNAME_KEY, str);
    }
  } catch {
    /* storage blocked: fine */
  }
  return str;
}
