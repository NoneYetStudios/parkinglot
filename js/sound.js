/**
 * Parking Lot V1 - Zero-Dependency Web Audio API Sound Effects
 * Includes Goose honk, shopping-cart rattle, parking confirmation, collision, and insurance notification.
 */

class SoundController {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  isMuted() {
    return this.muted;
  }

  ensureContext() {
    if (this.muted) return null;
    try {
      if (!this.ctx && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = true;
      return this.ctx;
    } catch (_e) {
      return null;
    }
  }

  playInspect() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playCascade() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [380, 480, 600];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.045);
      gain.gain.setValueAtTime(0.07, now + i * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.045 + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.045);
      osc.stop(now + i * 0.045 + 0.1);
    });
  }

  playHonk() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Nasal two-part goose honk using sawtooth + bandpass
    [0, 0.14].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const baseFreq = idx === 0 ? 255 : 295;
      osc.frequency.setValueAtTime(baseFreq, now + offset);
      osc.frequency.linearRampToValueAtTime(baseFreq * 1.18, now + offset + 0.05);
      osc.frequency.linearRampToValueAtTime(baseFreq * 0.92, now + offset + 0.12);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750, now + offset);
      filter.Q.setValueAtTime(3.2, now + offset);

      gain.gain.setValueAtTime(0.14, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.13);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.14);
    });
  }

  playCartRattle() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = [820, 1140, 690, 960];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.032);
      gain.gain.setValueAtTime(0.05, now + i * 0.032);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.032 + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.032);
      osc.stop(now + i * 0.032 + 0.04);
    });
  }

  playParkConfirm() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Friendly key-fob double chirp ("beep-beep!")
    [0, 0.11].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 880 : 1046.5, now + offset);
      gain.gain.setValueAtTime(0.1, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.09);
    });
  }

  playCollision() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Low thud + metallic scrape + insurance stamp chime
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.24);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.27);

    // Follow-up insurance claim alert tone
    const alertOsc = ctx.createOscillator();
    const alertGain = ctx.createGain();
    alertOsc.type = 'triangle';
    alertOsc.frequency.setValueAtTime(440, now + 0.22);
    alertOsc.frequency.setValueAtTime(330, now + 0.34);
    alertGain.gain.setValueAtTime(0.11, now + 0.22);
    alertGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    alertOsc.connect(alertGain);
    alertGain.connect(ctx.destination);
    alertOsc.start(now + 0.22);
    alertOsc.stop(now + 0.5);
  }

  playPatienceFail() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [330, 293.66, 246.94];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.08, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.14);
    });
  }
}

export const sound = new SoundController();
