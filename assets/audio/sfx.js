// Type-R 198X — audio: transport, bus, music direction, the sample pool, the announcer and the cue registry.
// Classic script (IIFE) exposing window.SFX. Loads before assets/js/core/00-util.js, so the
// environment flags are detected here. Contract: scratchpad/design/CONTRACT.md section 6.
// SOUND pass (2026-11): cues play round-robin samples from two MP3 banks (manifest.sfxBank / voBank, built by
// tools/audio/*) through a voice pool with per-cue caps and stealing; every cue keeps its synth as the fallback
// (bank missing or still decoding, legacy manifest, native / file:// shells) or as a parametric layer. A fast music
// sidechain (musicDuck) dips under explosions, boss hits and the announcer; the master compressor is gentler (3:1).
// Adaptive music: on desktop Web Audio the sector's track plays as two decoded layers (manifest.musicLayers: the
// drumless stem + the mono drums stem from tools/audio/split_stems.sh) through AudioBufferSourceNodes with
// sample-accurate loops at MUSIC_LOOP; setIntensity(0..1) is the drums' level. The streamed HTMLMediaElement
// transport below is unchanged and remains the path for touch / native / file:// / low-memory devices, for a track
// whose layers are not decoded yet (the first sector starts on it and hands over at the next loop boundary) and for
// any decode failure.
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

  // [loopStart, loopEnd] seconds per track, measured on assets/opt/audio/*.mp3 with tools/measure-loops.sh
  // (the WAV masters have identical timelines, LAME gapless, so the table serves the legacy fallback too).
  // loopStart = the first onset of the sustained body: the first 100 ms window within 6 dB of the body median
  // whose next 2 s and 8 s medians are too, snapped to the strongest onset within +-150 ms (first audio when the
  // lead-in is under 0.5 s: track 5). Tracks 1, 2 and 6 have intros and build-ups 8-10 dB under the body for
  // 17.3 / 15.2 / 16.9 s; tracks 3 and 4 have 2-3 s intros 6-7 dB under. Looping into a lead-in was a 10-40 dB
  // energy hole every two minutes, so the loop (and every sector start) lands on the body instead.
  // loopEnd = X + LOOP_FADE where X, the moment the incoming element starts at loopStart, is beat-aligned: the
  // first beat after loopStart coincides with an onset peak near the end of the body, a whole number of bars
  // from it where the pulse is steady (tracks 2-5 at 126/115/70/167 BPM), the strongest onset in the last two
  // bars for 1 and 6 (same song, weak pulse). "MUSIC_LOOP adopted" in the script output is this table; its
  // "raw" line is the first-audio / last-body table the transport would loop on without the analysis.
  const MUSIC_LOOP = [[17.21, 119.67], [15.23, 120.36], [3.25, 126.72], [2.08, 122.25], [0.47, 133.32], [16.94, 119.81]];

  const LOOP_FADE = 0.6;        // equal-power crossfade length at loopEnd - LOOP_FADE
  const PREFETCH_LEAD = 3.0;    // the idle element receives the same src at loopEnd - 3 s (amendment C-4)
  const LOOP_ARM_S = 0.25;      // inside this window a one-shot timer fires the crossfade at the exact moment
  const PRIME_TIMEOUT_MS = 1500; // media primes / ctx.resume() never hold Start longer than this
  const MASTER_BASE = 0.8;
  const MUSIC_BASE = 0.8;
  const SFX_BASE = 1.0;
  const LASER_VOICES = 4;
  const STATE_LEVEL = { wave: 1.0, boss: 0.55, finale: 0.3, end: 0.0 };
  const STATE_FILTER = { wave: 20000, boss: 900, finale: 20000, end: 20000, pause: 600 };
  const PAUSE_ATTENUATION = 0.5; // -6 dB

  // Sample pool (SOUND pass). Banks are MP3 sprite sheets (tools/audio/pack-bank.mjs) listed in the manifest as
  // sfxBank / voBank { src, rate, marker, cues: { name: { trim, voices, jitter, priority?, v: [[offset, dur], ...] } } }.
  const POOL_MAX_VOICES = 32;         // global cap; the oldest voice fades out in 10 ms when exceeded
  const POOL_DEFAULT_CAP = 3;         // per-cue cap when the bank table has none
  const BANK_MARKER_THRESHOLD = 0.25; // the packer's 1 kHz marker is -6 dBFS; its first sample above this is the onset
  const DUCK_DB = { explosionM: -3.0, explosionL: -4.0, bossHit: -3.0, bossKill: -4.0, damage: -3.0, vo: -4.0 };
  const DUCK_HOLD_S = 0.35;
  const CLIMB_BASE_RATE = 0.75;       // typing tick: playbackRate at progress 0 (2200 Hz sample -> 1650 Hz), x2 at the last glyph
  const LIMIT_KNEE = 0.6;             // master soft clip after the compressor: identity below this ...
  const LIMIT_CEIL = 0.94;            // ... then tanh toward this (output never exceeds ~.88 for any input)
  // WaveShaper curve for the soft clip: linear through the knee so ordinary levels are bit-exact (music peaks ~.3-.4),
  // a tanh shoulder above it. Five sampled onsets on the same instant run ahead of the compressor's 5 ms attack; this
  // is what keeps that sum under full scale instead of trimming every cue for the worst case.
  const LIMIT_CURVE = (() => {
    const n = 4097, c = new Float32Array(n), k = LIMIT_KNEE, m = LIMIT_CEIL;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      c[i] = a <= k ? x : Math.sign(x) * (k + (m - k) * Math.tanh((a - k) / (m - k)));
    }
    return c;
  })();
  // Adaptive music layers: desktop Web Audio only; touch-first devices and < 4 GB keep the streamed transport.
  const LAYERS_ENV_OK = !FORCE_HTML_AUDIO && hasWindow && (() => {
    try {
      if (hasNavigator && navigator.deviceMemory != null && navigator.deviceMemory < 4) return false;
      if (typeof matchMedia === "function" && matchMedia("(pointer: coarse) and (hover: none)").matches) return false;
      return typeof AudioBuffer !== "undefined";
    } catch (_) { return false; }
  })();
  const LAYER_INTENSITY_TC = 0.25;   // setIntensity time constant (s): the drums come and go over ~1 s, never per key
  const LAYER_SPLICE_S = 0.012;      // loop splice: the body's last 12 ms blend into the material that leads into loopStart
  const LAYER_RELEASE_DELAY_MS = 900; // after a level clear: the old pair's fade-out ends before the next pair decodes
  const VO_LINES = ["warning", "boss_incoming", "sector_clear", "signal_lost", "perfect", "overdrive", "new_record", "rank_s", "rank_a", "rank_b", "rank_c", "rank_d", "ready", "go"];
  const perfNow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

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

  // Resolves with "ok" | "error" | "timeout"; never rejects, never holds the caller longer than ms.
  const withTimeout = (promise, ms) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    Promise.resolve(promise).then(() => { clearTimeout(timer); resolve("ok"); }, () => { clearTimeout(timer); resolve("error"); });
  });

  // play() then pause() inside the gesture activates a media element on engines that unlock per element.
  const primeElement = (el) => {
    try {
      const p = el.play();
      if (p && p.then) return p.then(() => { try { el.pause(); } catch (_) {} }, () => {});
      try { el.pause(); } catch (_) {}
    } catch (_) {}
    return Promise.resolve();
  };

  class SFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.limiter = null;
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
      this._fadeTimer = null;
      this._endTimer = null;
      this._lowHpTimer = null;
      this._surge = null;
      this._htmlFader = null;
      this._hidden = false;
      this._resumeOnVisible = false;
      this._noiseBuf = null;
      this._timeShift = 0;         // probe seam: offsets _now() so offline renders can stagger cues

      // SOUND pass: sample pool, sidechain and announcer state
      this.banks = { sfx: null, vo: null };   // decoded banks: { kind, buffer, cues, shift, rr, voices, stats }
      this._bankPromises = {};
      this.loadStats = {};                     // src -> { bytes, fetchMs, decodeMs }
      this.voGain = null;
      this.musicDuck = null;
      this.announcerOn = true;
      this.lastVoice = null;                   // { cue, variant, rate, gain, bank } of the last sampled voice (probes)
      this.lastTick = null;                    // { kind: "climb" | "resolve" | "miss", p, rate, hz } of the last typing tick
      this.lastVo = null;                      // last announcer line that was scheduled
      this._vo = null;                         // { line, priority, until, voice } while a line plays
      this._voQueue = null;
      this._voTimer = null;
      this._pool = [];                         // live sampled voices, oldest first (global cap)
      this._duckUntil = 0;
      this._duckLevel = 1;
      this.lastRank = null;                    // 88-audio-director.js stores results.rank / newHigh for rankStamp()
      this.lastNewHigh = false;
      this.pendingPerfect = false;             // set by the director on a perfect wave; waveClear() announces it

      // Adaptive music layers (SOUND pass)
      this.layersEnabled = LAYERS_ENV_OK;
      this.intensity = 1;                      // 0 calm (drums out) .. 1 full mix; setIntensity()
      this.layers = null;                      // prepared pair { track, base, top, start, len }
      this._layerBytes = {};                   // track -> { base, top } ArrayBuffers fetched ahead (prefetchMusic)
      this._layerFetching = {};
      this._layerPromises = {};
      this._layerPlay = null;                  // { pair, track, srcBase, srcTop, gBase, gTop, out, startedAt, offset, facade }
      this._layerParked = null;                // { track, pos } after end / hidden stop, so playMusic(same) resumes there
      this._prefetchedTrack = -1;
      this._layerPlanTimer = null;
      this.layerStats = { decodeMs: 0, residentMB: 0, peakMB: 0, takeovers: 0, starts: 0 };
    }

    _applyManifest() {
      const m = this.manifest;
      this.musicTracks = (m ? m.music : LEGACY_MUSIC).slice();
      this.sfxSources = m ? { laser: m.sfx.laser, bigExplosion: m.sfx.bigExplosion } : { ...LEGACY_SFX };
      // SOUND pass: the banks are optional manifest members (an older manifest simply has none -> synth cues)
      this.bankSources = { sfx: (m && m.sfxBank && m.sfxBank.src && m.sfxBank.cues) ? m.sfxBank : null, vo: (m && m.voBank && m.voBank.src && m.voBank.cues) ? m.voBank : null };
      this.musicLayers = (m && Array.isArray(m.musicLayers)) ? m.musicLayers.slice() : [];
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
      const primes = this._createMusicSlots();
      if (this.forceHtmlAudio && !this.htmlBigExplosion) {
        this.htmlBigExplosion = createHtmlAudio(this.sfxSources.bigExplosion);
      }
      const loads = [];
      let bankLoad = Promise.resolve(null);
      if (this.ctx && !this.forceHtmlAudio) {
        loads.push(this._fetchBuffer(this.sfxSources.laser).then((b) => { this.laserBuffer = b; }));
        loads.push(this._fetchBuffer(this.sfxSources.bigExplosion).then((b) => { this.bigExplosionBuffer = b; }));
        // SOUND pass: the sample banks ride the same gesture but never hold Start past PRIME_TIMEOUT_MS; cues fall
        // back to their synths until a bank is decoded (the vo bank only when the announcer is on).
        const banks = [this._loadBank("sfx")];
        if (this.announcerOn) banks.push(this._loadBank("vo"));
        bankLoad = Promise.all(banks);
      }
      // Only the two one-shot buffers gate Start. The media primes, the banks and ctx.resume() are raced against
      // PRIME_TIMEOUT_MS: a play() promise that never settles (seen in headless Chrome over HTTP under the
      // native UA) or a resume() stuck in 'interrupted' must not keep the player on the menu.
      await withTimeout(Promise.all([...primes, bankLoad]), PRIME_TIMEOUT_MS);
      await Promise.all(loads);
      const resumed = await withTimeout(this.resumeIfNeeded(), PRIME_TIMEOUT_MS);
      if (resumed !== "ok" && this.ctx && this.ctx.state !== "running") this.needsGesture = true;
      if (this.pendingTrack != null) {
        const index = this.pendingTrack;
        this.pendingTrack = null;
        this.playMusic(index, { fade: 0.2 });
      }
    }

    // Builds the bus on `ctx` (an OfflineAudioContext works too, which is how the probes render cues).
    _buildBus(ctx) {
      // Gentle glue on the master (SOUND pass: 3:1, 5 / 150 ms; was 5:1, 3 / 120 ms): the sampled transients keep
      // their attack and the sidechain below does the ducking the ratio used to do by brute force.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.15;
      const limiter = ctx.createWaveShaper();   // soft clip (LIMIT_CURVE): the ceiling the gentle ratio no longer provides
      limiter.curve = LIMIT_CURVE;
      try { limiter.oversample = "2x"; } catch (_) {}
      compressor.connect(limiter);
      limiter.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_BASE;
      master.connect(compressor);

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_BASE * this.sfxVol * this.sfxVol;
      sfxGain.connect(master);

      const voGain = ctx.createGain();      // announcer lines: under the SFX bus so SFX volume and mute apply
      voGain.gain.value = 1;
      voGain.connect(sfxGain);

      const musicDuck = ctx.createGain();   // fast sidechain: explosions, boss hits and the announcer dip the music here
      musicDuck.gain.value = 1;
      musicDuck.connect(master);

      const musicGain = ctx.createGain();
      musicGain.connect(musicDuck);

      const musicFilter = ctx.createBiquadFilter();
      musicFilter.type = "lowpass";
      musicFilter.frequency.value = STATE_FILTER[this.musicState] || 20000;
      musicFilter.Q.value = 0.7;
      musicFilter.connect(musicGain);

      Object.assign(this, { ctx, compressor, limiter, master, sfxGain, musicGain, musicFilter, musicDuck, voGain });
      musicGain.gain.value = this._musicTarget();
      this._noiseBuf = null;
      this._duckUntil = 0;
      this._duckLevel = 1;
      ctx.onstatechange = () => this._onStateChange();
      return this;
    }

    // Two media slots. Idle slots stay at preload "none"/"metadata" so no track streams before playMusic
    // targets it; the loop lead (loopEnd - 3 s) is the only time a slot preloads "auto" without playing.
    // Returns the gesture-prime promises (empty when the slots already exist).
    _createMusicSlots() {
      const primes = [];
      if (this.musicEls.length || typeof Audio === "undefined") return primes;
      for (let i = 0; i < 2; i++) {
        const el = new Audio();
        el.preload = "none";
        el.setAttribute("playsinline", "");
        el.playsInline = true;
        el.loop = false;
        const slot = { el, source: null, gain: null, index: -1, src: null, level: 0, fade: null, pendingSeek: null, parkedAt: null, id: i };
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
          primes.push(primeElement(el));
        } catch (_) {}
      }
      return primes;
    }

    _fetchBuffer(src) {
      if (!src) return Promise.resolve(null);
      if (this._bufferPromises.has(src)) return this._bufferPromises.get(src);
      const promise = (async () => {
        if (!this.ctx) return null;
        try {
          const tFetch = perfNow();
          const resp = await fetch(versioned(src));
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.arrayBuffer();
          const tDecode = perfNow();
          const bytes = data.byteLength;
          const buf = await new Promise((resolve, reject) => {
            const r = this.ctx.decodeAudioData(data, resolve, reject);
            if (r && r.then) r.then(resolve, reject);
          });
          this.loadStats[src] = { bytes, fetchMs: Math.round(tDecode - tFetch), decodeMs: Math.round(perfNow() - tDecode) };
          return (typeof AudioBuffer !== "undefined" && buf instanceof AudioBuffer) ? buf : null;
        } catch (err) {
          console.warn(`SFX: could not load ${src}; synth fallback in use`, err);
          return null;
        }
      })();
      this._bufferPromises.set(src, promise);
      return promise;
    }

    // Called on every gesture (keydown / pointerdown) and inside unlock(). A context left 'suspended' or
    // 'interrupted' (iOS phone call, Safari tab switch) is resumed here; when resume() rejects or does not
    // settle within PRIME_TIMEOUT_MS, needsGesture stays set so the shell shows TAP TO RESTORE AUDIO.
    resumeIfNeeded() {
      const ctx = this.ctx;
      let p = Promise.resolve();
      if (ctx && ctx.state !== "running" && ctx.state !== "closed" && !this._hidden) {
        const guard = setTimeout(() => { if (ctx.state !== "running") this.needsGesture = true; }, PRIME_TIMEOUT_MS);
        p = Promise.resolve()
          .then(() => ctx.resume())
          .then(() => { clearTimeout(guard); this.needsGesture = ctx.state !== "running"; })
          .catch(() => { clearTimeout(guard); this.needsGesture = true; });
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
      // Buffered layers carry the track when its pair is decoded (the no-restart rule applies there too: a parked pair
      // resumes at its position). Otherwise the element streams now and the pair decodes for the next loop boundary.
      if (this.layersAvailable(index)) {
        const L = this._layerPlay;
        if (L && L.track === index) {
          this.currentTrack = index;
          this._applyMusicGain(0.1);
          this._armLoopTimer();
          return;
        }
        // A live element already streaming this track is never hijacked mid-play (the two carriers cannot be aligned
        // closer than the element's clock jitter): the next loop boundary hands over. The pair starts now only when
        // nothing carries the track yet, resuming at the parked pair's or the paused element's position.
        const slotNow = this.active;
        const streaming = !!(slotNow && slotNow.index === index && this.currentTrack === index && !slotNow.el.paused);
        if (this._layersReadyFor(index) && !streaming && !this._hidden) {
          let pos = this._layerParked && this._layerParked.track === index ? this._layerParked.pos : null;
          if (pos == null && slotNow && slotNow.index === index && this.currentTrack === index && Number.isFinite(slotNow.el.currentTime)) pos = slotNow.el.currentTime;
          const prev = this.active;
          this.currentTrack = index;
          this._layersStart(this.layers, pos, L ? fade : 0.15);
          if (prev && !prev.el.paused) this._parkElement(prev, fade);
          this._applyMusicGain(0.1);
          this._armLoopTimer();
          return;
        }
        if (!this._layersReadyFor(index)) this._layersPrepare(index);
      }
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

    // offset: seconds past loopStart to begin at (the loop crossfade passes how late it fired).
    _startSlot(slot, index, fade, fromLoopStart, offset = 0) {
      if (!slot) return;
      if (this._layerPlay) this._layersStop(fade, false);   // a buffered pair of another track fades out under the element
      if (this._layerParked && this._layerParked.track !== index) this._layerParked = null;
      const prev = this.active;
      const src = this.musicTracks[index];
      const [loopStart] = this._loopFor(index);
      this._clearFadeTimer();
      slot.el.preload = "auto"; // this slot plays now: stream ahead
      if (slot.src !== src) {
        slot.src = src;
        slot.el.src = versioned(src);
      }
      slot.index = index;
      slot.parkedAt = null;
      if (fromLoopStart) this._seek(slot, loopStart + Math.max(0, offset || 0));
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
      const el = slot.el;
      if (el.readyState >= 1 && Math.abs((el.currentTime || 0) - t) < 0.01) { slot.pendingSeek = null; return; }
      slot.pendingSeek = el.readyState >= 1 ? null : t;
      try { el.currentTime = t; } catch (_) {}
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

    // Polled at 100 ms (interval + timeupdate). Inside the last LOOP_ARM_S a one-shot timer takes over so the
    // crossfade starts within a few ms of loopEnd - LOOP_FADE instead of up to a poll late.
    _loopTick() {
      const slot = this.active;
      if (!slot || !this.wantMusic || slot.index < 0 || this._layerPlay) return;
      const el = slot.el;
      if (el.paused || !Number.isFinite(el.currentTime)) return;
      const [, end] = this._loopFor(slot.index);
      const t = el.currentTime;
      const fadeAt = end - LOOP_FADE;
      if (t >= fadeAt - 0.004) { this._crossfadeLoop(slot); return; }
      if (t >= end - PREFETCH_LEAD) {
        this._prefetchSlot(this._idleSlot(), slot.index, "auto");
        if (!this._fadeTimer && fadeAt - t <= LOOP_ARM_S + 0.1) {
          const ms = Math.max(0, (fadeAt - t) / (el.playbackRate || 1) * 1000 - 2);
          this._fadeTimer = setTimeout(() => { this._fadeTimer = null; this._loopTick(); }, ms);
        }
      }
    }

    _clearFadeTimer() {
      if (this._fadeTimer) clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }

    // The incoming element starts at loopStart (+ however late the fade point was caught, so the two
    // elements stay beat-aligned) while the outgoing one fades over LOOP_FADE.
    _crossfadeLoop(slot) {
      const next = this._idleSlot();
      if (!next || next === slot) return;
      const [, end] = this._loopFor(slot.index);
      const late = (slot.el.currentTime || 0) - (end - LOOP_FADE);
      if (!this._layerPlay && this._layersReadyFor(slot.index)) { this._layersTakeover(slot, late > 0.015 ? late : 0); return; }
      this._startSlot(next, slot.index, LOOP_FADE, true, late > 0.015 ? late : 0);
    }

    _onSlotEnded(slot) {
      if (slot === this.active && this.wantMusic && slot.index >= 0) this._crossfadeLoop(slot);
    }

    prefetchMusic(index) {
      if (!this.musicEls.length || !this.musicTracks.length) return;
      const i = clamp(Math.floor(Number(index) || 0), 0, this.musicTracks.length - 1);
      this._prefetchedTrack = i;
      if (this.layersAvailable(i) && !this._layersReadyFor(i)) this._layerFetch(i);   // bytes only; decoded at the level clear
      if (this.active && this.active.index === i) return;
      this._prefetchSlot(this._idleSlot(), i);
    }

    // preload "metadata" (default: the next sector's track, headers only) or "auto" (the loop lead:
    // same track as the active slot, parked at loopStart so the crossfade starts from buffered data).
    _prefetchSlot(slot, index, preload) {
      const src = this.musicTracks[index];
      if (!slot || slot === this.active || slot.level > 0) return;
      const mode = preload === "auto" ? "auto" : "metadata";
      if (slot.src !== src) {
        slot.src = src;
        slot.index = -1;
        slot.pendingSeek = null;
        slot.parkedAt = null;
        slot.el.preload = mode;
        slot.el.src = versioned(src);
      } else if (mode === "auto" && slot.el.preload !== "auto") {
        slot.el.preload = "auto";
      }
      if (mode === "auto") {
        const [loopStart] = this._loopFor(index);
        if (slot.parkedAt !== loopStart) { slot.parkedAt = loopStart; this._seek(slot, loopStart); }
      }
    }

    stopMusic() {
      this.wantMusic = false;
      this.pendingTrack = null;
      this.currentTrack = -1;
      this._layersStop(0.05, false);
      this._layerParked = null;
      this._clearEndTimer();
      this._disarmLoopTimer();
      this._clearFadeTimer();
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
      if (state === "resume") {
        if (this.musicState !== "pause") return;   // review R9: only a paused bus resumes (a restart's 'wave' survives the pause -> playing hop)
        state = this.musicStateBeforePause || "wave";
      }
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
      if (this._layerPlay) return;   // the buffered pair carries the track
      const parked = this._layerParked;
      if (this.wantMusic && parked && parked.track === this.currentTrack && this._layersReadyFor(parked.track) && !this._hidden && this.musicState !== "end") {
        this._layersStart(this.layers, parked.pos, 0.1);
        return;
      }
      const slot = this.active;
      if (this.wantMusic && slot && slot.index >= 0 && slot.el.paused && !this._hidden && this.musicState !== "end") {
        slot.el.play().catch(() => { this.needsGesture = true; });
      }
    }

    _pauseAll() {
      this._layersStop(0.02, true);
      for (const slot of this.musicEls) { try { slot.el.pause(); } catch (_) {} }
    }

    _clearEndTimer() {
      if (this._endTimer) clearTimeout(this._endTimer);
      this._endTimer = null;
    }

    // Legacy field: the element carrying music, a facade { buffered: true, currentTime, paused: false } while the
    // layer pair carries it, or null when nothing plays.
    get music() {
      if (this._layerPlay && this.wantMusic) return this._layerPlay.facade;
      const slot = this.active;
      return slot && this.wantMusic && !slot.el.paused ? slot.el : null;
    }

    // "layers" | "stream" | null: which transport carries the music right now.
    musicPath() {
      if (this._layerPlay && this.wantMusic) return "layers";
      const slot = this.active;
      return slot && this.wantMusic && !slot.el.paused ? "stream" : null;
    }

    // Moves the music to track position t (seconds): element currentTime on the stream path, a restart of the pair's
    // sources at that offset on the buffered path. A probe / debug seam: the transport itself never seeks mid-loop.
    seekMusic(t) {
      const L = this._layerPlay;
      if (L) {
        const pair = L.pair;
        this._layersStart(pair, clamp(Number(t) || pair.start, pair.start, pair.start + pair.len - 0.01), 0.005);
        return true;
      }
      const slot = this.active;
      if (slot && slot.index >= 0) { try { slot.el.currentTime = Number(t) || 0; } catch (_) {} return true; }
      return false;
    }

    // Snapshot of the adaptive-music state for the shell / probes.
    musicLayerInfo() {
      const L = this._layerPlay, pair = L ? L.pair : this.layers;
      return {
        enabled: this.layersEnabled, path: this.musicPath(), track: L ? L.track : null, prepared: this.layers ? this.layers.track : null,
        position: this.musicPosition(), loopStart: pair ? pair.start : null, loopEnd: pair ? pair.start + pair.len : null,
        intensity: this.intensity, topGain: L ? +L.gTop.gain.value.toFixed(3) : null, parked: this._layerParked ? { ...this._layerParked } : null,
        ...this.layerStats
      };
    }

    // Track position in seconds on whichever path carries (or parked) the music; null when unknown.
    musicPosition() {
      if (this._layerPlay) return this._layersPos();
      if (this._layerParked && this._layerParked.track === this.currentTrack) return this._layerParked.pos;
      const slot = this.active;
      return slot && Number.isFinite(slot.el.currentTime) ? slot.el.currentTime : null;
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

    // ------------------------------------------------------------------ adaptive music layers (SOUND pass)

    // True when track `index` has a layer pair in the manifest and this device takes the buffered path.
    layersAvailable(index) {
      const L = this.musicLayers[index];
      return !!(this.layersEnabled && this.ctx && !this.forceHtmlAudio && L && L.base && L.top);
    }

    _layersReadyFor(index) {
      return !!(this.layers && this.layers.track === index && this.layers.base && this.layers.top);
    }

    // Debug / probe switch. Turning the layers off while they carry the music moves the track onto the element at the
    // same position; turning them on takes effect at the next playMusic / loop boundary.
    setLayersEnabled(on) {
      this.layersEnabled = !!on && LAYERS_ENV_OK;
      if (!this.layersEnabled && this._layerPlay) {
        const pos = this._layersPos(), track = this._layerPlay.track;
        const slot = this._idleSlot();
        this._layersStop(0.3, false);
        if (slot && this.wantMusic) { this.currentTrack = track; this._startSlot(slot, track, 0.3, false); this._seek(slot, pos); }
      }
      return this.layersEnabled;
    }

    // Drums level 0..1, eased over LAYER_INTENSITY_TC (the director calls this from the tick hook; a per-key jump never
    // reaches the gain). Stored for the next start when nothing buffered plays.
    setIntensity(v) {
      this.intensity = clamp(Number(v) || 0, 0, 1);
      const L = this._layerPlay;
      if (L) this._ramp(L.gTop.gain, this.intensity, LAYER_INTENSITY_TC);
    }

    // Fetches the two layer files of `index` as ArrayBuffers (kept until decoded). Resolves to the bytes or null.
    _layerFetch(index) {
      if (!this.layersAvailable(index)) return Promise.resolve(null);
      if (this._layerBytes[index]) return Promise.resolve(this._layerBytes[index]);
      if (this._layerFetching[index]) return this._layerFetching[index];
      const L = this.musicLayers[index];
      const get = (src) => fetch(versioned(src)).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); });
      const p = Promise.all([get(L.base), get(L.top)])
        .then(([base, top]) => { this._layerBytes[index] = { base, top }; return this._layerBytes[index]; })
        .catch((err) => { console.warn("SFX: music layers fetch failed", index, err); return null; })
        .finally(() => { delete this._layerFetching[index]; });
      this._layerFetching[index] = p;
      return p;
    }

    // Decodes `index`'s pair (from the prefetched bytes or a fresh fetch), trims both to the loop body
    // [loopStart, loopEnd - LOOP_FADE) with a 12 ms splice so the wrap is seamless, and installs it as this.layers.
    // The previous pair is released unless it is the one playing (the switch releases that one). Resolves pair | null.
    _layersPrepare(index) {
      if (!this.layersAvailable(index)) return Promise.resolve(null);
      if (this._layersReadyFor(index)) return Promise.resolve(this.layers);
      if (this._layerPromises[index]) return this._layerPromises[index];
      const p = (async () => {
        const bytes = await this._layerFetch(index);
        if (!bytes || !this.ctx) return null;
        const t0 = perfNow();
        const decode = (ab) => new Promise((resolve, reject) => {
          const r = this.ctx.decodeAudioData(ab, resolve, reject);
          if (r && r.then) r.then(resolve, reject);
        });
        let base, top;
        try { [base, top] = await Promise.all([decode(bytes.base), decode(bytes.top)]); } catch (err) { console.warn("SFX: music layers decode failed", index, err); delete this._layerBytes[index]; return null; }
        delete this._layerBytes[index];
        if (!(base instanceof AudioBuffer) || !(top instanceof AudioBuffer)) return null;
        const row = MUSIC_LOOP[index] || [0, Math.min(base.duration, top.duration)];
        const start = row[0];
        const end = Math.min(row[1] - LOOP_FADE, base.duration, top.duration);
        const n = Math.round((end - start) * base.sampleRate);
        const pair = { track: index, base: this._trimBuffer(base, start, n), top: this._trimBuffer(top, start, n), start, len: n / base.sampleRate };
        if (this.layers && this.layers !== (this._layerPlay && this._layerPlay.pair)) this.layers = null;
        this.layers = pair;
        this.layerStats.decodeMs = Math.round(perfNow() - t0);
        this._layersAccount();
        return pair;
      })().finally(() => { delete this._layerPromises[index]; });
      this._layerPromises[index] = p;
      return p;
    }

    // Copies n samples from `from` seconds into a fresh buffer; the last LAYER_SPLICE_S blend into the material that
    // leads into `from`, so looping back to sample 0 is continuous.
    _trimBuffer(buf, from, n) {
      const sr = buf.sampleRate, a = Math.round(from * sr);
      n = Math.max(1, Math.min(buf.length - a, n));
      const out = this.ctx.createBuffer(buf.numberOfChannels, n, sr);
      const xf = Math.min(Math.round(LAYER_SPLICE_S * sr), a, n >> 1);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const tmp = new Float32Array(n);
        buf.copyFromChannel(tmp, c, a);
        if (xf > 0) {
          const pre = new Float32Array(xf);
          buf.copyFromChannel(pre, c, a - xf);
          for (let i = 0; i < xf; i++) { const w = (i + 1) / (xf + 1), k = n - xf + i; tmp[k] = tmp[k] * (1 - w) + pre[i] * w; }
        }
        out.copyToChannel(tmp, c, 0);
      }
      return out;
    }

    _layersAccount() {
      const mb = (b) => (b ? b.length * b.numberOfChannels * 4 / 1048576 : 0);
      const pairs = new Set();
      if (this.layers) pairs.add(this.layers);
      if (this._layerPlay) pairs.add(this._layerPlay.pair);
      let total = 0;
      for (const p of pairs) total += mb(p.base) + mb(p.top);
      for (const b of Object.values(this.banks)) if (b) total += mb(b.buffer);
      this.layerStats.residentMB = +total.toFixed(1);
      if (this.layerStats.residentMB > this.layerStats.peakMB) this.layerStats.peakMB = this.layerStats.residentMB;
    }

    // Starts the pair at track position `pos` (seconds; null = loopStart) with both sources looping [0, len) in lockstep;
    // the top (drums) layer sits at this.intensity. fadeSec > 0 fades the pair in (equal-power shape, as the slots do).
    _layersStart(pair, pos, fadeSec = 0, at) {
      const ctx = this.ctx;
      if (!ctx || !pair || !this.musicFilter) return;
      if (this._layerPlay) this._layersStop(Math.max(0.02, fadeSec), false);
      const now = at != null ? at : this._now();
      const off = clamp((pos != null ? pos : pair.start) - pair.start, 0, Math.max(0, pair.len - 0.01));
      const mk = (buf) => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = pair.len; return src; };
      const srcBase = mk(pair.base), srcTop = mk(pair.top);
      const gBase = ctx.createGain(), gTop = ctx.createGain(), out = ctx.createGain();
      gBase.gain.value = 1;
      gTop.gain.value = this.intensity;
      srcBase.connect(gBase); gBase.connect(out);
      srcTop.connect(gTop); gTop.connect(out);
      out.connect(this.musicFilter);
      const g = out.gain;
      if (fadeSec > 0.01) {
        g.setValueAtTime(0.0001, now);
        if (fadeSec > 0.1) g.linearRampToValueAtTime(0.707, now + fadeSec / 2);
        g.linearRampToValueAtTime(1, now + fadeSec);
      } else {
        g.setValueAtTime(1, now);
      }
      srcBase.start(now, off);
      srcTop.start(now, off);
      const self = this;
      const facade = { buffered: true, paused: false, track: pair.track, get currentTime() { return self._layersPos() || 0; }, duration: pair.start + pair.len };
      this._layerPlay = { pair, track: pair.track, srcBase, srcTop, gBase, gTop, out, startedAt: now, offset: off, facade };
      this._layerParked = null;
      this.layerStats.starts++;
      this._layersAccount();
    }

    // Fades the playing pair out and stops it; park = remember the position for playMusic(same) / resume.
    _layersStop(fadeSec = 0.05, park = true) {
      const L = this._layerPlay;
      if (!L) return;
      this._layerPlay = null;
      if (park) this._layerParked = { track: L.track, pos: this._layersPos(L) };
      const now = this._now(), f = Math.max(0.005, fadeSec);
      try {
        L.out.gain.cancelScheduledValues(now);
        L.out.gain.setValueAtTime(L.out.gain.value, now);
        L.out.gain.linearRampToValueAtTime(0.0001, now + f);
        L.srcBase.stop(now + f + 0.02);
        L.srcTop.stop(now + f + 0.02);
      } catch (_) {}
      L.srcBase.onended = () => { try { L.out.disconnect(); L.gBase.disconnect(); L.gTop.disconnect(); } catch (_) {} };
    }

    // Track position (seconds) of a playing pair: start offset + elapsed context time, wrapped into the loop body.
    _layersPos(L = this._layerPlay) {
      if (!L) return null;
      const elapsed = Math.max(0, this._now() - L.startedAt);
      return L.pair.start + ((L.offset + elapsed) % L.pair.len);
    }

    // The streaming element reached its loop point and the pair is decoded: the pair starts at loopStart (+ however
    // late the fade point was caught) while the element fades over LOOP_FADE, exactly as the second element would.
    _layersTakeover(slot, late = 0) {
      const pair = this.layers;
      if (!pair) return;
      this._layersStart(pair, pair.start + late, LOOP_FADE);
      this._parkElement(slot, LOOP_FADE);
      this.currentTrack = pair.track;
      this.layerStats.takeovers++;
    }

    // Fades an element out and pauses it afterwards (it stays this.active for the shell / probes; its index is kept so
    // a later element start of the same track reuses the slot's src).
    _parkElement(slot, fade) {
      this._setSlotLevel(slot, 0, fade, "out");
      setTimeout(() => { if (slot.level === 0 && (slot !== this.active || this._layerPlay || !this.wantMusic)) { try { slot.el.pause(); } catch (_) {} } }, (fade + 0.08) * 1000);
    }

    // Level clear: a different track follows (prefetchMusic said which), so the pair that just played is released and
    // the next one decodes behind the results card (after the fade-out, so the two never overlap in memory).
    _layersPlanNext() {
      const next = this._prefetchedTrack;
      if (next < 0 || !this.layersAvailable(next) || this._layersReadyFor(next)) return;
      const g = global.game;
      if (g && typeof g.runMode === "function" && g.runMode() !== "campaign") return;
      clearTimeout(this._layerPlanTimer);
      this._layerPlanTimer = setTimeout(() => {
        this._layerPlanTimer = null;
        if (this._layerPlay) return;              // something restarted the music meanwhile
        if (this._layersReadyFor(next)) return;   // a quick Next already decoded it (playMusic -> _layersPrepare)
        this.layers = null;
        this._layerParked = null;
        this._layersAccount();
        this._layersPrepare(next);
      }, LAYER_RELEASE_DELAY_MS);
    }

    // ------------------------------------------------------------------ sample pool (SOUND pass)

    // Fetch + decode one bank (sfxBank | voBank). Never gates Start on its own (unlock() races it against
    // PRIME_TIMEOUT_MS); every cue falls back to its synth until the bank is in. Resolves to the bank or null.
    _loadBank(kind) {
      const info = this.bankSources && this.bankSources[kind];
      if (!info || !info.src || !info.cues || !this.ctx || this.forceHtmlAudio) return Promise.resolve(null);
      if (this._bankPromises[kind]) return this._bankPromises[kind];
      const p = this._fetchBuffer(info.src).then((buf) => {
        if (!buf) return null;
        const bank = { kind, buffer: buf, cues: info.cues, shift: this._bankShift(buf, info), rr: Object.create(null), voices: Object.create(null), stats: this.loadStats[info.src] || null };
        this.banks[kind] = bank;
        return bank;
      });
      this._bankPromises[kind] = p;
      return p;
    }

    // Offset between the decoded buffer and the packer's timeline: the first sample above the threshold inside
    // [0, marker + .15 s] is the 1 kHz marker's onset. A decoder that ignores the LAME gapless header leaves ~1105
    // samples of pre-roll; this cancels it. Out-of-range results (no marker found, odd decode) fall back to 0.
    _bankShift(buf, info) {
      const marker = Number(info.marker) || 0;
      const d = buf.getChannelData(0), sr = buf.sampleRate;
      const end = Math.min(d.length, Math.round((marker + 0.15) * sr));
      for (let i = 0; i < end; i++) {
        if (Math.abs(d[i]) > BANK_MARKER_THRESHOLD) {
          const shift = i / sr - marker;
          return Math.abs(shift) <= 0.08 ? shift : 0;
        }
      }
      return 0;
    }

    // One round-robin variant of `cue` from a bank as an AudioBufferSourceNode voice.
    // o: { bank: "sfx" | "vo", t0, rate, jitter (fraction, default from the table), gain (x trim), dur (cap in buffer
    //      seconds), dest, track (pool bookkeeping, default true), voices (per-cue cap) }
    // Returns { cue, src, gain, variant, rate, dur (wall seconds), t0 } or null when no bank / cue is available.
    _sample(cue, o = {}) {
      const bank = this.banks[o.bank || "sfx"];
      const ctx = this.ctx;
      if (!bank || !ctx || !this.sfxGain) return null;
      const row = bank.cues[cue];
      if (!row || !row.v || !row.v.length) return null;
      const n = row.v.length;
      const last = bank.rr[cue];
      // round-robin without immediate repeats: a random step of 1..n-1 from the previous pick
      const variant = n === 1 ? 0 : last == null ? (Math.random() * n) | 0 : (last + 1 + ((Math.random() * (n - 1)) | 0)) % n;
      bank.rr[cue] = variant;
      const [off, len] = row.v[variant];
      const jitter = o.jitter != null ? o.jitter : (row.jitter || 0);
      const rate = clamp((o.rate || 1) * (jitter ? 1 + (Math.random() * 2 - 1) * jitter : 1), 0.25, 4);
      const level = (o.gain != null ? o.gain : 1) * (row.trim != null ? row.trim : 0.5);
      const t0 = o.t0 != null ? o.t0 : this._now();
      const bufDur = o.dur != null ? Math.min(len, o.dur) : len;
      const wall = bufDur / rate;
      const src = ctx.createBufferSource();
      src.buffer = bank.buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      const g = gain.gain;
      g.setValueAtTime(level, t0);
      g.setValueAtTime(level, t0 + Math.max(0, wall - 0.008));
      g.linearRampToValueAtTime(0.0001, t0 + wall);
      src.connect(gain);
      gain.connect(o.dest || this.sfxGain);
      // the end is left to stop(): start()'s duration argument counts buffer seconds in the spec but not in every engine
      src.start(t0, Math.max(0, off + bank.shift));
      src.stop(t0 + wall + 0.01);
      const voice = { cue, src, gain, variant, rate, dur: wall, t0 };
      if (o.track !== false) this._poolAdd(bank, voice, o.voices || row.voices || POOL_DEFAULT_CAP);
      else src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch (_) {} };
      this.lastVoice = { cue, variant, rate: +rate.toFixed(4), gain: +level.toFixed(3), bank: bank.kind };
      return voice;
    }

    _poolAdd(bank, voice, cap) {
      const list = bank.voices[voice.cue] || (bank.voices[voice.cue] = []);
      list.push(voice);
      this._pool.push(voice);
      voice.src.onended = () => {
        let i = list.indexOf(voice);
        if (i >= 0) list.splice(i, 1);
        i = this._pool.indexOf(voice);
        if (i >= 0) this._pool.splice(i, 1);
        try { voice.src.disconnect(); voice.gain.disconnect(); } catch (_) {}
      };
      while (list.length > cap) this._fadeStop(list.shift(), 0.01);       // per-cue stealing, oldest first
      while (this._pool.length > POOL_MAX_VOICES) this._fadeStop(this._pool.shift(), 0.01);
    }

    // Click-free early stop (voice stealing, announcer interrupts).
    _fadeStop(v, sec = 0.012) {
      if (!v) return;
      const now = this._now();
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0.0001, now + sec);
        v.src.stop(now + sec + 0.005);
      } catch (_) {}
    }

    // Fast music sidechain: musicDuck (between musicGain and master) drops `dbs` dB in 20 ms, holds, releases over
    // .25 s. A deeper duck replaces a shallower one, a repeat extends the hold. Separate from duckMusic(), which
    // drives musicGain's own timeline for the long stinger dips. Web Audio path only (the HTML path has no node).
    _sideDuck(dbs, hold = DUCK_HOLD_S, t0) {
      const node = this.musicDuck;
      if (!node || this.forceHtmlAudio) return;
      const now = this._now(), at = t0 != null ? Math.max(now, t0) : now;
      const level = Math.pow(10, Math.min(0, Number(dbs) || 0) / 20);
      if (at < this._duckUntil && level > this._duckLevel + 0.001) return; // a deeper duck is already holding
      const g = node.gain;
      try {
        g.cancelScheduledValues(at);
        g.setValueAtTime(g.value, at);
        g.linearRampToValueAtTime(level, at + 0.02);
        g.setValueAtTime(level, at + 0.02 + hold);
        g.linearRampToValueAtTime(1, at + 0.02 + hold + 0.25);
      } catch (_) { g.value = 1; return; }
      this._duckUntil = at + 0.02 + hold;
      this._duckLevel = level;
    }

    // Typing tick: climbs one octave across the word (continuous, so each glyph is higher than the one before) and
    // resolves on the last glyph with a short root / fifth / octave chord. Sampled tick when the bank is in, else a sine.
    _typeClimb(p, t0) {
      const rate = CLIMB_BASE_RATE * Math.pow(2, p);
      const resolve = p >= 0.999;
      const hz = 2200 * rate;
      const v = this._sample("tick", { t0, rate, jitter: 0.004, gain: resolve ? 1.25 : 1, voices: 4 });
      if (!v) this._osc({ type: "sine", f0: hz, t0, dur: 0.03, a: 0.001, d: 0.008, s: 0.5, r: 0.021, peak: 0.1 });
      if (resolve) {
        for (const [k, peak] of [[0.5, 0.07], [0.75, 0.05], [1, 0.06]]) {
          this._osc({ type: "sine", f0: hz * k, t0: t0 + 0.012, dur: 0.075, a: 0.004, d: 0.02, s: 0.6, r: 0.05, peak });
        }
      }
      this.lastTick = { kind: resolve ? "resolve" : "climb", p: +p.toFixed(3), rate: +rate.toFixed(4), hz: Math.round(hz) };
    }

    // ------------------------------------------------------------------ announcer (SOUND pass)

    // settings.announcer. Off cuts the current line; on fetches the vo bank if it is not in yet.
    setAnnouncer(on) {
      this.announcerOn = on !== false;
      if (!this.announcerOn) this._voCut(0.03);
      else if (this.ctx && !this.banks.vo) this._loadBank("vo");
      return this.announcerOn;
    }

    // Radio line from the vo bank through voGain -> sfxGain (SFX volume and mute apply), ducking the music -4 dB.
    // One line at a time: a higher priority interrupts, an equal or lower one with priority >= 2 waits in the single
    // queue slot, the rest are dropped. Before the bank is decoded the line waits for it (it arrives within the first
    // sector card). o: { delay (s), priority }. Returns true when the line was scheduled or queued. Not a cue: lastCue
    // is untouched.
    say(line, o = {}) {
      if (!this.announcerOn || !this.ctx || this._hidden || this.forceHtmlAudio) return false;
      const bank = this.banks.vo;
      if (!bank) {
        const p = this._loadBank("vo");
        if (p && !this._voPending) {
          this._voPending = true;
          p.then((b) => { this._voPending = false; if (b && this.announcerOn) this.say(line, o); });
        }
        return false;
      }
      const row = bank.cues[line];
      if (!row) return false;
      const priority = o.priority != null ? o.priority : (row.priority != null ? row.priority : 2);
      const now = this._now();
      const cur = this._vo;
      if (cur && cur.until > now) {
        if (priority > cur.priority) this._voCut(0.03);
        else {
          if (priority >= 2 && (!this._voQueue || priority >= this._voQueue.priority)) {
            this._voQueue = { line, priority };
            clearTimeout(this._voTimer);
            this._voTimer = setTimeout(() => {
              const q = this._voQueue;
              this._voQueue = null;
              this._voTimer = null;
              if (q) this.say(q.line, { priority: q.priority });
            }, Math.max(0, (cur.until - now) * 1000) + 60);
          }
          return true;
        }
      }
      const t0 = now + Math.max(0, Number(o.delay) || 0);
      const v = this._sample(line, { bank: "vo", t0, dest: this.voGain || this.sfxGain, track: false, jitter: 0 });
      if (!v) return false;
      this._vo = { line, priority, until: t0 + v.dur, voice: v };
      this.lastVo = line;
      this._sideDuck(DUCK_DB.vo, v.dur + 0.05, t0);
      return true;
    }

    _voCut(sec = 0.03) {
      clearTimeout(this._voTimer);
      this._voTimer = null;
      this._voQueue = null;
      const cur = this._vo;
      this._vo = null;
      if (cur && cur.voice) this._fadeStop(cur.voice, sec);
    }

    // ------------------------------------------------------------------ cue registry

    // Every correct key: the laser (bank round-robin, else the laser WAV trimmed to 0.16 s, else a saw) pitched up
    // across the word (progress 0..1), plus the typing tick that climbs the octave and resolves on the last glyph.
    zap(progress = 0) {
      this.lastCue = "zap";
      if (!this.ctx || !this.sfxGain) return;
      const p = clamp(Number(progress) || 0, 0, 1);
      const rate = 0.92 + 0.45 * p;
      const t0 = this._now();
      const sampled = this._sample("laser", { t0, rate, track: false });
      if (sampled) {
        this._pushLaserVoice({ src: sampled.src, gain: sampled.gain });
        this._typeClimb(p, t0);
        return;
      }
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
      this._typeClimb(p, t0);
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
          this.say("go", { delay: 0.05 });
          break;
        default:
          if (this._sample("lock", { t0 })) break;
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
      if (this._sample("lock_lost")) return;
      this._osc({ type: "square", f0: 420, f1: 180, dur: 0.1, peak: 0.25, filter: { type: "lowpass", f0: 1400 } });
    }

    // Hard miss: the dull tick (sampled knock, else a low-passed square). Dry fire uses error(0.45): 50 ms and quieter.
    error(scale = 1) {
      this.lastCue = "error";
      if (!this.ctx) return;
      const s = clamp(Number(scale) || 1, 0.1, 1);
      const short = s < 0.6;
      const t0 = this._now();
      this.lastTick = { kind: "miss", p: null, rate: 0, hz: 180 };
      if (this._sample("error", { t0, gain: s, dur: short ? 0.06 : undefined })) return;
      const dur = short ? 0.05 : 0.16;
      const v = this._osc({ type: "square", f0: 180, t0, dur, a: 0.002, d: 0.02, s: 0.25, r: dur - 0.022, peak: 0.4 * s, filter: { type: "lowpass", f0: 1500 } });
      if (v && !short) v.osc.frequency.setValueAtTime(140, t0 + 0.05);
    }

    // Kills: size 0..1 ((len-1)/11 for words, .15 minions, .7-1 boss bursts). Three sampled sets by size (small under
    // .3, medium under .7, large), the medium and large ones duck the music -3 / -4 dB for .35 s.
    explosion(size = 0.5) {
      this.lastCue = "explosion";
      if (!this.ctx) return;
      const s = clamp(Number(size) || 0, 0, 1);
      const det = 1 + (Math.random() * 0.16 - 0.08);
      const t0 = this._now();
      if (s >= 0.7) this._sideDuck(DUCK_DB.explosionL);
      else if (s >= 0.5) this._sideDuck(DUCK_DB.explosionM);
      if (this._sample(s < 0.3 ? "explosion_s" : s < 0.7 ? "explosion_m" : "explosion_l", { t0, gain: 0.85 + 0.3 * s })) return;
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
      if (this._sample("impact", { t0 })) return;
      this._burst({ t0, dur: 0.09, a: 0.002, d: 0.03, s: 0.4, r: 0.058, peak: 0.45, filter: { type: "bandpass", f0: 2400, Q: 3 } });
      this._osc({ type: "sine", f0: 100, f1: 38, t0, dur: 0.2, a: 0.003, d: 0.06, s: 0.5, r: 0.137, peak: 0.5 });
    }

    // Real HP loss.
    damage() {
      this.lastCue = "damage";
      if (!this.ctx) return;
      const t0 = this._now();
      this._sideDuck(DUCK_DB.damage);
      if (this._sample("damage", { t0 })) return;
      this._osc({ type: "square", f0: 300, f1: 80, t0, dur: 0.18, a: 0.003, d: 0.05, s: 0.3, r: 0.127, peak: 0.7, filter: { type: "lowpass", f0: 1800 } });
      this._burst({ t0, dur: 0.15, a: 0.003, d: 0.04, s: 0.4, r: 0.107, peak: 0.4, filter: { type: "lowpass", f0: 600 } });
    }

    shieldHit() {
      this.lastCue = "shieldHit";
      if (!this.ctx) return;
      const t0 = this._now();
      if (this._sample("shield_hit", { t0 })) return;
      this._osc({ type: "sine", f0: 1320, t0, dur: 0.07, peak: 0.3 });
      this._osc({ type: "sine", f0: 1980, t0, dur: 0.07, peak: 0.2 });
      this._burst({ t0, dur: 0.03, a: 0.001, d: 0.01, s: 0.4, r: 0.019, peak: 0.1, filter: { type: "highpass", f0: 3000 } });
    }

    shieldBreak() {
      this.lastCue = "shieldBreak";
      if (!this.ctx) return;
      const t0 = this._now();
      this._sideDuck(DUCK_DB.bossHit);
      if (this._sample("shield_break", { t0 })) return;
      this._osc({ type: "sine", f0: 1980, f1: 660, t0, dur: 0.25, peak: 0.35 });
      this._osc({ type: "sine", f0: 1320, f1: 440, t0, dur: 0.25, peak: 0.25 });
      this._burst({ t0, dur: 0.2, a: 0.002, d: 0.05, s: 0.4, r: 0.148, peak: 0.25, filter: { type: "bandpass", f0: 1500, Q: 1 } });
    }

    // 880 Hz beeps at 2 Hz while hp/maxHp <= .25.
    lowHp(on) {
      this.lastCue = "lowHp:" + (on ? "on" : "off");
      if (on) {
        if (this._lowHpTimer || !this.ctx) return;
        const beep = () => { if (this.ctx && !this._sample("low_hp")) this._osc({ type: "sine", f0: 880, dur: 0.06, a: 0.003, d: 0.02, s: 0.6, r: 0.037, peak: 0.2 }); };
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
          this._sample("pickup", { t0, gain: 0.5 });   // chime layer under the repair tones (C-G-C against E-A: consonant)
          this._arp([659, 880], { t0, step: 0.08, dur: 0.16, type: "sine", peak: 0.3 });
          this._osc({ type: "sine", f0: 1760, t0: t0 + 0.16, dur: 0.3, a: 0.01, d: 0.1, s: 0.3, r: 0.19, peak: 0.15 });
          break;
        default: // SHIELD and the legacy powerup() shim: the sampled chime, else the sine arp
          if (this._sample("pickup", { t0 })) break;
          this._arp([523, 784, 1046], { t0, step: 0.07, dur: 0.12, type: "sine", peak: 0.3 });
      }
    }

    powerDown() {
      this.lastCue = "powerDown";
      if (!this.ctx) return;
      if (this._sample("power_down")) return;
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
      const layered = !!this._sample("combo_tier", { gain: 0.8 });   // sparkle layer; the arp carries the tier
      this._arp(notes, { step: 0.06, dur: 0.09, type: "triangle", peak: layered ? 0.22 : 0.3 });
    }

    comboBreak(lost = 10) {
      this.lastCue = "comboBreak";
      if (!this.ctx) return;
      const t0 = this._now();
      const peak = 0.5 + 0.01 * Math.min(Math.max(Number(lost) || 0, 0), 30);
      if (this._sample("combo_break", { t0, gain: peak / 0.5 })) return;
      this._osc({ type: "sawtooth", f0: 600, f1: 120, t0, dur: 0.26, a: 0.004, d: 0.08, s: 0.5, r: 0.176, peak, filter: { type: "lowpass", f0: 2500, f1: 300 } });
      this._burst({ t0, dur: 0.2, a: 0.003, d: 0.06, s: 0.4, r: 0.137, peak: 0.3, filter: { type: "lowpass", f0: 800 } });
    }

    // Level intro t=0: the warp swell, then "Ready" from the announcer.
    sectorStart() {
      this.lastCue = "sectorStart";
      if (!this.ctx) return;
      const t0 = this._now();
      this.say("ready", { delay: 0.35 });
      if (this._sample("sector_start", { t0 })) return;
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
      if (this.pendingPerfect) { this.pendingPerfect = false; this.say("perfect", { delay: 0.3 }); }
    }

    // Approach phase: klaxon twice (sampled alarm, else two saw pulses) and "Warning".
    bossWarning() {
      this.lastCue = "bossWarning";
      if (!this.ctx) return;
      const t0 = this._now();
      if (!this._sample("alarm", { t0 })) {
        for (const at of [0, 0.42]) {
          this._osc({ type: "sawtooth", f0: 440, f1: 330, t0: t0 + at, dur: 0.3, a: 0.01, d: 0.1, s: 0.6, r: 0.19, peak: 0.35, filter: { type: "lowpass", f0: 1500 } });
        }
      }
      this.duckMusic(0.5, 1.0);
      this.say("warning", { delay: 0.1 });
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
      this.say("boss_incoming", { delay: 0.45 });
    }

    segmentDown() {
      this.lastCue = "segmentDown";
      if (!this.ctx) return;
      const t0 = this._now();
      this._sideDuck(DUCK_DB.bossHit);
      if (this._sample("segment_down", { t0 })) return;
      this._osc({ type: "square", f0: 440, f1: 220, t0, dur: 0.12, a: 0.003, d: 0.04, s: 0.4, r: 0.077, peak: 0.35, filter: { type: "lowpass", f0: 2500 } });
      this._osc({ type: "sine", f0: 90, t0, dur: 0.15, a: 0.003, d: 0.05, s: 0.5, r: 0.097, peak: 0.3 });
      this._burst({ t0, dur: 0.08, a: 0.002, d: 0.02, s: 0.4, r: 0.058, peak: 0.2, filter: { type: "bandpass", f0: 1200, Q: 1 } });
    }

    bossPhaseClear() {
      if (this.ctx && this._sample("phase_clear")) {
        this._sideDuck(DUCK_DB.bossHit, 0.45);
      } else {
        this.segmentDown();
        if (this.ctx) this._arp([523, 659, 784], { t0: this._now() + 0.12, step: 0.07, dur: 0.14, type: "triangle", peak: 0.3 });
      }
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
      // sampled 1.2 s noise texture stretched to the charge (a pitchless layer, so the rate change is free)
      const c = this._sample("surge_charge", { t0, rate: clamp(1.2 / d, 0.5, 2), gain: 0.9, track: false });
      this._surge = [a, b, c].filter(Boolean);
    }

    surgeFire() {
      this._cutSurge();
      if (this.ctx && !this._sample("surge_fire")) this._burst({ dur: 0.06, a: 0.001, d: 0.02, s: 0.4, r: 0.039, peak: 0.45, filter: { type: "bandpass", f0: 3000, Q: 2 } });
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

    // Counter-Signal (ARCADE D10): silently cut the riser (pause, phase clear, fight end); not a cue (lastCue untouched).
    surgeStop() { this._cutSurge(); }

    // Overdrive (ARCADE D11): a rising sine sweep + a bright triangle arpeggio + a band-passed air burst.
    overdrive() {
      this.lastCue = "overdrive";
      if (!this.ctx) return;
      const t0 = this._now();
      this.say("overdrive", { delay: 0.12 });
      if (this._sample("overdrive", { t0 })) return;
      this._osc({ type: "sine", f0: 400, f1: 1600, t0, dur: 0.18, a: 0.01, d: 0.06, s: 0.6, r: 0.11, peak: 0.25 });
      this._arp([784, 1047, 1319], { t0: t0 + 0.08, step: 0.05, dur: 0.12, type: "triangle", peak: 0.2 });
      this._burst({ t0, dur: 0.25, a: 0.02, d: 0.08, s: 0.5, r: 0.15, peak: 0.12, filter: { type: "bandpass", f0: 800, f1: 4000, Q: 1, sweep: 0.25 } });
    }

    // Overdrive vented: a falling steam hiss + a short sine drop.
    overdriveVent() {
      this.lastCue = "overdriveVent";
      if (!this.ctx) return;
      const t0 = this._now();
      if (this._sample("overdrive_vent", { t0 })) return;
      this._burst({ t0, dur: 0.35, a: 0.005, d: 0.1, s: 0.5, r: 0.245, peak: 0.22, filter: { type: "bandpass", f0: 6000, f1: 1500, Q: 0.8, sweep: 0.35 } });
      this._osc({ type: "sine", f0: 900, f1: 300, t0, dur: 0.18, peak: 0.12 });
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
        this._sideDuck(DUCK_DB.bossKill, 0.6);
        // the crack over the bigexplosion master: sampled boss_crack (sub drop, debris, long tail), else the burst
        if (!this._sample("boss_crack", { t0 })) this._burst({ t0, dur: 0.06, a: 0.001, d: 0.02, s: 0.4, r: 0.039, peak: 0.5, filter: { type: "bandpass", f0: 3000, Q: 1.5 } });
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
      if (kind === "levelClear") this._layersPlanNext();   // the sector is over: decode the next track's pair behind the card
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
          this.say("sector_clear", { delay: 1.9 });
          break;
        }
        case "gameOver":
          this._arp([440, 415, 370, [330, 0.6]], { t0, step: 0.22, dur: 0.3, type: "square", peak: 0.25, filter: { type: "lowpass", f0: 1800 } });
          this._osc({ type: "sine", f0: 110, f1: 30, t0, dur: 1.5, a: 0.05, d: 0.5, s: 0.6, r: 0.95, peak: 0.35 });
          this.duckMusic(0.3, 1.8);
          this.say("signal_lost", { delay: 0.3 });
          break;
        default:
          voices(clear, { t0, step: 0.12, dur: 0.25, type: "triangle", peak: 0.25 });
          this.duckMusic(0.3, 1.2);
          this.say("sector_clear", { delay: 0.35 });
      }
    }

    // confirm | back | pause | resume | count | stamp | slam | tick
    uiTick(kind = "tick") {
      this.lastCue = "uiTick:" + kind;
      if (!this.ctx) return;
      const t0 = this._now();
      switch (kind) {
        case "confirm": if (!this._sample("ui_confirm", { t0 })) this._osc({ type: "sine", f0: 1200, t0, dur: 0.03, peak: 0.2 }); break;
        case "back": if (!this._sample("ui_back", { t0 })) this._osc({ type: "sine", f0: 900, t0, dur: 0.03, peak: 0.2 }); break;
        case "pause": this._osc({ type: "sine", f0: 1200, f1: 800, t0, dur: 0.06, peak: 0.2 }); break;
        case "resume": this._osc({ type: "sine", f0: 800, f1: 1200, t0, dur: 0.06, peak: 0.2 }); break;
        case "count": this._osc({ type: "sine", f0: 1500, t0, dur: 0.015, a: 0.001, d: 0.005, s: 0.5, r: 0.009, peak: 0.15 }); break;
        case "stamp":
          if (this._sample("rank_stamp", { t0 })) break;
          this._osc({ type: "sine", f0: 180, f1: 60, t0, dur: 0.08, peak: 0.4 });
          this._burst({ t0, dur: 0.02, a: 0.001, d: 0.006, s: 0.4, r: 0.013, peak: 0.2, filter: { type: "lowpass", f0: 1200 } });
          break;
        case "slam":
          if (this._sample("banner_slam", { t0 })) break;
          this._osc({ type: "sine", f0: 1000, t0, dur: 0.04, peak: 0.25 });
          this._burst({ t0, dur: 0.03, a: 0.001, d: 0.01, s: 0.4, r: 0.019, peak: 0.2, filter: { type: "bandpass", f0: 2000, Q: 1 } });
          break;
        default: if (!this._sample("ui_tick", { t0 })) this._osc({ type: "sine", f0: 1200, t0, dur: 0.03, peak: 0.15 });
      }
    }

    // Ending typewriter: 18 ms sine (empress 1800, typegrid 2600, else 2200). With a progress (0..1) through the
    // current word the tick climbs the octave and resolves on the last glyph like the gameplay keys (_typeClimb).
    typeTick(variant, progress) {
      this.lastCue = "typeTick:" + (variant || "default");
      if (!this.ctx) return;
      if (progress != null && Number.isFinite(Number(progress))) { this._typeClimb(clamp(Number(progress), 0, 1), this._now()); return; }
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
    // The rank letter (S/A/B/C/D) comes from the argument or from the director's results-hook note (lastRank); a new
    // high score adds "New record" after it. lastCue stays "uiTick:stamp" (the contract table's alias semantics).
    rankStamp(rank) {
      this.uiTick("stamp");
      const r = String(rank != null ? rank : (this.lastRank || "")).trim().toUpperCase();
      if (/^[SABCD]$/.test(r)) this.say("rank_" + r.toLowerCase(), { delay: 0.2 });
      if (this.lastNewHigh) this.say("new_record", { delay: 0.3 });
    }
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
  SFX.VO_LINES = VO_LINES;
  SFX.LAYERS_ENV_OK = LAYERS_ENV_OK;
  SFX.POOL = { maxVoices: POOL_MAX_VOICES, defaultCap: POOL_DEFAULT_CAP, climbBaseRate: CLIMB_BASE_RATE, duckDb: DUCK_DB };
  SFX.CUES = [
    "zap", "lock", "lockRelease", "lockLost", "error", "explosion", "impact", "damage", "shieldHit", "shieldBreak",
    "lowHp", "pickup", "powerDown", "chainZap", "comboTier", "comboBreak", "sectorStart", "waveStart", "waveClear",
    "bossWarning", "bossSiren", "segmentDown", "bossPhaseClear", "surgeCharge", "surgeFire", "surgeCancel",
    "bossCharge", "bossKill", "fanfare", "uiTick", "typeTick", "overdrive", "overdriveVent"
  ];
  SFX.ALIASES = [
    "hit", "laser", "lockOn", "dryFire", "segmentClear", "bossSegmentClear", "shieldAbsorb", "powerExpire", "heal",
    "bossDefeat", "bossExplosion", "tallyTick", "rankStamp", "bannerSlam", "multTierUp", "uiConfirm", "uiBack",
    "pause", "resume", "bossSurge", "powerup"
  ];

  global.SFX = SFX;
})(typeof window !== "undefined" ? window : globalThis);
