(function (global) {
  const LASER_SRC = "./assets/audio/laser.wav";
  const AUDIO_VERSION = "2025-11-29";

  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const isFileOrigin = hasWindow && window.location && window.location.protocol === "file:";
  const isNativeShell = hasNavigator && /TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "");
  const FORCE_HTML_AUDIO = isFileOrigin || isNativeShell;

  const versioned = (src) => {
    if (!src) return src;
    if (FORCE_HTML_AUDIO) return src;
    const sep = src.includes("?") ? "&" : "?";
    return `${src}${sep}v=${AUDIO_VERSION}`;
  };

  const createHtmlAudio = (src) => {
    if (typeof Audio === "undefined") return null;
    const audio = new Audio(versioned(src));
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    if (audio.dataset) audio.dataset.src = src;
    else audio._sfxSrc = src;
    return audio;
  };

  const waitForHtmlAudio = (audio) => new Promise((resolve) => {
    if (!audio) {
      resolve(null);
      return;
    }
    const cleanup = () => {
      audio.removeEventListener("canplaythrough", cleanup);
      audio.removeEventListener("error", cleanup);
      resolve(audio);
    };
    if (audio.readyState >= 3) {
      resolve(audio);
      return;
    }
    audio.addEventListener("canplaythrough", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    setTimeout(cleanup, 1500);
    audio.load();
  });

  class SFX {
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
      this.pendingTrack = null;
      this.musicLoaded = {};
      this.bigExplosionBuffer = null;
      this.laserBuffer = null;
      this.htmlMusicElements = [];
      this.htmlMusicCurrent = null;
      this.htmlBigExplosion = null;
      this.htmlSetupPromise = null;
      this.forceHtmlAudio = FORCE_HTML_AUDIO;
    }

    async unlock() {
      const Ctx = hasWindow && (window.AudioContext || window.webkitAudioContext);
      if (Ctx && !this.ctx) {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.65;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.55;
        this.musicGain.connect(this.master);
      }

      if (this.forceHtmlAudio) {
        await this._setupHtmlAudioElements();
      } else {
        await Promise.all([
          this._preloadMusic(),
          this._loadBigExplosion(),
          this._loadLaser()
        ]);
      }

      if (this.ctx && this.ctx.state === "suspended") {
        try {
          await this.ctx.resume();
        } catch (_) {}
      }
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master) {
        this.master.gain.value = this.muted ? 0 : 0.65;
        if (this.musicGain) this.musicGain.gain.value = this.muted ? 0 : 0.55;
      }
      if (this.forceHtmlAudio) {
        this.htmlMusicElements.forEach((audio) => {
          if (!audio) return;
          audio.muted = this.muted;
          if (this.muted) audio.pause();
        });
        if (this.htmlBigExplosion) {
          this.htmlBigExplosion.muted = this.muted;
          if (this.muted) this.htmlBigExplosion.pause();
        }
        if (!this.muted && this.htmlMusicCurrent) {
          this.htmlMusicCurrent.play().catch(() => {});
        }
      }
    }

    async _setupHtmlAudioElements() {
      if (this.htmlSetupPromise) return this.htmlSetupPromise;
      const audios = [];
      this.htmlMusicElements = this.musicTracks.map((src) => {
        const audio = createHtmlAudio(src);
        if (!audio) return null;
        audio.loop = true;
        audio.volume = 0.55;
        audios.push(audio);
        return audio;
      }).filter(Boolean);
      this.htmlBigExplosion = createHtmlAudio("./assets/audio/bigexplosion.wav");
      if (this.htmlBigExplosion) {
        this.htmlBigExplosion.volume = 0.7;
        audios.push(this.htmlBigExplosion);
      }

      this.htmlSetupPromise = Promise.all(audios.map(waitForHtmlAudio)).then(() => {
        const primes = audios.map((audio) => {
          if (!audio) return null;
          return audio.play()
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
            })
            .catch(() => {});
        }).filter(Boolean);
        return Promise.all(primes).catch(() => {});
      });
      return this.htmlSetupPromise;
    }

    async _preloadMusic() {
      if (!this.ctx || this.forceHtmlAudio) return;
      const loads = this.musicTracks.map(async (src) => {
        if (this.musicLoaded[src] && this.musicLoaded[src] !== "loading") return;
        this.musicLoaded[src] = "loading";
        const result = await this._fetchAudio(src);
        this.musicLoaded[src] = result;
      });
      await Promise.all(loads);
      if (this.pendingTrack) {
        const next = this.musicLoaded[this.pendingTrack];
        if (next && next !== "loading") this.playMusic(this.pendingTrack);
        this.pendingTrack = null;
      }
    }

    async _loadBigExplosion() {
      if (!this.ctx || this.forceHtmlAudio || this.bigExplosionBuffer) return;
      this.bigExplosionBuffer = await this._fetchAudio("./assets/audio/bigexplosion.wav");
    }

    async _loadLaser() {
      if (!this.ctx || this.forceHtmlAudio || this.laserBuffer) return;
      this.laserBuffer = await this._fetchAudio(LASER_SRC);
    }

    async _fetchAudio(src) {
      if (this.ctx && !this.forceHtmlAudio) {
        try {
          const resp = await fetch(versioned(src));
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          return await this.ctx.decodeAudioData(buf);
        } catch (err) {
          console.warn(`SFX: fetch failed for ${src}, falling back to HTML audio`, err);
        }
      }
      const audio = createHtmlAudio(src);
      return waitForHtmlAudio(audio);
    }

    _pickMusicTrack() {
      return this.musicTracks[Math.floor(Math.random() * this.musicTracks.length)];
    }

    playMusic(trackSrc) {
      if (this.forceHtmlAudio) {
        this._playHtmlMusic(trackSrc);
        return;
      }
      if (!this.ctx) return;
      const src = trackSrc || this._pickMusicTrack();
      const asset = this.musicLoaded[src];
      if (!asset || asset === "loading") {
        this.pendingTrack = src;
        return;
      }
      this.stopMusic();
      const node = this.ctx.createBufferSource();
      node.buffer = asset;
      node.loop = true;
      node.connect(this.musicGain || this.master);
      if (!this.muted) node.start();
      this.music = node;
    }

    _playHtmlMusic(trackSrc) {
      if (!this.htmlMusicElements.length) return;
      const src = trackSrc || this._pickMusicTrack();
      const node = this.htmlMusicElements.find((audio) => {
        const tagSrc = (audio.dataset && audio.dataset.src) || audio._sfxSrc;
        return tagSrc === src;
      }) || this.htmlMusicElements[0];
      if (!node) return;
      if (this.htmlMusicCurrent && this.htmlMusicCurrent !== node) {
        this.htmlMusicCurrent.pause();
        this.htmlMusicCurrent.currentTime = 0;
      }
      this.htmlMusicCurrent = node;
      node.muted = this.muted;
      if (this.muted) return;
      node.currentTime = 0;
      node.play().catch(() => {});
    }

    stopMusic() {
      if (this.forceHtmlAudio) {
        if (this.htmlMusicCurrent) {
          this.htmlMusicCurrent.pause();
          this.htmlMusicCurrent.currentTime = 0;
          this.htmlMusicCurrent = null;
        }
        return;
      }
      if (!this.music) return;
      try { this.music.stop(); } catch (_) {}
      if (this.music.disconnect) this.music.disconnect();
      this.music = null;
    }

    bossExplosion() {
      if (this.muted) return;
      if (this.forceHtmlAudio) {
        if (!this.htmlBigExplosion) return;
        try {
          this.htmlBigExplosion.currentTime = 0;
          this.htmlBigExplosion.play();
        } catch (_) {}
        return;
      }
      if (!this.ctx || !this.bigExplosionBuffer) {
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

    _now() {
      return this.ctx ? this.ctx.currentTime : 0;
    }

    _env(gainNode, t0, a, d, s, r) {
      if (!this.ctx) return;
      const g = gainNode.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.exponentialRampToValueAtTime(1.0, t0 + a);
      g.exponentialRampToValueAtTime(Math.max(0.0001, s), t0 + a + d);
      g.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    }

    _noise(duration = 0.12) {
      if (!this.ctx) return null;
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * duration));
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      return src;
    }

    _playHtmlClone(audio, volume = 1) {
      if (!audio || typeof audio.cloneNode !== "function") return;
      const clone = audio.cloneNode();
      clone.volume = volume;
      clone.muted = this.muted;
      clone.play().catch(() => {});
    }

    laser() {
      if (this.muted) return;
      if (this.forceHtmlAudio && this.laserBuffer instanceof Audio) {
        this._playHtmlClone(this.laserBuffer, 0.8);
        return;
      }
      if (this.laserBuffer && this.ctx) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.laserBuffer;
        const gain = this.ctx.createGain();
        gain.gain.value = 1.2;
        src.connect(gain);
        gain.connect(this.master);
        src.start();
        return;
      }
      if (!this.ctx) return;
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
      if (!noise) return;
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

  global.SFX = SFX;
})(typeof window !== "undefined" ? window : globalThis);
