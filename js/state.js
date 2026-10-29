/**
 * Parking Lot V1 - Game State Machine, Timer & Patience Management
 */

import {
  LOTS,
  MODIFIERS,
  CELL_TYPES,
  GOOSE_QUIPS
} from './config.js';
import {
  generateValidBoard,
  revealWithCascade,
  validateModifierCombination,
  getObservedSpaceEvaluation
} from './generator.js';
import {
  resolveParkingOutcome,
  calculateScoreBreakdown
} from './scoring.js';
import {
  loadRecords,
  recordRoundResult,
  resetRecords,
  setMutedPreference
} from './storage.js';
import { sound } from './sound.js';
import {
  createSession,
  submitScore,
  buildSubmissionPayload,
  isNetworkAvailable,
  saveNickname,
  loadSavedNickname,
  loadAutoSubmitPreference,
  validateNickname
} from './leaderboard.js';

export const GAME_PHASES = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  RESOLVING: 'RESOLVING',
  RESULTS: 'RESULTS'
};

export class ParkingLotState {
  constructor(onUpdate) {
    this.onUpdate = typeof onUpdate === 'function' ? onUpdate : () => {};
    this.phase = GAME_PHASES.MENU;
    this.lotId = 'dollar';
    this.activeModifiers = []; // Empty array means "Standard" baseline mode
    this.flagMode = false; // Mobile-friendly toggle for flagging suspected hazards

    this.board = null;
    this.elapsedSeconds = 0;
    this.timerStartMs = null;
    this.timerIntervalId = null;

    this.patience = LOTS.dollar.basePatience;
    this.maxPatience = LOTS.dollar.basePatience;
    this.lastPatienceEvent = null;

    this.selectedCoords = null; // [r, c] of currently focused SAFE space
    this.lastInspectedCoords = null;

    this.gooseMessage = GOOSE_QUIPS.welcome[0];
    this.gooseMood = 'idle'; // 'idle' | 'honk' | 'glare' | 'flap'

    this.roundResult = null;
    this.recordUpdate = null;
    this.records = loadRecords();
    sound.setMuted(this.records.muted);

    // Global leaderboard (optional, never blocks gameplay)
    this.roundCounter = 0;
    this.sessionToken = null;
    this.sessionStatus = 'none'; // 'none' | 'pending' | 'ready' | 'unavailable'
    this.runSnapshot = null;
    this.submission = { status: 'idle', message: '', result: null }; // idle|submitting|done|error
  }

  /** Requests a server-signed session token for this round. Failure just disables global submit. */
  beginLeaderboardSession() {
    const round = ++this.roundCounter;
    this.sessionToken = null;
    this.runSnapshot = null;
    this.pendingAutoSubmit = null;
    this.submission = { status: 'idle', message: '', result: null, isAuto: false };
    if (!isNetworkAvailable()) {
      this.sessionStatus = 'unavailable';
      return;
    }
    this.sessionStatus = 'pending';
    createSession(this.lotId, this.activeModifiers)
      .then((token) => {
        if (round !== this.roundCounter) return; // a newer round superseded this one
        this.sessionToken = token;
        this.sessionStatus = token ? 'ready' : 'unavailable';
        if (this.phase === GAME_PHASES.RESULTS) {
          if (this.pendingAutoSubmit) {
            const nick = this.pendingAutoSubmit;
            this.pendingAutoSubmit = null;
            if (this.canSubmitGlobally()) {
              this.submitToLeaderboard(nick, { isAuto: true });
            } else {
              this.submission = {
                status: 'error',
                message: 'Could not auto-submit score (global leaderboard unavailable). Local score was saved.',
                result: null,
                isAuto: true
              };
            }
          }
          this.notify();
        }
      })
      .catch(() => {
        if (round === this.roundCounter) {
          this.sessionStatus = 'unavailable';
          if (this.pendingAutoSubmit) {
            this.pendingAutoSubmit = null;
            this.submission = {
              status: 'error',
              message: 'Could not reach the global leaderboard. Local score was saved.',
              result: null,
              isAuto: true
            };
          }
          if (this.phase === GAME_PHASES.RESULTS) this.notify();
        }
      });
  }

  canSubmitGlobally() {
    return Boolean(
      this.phase === GAME_PHASES.RESULTS &&
        this.roundResult &&
        this.roundResult.success &&
        this.runSnapshot &&
        this.sessionToken
    );
  }

  /**
   * If auto-submission is enabled and the round completed with a committed space,
   * validates the nickname and immediately submits or queues for pending session token.
   */
  triggerAutoSubmitIfEnabled() {
    if (!loadAutoSubmitPreference()) return;
    if (!this.roundResult || !this.roundResult.success) return;
    if (this.submission.status === 'submitting' || this.submission.status === 'done') return;

    const rawNick = loadSavedNickname();
    const validated = validateNickname(rawNick);
    if (!validated.ok) {
      this.submission = {
        status: 'error',
        message: `Auto-submit skipped: ${validated.message}`,
        result: null,
        isAuto: true
      };
      return;
    }

    if (this.sessionStatus === 'pending') {
      this.pendingAutoSubmit = validated.value;
      this.submission = {
        status: 'submitting',
        message: 'Automatically submitting score to global leaderboard…',
        result: null,
        isAuto: true
      };
      return;
    }

    if (!this.canSubmitGlobally()) {
      this.submission = {
        status: 'error',
        message: 'Could not auto-submit score (global leaderboard unavailable). Local score was saved.',
        result: null,
        isAuto: true
      };
      return;
    }

    this.submitToLeaderboard(validated.value, { isAuto: true });
  }

  /** Submits the finished run to the global leaderboard. Safe against repeated clicks. */
  async submitToLeaderboard(nickname, options = {}) {
    if (!this.canSubmitGlobally()) return null;
    if (this.submission.status === 'submitting' || this.submission.status === 'done') return null;

    const isAuto = Boolean(options.isAuto);
    const round = this.roundCounter;
    this.submission = {
      status: 'submitting',
      message: isAuto ? 'Automatically submitting score to global leaderboard…' : 'Submitting…',
      result: null,
      isAuto
    };
    this.notify();

    const payload = buildSubmissionPayload({
      token: this.sessionToken,
      nickname,
      roundResult: this.roundResult,
      ...this.runSnapshot
    });
    const res = await submitScore(payload);
    if (round !== this.roundCounter) return res; // user already started another round

    if (res.ok) {
      saveNickname(res.data.entry.nickname);
      this.submission = {
        status: 'done',
        message: isAuto ? 'Score automatically submitted!' : 'Score submitted!',
        result: res.data,
        isAuto
      };
    } else if (res.code === 'duplicate') {
      this.submission = {
        status: 'done',
        message: 'This game was already submitted.',
        result: null,
        isAuto
      };
    } else {
      this.submission = {
        status: 'error',
        message: res.message || 'Submission failed. Local score was saved.',
        result: null,
        isAuto
      };
    }
    this.notify();
    return res;
  }

  getLot() {
    return LOTS[this.lotId] || LOTS.dollar;
  }

  selectLot(lotId) {
    if (!LOTS[lotId]) return;
    if (this.phase === GAME_PHASES.PLAYING || this.phase === GAME_PHASES.RESOLVING) {
      this.stopTimer();
    }
    this.lotId = lotId;
    this.phase = GAME_PHASES.MENU;
    this.notify();
  }

  toggleModifier(modifierId) {
    if (modifierId === 'standard') {
      this.activeModifiers = [];
      this.notify();
      return;
    }
    if (!MODIFIERS[modifierId] || MODIFIERS[modifierId].isBaseline) return;

    const exists = this.activeModifiers.includes(modifierId);
    if (exists) {
      this.activeModifiers = this.activeModifiers.filter((id) => id !== modifierId);
    } else {
      this.activeModifiers = validateModifierCombination([
        ...this.activeModifiers,
        modifierId
      ]);
    }
    this.notify();
  }

  setFlagMode(enabled) {
    this.flagMode = Boolean(enabled);
    this.notify();
  }

  toggleMute() {
    const nextMuted = !sound.isMuted();
    sound.setMuted(nextMuted);
    this.records = setMutedPreference(nextMuted);
    this.notify();
  }

  clearRecords() {
    this.records = resetRecords();
    this.notify();
  }

  /**
   * Starts a fresh round:
   * 1. Stops any prior timer.
   * 2. Generates and validates the board BEFORE starting the timer.
   * 3. Resets elapsed time to 00:00 and starts counting up.
   */
  startRound(customRng = Math.random) {
    this.stopTimer();

    const lot = this.getLot();
    this.activeModifiers = validateModifierCombination(this.activeModifiers);

    // Generate and validate board before timer begins
    this.board = generateValidBoard(this.lotId, this.activeModifiers, customRng);

    this.patience = lot.basePatience;
    this.maxPatience = lot.basePatience;
    this.hazardsTriggered = 0;
    this.lastPatienceEvent = {
      delta: 0,
      reason: 'Entered lot. Read starting hazard clues in the lower lane to deduce safe spaces.'
    };

    this.elapsedSeconds = 0;
    this.roundResult = null;
    this.recordUpdate = null;
    this.flagMode = false;
    this.lastInspectedCoords = this.board.startCell;

    // No safe space is pre-revealed or pre-selected at game start
    this.selectedCoords = null;

    this.gooseMessage =
      GOOSE_QUIPS.roundStart[Math.floor(Math.random() * GOOSE_QUIPS.roundStart.length)];
    this.gooseMood = this.activeModifiers.includes('goose') ? 'glare' : 'idle';

    this.phase = GAME_PHASES.PLAYING;
    this.beginLeaderboardSession();
    this.startTimer();
    this.notify();
  }

  startTimer() {
    this.stopTimer();
    this.timerStartMs = Date.now();
    this.elapsedSeconds = 0;

    this.timerIntervalId = setInterval(() => {
      if (this.phase !== GAME_PHASES.PLAYING) {
        this.stopTimer();
        return;
      }
      const now = Date.now();
      this.elapsedSeconds = Math.max(0, Math.floor((now - this.timerStartMs) / 1000));
      this.notify('timer');
    }, 250);
  }

  stopTimer() {
    if (this.timerIntervalId !== null) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
  }

  findBestRevealedSafeCoords() {
    if (!this.board) return null;
    let bestCell = null;
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const cell = this.board.grid[r][c];
        if (cell.revealed && cell.type === CELL_TYPES.SAFE) {
          if (!bestCell || cell.qualityScore > bestCell.qualityScore) {
            bestCell = cell;
          }
        }
      }
    }
    return bestCell ? [bestCell.r, bestCell.c] : null;
  }

  getSelectedCell() {
    if (!this.board || !this.selectedCoords) return null;
    const [r, c] = this.selectedCoords;
    return this.board.grid[r]?.[c] || null;
  }

  getFocusedCell() {
    if (!this.board) return null;
    if (this.selectedCoords) {
      const [sr, sc] = this.selectedCoords;
      const sCell = this.board.grid[sr]?.[sc];
      if (sCell) return sCell;
    }
    if (this.lastInspectedCoords) {
      const [ir, ic] = this.lastInspectedCoords;
      return this.board.grid[ir]?.[ic] || null;
    }
    return null;
  }

  /**
   * Toggles a warning flag on an uninspected space so players can mark deduced Trouble Stalls.
   */
  toggleFlag(r, c) {
    if (this.phase !== GAME_PHASES.PLAYING || !this.board) return;
    const cell = this.board.grid[r]?.[c];
    if (!cell || cell.revealed || cell.visibleAtStart) return;
    cell.flagged = !cell.flagged;
    this.notify();
  }

  /**
   * Inspects an unrevealed space or selects an already-revealed space.
   */
  inspectOrSelectSpace(r, c) {
    if (this.phase !== GAME_PHASES.PLAYING || !this.board) return;
    const cell = this.board.grid[r]?.[c];
    if (!cell) return;

    if (this.flagMode && !cell.revealed && !cell.visibleAtStart) {
      this.toggleFlag(r, c);
      return;
    }

    if (cell.flagged && !cell.revealed) {
      this.lastPatienceEvent = {
        delta: 0,
        reason: `Stall ${cell.id} is marked with a caution flag. Unflag it first to inspect.`
      };
      this.notify();
      return;
    }

    // If already revealed: focus it in the Space Inspector (and select if SAFE)
    if (cell.revealed) {
      this.lastInspectedCoords = [r, c];
      if (cell.type === CELL_TYPES.SAFE) {
        this.selectedCoords = [r, c];
        sound.playInspect();
      } else if (cell.type === CELL_TYPES.HAZARD && cell.subtype === 'GOOSE') {
        sound.playHonk();
        this.gooseMood = 'honk';
        this.gooseMessage = 'HONK! The Goose is still not moving.';
      } else {
        sound.playInspect();
      }
      this.notify();
      return;
    }

    // Inspecting a space (or checking surroundings of a visible parked car/pillar)
    const lot = this.getLot();
    const isVisibleLandmark = Boolean(cell.visibleAtStart);
    let patienceCost = isVisibleLandmark
      ? Math.max(2, Math.floor(lot.inspectCost / 2))
      : lot.inspectCost;
    let eventReason = isVisibleLandmark
      ? `Checked surroundings of Stall ${cell.id} (-${patienceCost} Patience) • Clue: ${cell.clue} nearby trouble.`
      : `Inspected Stall ${cell.id} (-${lot.inspectCost} Patience)`;

    revealWithCascade(
      this.board.grid,
      r,
      c,
      this.board.rows,
      this.board.cols
    );
    this.lastInspectedCoords = [r, c];

    if (cell.type === CELL_TYPES.HAZARD) {
      const extra = lot.hazardPenaltyPatience;
      patienceCost += extra;
      this.hazardsTriggered = (this.hazardsTriggered || 0) + 1;
      eventReason = `Stall ${cell.id}: Hidden Hazard (${cell.title})! (-${lot.inspectCost} inspect, -${extra} hazard shock)`;

      if (cell.subtype === 'GOOSE') {
        sound.playHonk();
        this.gooseMood = 'honk';
        this.gooseMessage =
          GOOSE_QUIPS.inspectHazardGoose[
            Math.floor(Math.random() * GOOSE_QUIPS.inspectHazardGoose.length)
          ];
      } else {
        sound.playCartRattle();
        this.gooseMood = 'flap';
        this.gooseMessage =
          GOOSE_QUIPS.inspectHazardOther[
            Math.floor(Math.random() * GOOSE_QUIPS.inspectHazardOther.length)
          ];
      }
    } else if (cell.type === CELL_TYPES.BLOCKED || (cell.type === CELL_TYPES.OCCUPIED && cell.isBadParker)) {
      sound.playCartRattle();
      this.gooseMood = 'glare';
      this.gooseMessage =
        GOOSE_QUIPS.inspectOccupied[
          Math.floor(Math.random() * GOOSE_QUIPS.inspectOccupied.length)
        ];
      if (cell.isBadParker) {
        const extra = 2;
        patienceCost += extra;
        eventReason = `Stall ${cell.id}: ${cell.title} (-${lot.inspectCost} inspect, -${extra} bad-parker annoyance)`;
      }
    } else if (cell.type === CELL_TYPES.OCCUPIED) {
      sound.playInspect();
      this.gooseMood = 'idle';
      if (!isVisibleLandmark) {
        eventReason = `Stall ${cell.id}: Occupied by ${cell.title} (-${patienceCost} Patience) • Clue: ${cell.clue} nearby trouble.`;
      }
      this.gooseMessage =
        GOOSE_QUIPS.inspectOccupied[
          Math.floor(Math.random() * GOOSE_QUIPS.inspectOccupied.length)
        ];
    } else if (cell.type === CELL_TYPES.SAFE) {
      this.selectedCoords = [r, c];
      sound.playInspect();
      eventReason = `Stall ${cell.id}: Open space discovered! (-${patienceCost} Patience) • Clue: ${cell.clue} nearby trouble.`;

      if (cell.qualityTier.id === 'PREMIUM' || cell.qualityTier.id === 'EXCELLENT') {
        this.gooseMood = 'glare';
        this.gooseMessage =
          GOOSE_QUIPS.inspectSafePremium[
            Math.floor(Math.random() * GOOSE_QUIPS.inspectSafePremium.length)
          ];
      } else if (cell.qualityTier.id === 'DEEPLY_UNFORTUNATE' || cell.qualityTier.id === 'TECHNICALLY_LEGAL') {
        this.gooseMood = 'flap';
        this.gooseMessage =
          GOOSE_QUIPS.inspectSafeBad[
            Math.floor(Math.random() * GOOSE_QUIPS.inspectSafeBad.length)
          ];
      } else {
        this.gooseMood = 'idle';
        this.gooseMessage =
          GOOSE_QUIPS.inspectSafeOrdinary[
            Math.floor(Math.random() * GOOSE_QUIPS.inspectSafeOrdinary.length)
          ];
      }
    }

    // Apply patience drain
    this.patience = Math.max(0, this.patience - patienceCost);
    this.lastPatienceEvent = {
      delta: -patienceCost,
      reason: eventReason
    };

    if (this.patience > 0 && this.patience <= 25) {
      this.gooseMessage =
        GOOSE_QUIPS.lowPatience[Math.floor(Math.random() * GOOSE_QUIPS.lowPatience.length)];
    }

    // Check for Patience Exhausted failure
    if (this.patience <= 0) {
      this.handlePatienceFailure();
      return;
    }

    this.notify();
  }

  /**
   * Immediately resolves the parking attempt in the chosen SAFE, revealed space.
   * Guards against duplicate clicks or non-PLAYING states.
   */
  commitToSpace(r, c, options = {}) {
    if (this.phase !== GAME_PHASES.PLAYING || !this.board) return false;

    const targetR = r !== undefined ? r : this.selectedCoords?.[0];
    const targetC = c !== undefined ? c : this.selectedCoords?.[1];
    if (targetR === undefined || targetC === undefined) return false;

    const cell = this.board.grid[targetR]?.[targetC];
    if (!cell || !cell.revealed || cell.type !== CELL_TYPES.SAFE) {
      return false;
    }

    // Lock state and stop timer immediately
    this.stopTimer();
    if (this.timerStartMs) {
      this.elapsedSeconds = Math.max(
        this.elapsedSeconds,
        Math.floor((Date.now() - this.timerStartMs) / 1000)
      );
    }

    this.selectedCoords = [targetR, targetC];
    cell.parkedHere = true;

    const evalInfo = getObservedSpaceEvaluation(this.board, cell);
    const rng = options.rng || Math.random;
    const resolution = resolveParkingOutcome(cell, this.activeModifiers, rng, evalInfo);

    const breakdown = calculateScoreBreakdown({
      lotId: this.lotId,
      activeModifierIds: this.activeModifiers,
      elapsedSeconds: this.elapsedSeconds,
      patienceRemaining: this.patience,
      selectedCell: cell,
      parkingResolution: resolution,
      patienceFailed: false
    });

    this.roundResult = breakdown;
    this.runSnapshot = {
      lotId: this.lotId,
      modifiers: [...this.activeModifiers],
      elapsedSeconds: this.elapsedSeconds
    };
    this.recordUpdate = recordRoundResult({
      lotId: this.lotId,
      success: true,
      finalScore: breakdown.finalScore,
      isAccident: breakdown.isAccident
    });
    this.records = this.recordUpdate.records;

    this.gooseMessage = breakdown.gooseLine;
    this.gooseMood = breakdown.isAccident ? 'honk' : 'glare';

    if (breakdown.isAccident) {
      sound.playCollision();
    } else {
      sound.playParkConfirm();
    }

    const skipAnimation =
      Boolean(options.instant) ||
      (typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (skipAnimation) {
      this.phase = GAME_PHASES.RESULTS;
      this.triggerAutoSubmitIfEnabled();
      this.notify();
    } else {
      this.phase = GAME_PHASES.RESOLVING;
      this.notify();
      setTimeout(() => {
        if (this.phase === GAME_PHASES.RESOLVING) {
          this.phase = GAME_PHASES.RESULTS;
          this.triggerAutoSubmitIfEnabled();
          this.notify();
        }
      }, 420);
    }

    return true;
  }

  handlePatienceFailure() {
    if (this.phase !== GAME_PHASES.PLAYING) return;
    this.stopTimer();

    const breakdown = calculateScoreBreakdown({
      lotId: this.lotId,
      activeModifierIds: this.activeModifiers,
      elapsedSeconds: this.elapsedSeconds,
      patienceRemaining: 0,
      selectedCell: null,
      parkingResolution: null,
      patienceFailed: true
    });

    this.roundResult = breakdown;
    this.recordUpdate = recordRoundResult({
      lotId: this.lotId,
      success: false,
      finalScore: 0,
      isAccident: false
    });
    this.records = this.recordUpdate.records;

    this.gooseMessage = breakdown.gooseLine;
    this.gooseMood = 'honk';
    sound.playPatienceFail();

    this.phase = GAME_PHASES.RESULTS;
    this.notify();
  }

  returnToMenu() {
    this.stopTimer();
    this.phase = GAME_PHASES.MENU;
    this.roundResult = null;
    this.gooseMessage =
      GOOSE_QUIPS.welcome[Math.floor(Math.random() * GOOSE_QUIPS.welcome.length)];
    this.gooseMood = 'idle';
    this.notify();
  }

  notify(source = 'state') {
    this.onUpdate(this, source);
  }
}
