/**
 * Procedural audio engine — synthesises all game sounds with Web Audio API.
 * No audio files required. Context is created on first user interaction.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null  = null;
  private effectsVol = 0.70;
  private musicVol   = 0.35;

  constructor() {
    const unlock = () => { this.ensureCtx(); };
    document.addEventListener('click',      unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('keydown',    unlock, { once: true });
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx    = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.effectsVol;
      this.master.connect(this.ctx.destination);
      this.startAmbient();
    }
    return this.ctx;
  }

  // ── Low-level helpers ───────────────────────────────────────────────────────

  private osc(
    freq: number, type: OscillatorType, dur: number, vol: number,
    delay = 0, freqEnd?: number,
  ) {
    const ctx = this.ensureCtx();
    if (!this.master) return;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type            = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + delay + dur * 0.8);
    }
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number, delay = 0) {
    const ctx = this.ensureCtx();
    if (!this.master) return;
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.ceil(sr * dur), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
    src.connect(lpf); lpf.connect(g); g.connect(this.master!);
    src.start(ctx.currentTime + delay);
  }

  // ── Sound effects ───────────────────────────────────────────────────────────

  playClick() {
    this.osc(900,  'square', 0.040, 0.14);
    this.osc(1400, 'sine',   0.025, 0.07, 0.01);
  }

  playMove() {
    this.osc(700, 'sine', 0.18, 0.12, 0, 320);
    this.osc(350, 'sine', 0.14, 0.06, 0.04, 160);
  }

  playHit(intensity = 1.0) {
    const f = 60 + Math.random() * 50;
    this.noise(0.10, Math.min(0.35, 0.22 * intensity), 500);
    this.osc(f, 'sawtooth', 0.07, 0.10 * intensity);
  }

  playShot() {
    // Sharp arquebus crack
    this.noise(0.06, 0.55, 3500);
    this.noise(0.18, 0.20, 800, 0.05);
    this.osc(110, 'sawtooth', 0.12, 0.18, 0.02);
  }

  playDeath() {
    this.osc(180, 'sawtooth', 0.30, 0.16, 0,  80);
    this.osc(120, 'sine',     0.35, 0.10, 0.05);
    this.noise(0.20, 0.12, 300, 0.02);
  }

  playBuild() {
    this.osc(500, 'triangle', 0.08, 0.10);
    this.osc(630, 'triangle', 0.06, 0.08, 0.08);
  }

  playVictory() {
    // C major fanfare  C-E-G-C + harmony
    const mel  = [523, 659, 784, 1047, 1047];
    const harm = [330, 415, 523, 659,  784];
    mel .forEach((f, i) => this.osc(f, 'sine',     0.38, 0.24, i * 0.16));
    harm.forEach((f, i) => this.osc(f, 'triangle', 0.28, 0.14, i * 0.16 + 0.04));
    // Timpani-like boom at start
    this.osc(80, 'sine', 0.50, 0.22, 0, 40);
    this.noise(0.3, 0.18, 600);
  }

  playDefeat() {
    // Descending minor lament
    const mel = [440, 370, 330, 220, 165];
    mel.forEach((f, i) => this.osc(f, 'sawtooth', 0.45, 0.18, i * 0.25));
    // Low drum
    this.osc(60, 'sine', 0.6, 0.20, 0, 30);
    this.noise(0.4, 0.14, 400, 0.1);
  }

  // ── Ambient ─────────────────────────────────────────────────────────────────

  private startAmbient() {
    const ctx = this.ensureCtx();
    if (!this.master) return;

    // Low steady drone (campfire/crowd feel)
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type            = 'sine';
    osc.frequency.value = 55;
    g.gain.value        = 0.025 * this.musicVol;
    osc.connect(g); g.connect(this.master);
    osc.start();

    // Slow wind gusts every 7–14 s
    const scheduleWind = () => {
      const delay = 7 + Math.random() * 7;
      setTimeout(() => {
        if (!this.ctx) return;
        this.noise(2.0, 0.018 * this.musicVol, 600);
        scheduleWind();
      }, delay * 1000);
    };
    scheduleWind();

    // Distant crowd murmur every 12 s
    const scheduleChatter = () => {
      setTimeout(() => {
        if (!this.ctx) return;
        for (let i = 0; i < 4; i++) {
          const f = 200 + Math.random() * 300;
          this.osc(f, 'sine', 0.25 + Math.random() * 0.25, 0.012 * this.musicVol, Math.random() * 0.5);
        }
        scheduleChatter();
      }, 12000 + Math.random() * 8000);
    };
    scheduleChatter();
  }

  // ── Volume control ───────────────────────────────────────────────────────────

  setEffectsVolume(v: number) {
    this.effectsVol = v;
    if (this.master) this.master.gain.value = v;
  }

  setMusicVolume(v: number) {
    this.musicVol = v;
  }
}
