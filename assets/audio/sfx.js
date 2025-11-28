// Minimal, arcade-y WebAudio SFX for offline play.
// Usage:
//   import { SFX } from "./assets/audio/sfx.js";
//   const sfx = new SFX();
//   await sfx.unlock(); // call this on first user gesture (Start button)
//   sfx.laser(); sfx.hit(); sfx.explosion(); sfx.powerup(); sfx.error(); sfx.bossSiren();

export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musicGain = null;
    this.music = null;
    this.musicTracks = [
      "./assets/audio/Galactic_High_Score_1.wav",
      "./assets/audio/Galactic_High_Score_2.wav",
      "./assets/audio/Galactic_High_Score_3.wav",
      "./assets/audio/Galactic_High_Score_4.wav",
      "./assets/audio/Galactic_High_Score_5.wav",
      "./assets/audio/Galactic_High_Score_6.wav"
    ];
    this.currentMusicBuffer = null;
    this.pendingTrack = null;
    this.musicLoaded = {};
    this.bigExplosionBuffer = null;
  }

  bossExplosion() {
    if (!this.ctx || this.muted || !this.bigExplosionBuffer) {
      this.explosion();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.bigExplosionBuffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  async unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.master);

    await Promise.all([
      this._preloadMusic(),
      this._loadBigExplosion()
    ]);

    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setMuted(m) {
    this.muted = !!m;
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : 0.65;
    if (this.musicGain) this.musicGain.gain.value = this.muted ? 0 : 0.55;
  }

  async _preloadMusic() {
    if (!this.ctx) return;
    const loads = this.musicTracks.map(async (src) => {
      if (this.musicLoaded[src] && this.musicLoaded[src] !== "loading") return;
      this.musicLoaded[src] = "loading";
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      this.musicLoaded[src] = await this.ctx.decodeAudioData(buf);
    });
    await Promise.all(loads);
    if (this.pendingTrack) {
      const next = this.musicLoaded[this.pendingTrack];
      if (next && next !== "loading") this.playMusic(this.pendingTrack);
      this.pendingTrack = null;
    }
  }

  async _loadBigExplosion() {
    if (!this.ctx || this.bigExplosionBuffer) return;
    try {
      const resp = await fetch("./assets/audio/bigexplosion.wav");
      const buf = await resp.arrayBuffer();
      this.bigExplosionBuffer = await this.ctx.decodeAudioData(buf);
    } catch (err) {
      console.warn("Failed to load big explosion sample", err);
    }
  }

  _pickMusicTrack() {
    return this.musicTracks[Math.floor(Math.random() * this.musicTracks.length)];
  }

  playMusic(trackSrc) {
    if (!this.ctx) return;
    const src = trackSrc || this._pickMusicTrack();
    const buffer = this.musicLoaded[src];
    if (!buffer || buffer === "loading") {
      this.pendingTrack = src;
      return;
    }
    if (this.music) {
      try { this.music.stop(); } catch (_) {}
      this.music.disconnect();
    }
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(this.musicGain || this.master);
    if (!this.muted) node.start();
    this.music = node;
  }

  stopMusic() {
    if (!this.music) return;
    try { this.music.stop(); } catch (_) {}
    this.music.disconnect();
    this.music = null;
  }

  _now() { return this.ctx.currentTime; }

  _env(gainNode, t0, a, d, s, r) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(1.0, t0 + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, s), t0 + a + d);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
  }

  _noise(duration = 0.12) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * duration));
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  laser() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "sawtooth";
    filter.type = "highpass";
    filter.frequency.setValueAtTime(900, t0);

    osc.frequency.setValueAtTime(1400, t0);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.08);

    this._env(gain, t0, 0.003, 0.02, 0.20, 0.10);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    osc.start(t0);
    osc.stop(t0 + 0.14);
  }

  hit() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.04);

    this._env(gain, t0, 0.002, 0.02, 0.14, 0.06);

    osc.connect(gain);
    gain.connect(this.master);

    osc.start(t0);
    osc.stop(t0 + 0.09);
  }

  explosion() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();

    const noise = this._noise(0.2);
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t0);
    filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.18);

    this._env(gain, t0, 0.003, 0.05, 0.22, 0.22);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    noise.start(t0);
    noise.stop(t0 + 0.22);

    const osc = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
    this._env(g2, t0, 0.003, 0.03, 0.35, 0.16);
    osc.connect(g2);
    g2.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  powerup() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();

    const notes = [660, 880, 1320];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      const st = t0 + i * 0.045;
      osc.frequency.setValueAtTime(f, st);

      this._env(gain, st, 0.003, 0.02, 0.35, 0.08);

      osc.connect(gain);
      gain.connect(this.master);
      osc.start(st);
      osc.stop(st + 0.14);
    });
  }

  error() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.setValueAtTime(140, t0 + 0.05);
    this._env(gain, t0, 0.002, 0.02, 0.25, 0.10);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  bossSiren() {
    if (!this.ctx || this.muted) return;
    const t0 = this._now();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = "sawtooth";
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(700, t0);
    filter.Q.setValueAtTime(6, t0);

    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.linearRampToValueAtTime(980, t0 + 0.22);
    osc.frequency.linearRampToValueAtTime(520, t0 + 0.44);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    osc.start(t0);
    osc.stop(t0 + 0.55);
  }
}