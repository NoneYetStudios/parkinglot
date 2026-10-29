/**
 * Parking Lot V1 - UI Renderer, Top-Down SVG Illustrations & Accessibility
 */

import {
  LOTS,
  MODIFIERS,
  CELL_TYPES,
  QUALITY_TIERS
} from './config.js';
import {
  calculateDifficultyMultiplier
} from './scoring.js';
import {
  isTroubleCell,
  getObservedSpaceEvaluation,
  normalizeEntrances
} from './generator.js';
import { GAME_PHASES } from './state.js';
import { sound } from './sound.js';
import {
  fetchLeaderboard,
  loadSavedNickname,
  saveNickname,
  loadAutoSubmitPreference,
  saveAutoSubmitPreference,
  validateNickname,
  generateDefaultNickname
} from './leaderboard.js';

const GLOBAL_PAGE_SIZE = 25;

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function renderStarsHtml(tierOrObj) {
  if (!tierOrObj) return '';
  let count = 5;
  let color = 'gold';
  if (typeof tierOrObj === 'number') {
    count = Math.max(0, Math.min(5, tierOrObj));
    const colors = { 5: 'gold', 4: 'green', 3: 'cyan', 2: 'orange', 1: 'red' };
    color = colors[count] || 'gold';
  } else if (typeof tierOrObj === 'string') {
    count = (tierOrObj.match(/★/g) || []).length;
    const colors = { 5: 'gold', 4: 'green', 3: 'cyan', 2: 'orange', 1: 'red' };
    color = colors[count] || 'gold';
  } else if (typeof tierOrObj === 'object') {
    count = tierOrObj.starsCount ?? (tierOrObj.stars ? (tierOrObj.stars.match(/★/g) || []).length : 5);
    color = tierOrObj.colorClass || (QUALITY_TIERS[tierOrObj.id]?.colorClass) || 'gold';
  }
  const filledStars = '★'.repeat(count);
  const emptyStars = '☆'.repeat(5 - count);
  return `<span class="star-rating">${filledStars ? `<span class="star-filled ${color}">${filledStars}</span>` : ''}${emptyStars ? `<span class="star-empty">${emptyStars}</span>` : ''}</span>`;
}

/**
 * Generates recognizable SVG artwork for The Goose mascot.
 */
export function getGooseSvg(mood = 'idle') {
  const isHonk = mood === 'honk';
  const isGlare = mood === 'glare';
  const isFlap = mood === 'flap';

  return `
    <svg class="goose-svg goose-mood-${mood}" viewBox="0 0 72 72" role="img" aria-label="The Goose (${mood})">
      <ellipse cx="36" cy="62" rx="18" ry="5" fill="rgba(0,0,0,0.35)" />
      <path d="M27 56 L22 62 L30 62 Z" fill="#f59e0b" />
      <path d="M43 56 L38 62 L46 62 Z" fill="#f59e0b" />
      ${
        isFlap || isHonk
          ? `<path class="goose-wing-left" d="M20 38 Q6 24 10 44 Z" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
             <path class="goose-wing-right" d="M50 38 Q66 24 60 44 Z" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>`
          : ''
      }
      <ellipse cx="36" cy="44" rx="16" ry="12" fill="#f8fafc" stroke="#334155" stroke-width="2.2" />
      <path d="M25 43 Q36 50 47 42" fill="none" stroke="#cbd5e1" stroke-width="2" />
      <path d="M32 34 C30 22, 33 15, 36 14 C40 14, 42 22, 40 34 Z" fill="#f8fafc" stroke="#334155" stroke-width="2.2" />
      <circle cx="37" cy="14" r="6.5" fill="#f8fafc" stroke="#334155" stroke-width="2.2" />
      <circle cx="39" cy="13.5" r="1.6" fill="#0f172a" />
      ${
        isGlare || isHonk
          ? `<line x1="35" y1="10.5" x2="42" y2="12.5" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" />`
          : `<line x1="35" y1="11" x2="41.5" y2="12" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round" />`
      }
      ${
        isHonk
          ? `<polygon points="43,12 56,9 43,15" fill="#f59e0b" stroke="#b45309" stroke-width="1.2" />
             <polygon points="43,15 55,19 43,17.5" fill="#d97706" stroke="#b45309" stroke-width="1.2" />
             <path d="M58 9 L64 6 M59 14 L66 14 M58 19 L64 22" stroke="#ef4444" stroke-width="2" stroke-linecap="round" />`
          : `<polygon points="43,12.5 55,14.5 43,17" fill="#f59e0b" stroke="#b45309" stroke-width="1.4" />`
      }
    </svg>
  `;
}

const SEDAN_PALETTES = [
  { body: '#475569', roof: '#334155', glass: '#94a3b8' },
  { body: '#3b4d6b', roof: '#26354d', glass: '#93c5fd' },
  { body: '#52525b', roof: '#3f3f46', glass: '#cbd5e1' },
  { body: '#5c3a47', roof: '#422731', glass: '#cbd5e1' },
  { body: '#3a524b', roof: '#273833', glass: '#a7f3d0' }
];

/**
 * Generates recognizable top-down SVG graphics for stalls on the board.
 */
export function getCellIllustrationSvg(cell) {
  if (cell.parkedHere) {
    return `
      <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
        <ellipse cx="36" cy="24" rx="28" ry="15" fill="rgba(0,0,0,0.35)"/>
        <rect x="10" y="7" width="52" height="32" rx="8" fill="#22c55e" stroke="#14532d" stroke-width="2.2"/>
        <rect x="20" y="10" width="30" height="26" rx="4" fill="#86efac" />
        <rect x="25" y="12" width="18" height="22" rx="2" fill="#15803d" />
        <circle cx="59" cy="13" r="2.5" fill="#fef08a"/>
        <circle cx="59" cy="33" r="2.5" fill="#fef08a"/>
      </svg>
    `;
  }

  if (cell.type === CELL_TYPES.SAFE) {
    const tier = cell.qualityTier;
    const filledCount = tier?.starsCount ?? 3;
    const colorHex = tier?.colorHex || '#ffd700';
    const filledStars = '★'.repeat(filledCount);
    const emptyStars = '☆'.repeat(5 - filledCount);
    return `
      <svg class="stall-art stall-art-safe" viewBox="0 0 72 46" aria-hidden="true">
        <rect x="10" y="6" width="52" height="34" rx="6" fill="rgba(34, 197, 94, 0.14)" stroke="#4ade80" stroke-width="1.8" stroke-dasharray="4,3"/>
        <text x="36" y="23" text-anchor="middle" fill="#86efac" font-size="15" font-weight="900" font-family="sans-serif">P</text>
        <text x="36" y="35" text-anchor="middle" font-size="7.5" font-weight="700" letter-spacing="0.8">
          <tspan fill="${colorHex}">${filledStars}</tspan>${emptyStars ? `<tspan fill="rgba(255,255,255,0.2)">${emptyStars}</tspan>` : ''}
        </text>
      </svg>
    `;
  }

  if (cell.type === CELL_TYPES.OCCUPIED) {
    if (cell.subtype === 'OVERSIZED_TRUCK') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <ellipse cx="36" cy="24" rx="33" ry="18" fill="rgba(0,0,0,0.4)"/>
          <!-- Tow mirrors jutting wide -->
          <line x1="46" y1="1" x2="46" y2="45" stroke="#94a3b8" stroke-width="2.5"/>
          <rect x="3" y="3" width="66" height="40" rx="5" fill="#b91c1c" stroke="#450a0a" stroke-width="2.2"/>
          <!-- Truck Bed with slats -->
          <rect x="7" y="7" width="25" height="32" rx="2" fill="#7f1d1d" stroke="#450a0a" stroke-width="1.5"/>
          <line x1="13" y1="7" x2="13" y2="39" stroke="#991b1b" stroke-width="1.5"/>
          <line x1="20" y1="7" x2="20" y2="39" stroke="#991b1b" stroke-width="1.5"/>
          <line x1="26" y1="7" x2="26" y2="39" stroke="#991b1b" stroke-width="1.5"/>
          <!-- Cab & Windshield -->
          <rect x="35" y="7" width="24" height="32" rx="3" fill="#ef4444"/>
          <rect x="49" y="9" width="8" height="28" rx="2" fill="#bae6fd"/>
          <circle cx="66" cy="10" r="2.5" fill="#fef08a"/>
          <circle cx="66" cy="36" r="2.5" fill="#fef08a"/>
        </svg>
      `;
    }
    if (cell.subtype === 'LINE_STRADDLER') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <g transform="rotate(-17 36 23)">
            <ellipse cx="36" cy="24" rx="26" ry="14" fill="rgba(0,0,0,0.4)"/>
            <rect x="12" y="9" width="48" height="28" rx="8" fill="#9333ea" stroke="#3b0764" stroke-width="2"/>
            <rect x="22" y="12" width="26" height="22" rx="4" fill="#e9d5ff"/>
            <rect x="26" y="14" width="14" height="18" rx="2" fill="#6b21a8"/>
            <circle cx="57" cy="14" r="2" fill="#fef08a"/>
            <circle cx="57" cy="32" r="2" fill="#fef08a"/>
          </g>
        </svg>
      `;
    }
    // Standard Sedan
    const pal = SEDAN_PALETTES[cell.carColorIndex || 0] || SEDAN_PALETTES[0];
    return `
      <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
        <ellipse cx="36" cy="24" rx="25" ry="14" fill="rgba(0,0,0,0.35)"/>
        <rect x="13" y="9" width="46" height="28" rx="8" fill="${pal.body}" stroke="#0f172a" stroke-width="2"/>
        <rect x="21" y="12" width="28" height="22" rx="4" fill="${pal.glass}"/>
        <rect x="25" y="13.5" width="16" height="19" rx="2" fill="${pal.roof}"/>
        <rect x="13" y="12" width="2.5" height="6" fill="#ef4444"/>
        <rect x="13" y="28" width="2.5" height="6" fill="#ef4444"/>
        <circle cx="56" cy="14" r="2" fill="#e2e8f0"/>
        <circle cx="56" cy="32" r="2" fill="#e2e8f0"/>
      </svg>
    `;
  }

  if (cell.type === CELL_TYPES.BLOCKED) {
    if (cell.subtype === 'CONCRETE_PILLAR') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <ellipse cx="36" cy="26" rx="16" ry="12" fill="rgba(0,0,0,0.4)"/>
          <circle cx="36" cy="23" r="14" fill="#eab308" stroke="#713f12" stroke-width="2.5"/>
          <circle cx="36" cy="23" r="8" fill="#475569" stroke="#1e293b" stroke-width="2"/>
          <circle cx="36" cy="23" r="3" fill="#fef08a"/>
        </svg>
      `;
    }
    // Cart Corral Overflow
    return `
      <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
        <g transform="rotate(-10 26 22)">
          <rect x="12" y="10" width="22" height="15" rx="2" fill="none" stroke="#fb923c" stroke-width="2.2"/>
          <line x1="17" y1="10" x2="17" y2="25" stroke="#fdba74" stroke-width="1.3"/>
          <line x1="23" y1="10" x2="23" y2="25" stroke="#fdba74" stroke-width="1.3"/>
        </g>
        <g transform="rotate(14 44 26)">
          <rect x="30" y="16" width="22" height="15" rx="2" fill="none" stroke="#f97316" stroke-width="2.2"/>
          <line x1="36" y1="16" x2="36" y2="31" stroke="#fdba74" stroke-width="1.3"/>
          <line x1="42" y1="16" x2="42" y2="31" stroke="#fdba74" stroke-width="1.3"/>
        </g>
      </svg>
    `;
  }

  if (cell.type === CELL_TYPES.HAZARD) {
    if (cell.subtype === 'GOOSE') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <ellipse cx="35" cy="36" rx="14" ry="5" fill="rgba(0,0,0,0.38)"/>
          <path d="M29 32 L25 37 L32 37 Z" fill="#f59e0b"/>
          <path d="M40 32 L36 37 L43 37 Z" fill="#f59e0b"/>
          <ellipse cx="34" cy="26" rx="13" ry="9" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
          <path d="M39 21 L41 10" stroke="#f8fafc" stroke-width="6" stroke-linecap="round"/>
          <path d="M39 21 L41 10" stroke="#0f172a" stroke-width="2" stroke-linecap="round" fill="none"/>
          <circle cx="42" cy="9" r="5" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8"/>
          <polygon points="46,7 56,9.5 46,12" fill="#f59e0b" stroke="#b45309" stroke-width="1"/>
          <circle cx="43.5" cy="8.5" r="1.4" fill="#dc2626"/>
          <line x1="40" y1="6.5" x2="45" y2="8" stroke="#dc2626" stroke-width="1.8"/>
        </svg>
      `;
    }
    if (cell.subtype === 'CART') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <g transform="rotate(-8 36 23)">
            <ellipse cx="36" cy="32" rx="16" ry="5" fill="rgba(0,0,0,0.3)"/>
            <rect x="22" y="10" width="28" height="18" rx="2" fill="rgba(239,68,68,0.15)" stroke="#ef4444" stroke-width="2.2"/>
            <line x1="28" y1="10" x2="28" y2="28" stroke="#fca5a5" stroke-width="1.5"/>
            <line x1="35" y1="10" x2="35" y2="28" stroke="#fca5a5" stroke-width="1.5"/>
            <line x1="42" y1="10" x2="42" y2="28" stroke="#fca5a5" stroke-width="1.5"/>
            <line x1="22" y1="19" x2="50" y2="19" stroke="#fca5a5" stroke-width="1.5"/>
            <line x1="17" y1="9" x2="22" y2="14" stroke="#ef4444" stroke-width="2.6" stroke-linecap="round"/>
            <circle cx="25" cy="32" r="3" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.2"/>
            <circle cx="46" cy="32" r="3" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.2"/>
          </g>
        </svg>
      `;
    }
    if (cell.subtype === 'ETERNAL_REVERSE') {
      return `
        <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
          <!-- Bright reverse light cones -->
          <polygon points="14,12 1,5 1,19" fill="rgba(254, 240, 138, 0.45)"/>
          <polygon points="14,34 1,27 1,41" fill="rgba(254, 240, 138, 0.45)"/>
          <rect x="14" y="9" width="46" height="28" rx="7" fill="#334155" stroke="#0f172a" stroke-width="2"/>
          <rect x="23" y="12" width="26" height="22" rx="4" fill="#94a3b8"/>
          <circle cx="15" cy="13" r="3.8" fill="#ffffff"/>
          <circle cx="15" cy="33" r="3.8" fill="#ffffff"/>
          <circle cx="15" cy="20" r="2.2" fill="#ef4444"/>
          <circle cx="15" cy="26" r="2.2" fill="#ef4444"/>
        </svg>
      `;
    }
    // MYSTERY_STAIN
    return `
      <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
        <path d="M18 24 Q22 9 36 13 T54 23 Q50 38 33 35 T18 24 Z" fill="#10b981" fill-opacity="0.72" stroke="#a3e635" stroke-width="2"/>
        <circle cx="31" cy="21" r="3.5" fill="#d9f99d"/>
        <circle cx="42" cy="26" r="2.5" fill="#d9f99d"/>
        <circle cx="25" cy="28" r="1.8" fill="#fef08a"/>
      </svg>
    `;
  }

  return '';
}

export function getUnknownStallSvg(flagged = false) {
  if (flagged) {
    // Illustrated traffic cone for flagged trouble
    return `
      <svg class="stall-art" viewBox="0 0 72 46" aria-hidden="true">
        <ellipse cx="36" cy="35" rx="14" ry="4" fill="rgba(0,0,0,0.35)"/>
        <polygon points="24,35 48,35 44,31 28,31" fill="#ea580c"/>
        <polygon points="28,31 44,31 39,11 33,11" fill="#f97316" stroke="#7c2d12" stroke-width="1.5"/>
        <polygon points="30.5,23 41.5,23 40,17 32,17" fill="#fef08a"/>
      </svg>
    `;
  }
  return `
    <svg class="stall-art stall-art-unknown" viewBox="0 0 72 46" aria-hidden="true">
      <circle cx="36" cy="23" r="13" fill="rgba(15, 23, 42, 0.55)" stroke="rgba(148, 163, 184, 0.35)" stroke-width="1.6" stroke-dasharray="3,3"/>
      <text x="36" y="28" text-anchor="middle" fill="#94a3b8" font-size="15" font-weight="800" font-family="sans-serif">?</text>
    </svg>
  `;
}

export class GameUI {
  constructor(state) {
    this.state = state;
    this.lastPhase = null;
    this.cacheElements();
    this.bindStaticEvents();
  }

  cacheElements() {
    this.screenMenu = document.getElementById('screen-menu');
    this.screenGame = document.getElementById('screen-game');
    this.screenResults = document.getElementById('screen-results');

    this.lotCardsContainer = document.getElementById('lot-cards-container');
    this.modifierCardsContainer = document.getElementById('modifier-cards-container');
    this.lotPreviewPanel = document.getElementById('lot-preview-panel');
    this.btnEnterLot = document.getElementById('btn-enter-lot');

    // Header & Modals
    this.btnMute = document.getElementById('btn-mute');
    this.btnHelp = document.getElementById('btn-help');
    this.btnRecords = document.getElementById('btn-records');
    this.modalHelp = document.getElementById('modal-help');
    this.modalRecords = document.getElementById('modal-records');
    this.recordsModalContent = document.getElementById('records-modal-content');
    this.btnResetRecords = document.getElementById('btn-reset-records');

    // Global leaderboard
    this.btnGlobal = document.getElementById('btn-global');
    this.modalGlobal = document.getElementById('modal-global');
    this.globalFilterLot = document.getElementById('global-filter-lot');
    this.globalFilterMods = document.getElementById('global-filter-mods');
    this.globalStatus = document.getElementById('global-status');
    this.globalTableBody = document.getElementById('global-table-body');
    this.globalPrev = document.getElementById('global-prev');
    this.globalNext = document.getElementById('global-next');
    this.globalPageInfo = document.getElementById('global-page-info');
    this.globalSubmitPanel = document.getElementById('global-submit-panel');
    this.globalState = { offset: 0, total: 0, requestId: 0 };
    this.nicknameDraft = loadSavedNickname();

    // Global Leaderboard Auto-Submit Preference controls (Menu & Modal)
    this.toggleAutoSubmitMenu = document.getElementById('toggle-auto-submit');
    this.nicknameGroupMenu = document.getElementById('nickname-config-group');
    this.inputNicknameMenu = document.getElementById('input-leaderboard-nickname');
    this.btnGenerateNicknameMenu = document.getElementById('btn-generate-nickname');
    this.feedbackNicknameMenu = document.getElementById('pref-nickname-feedback');
    this.btnMenuOpenGlobal = document.getElementById('btn-menu-open-global');

    this.toggleAutoSubmitModal = document.getElementById('toggle-auto-submit-modal');
    this.nicknameGroupModal = document.getElementById('nickname-config-group-modal');
    this.inputNicknameModal = document.getElementById('input-leaderboard-nickname-modal');
    this.btnGenerateNicknameModal = document.getElementById('btn-generate-nickname-modal');
    this.feedbackNicknameModal = document.getElementById('pref-nickname-feedback-modal');

    // Game HUD
    this.hudLotName = document.getElementById('hud-lot-name');
    this.hudModifiers = document.getElementById('hud-modifiers');
    this.hudTimer = document.getElementById('hud-timer');
    this.hudPatienceValue = document.getElementById('hud-patience-value');
    this.hudPatienceFill = document.getElementById('hud-patience-fill');
    this.hudPatienceEvent = document.getElementById('hud-patience-event');
    this.btnFlagMode = document.getElementById('btn-flag-mode');
    this.btnAbandonRound = document.getElementById('btn-abandon-round');

    // Goose Bar
    this.gooseAvatar = document.getElementById('goose-avatar');
    this.gooseSpeech = document.getElementById('goose-speech');
    this.btnPokeGoose = document.getElementById('btn-poke-goose');

    // Board & Storefront
    this.storefrontBanner = document.getElementById('storefront-banner');
    this.bottomStorefrontBanner = document.getElementById('bottom-storefront-banner');
    this.boardGridContainer = document.getElementById('board-grid-container');

    // Space Inspector Panel
    this.inspectorContent = document.getElementById('inspector-content');

    // Results Screen
    this.resultsContent = document.getElementById('results-content');
    this.resultsCardsContainer = document.getElementById('results-cards-container');
    this.resultsRecordsStrip = document.getElementById('results-records-strip');
    this.btnParkAgain = document.getElementById('btn-park-again');
    this.btnChangeLot = document.getElementById('btn-change-lot');
    this.btnMainMenu = document.getElementById('btn-main-menu');
  }

  bindStaticEvents() {
    this.btnEnterLot.addEventListener('click', () => {
      sound.playInspect();
      this.state.startRound();
    });

    this.btnMute.addEventListener('click', () => {
      this.state.toggleMute();
    });

    this.btnHelp.addEventListener('click', () => {
      this.openModal(this.modalHelp);
    });

    this.btnRecords.addEventListener('click', () => {
      this.renderRecordsModal();
      this.openModal(this.modalRecords);
    });

    this.btnGlobal.addEventListener('click', () => {
      this.openGlobalLeaderboard();
    });

    this.globalFilterLot.addEventListener('change', () => this.loadGlobalPage(0));
    this.globalFilterMods.addEventListener('change', () => this.loadGlobalPage(0));
    this.globalPrev.addEventListener('click', () =>
      this.loadGlobalPage(Math.max(0, this.globalState.offset - GLOBAL_PAGE_SIZE))
    );
    this.globalNext.addEventListener('click', () =>
      this.loadGlobalPage(this.globalState.offset + GLOBAL_PAGE_SIZE)
    );

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeAllModals();
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });

    this.btnResetRecords.addEventListener('click', () => {
      this.state.clearRecords();
      this.renderRecordsModal();
    });

    this.btnFlagMode.addEventListener('click', () => {
      this.state.setFlagMode(!this.state.flagMode);
    });

    this.btnAbandonRound.addEventListener('click', () => {
      this.state.returnToMenu();
    });

    this.btnPokeGoose.addEventListener('click', () => {
      sound.playHonk();
      this.state.gooseMood = 'honk';
      this.state.gooseMessage = 'HONK! Do not poke The Goose. Focus on the asphalt.';
      this.renderGooseBar();
    });

    this.btnParkAgain.addEventListener('click', () => {
      sound.playInspect();
      this.state.startRound();
    });

    this.btnChangeLot.addEventListener('click', () => {
      this.state.returnToMenu();
    });

    this.btnMainMenu.addEventListener('click', () => {
      this.state.returnToMenu();
    });

    if (this.toggleAutoSubmitMenu) {
      this.toggleAutoSubmitMenu.addEventListener('change', (e) => {
        this.setAutoSubmitPreference(e.target.checked);
      });
    }
    if (this.toggleAutoSubmitModal) {
      this.toggleAutoSubmitModal.addEventListener('change', (e) => {
        this.setAutoSubmitPreference(e.target.checked);
      });
    }
    if (this.btnMenuOpenGlobal) {
      this.btnMenuOpenGlobal.addEventListener('click', () => {
        this.openGlobalLeaderboard();
      });
    }
    if (this.inputNicknameMenu) {
      this.inputNicknameMenu.addEventListener('input', (e) => {
        this.handleNicknameInput(e.target.value);
      });
    }
    if (this.inputNicknameModal) {
      this.inputNicknameModal.addEventListener('input', (e) => {
        this.handleNicknameInput(e.target.value);
      });
    }
    if (this.btnGenerateNicknameMenu) {
      this.btnGenerateNicknameMenu.addEventListener('click', () => {
        this.generateRandomNickname();
      });
    }
    if (this.btnGenerateNicknameModal) {
      this.btnGenerateNicknameModal.addEventListener('click', () => {
        this.generateRandomNickname();
      });
    }

    this.syncPreferenceUI();
  }

  openModal(modalEl) {
    if (!modalEl) return;
    modalEl.hidden = false;
    const focusable = modalEl.querySelector('button');
    if (focusable) focusable.focus();
  }

  closeAllModals() {
    if (this.modalHelp) this.modalHelp.hidden = true;
    if (this.modalRecords) this.modalRecords.hidden = true;
    if (this.modalGlobal) this.modalGlobal.hidden = true;
  }

  /* ---------------- Global Leaderboard Preferences ---------------- */

  syncPreferenceUI() {
    const isAuto = loadAutoSubmitPreference();
    const savedNick = loadSavedNickname();
    const displayNick = savedNick || this.nicknameDraft || '';

    const updateGroup = (toggle, group, input, feedback) => {
      if (!toggle) return;
      toggle.checked = isAuto;
      if (group) group.hidden = !isAuto;
      if (input && input !== document.activeElement) {
        input.value = displayNick;
      }
      if (feedback) {
        if (isAuto && displayNick) {
          const val = validateNickname(displayNick);
          if (val.ok) {
            feedback.hidden = true;
            feedback.textContent = '';
          } else {
            feedback.hidden = false;
            feedback.textContent = val.message;
          }
        } else {
          feedback.hidden = true;
          feedback.textContent = '';
        }
      }
    };

    updateGroup(
      this.toggleAutoSubmitMenu,
      this.nicknameGroupMenu,
      this.inputNicknameMenu,
      this.feedbackNicknameMenu
    );
    updateGroup(
      this.toggleAutoSubmitModal,
      this.nicknameGroupModal,
      this.inputNicknameModal,
      this.feedbackNicknameModal
    );
  }

  setAutoSubmitPreference(enabled) {
    saveAutoSubmitPreference(enabled);
    if (enabled) {
      let nick = loadSavedNickname();
      if (!nick) {
        nick = generateDefaultNickname();
        saveNickname(nick);
        this.nicknameDraft = nick;
      }
    }
    this.syncPreferenceUI();
  }

  handleNicknameInput(val) {
    this.nicknameDraft = val;
    const validated = validateNickname(val);
    const updateFeedback = (feedback) => {
      if (!feedback) return;
      if (validated.ok || !val) {
        feedback.hidden = true;
        feedback.textContent = '';
      } else {
        feedback.hidden = false;
        feedback.textContent = validated.message;
      }
    };

    updateFeedback(this.feedbackNicknameMenu);
    updateFeedback(this.feedbackNicknameModal);

    if (validated.ok) {
      saveNickname(validated.value);
    }

    if (this.inputNicknameMenu && this.inputNicknameMenu !== document.activeElement) {
      this.inputNicknameMenu.value = val;
    }
    if (this.inputNicknameModal && this.inputNicknameModal !== document.activeElement) {
      this.inputNicknameModal.value = val;
    }
  }

  generateRandomNickname() {
    const nick = generateDefaultNickname();
    saveNickname(nick);
    this.nicknameDraft = nick;
    this.syncPreferenceUI();
  }

  /* ---------------- Global leaderboard ---------------- */

  populateGlobalFilters() {
    if (this.globalFilterLot.options.length > 0) return;
    const addOpt = (sel, value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    };
    addOpt(this.globalFilterLot, 'all', 'All lots');
    Object.values(LOTS).forEach((lot) => addOpt(this.globalFilterLot, lot.id, lot.name));

    addOpt(this.globalFilterMods, 'all', 'All difficulties');
    addOpt(this.globalFilterMods, '', 'Standard (no modifiers)');
    const ids = Object.values(MODIFIERS).filter((m) => !m.isBaseline).map((m) => m.id);
    const sorted = [...ids].sort();
    for (let mask = 1; mask < 1 << sorted.length; mask++) {
      const picked = sorted.filter((_, i) => mask & (1 << i));
      addOpt(
        this.globalFilterMods,
        picked.join(','),
        picked.map((id) => MODIFIERS[id].name).join(' + ')
      );
    }
  }

  openGlobalLeaderboard(preset = null) {
    this.populateGlobalFilters();
    if (preset) {
      this.globalFilterLot.value = preset.lot ?? 'all';
      this.globalFilterMods.value = preset.mods ?? 'all';
    }
    this.openModal(this.modalGlobal);
    this.loadGlobalPage(0);
  }

  setGlobalStatus(text, isError = false) {
    this.globalStatus.textContent = text;
    this.globalStatus.classList.toggle('is-error', isError);
  }

  async loadGlobalPage(offset) {
    const requestId = ++this.globalState.requestId;
    this.globalState.offset = offset;
    this.globalTableBody.replaceChildren();
    this.globalPrev.disabled = true;
    this.globalNext.disabled = true;
    this.globalPageInfo.textContent = '';
    this.setGlobalStatus('Loading global scores…');

    const res = await fetchLeaderboard({
      lot: this.globalFilterLot.value,
      mods: this.globalFilterMods.value,
      limit: GLOBAL_PAGE_SIZE,
      offset
    });
    if (requestId !== this.globalState.requestId) return; // a newer request superseded this one

    if (!res.ok) {
      this.setGlobalStatus(
        `${res.message} Your local records are unaffected. Close and reopen to retry.`,
        true
      );
      return;
    }

    const { entries, total } = res.data;
    this.globalState.total = total;
    if (entries.length === 0) {
      this.setGlobalStatus(
        total === 0 ? 'No global scores yet for this filter. Be the first!' : 'No more results on this page.'
      );
    } else {
      this.setGlobalStatus('');
    }

    const rows = document.createDocumentFragment();
    entries.forEach((e, idx) => {
      const tr = document.createElement('tr');
      const cell = (text, cls) => {
        const td = document.createElement('td');
        td.textContent = text; // always text, never HTML
        if (cls) td.className = cls;
        tr.appendChild(td);
      };
      const rankNum = e.rank !== undefined && e.rank !== null ? e.rank : (offset + idx + 1);
      cell(String(rankNum), 'global-rank');
      cell(e.nickname, 'global-nick');
      cell(Number(e.score).toLocaleString(), 'global-score');
      cell(LOTS[e.lotId]?.name || e.lotId);
      const modNames = e.modifiers.length
        ? e.modifiers.map((id) => MODIFIERS[id]?.name || id).join(' + ')
        : 'Standard';
      cell(`${modNames} (${Number(e.difficultyMultiplier).toFixed(2)}×)`);
      cell(new Date(e.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
      rows.appendChild(tr);
    });
    this.globalTableBody.appendChild(rows);

    const first = entries.length ? offset + 1 : 0;
    const last = offset + entries.length;
    this.globalPageInfo.textContent = total ? `${first}–${last} of ${total.toLocaleString()}` : '';
    this.globalPrev.disabled = offset <= 0;
    this.globalNext.disabled = last >= total;
  }

  renderGlobalSubmitPanel() {
    const panel = this.globalSubmitPanel;
    const st = this.state;
    const res = st.roundResult;
    if (!res || !res.success || st.phase !== GAME_PHASES.RESULTS) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.replaceChildren();

    const lot = st.getLot();
    const modNames = st.activeModifiers.length
      ? st.activeModifiers.map((id) => MODIFIERS[id].name).join(' + ')
      : 'Standard';

    const h = document.createElement('h3');
    h.textContent = '🌍 Global Leaderboard (optional)';
    panel.appendChild(h);

    const summary = document.createElement('p');
    summary.className = 'global-submit-summary';
    summary.textContent = `${res.finalScore.toLocaleString()} pts · ${lot.name} · ${modNames}`;
    panel.appendChild(summary);

    const note = document.createElement('p');
    note.className = 'global-submit-note';
    note.textContent =
      'Submitting publishes your nickname, score, lot, difficulty and play time to the public global leaderboard. Nothing is uploaded unless you press Submit.';
    panel.appendChild(note);

    const sub = st.submission;
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn-nav';
    viewBtn.textContent = '🌍 View Global Leaderboard';
    viewBtn.addEventListener('click', () =>
      this.openGlobalLeaderboard({ lot: st.lotId, mods: [...st.activeModifiers].sort().join(',') })
    );

    if (sub.status === 'done') {
      const msg = document.createElement('p');
      msg.className = 'global-submit-msg is-success';
      const ranks = sub.result?.ranks;
      const prefix = sub.isAuto ? '⚡ Auto-submitted to Global Leaderboard! ' : '';
      msg.textContent = ranks
        ? `${prefix}${sub.message} Rank #${ranks.category} for ${lot.name} · ${modNames} (#${ranks.lot} in ${lot.name}, #${ranks.global} overall).`
        : `${prefix}${sub.message}`;
      panel.appendChild(msg);
      panel.appendChild(viewBtn);
      return;
    }

    if (sub.status === 'submitting') {
      const msg = document.createElement('p');
      msg.className = 'global-submit-msg';
      msg.textContent = sub.message || 'Connecting to the global leaderboard…';
      panel.appendChild(msg);
      return;
    }

    if (st.sessionStatus === 'pending') {
      const msg = document.createElement('p');
      msg.className = 'global-submit-msg';
      msg.textContent = 'Connecting to the global leaderboard…';
      panel.appendChild(msg);
      return;
    }
    if (!st.canSubmitGlobally()) {
      const msg = document.createElement('p');
      msg.className = 'global-submit-msg';
      msg.textContent =
        'The global leaderboard is unavailable for this game. Your score is still saved in Local Records.';
      panel.appendChild(msg);
      panel.appendChild(viewBtn);
      return;
    }

    const form = document.createElement('form');
    form.className = 'global-submit-form';
    form.noValidate = true;
    const label = document.createElement('label');
    label.textContent = 'Nickname';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'nickname';
    input.maxLength = 16;
    input.autocomplete = 'off';
    input.placeholder = 'Up to 16 characters';
    input.value = this.nicknameDraft || loadSavedNickname();
    input.setAttribute('aria-label', 'Nickname for the global leaderboard');
    input.addEventListener('input', () => {
      this.handleNicknameInput(input.value);
    });
    label.appendChild(input);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn-primary';
    submit.textContent = sub.status === 'submitting' ? 'Submitting…' : '📤 Submit Score';
    submit.disabled = sub.status === 'submitting';
    form.append(label, submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true; // immediate guard against repeated clicks; state also guards
      st.submitToLeaderboard(input.value);
    });
    panel.appendChild(form);

    if (sub.status === 'error') {
      const msg = document.createElement('p');
      msg.className = 'global-submit-msg is-error';
      msg.setAttribute('role', 'alert');
      msg.textContent = sub.message;
      panel.appendChild(msg);
    }
    panel.appendChild(viewBtn);

    const toggleRow = document.createElement('div');
    toggleRow.className = 'global-submit-pref-row';
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'pref-toggle-label';
    const toggleCheck = document.createElement('input');
    toggleCheck.type = 'checkbox';
    toggleCheck.className = 'pref-checkbox';
    toggleCheck.checked = loadAutoSubmitPreference();
    toggleCheck.addEventListener('change', (e) => {
      this.setAutoSubmitPreference(e.target.checked);
      this.renderGlobalSubmitPanel();
    });
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'pref-toggle-text';
    toggleSpan.textContent = 'Automatically submit scores to global leaderboard';
    toggleLabel.append(toggleCheck, toggleSpan);
    toggleRow.appendChild(toggleLabel);
    panel.appendChild(toggleRow);
  }

  render(state, source = 'state') {
    this.updateMuteButton();

    if (source === 'timer' && state.phase === GAME_PHASES.PLAYING) {
      this.hudTimer.textContent = formatTime(state.elapsedSeconds);
      return;
    }

    const isMenu = state.phase === GAME_PHASES.MENU;
    const isPlaying =
      state.phase === GAME_PHASES.PLAYING || state.phase === GAME_PHASES.RESOLVING;
    const isResults = state.phase === GAME_PHASES.RESULTS;

    this.screenMenu.hidden = !isMenu;
    this.screenGame.hidden = !isPlaying;
    this.screenResults.hidden = !isResults;

    if (isMenu) {
      this.renderMenuScreen();
    } else if (isPlaying) {
      this.renderGameScreen();
    } else if (isResults) {
      this.renderResultsScreen();
    }

    this.lastPhase = state.phase;
  }

  updateMuteButton() {
    const muted = sound.isMuted();
    this.btnMute.textContent = muted ? '🔇 Muted' : '🔊 Sound';
    this.btnMute.setAttribute('aria-pressed', String(!muted));
  }

  renderMenuScreen() {
    const { lotId, activeModifiers, records } = this.state;

    this.lotCardsContainer.innerHTML = Object.values(LOTS)
      .map((lot) => {
        const selected = lot.id === lotId;
        const lotRec = records.byLot[lot.id] || {
          bestScore: 0,
          gamesPlayed: 0,
          successfulParks: 0
        };
        return `
          <button
            type="button"
            class="lot-card ${selected ? 'is-selected' : ''}"
            data-lot-id="${lot.id}"
            aria-pressed="${selected}"
          >
            <div class="lot-card-top">
              <div>
                <span class="lot-badge">${lot.subtitle}</span>
                <h3 class="lot-title">${lot.name}</h3>
              </div>
              <span class="lot-dims">${lot.rows}×${lot.cols} (${lot.totalSpaces} stalls)</span>
            </div>
            <p class="lot-desc">${lot.description}</p>
            <p class="lot-atmosphere">“${lot.atmosphere}”</p>
            <div class="lot-card-footer">
              <span>Base Diff: <strong>${lot.baseDifficultyMultiplier.toFixed(2)}×</strong></span>
              <span>Inspect: <strong>-${lot.inspectCost} Pat</strong></span>
              <span>Best: <strong>${lotRec.bestScore.toLocaleString()} pts</strong></span>
            </div>
          </button>
        `;
      })
      .join('');

    this.lotCardsContainer.querySelectorAll('[data-lot-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playInspect();
        this.state.selectLot(btn.getAttribute('data-lot-id'));
      });
    });

    const isStandardSelected = activeModifiers.length === 0;
    this.modifierCardsContainer.innerHTML = Object.values(MODIFIERS)
      .map((mod) => {
        const selected = mod.isBaseline
          ? isStandardSelected
          : activeModifiers.includes(mod.id);
        return `
          <button
            type="button"
            class="mod-card ${selected ? 'is-selected' : ''}"
            data-mod-id="${mod.id}"
            aria-pressed="${selected}"
          >
            <div class="mod-card-header">
              <span class="mod-name">${mod.shortLabel}</span>
              <span class="mod-bonus">${
                mod.isBaseline ? '1.00× Base' : `+${Math.round(mod.multiplierBonus * 100)}% Score`
              }</span>
            </div>
            <p class="mod-desc">${mod.description}</p>
            <div class="mod-effect">${mod.effectSummary}</div>
          </button>
        `;
      })
      .join('');

    this.modifierCardsContainer.querySelectorAll('[data-mod-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playInspect();
        this.state.toggleModifier(btn.getAttribute('data-mod-id'));
      });
    });

    const lot = LOTS[lotId];
    const diffInfo = calculateDifficultyMultiplier(lotId, activeModifiers);
    const lotStats = records.byLot[lotId] || {
      bestScore: 0,
      gamesPlayed: 0,
      successfulParks: 0,
      accidents: 0
    };
    const activeModLabels =
      activeModifiers.length === 0
        ? 'Standard (No extra modifiers)'
        : activeModifiers.map((id) => MODIFIERS[id].name).join(' + ');

    this.lotPreviewPanel.innerHTML = `
      <div class="preview-grid">
        <div class="preview-item">
          <span class="preview-label">Selected Environment</span>
          <strong class="preview-val">${lot.name} (${lot.rows}×${lot.cols} Grid)</strong>
        </div>
        <div class="preview-item">
          <span class="preview-label">Active Modifiers</span>
          <strong class="preview-val">${activeModLabels}</strong>
        </div>
        <div class="preview-item">
          <span class="preview-label">Total Difficulty Multiplier</span>
          <strong class="preview-val accent-text">${diffInfo.totalMultiplier.toFixed(2)}×</strong>
        </div>
        <div class="preview-item">
          <span class="preview-label">Starting Patience</span>
          <strong class="preview-val">${lot.basePatience} pts (-${lot.inspectCost} per inspection)</strong>
        </div>
        <div class="preview-item">
          <span class="preview-label">Target Par Search Time</span>
          <strong class="preview-val">${formatTime(lot.parTimeSeconds)}</strong>
        </div>
        <div class="preview-item">
          <span class="preview-label">${lot.name} Personal Best</span>
          <strong class="preview-val">${lotStats.bestScore.toLocaleString()} pts (${lotStats.successfulParks}/${lotStats.gamesPlayed} parked)</strong>
        </div>
      </div>
    `;
  }

  renderGameScreen() {
    const { board, elapsedSeconds, patience, maxPatience, lastPatienceEvent, flagMode } =
      this.state;
    const lot = this.state.getLot();
    const diffInfo = calculateDifficultyMultiplier(this.state.lotId, this.state.activeModifiers);

    this.hudLotName.textContent = lot.name;
    const modNames =
      this.state.activeModifiers.length === 0
        ? 'Standard'
        : this.state.activeModifiers.map((id) => MODIFIERS[id].shortLabel).join(' • ');
    this.hudModifiers.textContent = `${modNames} (${diffInfo.totalMultiplier.toFixed(2)}×)`;

    this.hudTimer.textContent = formatTime(elapsedSeconds);

    const pct = Math.max(0, Math.min(100, Math.round((patience / maxPatience) * 100)));
    this.hudPatienceValue.textContent = `${patience} / ${maxPatience}`;
    this.hudPatienceFill.style.width = `${pct}%`;
    this.hudPatienceFill.className = `patience-bar-fill ${
      pct <= 25 ? 'is-critical' : pct <= 55 ? 'is-warning' : ''
    }`;

    if (lastPatienceEvent) {
      this.hudPatienceEvent.textContent = lastPatienceEvent.reason;
    }

    this.btnFlagMode.setAttribute('aria-pressed', String(flagMode));
    this.btnFlagMode.classList.toggle('is-active', flagMode);
    this.btnFlagMode.textContent = flagMode
      ? '⚠️ Flag Mode: ON'
      : '⚠️ Flag Hazard: OFF';

    this.renderGooseBar();
    this.renderStorefrontAndBoard(board, lot);
    this.renderInspectorPanel();
  }

  renderGooseBar() {
    this.gooseAvatar.innerHTML = getGooseSvg(this.state.gooseMood);
    this.gooseSpeech.textContent = `“${this.state.gooseMessage}”`;
  }

  renderStorefrontAndBoard(board, lot) {
    if (!board) return;

    const entrances = normalizeEntrances(board.entrances || board.entranceCols, lot);
    const topEntrances = entrances.filter((e) => e.edge === 'top');
    const bottomEntrances = entrances.filter((e) => e.edge === 'bottom');
    const leftEntrances = entrances.filter((e) => e.edge === 'left');
    const rightEntrances = entrances.filter((e) => e.edge === 'right');
    const templateName = board.layoutTemplate ? board.layoutTemplate.toUpperCase() : 'CONVENTIONAL';

    // 1. Top Banner
    if (topEntrances.length > 0) {
      const entranceCells = [];
      for (let c = 0; c < lot.cols; c++) {
        const matchingDoor = topEntrances.find((e) => e.doorCol === c);
        entranceCells.push(`
          <div class="storefront-col ${matchingDoor ? 'is-entrance-door' : ''}">
            ${
              matchingDoor
                ? `<span class="door-pill">🚪 ENTRANCE</span>`
                : `<span class="curb-segment">CURB</span>`
            }
          </div>
        `);
      }

      this.storefrontBanner.innerHTML = `
        <div class="storefront-building">
          <span>${lot.storefrontLabel}</span>
          <span class="layout-template-badge">${templateName}</span>
        </div>
        <div class="storefront-doors-row" style="grid-template-columns: repeat(${lot.cols}, minmax(0, 1fr));">
          ${entranceCells.join('')}
        </div>
      `;
      this.storefrontBanner.style.display = 'block';
    } else {
      this.storefrontBanner.innerHTML = `
        <div class="storefront-building perimeter-banner">
          <span>${lot.name.toUpperCase()} • ${board.layoutTemplate === 'side' ? 'SIDE ENTRANCE ARCADE' : 'PERIMETER FENCE & OVERFLOW ACCESS'}</span>
          <span class="layout-template-badge">${templateName}</span>
        </div>
      `;
      this.storefrontBanner.style.display = 'block';
    }

    // 2. Bottom Banner
    if (this.bottomStorefrontBanner) {
      if (bottomEntrances.length > 0) {
        const entranceCells = [];
        for (let c = 0; c < lot.cols; c++) {
          const matchingDoor = bottomEntrances.find((e) => e.doorCol === c);
          entranceCells.push(`
            <div class="storefront-col ${matchingDoor ? 'is-entrance-door' : ''}">
              ${
                matchingDoor
                  ? `<span class="door-pill">🚪 ENTRANCE</span>`
                  : `<span class="curb-segment">CURB</span>`
              }
            </div>
          `);
        }

        const bottomTitle = bottomEntrances[0]?.label ? `${bottomEntrances[0].label.toUpperCase()} • MAIN STOREFRONT ATRIUM` : lot.storefrontLabel;
        this.bottomStorefrontBanner.innerHTML = `
          <div class="storefront-doors-row" style="grid-template-columns: repeat(${lot.cols}, minmax(0, 1fr));">
            ${entranceCells.join('')}
          </div>
          <div class="storefront-building bottom-building">
            <span>${bottomTitle}</span>
            <span class="layout-template-badge">${templateName} GATE</span>
          </div>
        `;
        this.bottomStorefrontBanner.style.display = 'block';
      } else {
        this.bottomStorefrontBanner.style.display = 'none';
      }
    }

    // 3. Parking Grid Rows
    const rowsHtml = [];
    for (let r = 0; r < board.rows; r++) {
      const rowLetter = String.fromCharCode(65 + r);

      if (board.sectionDividerRow != null && r === board.sectionDividerRow + 1) {
        rowsHtml.push(`
          <div class="concourse-lane" aria-hidden="true">
            <span class="concourse-badge">🚶 CENTRAL CONCOURSE & DRIVING AISLE 🚶</span>
            <span class="concourse-info">CONNECTING PARKING SECTIONS • DIRECT CROSSING</span>
          </div>
        `);
      }

      if (r === 0 || r % 2 === 1) {
        const laneDirection = r % 2 === 0 ? '➔  DRIVING LANE  ➔' : '⬅  DRIVING LANE  ⬅';
        rowsHtml.push(`
          <div class="driving-lane" aria-hidden="true">
            <span class="lane-label">ROW ${rowLetter}</span>
            <span class="lane-arrows">${laneDirection}</span>
            <span class="lane-label">ROW ${rowLetter}</span>
          </div>
        `);
      }

      const stallsHtml = [];
      for (let c = 0; c < board.cols; c++) {
        const cell = board.grid[r][c];
        stallsHtml.push(this.renderStallButton(cell, lot));
      }

      rowsHtml.push(`
        <div
          class="parking-row"
          role="row"
          aria-label="Parking Row ${rowLetter}"
          style="grid-template-columns: repeat(${board.cols}, minmax(0, 1fr));"
        >
          ${stallsHtml.join('')}
        </div>
      `);
    }

    // 4. Side Flanks with Vertical Access Lanes
    let leftFlankHtml = '';
    if (leftEntrances.length > 0) {
      const slots = [];
      for (let r = 0; r < board.rows; r++) {
        const door = leftEntrances.find((e) => e.doorRow === r);
        if (door) {
          slots.push(`
            <div class="side-curb-slot is-door">
              <span class="door-icon">🚪</span>
              <span class="door-title">ENTRANCE</span>
            </div>
          `);
        } else {
          slots.push(`<div class="side-curb-slot"><span class="curb-segment">CURB</span></div>`);
        }
      }
      leftFlankHtml = `
        <aside class="side-flank left" aria-label="West Storefront Entrance and Access Lane">
          <div class="side-building-facade">
            <div class="side-facade-header">${leftEntrances[0].label.replace(lot.name, '').trim() || 'WEST ARCADE'}</div>
            <div class="side-facade-body">${slots.join('')}</div>
          </div>
          <div class="vertical-access-lane" aria-hidden="true">
            <span class="lane-arrow-up">▲</span>
            <span class="lane-text-v">ACCESS LANE</span>
            <span class="lane-arrow-down">▼</span>
          </div>
        </aside>
      `;
    }

    let rightFlankHtml = '';
    if (rightEntrances.length > 0) {
      const slots = [];
      for (let r = 0; r < board.rows; r++) {
        const door = rightEntrances.find((e) => e.doorRow === r);
        if (door) {
          slots.push(`
            <div class="side-curb-slot is-door">
              <span class="door-icon">🚪</span>
              <span class="door-title">ENTRANCE</span>
            </div>
          `);
        } else {
          slots.push(`<div class="side-curb-slot"><span class="curb-segment">CURB</span></div>`);
        }
      }
      rightFlankHtml = `
        <aside class="side-flank right" aria-label="East Storefront Entrance and Access Lane">
          <div class="vertical-access-lane" aria-hidden="true">
            <span class="lane-arrow-up">▲</span>
            <span class="lane-text-v">ACCESS LANE</span>
            <span class="lane-arrow-down">▼</span>
          </div>
          <div class="side-building-facade">
            <div class="side-facade-header">${rightEntrances[0].label.replace(lot.name, '').trim() || 'EAST PLAZA'}</div>
            <div class="side-facade-body">${slots.join('')}</div>
          </div>
        </aside>
      `;
    }

    this.boardGridContainer.innerHTML = `
      <div class="lot-layout-container ${leftEntrances.length > 0 ? 'has-left-flank' : ''} ${rightEntrances.length > 0 ? 'has-right-flank' : ''}">
        ${leftFlankHtml}
        <div class="lot-rows-container">
          ${rowsHtml.join('')}
        </div>
        ${rightFlankHtml}
      </div>
    `;

    this.boardGridContainer.querySelectorAll('.parking-stall').forEach((btn) => {
      const r = Number(btn.getAttribute('data-r'));
      const c = Number(btn.getAttribute('data-c'));

      btn.addEventListener('click', () => {
        this.state.inspectOrSelectSpace(r, c);
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.state.toggleFlag(r, c);
      });
    });
  }

  /**
   * Renders a visually clean top-down parking stall:
   * - Unknown spaces show ONLY their stall coordinate (A1) and a visual ? or cone icon.
   *   No precomputed quality ratings, risk percentages, or scores are leaked!
   * - Visible landmarks (obviously parked sedans/concrete poles) show their SVG graphic.
   * - Inspected spaces show their visual graphic + circular Clue Badge (0-8 adjacent trouble stalls).
   */
  renderStallButton(cell, lot) {
    const isSelectedSafe =
      this.state.selectedCoords &&
      this.state.selectedCoords[0] === cell.r &&
      this.state.selectedCoords[1] === cell.c;
    const isLastInspected =
      this.state.lastInspectedCoords &&
      this.state.lastInspectedCoords[0] === cell.r &&
      this.state.lastInspectedCoords[1] === cell.c;

    // Case 1: Completely unknown space (not revealed and not a visible landmark)
    if (!cell.revealed && !cell.visibleAtStart) {
      if (cell.flagged) {
        return `
          <button
            type="button"
            class="parking-stall stall-unknown stall-flagged"
            data-r="${cell.r}"
            data-c="${cell.c}"
            aria-label="Stall ${cell.id}, Flagged as suspected trouble. Right-click or use Flag mode to unflag."
          >
            <div class="stall-top-bar">
              <span class="stall-id">${cell.id}</span>
              <span class="flag-indicator" aria-hidden="true">⚠️</span>
            </div>
            <div class="stall-art-wrap">
              ${getUnknownStallSvg(true)}
            </div>
          </button>
        `;
      }

      return `
        <button
          type="button"
          class="parking-stall stall-unknown"
          data-r="${cell.r}"
          data-c="${cell.c}"
          aria-label="Stall ${cell.id}, Uninspected space. Click to inspect (-${lot.inspectCost} patience)."
        >
          <div class="stall-top-bar">
            <span class="stall-id">${cell.id}</span>
          </div>
          <div class="stall-art-wrap">
            ${getUnknownStallSvg(false)}
          </div>
        </button>
      `;
    }

    // Case 2: Obviously occupied car or physical pillar visible at start, but surroundings not inspected yet
    if (cell.visibleAtStart && !cell.revealed) {
      const glanceCost = Math.max(2, Math.floor(lot.inspectCost / 2));
      return `
        <button
          type="button"
          class="parking-stall stall-occupied stall-landmark"
          data-r="${cell.r}"
          data-c="${cell.c}"
          aria-label="Stall ${cell.id}, ${cell.title} (Visible). Click to check surrounding trouble clue (-${glanceCost} patience)."
        >
          <div class="stall-top-bar">
            <span class="stall-id">${cell.id}</span>
          </div>
          <div class="stall-art-wrap">
            ${getCellIllustrationSvg(cell)}
          </div>
        </button>
      `;
    }

    // Case 3: Inspected / Revealed Stall (shows visual illustration + Clue Badge)
    const clueBadgeClass =
      cell.clue === 0
        ? 'clue-zero'
        : cell.clue === 1
        ? 'clue-low'
        : cell.clue === 2
        ? 'clue-med'
        : 'clue-high';

    if (cell.type === CELL_TYPES.SAFE) {
      return `
        <button
          type="button"
          class="parking-stall stall-safe ${isSelectedSafe ? 'is-selected' : ''} ${
            cell.parkedHere ? 'is-parked' : ''
          }"
          data-r="${cell.r}"
          data-c="${cell.c}"
          aria-label="Stall ${cell.id}, Available Parking Space. Adjacent trouble clue: ${
            cell.clue
          }. ${isSelectedSafe ? 'Selected for inspection.' : 'Click to view details or park.'}"
        >
          <div class="stall-top-bar">
            <span class="stall-id">${cell.id}</span>
            <span class="clue-badge ${clueBadgeClass}" title="Adjacent trouble stalls: ${cell.clue}">
              ${cell.clue}
            </span>
          </div>
          <div class="stall-art-wrap">
            ${getCellIllustrationSvg(cell)}
          </div>
        </button>
      `;
    }

    // Revealed Occupied, Blocked, or Hazard stall
    let statusClass = 'stall-occupied';
    if (cell.type === CELL_TYPES.HAZARD) {
      statusClass = 'stall-hazard';
    } else if (cell.type === CELL_TYPES.BLOCKED) {
      statusClass = 'stall-blocked';
    } else if (cell.isBadParker) {
      statusClass = 'stall-bad-parker';
    }

    return `
      <button
        type="button"
        class="parking-stall ${statusClass} ${isLastInspected ? 'is-focused-clue' : ''}"
        data-r="${cell.r}"
        data-c="${cell.c}"
        aria-label="Stall ${cell.id}, ${cell.title}. Adjacent trouble clue: ${cell.clue}."
      >
        <div class="stall-top-bar">
          <span class="stall-id">${cell.id}</span>
          <span class="clue-badge ${clueBadgeClass}" title="Adjacent trouble stalls: ${cell.clue}">
            ${cell.clue}
          </span>
        </div>
        <div class="stall-art-wrap">
          ${getCellIllustrationSvg(cell)}
        </div>
      </button>
    `;
  }

  /**
   * Renders the Side Inspection Panel:
   * - Distinguishes Confirmed Facts from Justified Estimates.
   * - Never displays false certainty ("0% Guaranteed" or precomputed final scores).
   */
  renderInspectorPanel() {
    const board = this.state.board;
    const lot = this.state.getLot();
    if (!board) return;

    let discoveredSafeSpaces = 0;
    for (const row of board.grid) {
      for (const c of row) {
        if (c.revealed && c.type === CELL_TYPES.SAFE) {
          discoveredSafeSpaces++;
        }
      }
    }

    const selectedSafe = this.state.getSelectedCell();
    const lastInspected =
      this.state.lastInspectedCoords &&
      board.grid[this.state.lastInspectedCoords[0]]?.[this.state.lastInspectedCoords[1]];

    // Show the last inspected stall if no safe space is selected, OR if the player just clicked a non-safe stall
    const activeCell =
      lastInspected && (!selectedSafe || lastInspected !== selectedSafe)
        ? lastInspected
        : selectedSafe;

    if (!activeCell) {
      this.inspectorContent.innerHTML = `
        <div class="inspector-empty">
          <span class="inspector-eyebrow">LOT OBSERVATION</span>
          <h3>Search for a Space</h3>
          <p>Click any <strong>?</strong> stall to inspect it (<strong>-${lot.inspectCost} Patience</strong>). Visible parked cars show a number when inspected indicating how many of their 8 neighboring stalls contain <strong>Trouble</strong>.</p>
        </div>
      `;
      return;
    }

    const evalInfo = getObservedSpaceEvaluation(board, activeCell);

    // If the currently viewed cell is NOT a safe available space (e.g. a visible car, bad parker, or hazard),
    // show its clue breakdown AND if the player has already found a safe space, provide a quick button to switch back to it!
    if (activeCell.type !== CELL_TYPES.SAFE) {
      const isTrouble = isTroubleCell(activeCell);
      this.inspectorContent.innerHTML = `
        <div class="inspector-card">
          <div class="inspector-header">
            <div>
              <span class="inspector-eyebrow">INSPECTED STALL (${discoveredSafeSpaces} open found)</span>
              <h3 class="inspector-title">Stall ${activeCell.id}: ${activeCell.title}</h3>
            </div>
            <span class="quality-badge-large ${isTrouble ? 'badge-trouble' : 'badge-neutral'}">
              ${isTrouble ? '⚠️ Trouble Stall' : 'Parked Vehicle'}
            </span>
          </div>

          <p class="inspector-tagline">“${activeCell.description}”</p>

          <div class="inspector-metrics">
            <div class="metric-box">
              <span class="metric-label">Confirmed Status</span>
              <strong class="metric-val">Unavailable (${activeCell.type})</strong>
            </div>
            <div class="metric-box">
              <span class="metric-label">Adjacent Trouble Clue</span>
              <strong class="metric-val accent-text">${activeCell.clue} of 8 neighbors</strong>
            </div>
          </div>

          <div class="inspector-factors">
            <div>
              <h4>Deduction From Stall ${activeCell.id}:</h4>
              <ul>
                ${evalInfo.observedNotes.map((n) => `<li>${n}</li>`).join('')}
              </ul>
            </div>
          </div>

          ${
            selectedSafe
              ? `<button type="button" id="btn-focus-safe" class="btn-primary btn-commit">
                   🅿️ RETURN TO OPEN STALL ${selectedSafe.id}
                 </button>`
              : `<p class="commit-subtext">Use the clue above to inspect likely safe neighboring stalls.</p>`
          }
        </div>
      `;

      const focusBtn = document.getElementById('btn-focus-safe');
      if (focusBtn && selectedSafe) {
        focusBtn.addEventListener('click', () => {
          this.state.lastInspectedCoords = [selectedSafe.r, selectedSafe.c];
          this.renderInspectorPanel();
        });
      }
      return;
    }

    // Active cell is a revealed SAFE space!
    this.inspectorContent.innerHTML = `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="inspector-eyebrow">AVAILABLE SPACE (${discoveredSafeSpaces} discovered)</span>
            <h3 class="inspector-title">Stall ${activeCell.id}</h3>
          </div>
          <span class="quality-badge-large ${evalInfo.displayTier.badgeClass}">
            ${evalInfo.qualityStatusBadge}: ${renderStarsHtml(evalInfo.displayTier)} ${evalInfo.displayTier.label}
          </span>
        </div>

        <p class="inspector-tagline">“${evalInfo.displayTier.tagline}”</p>

        <div class="inspector-metrics">
          <div class="metric-box">
            <span class="metric-label">Confirmed Proximity</span>
            <strong class="metric-val">${evalInfo.proximityLabel}</strong>
          </div>
          <div class="metric-box">
            <span class="metric-label">Confirmed Clue</span>
            <strong class="metric-val">${activeCell.clue} adjacent trouble</strong>
          </div>
          <div class="metric-box">
            <span class="metric-label">Space Quality (${evalInfo.qualityStatusBadge})</span>
            <strong class="metric-val accent-text">${renderStarsHtml(evalInfo.displayTier)} ${evalInfo.displayTier.label}</strong>
          </div>
          <div class="metric-box">
            <span class="metric-label">Maneuver Condition</span>
            <strong class="metric-val ${evalInfo.riskBandClass}">${evalInfo.riskBandLabel}</strong>
          </div>
        </div>

        <div class="inspector-factors">
          <div>
            <h4>Confirmed Observations:</h4>
            <ul>
              ${evalInfo.observedNotes.map((n) => `<li>${n}</li>`).join('')}
            </ul>
          </div>
          <div>
            <h4>Maneuvering Assessment:</h4>
            <p class="assessment-note">${evalInfo.riskStatusNote}</p>
          </div>
        </div>

        <button
          type="button"
          id="btn-commit-park"
          class="btn-primary btn-commit"
        >
          🅿️ PARK IN STALL ${activeCell.id}
        </button>
        <p class="commit-subtext">
          Take this space now, or spend time and patience (-${lot.inspectCost} per stall) searching for a better option.
        </p>
      </div>
    `;

    const commitBtn = document.getElementById('btn-commit-park');
    if (commitBtn) {
      commitBtn.addEventListener('click', () => {
        this.state.commitToSpace(activeCell.r, activeCell.c);
      });
    }
  }

  renderResultsScreen() {
    const res = this.state.roundResult;
    if (!res) return;

    const lot = this.state.getLot();
    const recUpdate = this.state.recordUpdate;
    const lotRecords = this.state.records.byLot[this.state.lotId];
    const modList =
      this.state.activeModifiers.length === 0
        ? 'Standard (1.00×)'
        : this.state.activeModifiers.map((id) => MODIFIERS[id].name).join(', ');

    const outcomeBannerClass = res.patienceFailed
      ? 'outcome-severe'
      : res.isAccident
      ? 'outcome-accident'
      : 'outcome-clean';

    const cardsHtml = `
      <div class="results-banner ${outcomeBannerClass}">
        <div class="results-banner-top">
          <span class="results-badge">${res.patienceFailed ? 'ROUND FAILED' : 'PARKING RESOLVED'}</span>
          ${
            recUpdate?.isNewLotBest
              ? `<span class="new-best-pill">🏆 NEW ${lot.name.toUpperCase()} RECORD!</span>`
              : ''
          }
        </div>
        <h2 class="results-outcome-title">${res.outcomeTitle}</h2>
        <p class="results-outcome-msg">${res.headerLead || res.outcomeMessage}</p>
        <p class="results-humor-summary">“${res.humorousSummary}”</p>
      </div>

      <div class="results-goose-box">
        <div class="results-goose-icon">${getGooseSvg(this.state.gooseMood)}</div>
        <div class="results-goose-text">
          <span class="goose-label">THE GOOSE'S OFFICIAL VERDICT:</span>
          <p>“${res.gooseLine}”</p>
        </div>
      </div>

      <div class="results-grid">
        <div class="results-panel">
          <h3>Round Summary</h3>
          <dl class="breakdown-list">
            <div class="breakdown-row">
              <dt>Parking Lot</dt>
              <dd>${lot.name}</dd>
            </div>
            <div class="breakdown-row">
              <dt>Difficulty Modifiers</dt>
              <dd>${modList}</dd>
            </div>
            <div class="breakdown-row">
              <dt>Total Elapsed Time</dt>
              <dd>${formatTime(this.state.elapsedSeconds)} (${res.timeEfficiencyLabel})</dd>
            </div>
            <div class="breakdown-row">
              <dt>Selected Space & Quality</dt>
              <dd>${res.stallId ? `Stall ${res.stallId} — ` : ''}${renderStarsHtml(res.qualityTier || res.spaceQualityStars)} ${res.spaceQualityLabel}</dd>
            </div>
            <div class="breakdown-row">
              <dt>Patience Remaining</dt>
              <dd>${res.patienceRemaining} / ${this.state.maxPatience}</dd>
            </div>
            <div class="breakdown-row">
              <dt>Parking Outcome</dt>
              <dd class="${res.isAccident ? 'text-danger' : res.accidentPenalty > 0 ? 'text-warn' : 'text-safe'}">${res.outcomeTitle}</dd>
            </div>
            ${
              res.incidentReport && (res.isAccident || res.accidentPenalty > 0)
                ? `
            <div class="breakdown-row incident-detail-row">
              <dt>Incident Report</dt>
              <dd class="incident-report-text ${res.isAccident ? 'text-danger' : 'text-warn'}">${res.incidentReport}</dd>
            </div>`
                : ''
            }
          </dl>
        </div>

        <div class="results-panel">
          <h3>Score Calculation Breakdown</h3>
          <dl class="breakdown-list">
            <div class="breakdown-row">
              <dt>Base Score</dt>
              <dd>${res.baseScore.toLocaleString()}</dd>
            </div>
            <div class="breakdown-row">
              <dt>× Space Quality (${renderStarsHtml(res.qualityTier || res.spaceQualityStars)} ${res.spaceQualityLabel})</dt>
              <dd>${res.spaceQualityMultiplier.toFixed(2)}×</dd>
            </div>
            <div class="breakdown-row">
              <dt>× Difficulty Multiplier</dt>
              <dd>${res.difficultyMultiplier.toFixed(2)}×</dd>
            </div>
            <div class="breakdown-row">
              <dt>× Time Efficiency Multiplier</dt>
              <dd>${res.timeEfficiencyMultiplier.toFixed(2)}×</dd>
            </div>
            <div class="breakdown-row subtotal-row">
              <dt>Gross Score</dt>
              <dd>${res.grossScore.toLocaleString()} pts</dd>
            </div>
            <div class="breakdown-row ${res.accidentPenalty > 0 ? 'penalty-row' : ''}">
              <dt>${res.penaltyLabel || (res.isAccident ? '− Accident Damage Penalty' : res.accidentPenalty > 0 ? '− Parking Anxiety Penalty' : '− Penalty')}</dt>
              <dd>${res.accidentPenalty > 0 ? `-${res.accidentPenalty} pts` : '0 pts'}</dd>
            </div>
            <div class="breakdown-row ${res.insuranceDeductible > 0 ? 'penalty-row' : ''}">
              <dt>− Insurance Deductible</dt>
              <dd>${res.insuranceDeductible > 0 ? `-${res.insuranceDeductible} pts` : res.isAccident ? '0 pts' : '0 pts (No Claim)'}</dd>
            </div>
            <div class="breakdown-row final-score-row">
              <dt>FINAL SCORE</dt>
              <dd>${res.finalScore.toLocaleString()} pts</dd>
            </div>
          </dl>
        </div>
      </div>
    `;

    const recordsHtml = `
      <span><strong>${lot.name} Best:</strong> ${lotRecords.bestScore.toLocaleString()} pts</span>
      <span><strong>Overall Best:</strong> ${this.state.records.overall.bestScore.toLocaleString()} pts</span>
      <span><strong>Games Played:</strong> ${this.state.records.overall.gamesPlayed}</span>
      <span><strong>Successful Parks:</strong> ${this.state.records.overall.successfulParks}</span>
      <span><strong>Accidents:</strong> ${this.state.records.overall.accidents}</span>
    `;

    if (this.resultsCardsContainer) {
      this.resultsCardsContainer.innerHTML = cardsHtml;
    }
    if (this.resultsRecordsStrip) {
      this.resultsRecordsStrip.innerHTML = recordsHtml;
    } else {
      this.resultsContent.innerHTML = `${cardsHtml}<div class="results-records-strip">${recordsHtml}</div>`;
    }
    this.renderGlobalSubmitPanel();
  }

  renderRecordsModal() {
    const rec = this.state.records;
    const rows = Object.values(LOTS)
      .map((lot) => {
        const s = rec.byLot[lot.id] || {
          bestScore: 0,
          gamesPlayed: 0,
          successfulParks: 0,
          accidents: 0
        };
        return `
          <tr>
            <td><strong>${lot.name}</strong></td>
            <td>${s.bestScore.toLocaleString()}</td>
            <td>${s.gamesPlayed}</td>
            <td>${s.successfulParks}</td>
            <td>${s.accidents}</td>
          </tr>
        `;
      })
      .join('');

    this.recordsModalContent.innerHTML = `
      <div class="records-summary-cards">
        <div class="rec-stat-card">
          <span>Best Score</span>
          <strong>${rec.overall.bestScore.toLocaleString()}</strong>
        </div>
        <div class="rec-stat-card">
          <span>Games Played</span>
          <strong>${rec.overall.gamesPlayed}</strong>
        </div>
        <div class="rec-stat-card">
          <span>Successful Parks</span>
          <strong>${rec.overall.successfulParks}</strong>
        </div>
        <div class="rec-stat-card">
          <span>Accidents Filed</span>
          <strong>${rec.overall.accidents}</strong>
        </div>
      </div>

      <table class="records-table">
        <thead>
          <tr>
            <th>Parking Lot</th>
            <th>Best Score</th>
            <th>Played</th>
            <th>Parked</th>
            <th>Accidents</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }
}
