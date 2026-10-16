// Type-R 198X — audio: transport, bus, music direction and the cue registry.
// Classic script (IIFE) exposing window.SFX. Loads before assets/js/core/00-util.js, so the
// environment flags are detected here. Contract: scratchpad/design/CONTRACT.md section 6.
(function (global) {
  "use strict";

  const AUDIO_VERSION = "2025-11-29"; // ?v= token for the legacy WAV paths when no manifest is present

  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const isFileOrigin = hasWindow && window.location && window.location.protocol === "file:";
  const isNativeShell = hasNavigator && /TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "");
  // Native shell / file:// : media elements play directly (no MediaElementSource: file:// taints it),
  // synth cues still run on the AudioContext, URLs stay bare (no ?v=).
  const FORCE_HTML_AUDIO = isFileOrigin || isNativeShell;

  const LEGACY_MUSIC = [
    "./assets/audio/Galactic_High_Score_1.wav",
    "./assets/audio/Galactic_High_Score_2.wav",
    "./assets/audio/Galactic_High_Score_3.wav",
    "./assets/audio/Galactic_High_Score_4.wav",
    "./assets/audio/Galactic_High_Score_5.wav",
    "./assets/audio/Galactic_High_Score_6.wav"
  ];
  const LEGACY_SFX = { laser: "./assets/audio/laser.wav", bigExplosion: "./assets/audio/bigexplosion.wav" };

  // Sector -> track index (into musicTracks). Tiers of two sectors share a song; tracks 0 and 5 are the
  // same song in two masters (measured: tools/measure-loops.sh, envelope r=0.57 at lag 0 vs <=0.40 for
  // every other pair), so they are confined to the sector 1-2 tier and no tier boundary repeats a song.
  // Track 3 (the fastest) is reserved for the last tier.
  const MUSIC_FOR_LEVEL = [0, 5, 2, 2, 1, 1, 4, 4, 3, 3];

  // [loopStart, loopEnd] seconds per track, measured on assets/opt/audio/*.mp3 with tools/measure-loops.sh:
  // loopStart = first sample above -50 dBFS; loopEnd = start of the last 100 ms RMS window still within
  // 3 dB of the body median, i.e. the last point before the trailing fade-out/silence. The WAV masters
  // have identical timelines (LAME gapless), so the table is valid for the legacy fallback too.
  const MUSIC_LOOP = [[1.3, 123.8], [1.02, 121.9], [0.01, 128.2], [0.37, 126.8], [0.47, 135.9], [0.18, 123.6]];

  const LOOP_FADE = 0.6;        // equal-power crossfade length at loopEnd - LOOP_FADE
  const PREFETCH_LEAD = 3.0;    // the idle element receives the same src at loopEnd - 3 s (amendment C-4)
  const MASTER_BASE = 0.8;
  const MUSIC_BASE = 0.8;
  const SFX_BASE = 1.0;
  const LASER_VOICES = 4;
  const STATE_LEVEL = { wave: 1.0, boss: 0.55, finale: 0.3, end: 0.0 };
  const STATE_FILTER = { wave: 20000, boss: 900, finale: 20000, end: 20000, pause: 600 };
  const PAUSE_ATTENUATION = 0.5; // -6 dB

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const readManifest = () => {
    const m = hasWindow && global.TYPER_ASSET_MANIFEST;
    return m && Array.isArray(m.music) && m.music.length && m.sfx ? m : null;
  };

  const versioned = (src) => {
    if (!src || FORCE_HTML_AUDIO || /^(data|blob):/.test(src)) return src;
    const manifest = readManifest();
    const v = (manifest && manifest.version) || AUDIO_VERSION;
    const sep = src.includes("?") ? "&" : "?";
    return `${src}${sep}v=${v}`;
  };

  // 50 ms of silence as a data URI: lets both media elements be activated inside the unlock gesture
  // (iOS/Safari activation is per element) without fetching any music yet.
  let silentWavUri = null;
  const silentWav = () => {
    if (silentWavUri) return silentWavUri;
    const n = 400, bytes = new Uint8Array(44 + n), dv = new DataView(bytes.buffer);
    const tag = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    tag(0, "RIFF"); dv.setUint32(4, 36 + n, true); tag(8, "WAVE"); tag(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    tag(36, "data"); dv.setUint32(40, n, true); bytes.fill(128, 44);
    let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    silentWavUri = "data:audio/wav;base64," + (typeof btoa === "function" ? btoa(bin) : "");
    return silentWavUri;
  };

  // Kick envelope for the boss pulse: a 2.2 Hz sawtooth LFO through this curve becomes a sharp
  // attack + exponential decay once per cycle.
  const PULSE_CURVE = (() => {
    const c = new Float32Array(256);
    for (let i = 0; i < 256; i++) c[i] = 0.9 * Math.exp(-6 * (i / 255));
    return c;
  })();

  const createHtmlAudio = (src) => {
    if (typeof Audio === "undefined") return null;
    const audio = new Audio(versioned(src));
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    return audio;
  };

  class SFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.musicFilter = null;
      this.muted = false;
      this.musicVol = 0.7;
      this.sfxVol = 0.8;
      this.forceHtmlAudio = FORCE_HTML_AUDIO;

      this.manifest = readManifest();
      this._applyManifest();
      this.MUSIC_FOR_LEVEL = MUSIC_FOR_LEVEL;
      this.MUSIC_LOOP = MUSIC_LOOP;

      this.musicEls = [];          // [{ el, source, gain, index, src, level, fade, pendingSeek }]
      this.active = null;          // the slot currently carrying the track
      this.currentTrack = -1;
      this.pendingTrack = null;
      this.wantMusic = false;
      this.musicState = "wave";
      this.musicStateBeforePause = "wave";
      this._musicLevel = 1;
      this._duck = 1;
      this._pulse = null;
      this._pulseIntensity = 0;

      this.laserBuffer = null;
      this.bigExplosionBuffer = null;
      this.laserVoices = [];
      this.htmlBigExplosion = null;
      this.needsGesture = false;
      this.lastCue = null;

      this._unlockPromise = null;
      this._bufferPromises = new Map();
      this._loopTimer = null;
      this._endTimer = null;
      this._lowHpTimer = null;
      this._surge = null;
      this._htmlFader = null;
      this._hidden = false;
      this._resumeOnVisible = false;
      this._noiseBuf = null;
      this._timeShift = 0;         // probe seam: offsets _now() so offline renders can stagger cues
    }

    _applyManifest() {
      const m = this.manifest;
      this.musicTracks = (m ? m.music : LEGACY_MUSIC).slice();
      this.sfxSources = m ? { laser: m.sfx.laser, bigExplosion: m.sfx.bigExplosion } : { ...LEGACY_SFX };
    }

    // ------------------------------------------------------------------ transport

    unlock() {
      if (!this._unlockPromise) {
        this._unlockPromise = this._doUnlock().catch((err) => {
          this._unlockPromise = null;
          throw err;
        });
      }
      return this._unlockPromise;
    }

    async _doUnlock() {
      if (!this.manifest) {
        this.manifest = readManifest();
        if (this.manifest) this._applyManifest();
      }
      // Everything that needs the user gesture happens synchronously, before the first await.
      const Ctx = hasWindow && (global.AudioContext || global.webkitAudioContext);
      if (Ctx && !this.ctx) {
        try { this._buildBus(new Ctx()); } catch (_) { this.ctx = null; }
      }
      if (!this.ctx) this.forceHtmlAudio = true;
      this._createMusicSlots();
      if (this.forceHtmlAudio && !this.htmlBigExplosion) {
        this.htmlBigExplosion = createHtmlAudio(this.sfxSources.bigExplosion);
      }
      const loads = [];
      if (this.ctx && !this.forceHtmlAudio) {
        loads.push(this._fetchBuffer(this.sfxSources.laser).then((b) => { this.laserBuffer = b; }));
        loads.push(this._fetchBuffer(this.sfxSources.bigExplosion).then((b) => { this.bigExplosionBuffer = b; }));
      }
      await Promise.all(loads);
      await this.resumeIfNeeded();
      if (this.pendingTrack != null) {
        const index = this.pendingTrack;
        this.pendingTrack = null;
        this.playMusic(index, { fade: 0.2 });
      }
    }

    // Builds the bus on `ctx` (an OfflineAudioContext works too, which is how the probes render cues).
    _buildBus(ctx) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 20;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      compressor.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_BASE;
      master.connect(compressor);

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_BASE * this.sfxVol * this.sfxVol;
      sfxGain.connect(master);

      const musicGain = ctx.createGain();
      musicGain.connect(master);

      const musicFilter = ctx.createBiquadFilter();
      musicFilter.type = "lowpass";
      musicFilter.frequency.value = STATE_FILTER[this.musicState] || 20000;
      musicFilter.Q.value = 0.7;
      musicFilter.connect(musicGain);

      Object.assign(this, { ctx, compressor, master, sfxGain, musicGain, musicFilter });
      musicGain.gain.value = this._musicTarget();
      this._noiseBuf = null;
      ctx.onstatechange = () => this._onStateChange();
      return this;
    }

    _createMusicSlots() {
      if (this.musicEls.length || typeof Audio === "undefined") return;
      for (let i = 0; i < 2; i++) {
        const el = new Audio();
        el.preload = "auto";
        el.setAttribute("playsinline", "");
        el.playsInline = true;
        el.loop = false;
        const slot = { el, source: null, gain: null, index: -1, src: null, level: 0, fade: null, pendingSeek: null, id: i };
        if (this.ctx && !this.forceHtmlAudio) {
          try {
            slot.source = this.ctx.createMediaElementSource(el);
            slot.gain = this.ctx.createGain();
            slot.gain.gain.value = 0;
            slot.source.connect(slot.gain);
            slot.gain.connect(this.musicFilter);
          } catch (_) {
            slot.source = null;
            slot.gain = null;
          }
        }
        if (!slot.gain) el.volume = 0;
        el.addEventListener("ended", () => this._onSlotEnded(slot));
        el.addEventListener("timeupdate", () => this._loopTick());
        el.addEventListener("loadedmetadata", () => {
          if (slot.pendingSeek != null) {
            const t = slot.pendingSeek;
            slot.pendingSeek = null;
            try { el.currentTime = t; } catch (_) {}
          }
        });
        el.addEventListener("error", () => {
          if (slot.index >= 0) console.warn("SFX: music element error", slot.src, el.error && el.error.code);
        });
        this.musicEls.push(slot);
        // Gesture priming with a silent clip; the real src arrives with playMusic/prefetchMusic.
        try {
          el.src = silentWav();
          const p = el.play();
          if (p && p.then) p.then(() => el.pause(), () => {});
        } catch (_) {}
      }
    }

    _fetchBuffer(src) {
      if (!src) return Promise.resolve(null);
      if (this._bufferPromises.has(src)) return this._bufferPromises.get(src);
      const promise = (async () => {
        if (!this.ctx) return null;
        try {
          const resp = await fetch(versioned(src));
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.arrayBuffer();
          const buf = await new Promise((resolve, reject) => {
            const r = this.ctx.decodeAudioData(data, resolve, reject);
            if (r && r.then) r.then(resolve, reject);
          });
          return (typeof AudioBuffer !== "undefined" && buf instanceof AudioBuffer) ? buf : null;
        } catch (err) {
          console.warn(`SFX: could not load ${src}; synth fallback in use`, err);
          return null;
        }
      })();
      this._bufferPromises.set(src, promise);
      return promise;
    }

    resumeIfNeeded() {
      const ctx = this.ctx;
      let p = Promise.resolve();
      if (ctx && ctx.state !== "running" && ctx.state !== "closed" && !this._hidden) {
        p = Promise.resolve()
          .then(() => ctx.resume())
          .then(() => { this.needsGesture = false; })
          .catch(() => { this.needsGesture = true; });
      }
      this._resumeMusicElement();
      return p;
    }

    _onStateChange() {
      const st = this.ctx && this.ctx.state;
      if (st === "running") this.needsGesture = false;
      else if (st === "interrupted" || (st === "suspended" && !this._hidden)) this.needsGesture = true;
    }

    onHidden() {
      this._hidden = true;
      if (this.active && this.wantMusic && !this.active.el.paused) {
        this._resumeOnVisible = true;
        try { this.active.el.pause(); } catch (_) {}
      }
      if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
    }

    onVisible() {
      this._hidden = false;
      if (this.ctx && this.ctx.state !== "closed") {
        this.ctx.resume().then(() => { this.needsGesture = false; }).catch(() => { this.needsGesture = true; });
      }
      if (this._resumeOnVisible) {
        this._resumeOnVisible = false;
        if (this.wantMusic && this.active) this.active.el.play().catch(() => {});
      }
    }

    // ------------------------------------------------------------------ mix

    setMuted(m) {
      this.muted = !!m;
      if (this.master) this._ramp(this.master.gain, this.muted ? 0 : MASTER_BASE, 0.02);
      if (this.forceHtmlAudio) {
        this._htmlApply(0.02);
        if (this.htmlBigExplosion) this.htmlBigExplosion.muted = this.muted;
      }
      if (this.muted) return;
      this.resumeIfNeeded();
      // Legacy shim (F053): the pre-overhaul game skips playMusic() while muted, so a run that started
      // muted has no track yet; start the sector's track on unmute. A no-op once a track was requested.
      const g = global.game;
      if (!this.wantMusic && this.pendingTrack == null && this.musicEls.length && g && g.mode === "playing") {
        this.playMusic(this.trackForLevel(g.levelIndex));
      }
    }

    setMusicVolume(v) {
      this.musicVol = clamp(Number(v) || 0, 0, 1);
      this._applyMusicGain(0.03);
    }

    setSfxVolume(v) {
      this.sfxVol = clamp(Number(v) || 0, 0, 1);
      if (this.sfxGain) this._ramp(this.sfxGain.gain, SFX_BASE * this.sfxVol * this.sfxVol, 0.03);
    }

    // setTargetAtTime for a click-free move, pinned to the exact target after 6 time constants
    // (Chrome only advances an input-less node's timeline while it is processed, so pin the end value).
    _ramp(param, target, tc) {
      const now = this._now();
      try {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.setTargetAtTime(target, now, tc);
        param.setValueAtTime(target, now + tc * 6);
      } catch (_) { param.value = target; }
    }

    _musicTarget(level) {
      const lvl = level != null ? level : this._musicLevel;
      const pause = this.musicState === "pause" ? PAUSE_ATTENUATION : 1;
      const duck = this.forceHtmlAudio ? this._duck : 1; // Web Audio ducks live on the gain timeline instead
      return MUSIC_BASE * this.musicVol * this.musicVol * lvl * pause * duck;
    }

    _applyMusicGain(sec = 0.05) {
      if (this.musicGain) {
        const g = this.musicGain.gain, now = this._now();
        try {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(this._musicTarget(), now + Math.max(0.005, sec));
        } catch (_) { g.value = this._musicTarget(); }
      }
      if (this.forceHtmlAudio) this._htmlApply(sec);
    }

    // points: [[secondsFromNow, level], ...] in increasing time.
    _musicRamp(points) {
      if (this.musicGain) {
        const g = this.musicGain.gain, now = this._now();
        try {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          for (const [at, level] of points) g.linearRampToValueAtTime(this._musicTarget(level), now + at);
        } catch (_) { g.value = this._musicTarget(); }
      }
      if (this.forceHtmlAudio) this._htmlApply(points[points.length - 1][0]);
    }

    _filterTo(hz, sec) {
      if (!this.musicFilter) return;
      const f = this.musicFilter.frequency, now = this._now();
      try {
        f.cancelScheduledValues(now);
        if (sec <= 0) { f.setValueAtTime(hz, now); return; }
        f.setValueAtTime(Math.max(20, f.value), now);
        f.exponentialRampToValueAtTime(hz, now + sec);
      } catch (_) { f.value = hz; }
    }

    // ------------------------------------------------------------------ music

    trackForLevel(levelIndex) {
      const n = this.musicTracks.length || 1;
      const i = clamp(Math.round(Number(levelIndex) || 0), 0, MUSIC_FOR_LEVEL.length - 1);
      return Math.min(MUSIC_FOR_LEVEL[i], n - 1);
    }

    _resolveTrack(arg) {
      const n = this.musicTracks.length;
      if (typeof arg === "string") {
        const i = this.musicTracks.indexOf(arg);
        return i >= 0 ? i : this.trackForLevel(0);
      }
      if (Number.isFinite(arg)) return clamp(Math.floor(arg), 0, n - 1);
      // Legacy no-argument call: follow the sector the game is on when it is discoverable (startLevel sets
      // game.levelIndex before calling playMusic()), otherwise keep what is playing, otherwise sector 1.
      const g = global.game;
      if (g && Number.isFinite(g.levelIndex)) return this.trackForLevel(g.levelIndex);
      if (this.currentTrack >= 0) return this.currentTrack;
      return this.trackForLevel(0);
    }

    _loopFor(index) {
      const row = MUSIC_LOOP[index];
      const slot = this.musicEls.find((s) => s.index === index);
      const duration = slot && Number.isFinite(slot.el.duration) ? slot.el.duration : Infinity;
      const start = row ? row[0] : 0;
      let end = row ? row[1] : duration - LOOP_FADE;
      if (Number.isFinite(duration) && end > duration - 0.05) end = Math.max(start + 1, duration - 0.05);
      return [start, end];
    }

    _idleSlot() {
      return this.musicEls.find((s) => s !== this.active) || this.musicEls[0] || null;
    }

    playMusic(track, opts) {
      const fade = opts && Number.isFinite(opts.fade) ? opts.fade : LOOP_FADE;
      if (!this.musicTracks.length) return;
      const index = this._resolveTrack(track);
      this.wantMusic = true;
      if (!this.musicEls.length) { this.pendingTrack = index; return; }
      this._clearEndTimer();
      if (this.musicState === "end") this.setMusicState("wave");
      const slot = this.active;
      if (slot && slot.index === index && this.currentTrack === index) {
        // No-restart rule: the same track keeps its element and position (restart, continue, unmute, retry).
        this._setSlotLevel(slot, 1, 0.08);
        this._applyMusicGain(0.1);
        if (slot.el.paused && !this._hidden) slot.el.play().catch(() => { this.needsGesture = true; });
        this._armLoopTimer();
        return;
      }
      this.currentTrack = index;
      this._startSlot(this._idleSlot(), index, fade, true);
    }

    _startSlot(slot, index, fade, fromLoopStart) {
      if (!slot) return;
      const prev = this.active;
      const src = this.musicTracks[index];
      const [loopStart] = this._loopFor(index);
      if (slot.src !== src) {
        slot.src = src;
        slot.el.preload = "auto";
        slot.el.src = versioned(src);
      }
      slot.index = index;
      if (fromLoopStart) this._seek(slot, loopStart);
      const p = slot.el.play();
      if (p && p.catch) p.catch(() => { this.needsGesture = true; });
      this.active = slot;
      this._setSlotLevel(slot, 1, fade, "in");
      if (prev && prev !== slot) {
        this._setSlotLevel(prev, 0, fade, "out");
        this._pauseLater(prev, fade + 0.08);
      }
      this._armLoopTimer();
    }

    _seek(slot, t) {
      slot.pendingSeek = slot.el.readyState >= 1 ? null : t;
      try { slot.el.currentTime = t; } catch (_) {}
    }

    _pauseLater(slot, sec) {
      setTimeout(() => {
        if (slot !== this.active && slot.level === 0) {
          try { slot.el.pause(); } catch (_) {}
        }
      }, sec * 1000);
    }

    // Equal-power approximation with two linear segments through sin(pi/4).
    _setSlotLevel(slot, to, sec, shape) {
      slot.level = to;
      if (slot.gain) {
        const g = slot.gain.gain, now = this._now(), dur = Math.max(0.005, sec || 0.005);
        try {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          if (shape && dur > 0.1) g.linearRampToValueAtTime(0.707, now + dur / 2);
          g.linearRampToValueAtTime(to, now + dur);
        } catch (_) { g.value = to; }
      } else {
        this._htmlApply(sec);
      }
    }

    _armLoopTimer() {
      if (this._loopTimer) return;
      this._loopTimer = setInterval(() => this._loopTick(), 100);
    }

    _disarmLoopTimer() {
      if (this._loopTimer) clearInterval(this._loopTimer);
      this._loopTimer = null;
    }

    _loopTick() {
      const slot = this.active;
      if (!slot || !this.wantMusic || slot.index < 0) return;
      const el = slot.el;
      if (el.paused || !Number.isFinite(el.currentTime)) return;
      const [, end] = this._loopFor(slot.index);
      const t = el.currentTime;
      if (t >= end - LOOP_FADE) { this._crossfadeLoop(slot); return; }
      if (t >= end - PREFETCH_LEAD) this._prefetchSlot(this._idleSlot(), slot.index);
    }

    _crossfadeLoop(slot) {
      const next = this._idleSlot();
      if (!next || next === slot) return;
      this._startSlot(next, slot.index, LOOP_FADE, true);
    }

    _onSlotEnded(slot) {
      if (slot === this.active && this.wantMusic && slot.index >= 0) this._crossfadeLoop(slot);
    }

    prefetchMusic(index) {
      if (!this.musicEls.length || !this.musicTracks.length) return;
      const i = clamp(Math.floor(Number(index) || 0), 0, this.musicTracks.length - 1);
      if (this.active && this.active.index === i) return;
      this._prefetchSlot(this._idleSlot(), i);
    }

    _prefetchSlot(slot, index) {
      const src = this.musicTracks[index];
      if (!slot || slot === this.active || slot.level > 0 || slot.src === src) return;
      slot.src = src;
      slot.index = -1;
      slot.el.preload = "auto";
      slot.el.src = versioned(src);
      try { slot.el.load(); } catch (_) {}
    }

    stopMusic() {
      this.wantMusic = false;
      this.pendingTrack = null;
      this.currentTrack = -1;
      this._clearEndTimer();
      this._disarmLoopTimer();
      this.bossPulse(false);
      for (const slot of this.musicEls) {
        this._setSlotLevel(slot, 0, 0.05);
        slot.index = -1;
      }
      const slots = this.musicEls;
      setTimeout(() => { for (const s of slots) { if (s.index < 0) { try { s.el.pause(); } catch (_) {} } } }, 80);
      this.active = null;
    }

    fadeOutMusic(sec = 0.8) {
      this.wantMusic = false;
      this._musicLevel = 0;
      this.musicState = "end";
      this.bossPulse(false);
      this._applyMusicGain(sec);
      this._clearEndTimer();
      this._endTimer = setTimeout(() => this._pauseAll(), sec * 1000 + 80);
    }

    // Temporary dip for stingers; the level restores to the current state afterwards.
    duckMusic(level = 0.3, sec = 1.0) {
      const lvl = clamp(Number(level) || 0, 0, 1);
      if (!this.musicEls.length) return; // nothing plays before unlock
      if (this.musicGain && !this.forceHtmlAudio) {
        const g = this.musicGain.gain, now = this._now(), full = this._musicTarget();
        try {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(full * lvl, now + 0.08);
          g.setValueAtTime(full * lvl, now + sec);
          g.linearRampToValueAtTime(full, now + sec + 0.35);
        } catch (_) {}
        return;
      }
      this._duck = lvl;
      this._applyMusicGain(0.08);
      clearTimeout(this._duckTimer);
      this._duckTimer = setTimeout(() => { this._duck = 1; this._applyMusicGain(0.35); }, sec * 1000);
    }

    // wave | boss | finale | end | pause ('resume' restores the state that was active before 'pause').
    setMusicState(state) {
      if (state === "resume") state = this.musicStateBeforePause || "wave";
      if (!(state in STATE_FILTER)) return;
      const prev = this.musicState;
      if (state === "pause" && prev !== "pause") this.musicStateBeforePause = prev;
      this.musicState = state;
      if (state !== "end") this._clearEndTimer();
      switch (state) {
        case "wave":
          this._musicLevel = STATE_LEVEL.wave;
          this._filterTo(STATE_FILTER.wave, 0.4);
          this.bossPulse(false);
          this._applyMusicGain(0.4);
          this._resumeMusicElement();
          break;
        case "boss":
          this._musicLevel = STATE_LEVEL.boss;
          this._filterTo(STATE_FILTER.boss, 0.4);
          this._applyMusicGain(0.4);
          this.bossPulse(true, this._pulseIntensity);
          this._resumeMusicElement();
          break;
        case "finale":
          this._musicLevel = STATE_LEVEL.finale;
          this._filterTo(STATE_FILTER.finale, 1.0);
          this.bossPulse(false);
          this._musicRamp([[0.25, 1.0], [4.0, STATE_LEVEL.finale]]);
          break;
        case "end":
          this.bossPulse(false);
          this.lowHp(false);
          this.fadeOutMusic(0.8);
          this._filterTo(STATE_FILTER.end, 0.8);
          break;
        case "pause":
          this._filterTo(STATE_FILTER.pause, 0.15);
          this._applyMusicGain(0.15);
          if (this._pulse) this._ramp(this._pulse.out.gain, 0, 0.1);
          break;
      }
    }

    // Boss layer: 55 Hz kick at 2.2 Hz + 110 Hz saw drone through a 400 Hz lowpass, into the music bus.
    // intensity 0..1 (the game passes 1 - boss.hpFrac()); gain .15 + .2 * intensity.
    bossPulse(on, intensity) {
      if (intensity != null) this._pulseIntensity = clamp(Number(intensity) || 0, 0, 1);
      if (!this.ctx || !this.musicGain) return;
      if (on && !this._pulse) this._pulse = this._buildPulse();
      if (!this._pulse) return;
      if (on) {
        const target = this.musicState === "pause" ? 0 : 0.15 + 0.2 * this._pulseIntensity;
        this._ramp(this._pulse.out.gain, target, 0.25);
        return;
      }
      const p = this._pulse;
      this._pulse = null;
      this._ramp(p.out.gain, 0, 0.12);
      const stopAt = this._now() + 0.6;
      try { p.kick.stop(stopAt); p.drone.stop(stopAt); p.lfo.stop(stopAt); } catch (_) {}
      p.drone.onended = () => { try { p.out.disconnect(); } catch (_) {} };
    }

    _buildPulse() {
      const ctx = this.ctx, now = this._now();
      const out = ctx.createGain(); out.gain.value = 0; out.connect(this.musicGain);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400; lp.Q.value = 1; lp.connect(out);
      const kick = ctx.createOscillator(); kick.type = "sine"; kick.frequency.value = 55;
      const kickGain = ctx.createGain(); kickGain.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = "sawtooth"; lfo.frequency.value = 2.2;
      const shaper = ctx.createWaveShaper(); shaper.curve = PULSE_CURVE;
      lfo.connect(shaper); shaper.connect(kickGain.gain);
      kick.connect(kickGain); kickGain.connect(lp);
      const drone = ctx.createOscillator(); drone.type = "sawtooth"; drone.frequency.value = 110;
      const droneGain = ctx.createGain(); droneGain.gain.value = 0.35;
      drone.connect(droneGain); droneGain.connect(lp);
      kick.start(now); lfo.start(now); drone.start(now);
      return { out, lp, kick, kickGain, lfo, shaper, drone, droneGain };
    }

    _resumeMusicElement() {
      const slot = this.active;
      if (this.wantMusic && slot && slot.index >= 0 && slot.el.paused && !this._hidden && this.musicState !== "end") {
        slot.el.play().catch(() => { this.needsGesture = true; });
      }
    }

    _pauseAll() {
      for (const slot of this.musicEls) { try { slot.el.pause(); } catch (_) {} }
    }

    _clearEndTimer() {
      if (this._endTimer) clearTimeout(this._endTimer);
      this._endTimer = null;
    }

    // Legacy field: the element carrying music, or null when nothing plays.
    get music() {
      const slot = this.active;
      return slot && this.wantMusic && !slot.el.paused ? slot.el : null;
    }

    // HTML-audio path (native/file://): gains become element.volume with a small interval fader.
    _htmlApply(sec = 0.05) {
      if (!this.forceHtmlAudio) return;
      const pause = this.musicState === "pause" ? PAUSE_ATTENUATION : 1;
      for (const slot of this.musicEls) {
        if (slot.gain) continue;
        const target = clamp(this.musicVol * this.musicVol * this._musicLevel * pause * this._duck * slot.level, 0, 1);
        slot.el.muted = this.muted;
        slot.fade = { from: slot.el.volume, to: target, t0: Date.now(), dur: Math.max(1, (sec || 0.005) * 1000) };
      }
      if (!this._htmlFader) this._htmlFader = setInterval(() => this._htmlFadeTick(), 40);
    }

    _htmlFadeTick() {
      let busy = false;
      for (const slot of this.musicEls) {
        const f = slot.fade;
        if (!f) continue;
        const k = Math.min(1, (Date.now() - f.t0) / f.dur);
        try { slot.el.volume = f.from + (f.to - f.from) * k; } catch (_) {}
        if (k < 1) busy = true; else slot.fade = null;
      }
      if (!busy) { clearInterval(this._htmlFader); this._htmlFader = null; }
    }

    _playHtmlClone(audio, volume) {
      if (!audio || typeof audio.cloneNode !== "function") return;
      const clone = audio.cloneNode();
      clone.volume = clamp(volume, 0, 1);
      clone.muted = this.muted;
      clone.play().catch(() => {});
    }

    // ------------------------------------------------------------------ synth helpers

    _now() {
      return (this.ctx ? this.ctx.currentTime : 0) + this._timeShift;
    }

    _env(gainNode, t0, a, d, s, r, peak = 1) {
      const g = gainNode.gain, p = Math.max(0.0002, peak);
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(p, t0 + a);
      g.exponentialRampToValueAtTime(Math.max(0.0001, p * s), t0 + a + d);
      g.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    }

    _noise() {
      const ctx = this.ctx;
      if (!this._noiseBuf || this._noiseBuf.sampleRate !== ctx.sampleRate) {
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this._noiseBuf = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      return src;
    }

    _envTimes(o) {
      const dur = o.dur || 0.1;
      const a = o.a != null ? o.a : 0.003;
      const d = o.d != null ? o.d : Math.max(0.01, dur * 0.35);
      const r = o.r != null ? o.r : Math.max(0.02, dur - a - d);
      const s = o.s != null ? o.s : 0.5;
      return { a, d, r, s, total: a + d + r };
    }

    _applyFilter(o, t0, total, head) {
      if (!o.filter) return head;
      const f = this.ctx.createBiquadFilter();
      f.type = o.filter.type || "lowpass";
      f.frequency.setValueAtTime(Math.max(10, o.filter.f0 || 1000), t0);
      if (o.filter.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.f1), t0 + (o.filter.sweep || total));
      if (o.filter.Q != null) f.Q.value = o.filter.Q;
      head.connect(f);
      return f;
    }

    // Oscillator voice: { type, f0, f1, linear, sweep, detune, dur, a, d, s, r, peak, filter:{type,f0,f1,Q,sweep}, t0, dest }
    _osc(o) {
      const ctx = this.ctx;
      if (!ctx || !this.sfxGain) return null;
      const t0 = o.t0 != null ? o.t0 : this._now();
      const { a, d, r, s, total } = this._envTimes(o);
      const osc = ctx.createOscillator();
      osc.type = o.type || "sine";
      const f0 = Math.max(1, o.f0 || 440);
      osc.frequency.setValueAtTime(f0, t0);
      if (o.f1 && o.f1 !== f0) {
        const tEnd = t0 + (o.sweep || total);
        if (o.linear) osc.frequency.linearRampToValueAtTime(Math.max(1, o.f1), tEnd);
        else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), tEnd);
      }
      if (o.detune) osc.detune.value = o.detune;
      const gain = ctx.createGain();
      this._env(gain, t0, a, d, s, r, o.peak != null ? o.peak : 0.3);
      const head = this._applyFilter(o, t0, total, osc);
      head.connect(gain);
      gain.connect(o.dest || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + total + 0.02);
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (_) {} };
      return { osc, gain };
    }

    // Noise burst: { dur, a, d, s, r, peak, filter:{type,f0,f1,Q,sweep}, t0, dest }
    _burst(o) {
      const ctx = this.ctx;
      if (!ctx || !this.sfxGain) return null;
      const t0 = o.t0 != null ? o.t0 : this._now();
      const { a, d, r, s, total } = this._envTimes(o);
      const src = this._noise();
      const gain = ctx.createGain();
      this._env(gain, t0, a, d, s, r, o.peak != null ? o.peak : 0.3);
      const head = this._applyFilter(o, t0, total, src);
      head.connect(gain);
      gain.connect(o.dest || this.sfxGain);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + total + 0.02);
      src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch (_) {} };
      return { src, gain };
    }

    // Arpeggio: notes = [hz | [hz, dur]]; o = { step, dur, type, peak, t0, dest, detune, filter }
    _arp(notes, o = {}) {
      const t0 = o.t0 != null ? o.t0 : this._now();
      const step = o.step != null ? o.step : 0.06;
      notes.forEach((n, i) => {
        const hz = Array.isArray(n) ? n[0] : n;
        const dur = Array.isArray(n) && n[1] != null ? n[1] : (o.dur || step * 1.6);
        this._osc({ type: o.type || "triangle", f0: hz, t0: t0 + i * step, dur, a: 0.004, d: dur * 0.3, s: 0.5, r: dur * 0.7, peak: o.peak != null ? o.peak : 0.3, dest: o.dest, detune: o.detune, filter: o.filter });
      });
      return t0 + notes.length * step;
    }

    // Feedback delay for the stinger tails; returns the input node, tears itself down after holdSec.
    _delayBus(delaySec, feedback, holdSec) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = delaySec;
      const fb = ctx.createGain(); fb.gain.value = feedback;
      const wet = ctx.createGain(); wet.gain.value = 0.55;
      input.connect(this.sfxGain);
      input.connect(delay);
      delay.connect(fb); fb.connect(delay);
      delay.connect(wet); wet.connect(this.sfxGain);
      setTimeout(() => { try { input.disconnect(); delay.disconnect(); fb.disconnect(); wet.disconnect(); } catch (_) {} }, holdSec * 1000);
      return input;
    }

    _pushLaserVoice(voice) {
      const voices = this.laserVoices;
      voices.push(voice);
      voice.src.onended = () => {
        const i = voices.indexOf(voice);
        if (i >= 0) voices.splice(i, 1);
        try { voice.src.disconnect(); voice.gain.disconnect(); } catch (_) {}
      };
      while (voices.length > LASER_VOICES) {
        const old = voices.shift();
        const now = this._now();
        try {
          old.gain.gain.cancelScheduledValues(now);
          old.gain.gain.setValueAtTime(old.gain.gain.value, now);
          old.gain.gain.linearRampToValueAtTime(0.0001, now + 0.015);
          old.src.stop(now + 0.02);
        } catch (_) {}
      }
    }

    _cutSurge() {
      const s = this._surge;
      this._surge = null;
      if (!s) return;
      const now = this._now();
      for (const v of s) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(v.gain.gain.value, now);
          v.gain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
          (v.osc || v.src).stop(now + 0.03);
        } catch (_) {}
      }
    }

    // ------------------------------------------------------------------ cue registry

    // Every correct key: the laser WAV trimmed to 0.16 s, pitched up across the word (progress 0..1).
    zap(progress = 0) {
      this.lastCue = "zap";
      if (!this.ctx || !this.sfxGain) return;
      const p = clamp(Number(progress) || 0, 0, 1);
      const rate = 0.92 + 0.45 * p;
      const t0 = this._now();
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.4, t0);
      gain.gain.setValueAtTime(0.4, t0 + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
      gain.connect(this.sfxGain);
      let src;
      if (typeof AudioBuffer !== "undefined" && this.laserBuffer instanceof AudioBuffer) {
        src = this.ctx.createBufferSource();
        src.buffer = this.laserBuffer;
        src.playbackRate.value = rate;
        src.connect(gain);
      } else {
        src = this.ctx.createOscillator();
        src.type = "sawtooth";
        src.frequency.setValueAtTime(1400 * rate, t0);
        src.frequency.exponentialRampToValueAtTime(520 * rate, t0 + 0.08);
        const hp = this.ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 900;
        src.connect(hp);
        hp.connect(gain);
      }
      src.start(t0);
      src.stop(t0 + 0.16);
      this._pushLaserVoice({ src, gain });
    }

    lock(kind = "enemy") {
      this.lastCue = "lock:" + kind;
      if (!this.ctx) return;
      const t0 = this._now();
      switch (kind) {
        case "powerup":
          this._osc({ type: "triangle", f0: 2600, t0, dur: 0.05, a: 0.003, d: 0.02, s: 0.4, r: 0.03, peak: 0.25 });
          break;
        case "boss":
          this._osc({ type: "square", f0: 660, t0, dur: 0.07, peak: 0.2, filter: { type: "lowpass", f0: 2200 } });
          this._osc({ type: "square", f0: 990, t0: t0 + 0.08, dur: 0.1, peak: 0.2, filter: { type: "lowpass", f0: 2600 } });
          break;
        case "go":
          this._osc({ type: "sine", f0: 1320, t0, dur: 0.1, peak: 0.3 });
          this._osc({ type: "sine", f0: 2640, t0, dur: 0.08, peak: 0.1 });
          break;
        default:
          this._osc({ type: "sine", f0: 1900, f1: 2500, t0, dur: 0.035, a: 0.002, d: 0.012, s: 0.6, r: 0.021, peak: 0.3 });
          this._burst({ t0, dur: 0.015, a: 0.001, d: 0.005, s: 0.5, r: 0.009, peak: 0.15, filter: { type: "highpass", f0: 5000 } });
      }
    }

    lockRelease() {
      this.lastCue = "lockRelease";
      if (!this.ctx) return;
      this._osc({ type: "sine", f0: 1400, f1: 900, dur: 0.06, peak: 0.2 });
    }

    lockLost() {
      this.lastCue = "lockLost";
      if (!this.ctx) return;
      this._osc({ type: "square", f0: 420, f1: 180, dur: 0.1, peak: 0.25, filter: { type: "lowpass", f0: 1400 } });
    }

    // Hard miss. Dry fire uses error(0.45): 50 ms and quieter.
    error(scale = 1) {
      this.lastCue = "error";
      if (!this.ctx) return;
      const s = clamp(Number(scale) || 1, 0.1, 1);
      const short = s < 0.6;
      const t0 = this._now();
      const dur = short ? 0.05 : 0.16;
      const v = this._osc({ type: "square", f0: 180, t0, dur, a: 0.002, d: 0.02, s: 0.25, r: dur - 0.022, peak: 0.4 * s, filter: { type: "lowpass", f0: 1500 } });
      if (v && !short) v.osc.frequency.setValueAtTime(140, t0 + 0.05);
    }

    // Kills: size 0..1 ((len-1)/11 for words, .15 minions, .7-1 boss bursts).
    explosion(size = 0.5) {
      this.lastCue = "explosion";
      if (!this.ctx) return;
      const s = clamp(Number(size) || 0, 0, 1);
      const det = 1 + (Math.random() * 0.16 - 0.08);
      const t0 = this._now();
      const dur = 0.12 + 0.2 * s;
      this._burst({ t0, dur, a: 0.003, d: dur * 0.25, s: 0.35, r: dur * 0.75, peak: 0.5 + 0.3 * s, filter: { type: "lowpass", f0: lerp(2200, 900, s) * det, f1: 120, Q: 0.8 } });
      this._burst({ t0, dur: 0.02, a: 0.001, d: 0.006, s: 0.4, r: 0.013, peak: 0.25, filter: { type: "highpass", f0: 2500 } });
      if (s > 0.5) {
        this._osc({ type: "sine", f0: 110 * det, f1: 55 * det, t0, dur: 0.12 + 0.1 * s, a: 0.003, d: 0.04, s: 0.4, r: 0.08 + 0.1 * s, peak: 0.35 * s });
      }
    }

    // Enemy reaches the hull.
    impact() {
      this.lastCue = "impact";
      if (!this.ctx) return;
      const t0 = this._now();
      this._burst({ t0, dur: 0.09, a: 0.002, d: 0.03, s: 0.4, r: 0.058, peak: 0.45, filter: { type: "bandpass", f0: 2400, Q: 3 } });
      this._osc({ type: "sine", f0: 100, f1: 38, t0, dur: 0.2, a: 0.003, d: 0.06, s: 0.5, r: 0.137, peak: 0.5 });
    }

    // Real HP loss.
    damage() {
      this.lastCue = "damage";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "square", f0: 300, f1: 80, t0, dur: 0.18, a: 0.003, d: 0.05, s: 0.3, r: 0.127, peak: 0.7, filter: { type: "lowpass", f0: 1800 } });
      this._burst({ t0, dur: 0.15, a: 0.003, d: 0.04, s: 0.4, r: 0.107, peak: 0.4, filter: { type: "lowpass", f0: 600 } });
    }

    shieldHit() {
      this.lastCue = "shieldHit";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "sine", f0: 1320, t0, dur: 0.07, peak: 0.3 });
      this._osc({ type: "sine", f0: 1980, t0, dur: 0.07, peak: 0.2 });
      this._burst({ t0, dur: 0.03, a: 0.001, d: 0.01, s: 0.4, r: 0.019, peak: 0.1, filter: { type: "highpass", f0: 3000 } });
    }

    shieldBreak() {
      this.lastCue = "shieldBreak";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "sine", f0: 1980, f1: 660, t0, dur: 0.25, peak: 0.35 });
      this._osc({ type: "sine", f0: 1320, f1: 440, t0, dur: 0.25, peak: 0.25 });
      this._burst({ t0, dur: 0.2, a: 0.002, d: 0.05, s: 0.4, r: 0.148, peak: 0.25, filter: { type: "bandpass", f0: 1500, Q: 1 } });
    }

    // 880 Hz beeps at 2 Hz while hp/maxHp <= .25.
    lowHp(on) {
      this.lastCue = "lowHp:" + (on ? "on" : "off");
      if (on) {
        if (this._lowHpTimer || !this.ctx) return;
        const beep = () => { if (this.ctx) this._osc({ type: "sine", f0: 880, dur: 0.06, a: 0.003, d: 0.02, s: 0.6, r: 0.037, peak: 0.2 }); };
        beep();
        this._lowHpTimer = setInterval(beep, 500);
        return;
      }
      if (this._lowHpTimer) clearInterval(this._lowHpTimer);
      this._lowHpTimer = null;
    }

    pickup(type) {
      const kind = String(type || "SHIELD").toUpperCase();
      this.lastCue = "pickup:" + kind;
      if (!this.ctx) return;
      const t0 = this._now();
      switch (kind) {
        case "MULTI":
          this._arp([660, 990, 1320, 1980, 2640], { t0, step: 0.035, dur: 0.08, type: "triangle", peak: 0.25 });
          break;
        case "RAPID":
          this._arp([1760, 2217, 1760, 2217, 1760, 2217, 1760, 2217], { t0, step: 0.03, dur: 0.045, type: "square", peak: 0.12, filter: { type: "lowpass", f0: 5000 } });
          break;
        case "SPREAD":
        case "PIERCE": {
          const f0 = kind === "SPREAD" ? 220 : 440;
          this._osc({ type: "sawtooth", f0, f1: f0 * 2, t0, dur: 0.18, detune: -8, peak: 0.18, filter: { type: "lowpass", f0: 1800, f1: 600 } });
          this._osc({ type: "sawtooth", f0, f1: f0 * 2, t0, dur: 0.18, detune: 8, peak: 0.18, filter: { type: "lowpass", f0: 1800, f1: 600 } });
          break;
        }
        case "REPAIR":
        case "HEAL":
          this._arp([659, 880], { t0, step: 0.08, dur: 0.16, type: "sine", peak: 0.3 });
          this._osc({ type: "sine", f0: 1760, t0: t0 + 0.16, dur: 0.3, a: 0.01, d: 0.1, s: 0.3, r: 0.19, peak: 0.15 });
          break;
        default: // SHIELD and the legacy powerup() shim
          this._arp([523, 784, 1046], { t0, step: 0.07, dur: 0.12, type: "sine", peak: 0.3 });
      }
    }

    powerDown() {
      this.lastCue = "powerDown";
      if (!this.ctx) return;
      this._arp([1320, 880, 660], { step: 0.09, dur: 0.1, type: "triangle", peak: 0.3 });
    }

    // Each RAPID chain hit.
    chainZap() {
      this.lastCue = "chainZap";
      if (!this.ctx) return;
      const t0 = this._now();
      this._burst({ t0, dur: 0.02, a: 0.001, d: 0.006, s: 0.5, r: 0.013, peak: 0.3, filter: { type: "bandpass", f0: 3000, Q: 4 } });
      this._osc({ type: "sine", f0: 3000, t0, dur: 0.015, a: 0.001, d: 0.005, s: 0.5, r: 0.009, peak: 0.15 });
    }

    comboTier(tier = 2) {
      const t = Math.max(1, Math.round(Number(tier) || 2));
      this.lastCue = "comboTier:" + t;
      if (!this.ctx) return;
      const notes = [523, 659, 784];
      if (t >= 3) notes.push(1046);
      if (t >= 4) notes.push(1319);
      this._arp(notes, { step: 0.06, dur: 0.09, type: "triangle", peak: 0.3 });
    }

    comboBreak(lost = 10) {
      this.lastCue = "comboBreak";
      if (!this.ctx) return;
      const t0 = this._now();
      const peak = 0.5 + 0.01 * Math.min(Math.max(Number(lost) || 0, 0), 30);
      this._osc({ type: "sawtooth", f0: 600, f1: 120, t0, dur: 0.26, a: 0.004, d: 0.08, s: 0.5, r: 0.176, peak, filter: { type: "lowpass", f0: 2500, f1: 300 } });
      this._burst({ t0, dur: 0.2, a: 0.003, d: 0.06, s: 0.4, r: 0.137, peak: 0.3, filter: { type: "lowpass", f0: 800 } });
    }

    // Level intro t=0.
    sectorStart() {
      this.lastCue = "sectorStart";
      if (!this.ctx) return;
      const t0 = this._now();
      for (const f0 of [220, 330, 440]) {
        this._osc({ type: "sawtooth", f0, t0, dur: 0.5, a: 0.01, d: 0.15, s: 0.5, r: 0.34, peak: 0.16, filter: { type: "lowpass", f0: 1200, f1: 400, sweep: 0.5 } });
      }
      this._burst({ t0, dur: 0.8, a: 0.6, d: 0.1, s: 0.5, r: 0.1, peak: 0.15, filter: { type: "bandpass", f0: 300, f1: 3000, Q: 1, sweep: 0.8 } });
    }

    waveStart(n = 1) {
      this.lastCue = "waveStart:" + n;
      if (!this.ctx) return;
      const k = Math.pow(2, (Number(n) || 0) / 12);
      this._arp([880 * k, 1175 * k], { step: 0.08, dur: 0.1, type: "sine", peak: 0.25 });
    }

    waveClear(n = 1) {
      this.lastCue = "waveClear:" + n;
      if (!this.ctx) return;
      const k = Math.pow(2, (Number(n) || 0) / 12);
      this._arp([784 * k, 988 * k, 1319 * k], { step: 0.07, dur: 0.13, type: "triangle", peak: 0.3 });
    }

    // Approach phase: klaxon twice.
    bossWarning() {
      this.lastCue = "bossWarning";
      if (!this.ctx) return;
      const t0 = this._now();
      for (const at of [0, 0.42]) {
        this._osc({ type: "sawtooth", f0: 440, f1: 330, t0: t0 + at, dur: 0.3, a: 0.01, d: 0.1, s: 0.6, r: 0.19, peak: 0.35, filter: { type: "lowpass", f0: 1500 } });
      }
      this.duckMusic(0.5, 1.0);
    }

    // Boss intro: 520->980->520 sweep per loop (0.8 s each), lowpass 2.5 kHz.
    bossSiren(loops = 3) {
      this.lastCue = "bossSiren";
      if (!this.ctx) return;
      const n = clamp(Math.round(Number(loops) || 3), 1, 6);
      const t0 = this._now(), per = 0.8, total = n * per;
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(520, t0);
      for (let i = 0; i < n; i++) {
        osc.frequency.linearRampToValueAtTime(980, t0 + i * per + per / 2);
        osc.frequency.linearRampToValueAtTime(520, t0 + (i + 1) * per);
      }
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2500;
      filter.Q.value = 1;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      gain.gain.setValueAtTime(0.5, t0 + total - 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + total);
      osc.connect(filter); filter.connect(gain); gain.connect(this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + total + 0.02);
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (_) {} };
      this.duckMusic(0.5, total);
    }

    segmentDown() {
      this.lastCue = "segmentDown";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "square", f0: 440, f1: 220, t0, dur: 0.12, a: 0.003, d: 0.04, s: 0.4, r: 0.077, peak: 0.35, filter: { type: "lowpass", f0: 2500 } });
      this._osc({ type: "sine", f0: 90, t0, dur: 0.15, a: 0.003, d: 0.05, s: 0.5, r: 0.097, peak: 0.3 });
      this._burst({ t0, dur: 0.08, a: 0.002, d: 0.02, s: 0.4, r: 0.058, peak: 0.2, filter: { type: "bandpass", f0: 1200, Q: 1 } });
    }

    bossPhaseClear() {
      this.segmentDown();
      this._arp([523, 659, 784], { t0: this._now() + 0.12, step: 0.07, dur: 0.14, type: "triangle", peak: 0.3 });
      this.lastCue = "bossPhaseClear";
    }

    // Signal Surge: riser over dur, cut by surgeFire/surgeCancel.
    surgeCharge(dur = 1.2) {
      this.lastCue = "surgeCharge";
      if (!this.ctx) return;
      this._cutSurge();
      const d = clamp(Number(dur) || 1.2, 0.2, 6);
      const t0 = this._now();
      const a = this._osc({ type: "sawtooth", f0: 200, f1: 1600, t0, dur: d, a: d * 0.85, d: d * 0.1, s: 0.8, r: 0.05, peak: 0.3, filter: { type: "lowpass", f0: 400, f1: 4000, sweep: d } });
      const b = this._burst({ t0, dur: d, a: d * 0.85, d: d * 0.1, s: 0.8, r: 0.05, peak: 0.2, filter: { type: "bandpass", f0: 400, f1: 4000, Q: 2, sweep: d } });
      this._surge = [a, b].filter(Boolean);
    }

    surgeFire() {
      this._cutSurge();
      if (this.ctx) this._burst({ dur: 0.06, a: 0.001, d: 0.02, s: 0.4, r: 0.039, peak: 0.45, filter: { type: "bandpass", f0: 3000, Q: 2 } });
      this.damage();
      this.lastCue = "surgeFire";
    }

    surgeCancel() {
      this._cutSurge();
      this.lastCue = "surgeCancel";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "sine", f0: 1200, f1: 3600, t0, dur: 0.15, peak: 0.3 });
      this._burst({ t0, dur: 0.15, a: 0.002, d: 0.04, s: 0.5, r: 0.108, peak: 0.3, filter: { type: "highpass", f0: 4000 } });
    }

    // Boss death t=0 (riser) and t=.4 (crack over bigexplosion).
    bossCharge() {
      this.lastCue = "bossCharge";
      if (!this.ctx) return;
      const t0 = this._now();
      this._osc({ type: "sine", f0: 200, f1: 1600, t0, dur: 0.4, a: 0.3, d: 0.05, s: 0.8, r: 0.05, peak: 0.35 });
      this._burst({ t0, dur: 0.4, a: 0.3, d: 0.05, s: 0.8, r: 0.05, peak: 0.2, filter: { type: "bandpass", f0: 500, f1: 5000, Q: 1, sweep: 0.4 } });
    }

    bossKill() {
      if (this.forceHtmlAudio && this.htmlBigExplosion) {
        this._playHtmlClone(this.htmlBigExplosion, 0.55 * this.sfxVol * this.sfxVol);
      }
      if (this.ctx) {
        const t0 = this._now();
        this._burst({ t0, dur: 0.06, a: 0.001, d: 0.02, s: 0.4, r: 0.039, peak: 0.5, filter: { type: "bandpass", f0: 3000, Q: 1.5 } });
        if (typeof AudioBuffer !== "undefined" && this.bigExplosionBuffer instanceof AudioBuffer) {
          const src = this.ctx.createBufferSource();
          src.buffer = this.bigExplosionBuffer;
          const gain = this.ctx.createGain();
          gain.gain.value = 0.55;
          src.connect(gain);
          gain.connect(this.sfxGain);
          src.start(t0);
          src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch (_) {} };
        } else if (!this.forceHtmlAudio || !this.htmlBigExplosion) {
          this.explosion(1);
        }
      }
      this.duckMusic(0.25, 0.8);
      this.lastCue = "bossKill";
    }

    // levelClear | bossDown | victory | gameOver (note tables from JUICE-14).
    fanfare(kind = "levelClear") {
      this.lastCue = "fanfare:" + kind;
      if (!this.ctx) return;
      const t0 = this._now();
      const clear = [523, 659, 784, [1046, 0.6]];
      const voices = (notes, o) => {
        this._arp(notes, { ...o, detune: -6 });
        this._arp(notes, { ...o, detune: 6 });
      };
      switch (kind) {
        case "bossDown": {
          const dest = this._delayBus(0.25, 0.35, 3.5);
          voices([261, 329, 392, [523, 0.6]], { t0, step: 0.12, dur: 0.25, type: "triangle", peak: 0.22, dest });
          this.duckMusic(0.3, 1.6);
          break;
        }
        case "victory": {
          const dest = this._delayBus(0.25, 0.35, 5);
          voices(clear, { t0, step: 0.12, dur: 0.25, type: "triangle", peak: 0.22, dest });
          voices(clear, { t0: t0 + 0.6, step: 0.12, dur: 0.25, type: "triangle", peak: 0.22, dest });
          voices([1046, 1319, 1568, [2093, 1.0]], { t0: t0 + 1.2, step: 0.12, dur: 0.25, type: "triangle", peak: 0.2, dest });
          this.duckMusic(0.3, 2.8);
          break;
        }
        case "gameOver":
          this._arp([440, 415, 370, [330, 0.6]], { t0, step: 0.22, dur: 0.3, type: "square", peak: 0.25, filter: { type: "lowpass", f0: 1800 } });
          this._osc({ type: "sine", f0: 110, f1: 30, t0, dur: 1.5, a: 0.05, d: 0.5, s: 0.6, r: 0.95, peak: 0.35 });
          this.duckMusic(0.3, 1.8);
          break;
        default:
          voices(clear, { t0, step: 0.12, dur: 0.25, type: "triangle", peak: 0.25 });
          this.duckMusic(0.3, 1.2);
      }
    }

    // confirm | back | pause | resume | count | stamp | slam | tick
    uiTick(kind = "tick") {
      this.lastCue = "uiTick:" + kind;
      if (!this.ctx) return;
      const t0 = this._now();
      switch (kind) {
        case "confirm": this._osc({ type: "sine", f0: 1200, t0, dur: 0.03, peak: 0.2 }); break;
        case "back": this._osc({ type: "sine", f0: 900, t0, dur: 0.03, peak: 0.2 }); break;
        case "pause": this._osc({ type: "sine", f0: 1200, f1: 800, t0, dur: 0.06, peak: 0.2 }); break;
        case "resume": this._osc({ type: "sine", f0: 800, f1: 1200, t0, dur: 0.06, peak: 0.2 }); break;
        case "count": this._osc({ type: "sine", f0: 1500, t0, dur: 0.015, a: 0.001, d: 0.005, s: 0.5, r: 0.009, peak: 0.15 }); break;
        case "stamp":
          this._osc({ type: "sine", f0: 180, f1: 60, t0, dur: 0.08, peak: 0.4 });
          this._burst({ t0, dur: 0.02, a: 0.001, d: 0.006, s: 0.4, r: 0.013, peak: 0.2, filter: { type: "lowpass", f0: 1200 } });
          break;
        case "slam":
          this._osc({ type: "sine", f0: 1000, t0, dur: 0.04, peak: 0.25 });
          this._burst({ t0, dur: 0.03, a: 0.001, d: 0.01, s: 0.4, r: 0.019, peak: 0.2, filter: { type: "bandpass", f0: 2000, Q: 1 } });
          break;
        default: this._osc({ type: "sine", f0: 1200, t0, dur: 0.03, peak: 0.15 });
      }
    }

    // Ending typewriter: 18 ms sine (empress 1800, typegrid 2600, else 2200).
    typeTick(variant) {
      this.lastCue = "typeTick:" + (variant || "default");
      if (!this.ctx) return;
      const f0 = variant === "empress" ? 1800 : variant === "typegrid" ? 2600 : 2200;
      this._osc({ type: "sine", f0, dur: 0.018, a: 0.001, d: 0.006, s: 0.5, r: 0.011, peak: 0.12 });
    }

    // ------------------------------------------------------------------ aliases (contract table)

    hit() { this.zap(1); }
    laser() { this.zap(0); }
    lockOn() { this.lock("enemy"); }
    dryFire() { this.error(0.45); }
    segmentClear() { this.segmentDown(); }
    bossSegmentClear() { this.segmentDown(); }
    shieldAbsorb() { this.shieldHit(); }
    powerExpire() { this.powerDown(); }
    heal() { this.pickup("REPAIR"); }
    bossDefeat() { this.fanfare("bossDown"); }
    bossExplosion() { this.bossKill(); }
    tallyTick() { this.uiTick("count"); }
    rankStamp() { this.uiTick("stamp"); }
    bannerSlam() { this.uiTick("slam"); }
    multTierUp(tier) { this.comboTier(tier); }
    uiConfirm() { this.uiTick("confirm"); }
    uiBack() { this.uiTick("back"); }
    pause() { this.uiTick("pause"); }
    resume() { this.uiTick("resume"); }
    bossSurge() { this.surgeFire(); }
    powerup() { this.pickup("SHIELD"); }
  }

  SFX.MUSIC_FOR_LEVEL = MUSIC_FOR_LEVEL;
  SFX.MUSIC_LOOP = MUSIC_LOOP;
  SFX.FORCE_HTML_AUDIO = FORCE_HTML_AUDIO;
  SFX.CUES = [
    "zap", "lock", "lockRelease", "lockLost", "error", "explosion", "impact", "damage", "shieldHit", "shieldBreak",
    "lowHp", "pickup", "powerDown", "chainZap", "comboTier", "comboBreak", "sectorStart", "waveStart", "waveClear",
    "bossWarning", "bossSiren", "segmentDown", "bossPhaseClear", "surgeCharge", "surgeFire", "surgeCancel",
    "bossCharge", "bossKill", "fanfare", "uiTick", "typeTick"
  ];
  SFX.ALIASES = [
    "hit", "laser", "lockOn", "dryFire", "segmentClear", "bossSegmentClear", "shieldAbsorb", "powerExpire", "heal",
    "bossDefeat", "bossExplosion", "tallyTick", "rankStamp", "bannerSlam", "multTierUp", "uiConfirm", "uiBack",
    "pause", "resume", "bossSurge", "powerup"
  ];

  global.SFX = SFX;
})(typeof window !== "undefined" ? window : globalThis);
