/**
 * Parking Lot V1 - Main Entrypoint
 * A Stab The Finger Game (https://parkinglot.stabthefinger.com/)
 */

import * as config from './config.js';
import * as generator from './generator.js';
import * as scoring from './scoring.js';
import * as storage from './storage.js';
import * as leaderboard from './leaderboard.js';
import { sound } from './sound.js';
import { ParkingLotState, GAME_PHASES } from './state.js';
import { GameUI } from './ui.js';

function initApp() {
  let ui = null;
  const state = new ParkingLotState((updatedState, source) => {
    if (ui) {
      ui.render(updatedState, source);
    }
  });

  ui = new GameUI(state);
  ui.render(state, 'init');

  // Expose API for debugging and automated verification
  window.ParkingLotGame = {
    state,
    ui,
    config,
    generator,
    scoring,
    storage,
    leaderboard,
    sound,
    GAME_PHASES
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
