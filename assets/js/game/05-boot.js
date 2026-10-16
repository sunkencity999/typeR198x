// Type-R 198X — boot sequence, loading overlay and the per-sector asset gate (PLAN A8; PERF-03, PERF-05, UX-09).
// Methods are mixed into Game.prototype; load order is defined in index.html (right after game.js).
//
// Boot: Assets.init at the computed renderScale -> loadMany(CRITICAL_KEYS) + the display font (raced against
// 1.5 s) -> onAssetsReady() -> hydrateShipCards() -> finishLoading(). The overlay shows real progress
// (#loadingBar / #loadingLabel / #loadingDetail), a 12 s "still spooling" watchdog with Continue, a 30 s hard
// dismissal, and an error block (Retry re-requests the failed keys, Continue runs on the procedural fallbacks).
//
// Sectors: loadLevelAssets(i) is called at the top of startLevel (gameplay track) and, as a safety net, by
// tickBoot() the first frame a new levelIndex is seen while playing. It sets levelReady=false, releases the
// previous sector's art, loads bg/fg/boss at high priority and applies the theme accent. isLevelGateOpen() is
// the spawn/input gate (levelReady || levelWait >= LEVEL_INTRO_MAX_S). prefetchNextSector() is idempotent per
// sector and feeds the slim #sectorPrefetch bar on Level Complete.

const CRITICAL_KEYS = ["ships/coconut", "ships/little-dark-one", "ships/sofrito", "ships/honeybee", "bg/first", "fg/first", "fx/explosions"];
const ASSET_LABELS = {
  "bg/first": "sector 1 skyline",
  "fg/first": "sector 1 skyline",
  "fx/explosions": "explosion sheet",
  "ships/coconut": "your ship",
  "ships/little-dark-one": "your ship",
  "ships/sofrito": "your ship",
  "ships/honeybee": "your ship",
  font: "display font"
};
const BOOT_SOFT_WATCHDOG_MS = 12000;
const BOOT_HARD_WATCHDOG_MS = 30000;
const FONT_RACE_MS = 1500;
const LOADING_FADE_MS = 450;

function assetLabel(key) {
  if (ASSET_LABELS[key]) return ASSET_LABELS[key];
  if (typeof key !== "string") return "asset";
  const m = /^(bg|fg)\/(.+)$/.exec(key);
  if (m) return `${m[2]} skyline`;
  const b = /^bosses\/(\d+)$/.exec(key);
  if (b) return `sector ${b[1]} boss`;
  return key;
}

Object.assign(Game.prototype, {
  // ------------------------- Boot -------------------------
  initBoot() {
    this.assetsReady = false;
    this.degradedAssets = false;
    this.loadingDismissed = false;
    this.bootReason = null;
    this.failedAssets = [];
    this.levelReady = false;
    this.levelWait = 0;
    this._assetsLevel = -1;
    this.levelAssetsPromise = null;
    this.prefetchedFor = null;
    this._sectorPrefetchKeys = [];
    this._bootProgress = { loaded: 0, total: CRITICAL_KEYS.length + 1, fontDone: false };

    const $ = (id) => document.getElementById(id);
    this.bootEls = {
      overlay: this.loadingOverlay || $("loadingOverlay"),
      bar: $("loadingBar"),
      fill: $("loadingBarFill"),
      label: $("loadingLabel"),
      detail: $("loadingDetail"),
      error: $("loadingError"),
      errorText: $("loadingErrorText"),
      retry: $("btnLoadingRetry"),
      cont: $("btnLoadingContinue"),
      sectorPrefetch: $("sectorPrefetch")
    };
    if (this.bootEls.retry) this.bootEls.retry.addEventListener("click", () => this.retryFailedAssets());
    if (this.bootEls.cont) this.bootEls.cont.addEventListener("click", () => { this.degradedAssets = !this.assetsReady || this.failedAssets.length > 0; this.finishLoading("continue"); });

    Assets.init({ renderScale: this.renderScale || 1 });
    ExplosionSprite.getSheet = () => Assets.get("fx/explosions");
    this.installAudioBusy();

    // Display font (B-3): cached text metrics measured before the swap are rebuilt through spriteEpoch.
    this.fontsReady = this.loadDisplayFont().then((ok) => {
      this._bootProgress.fontDone = true;
      this.spriteEpoch++;
      if (this.plateCache) this.plateCache.clear();
      this.reportBootProgress("font");
      return ok;
    });

    this._assetsOff = [
      Assets.on("error", (e) => this.noteAssetError(e)),
      Assets.on("progress", () => this.updateSectorPrefetchBar())
    ];

    this.setLoadingProgress({ loaded: 0, total: this._bootProgress.total, label: "manifest" });
    const critical = Assets.loadMany(CRITICAL_KEYS, (p) => {
      this._bootProgress.loaded = p.loaded;
      this.reportBootProgress(p.key);
    });
    this.bootPromise = Promise.all([critical, this.fontsReady])
      .then(() => this.onAssetsReady())
      .catch((err) => {
        console.error("[TypeR] boot failed; continuing on fallbacks", err);
        this.degradedAssets = true;
        this.finishLoading("error");
      });

    // Watchdogs count from navigation start: when the scripts themselves arrived late, Continue is offered at once.
    const sinceNav = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    this._bootSoftTimer = setTimeout(() => this.onBootSlow(), Math.max(250, BOOT_SOFT_WATCHDOG_MS - sinceNav));
    this._bootHardTimer = setTimeout(() => { this.degradedAssets = !this.assetsReady; this.finishLoading("watchdog"); }, Math.max(3000, BOOT_HARD_WATCHDOG_MS - sinceNav));
  },

  // Orbitron for banners/titles, raced against FONT_RACE_MS so a slow font never holds the menu.
  loadDisplayFont() {
    let load;
    try {
      if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve(false);
      load = document.fonts.load("800 52px Orbitron").then(() => document.fonts.load("600 18px Orbitron")).then(() => true).catch(() => false);
    } catch (e) {
      return Promise.resolve(false);
    }
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), FONT_RACE_MS));
    return Promise.race([load, timeout]);
  },

  reportBootProgress(key) {
    const bp = this._bootProgress;
    const loaded = bp.loaded + (bp.fontDone ? 1 : 0);
    this.setLoadingProgress({ loaded, total: bp.total, label: assetLabel(key) });
  },

  // Writes the overlay's bar (min 4 %), aria-valuenow, "Spooling hyperspace lanes… k / N" and the stage label.
  setLoadingProgress({ loaded = 0, total = 0, label = "" } = {}) {
    const els = this.bootEls || {};
    const pct = total > 0 ? clamp(Math.round((loaded / total) * 100), 0, 100) : 0;
    if (els.fill) els.fill.style.width = `${Math.max(4, pct)}%`;
    if (els.bar) els.bar.setAttribute("aria-valuenow", String(pct));
    if (els.label && !(els.overlay && els.overlay.classList.contains("isError"))) {
      els.label.textContent = `Spooling hyperspace lanes… ${Math.min(loaded, total)} / ${total}`;
    }
    if (els.detail && label && this.failedAssets.length === 0) els.detail.textContent = String(label).toUpperCase();
  },

  noteAssetError(e) {
    if (!e || !e.key) return;
    if (!this.failedAssets.some((f) => f.key === e.key)) this.failedAssets.push({ key: e.key, src: e.src || null, label: assetLabel(e.key) });
    if (this.loadingDismissed) {
      // In-game failure: the procedural fallbacks draw; say so once per run.
      if (this.toastOnce && !this.toastOnce.has("degraded") && typeof this.showToast === "function") {
        this.toastOnce.add("degraded");
        this.showToast("SOME ART FAILED TO LOAD — USING FALLBACKS", { kind: "warn", key: "degraded" });
      }
      return;
    }
    if (CRITICAL_KEYS.includes(e.key)) this.showLoadingError();
  },

  criticalFailures() {
    return this.failedAssets.filter((f) => CRITICAL_KEYS.includes(f.key));
  },

  showLoadingError() {
    const els = this.bootEls || {};
    if (this.loadingDismissed) return;
    const failed = this.criticalFailures();
    const labels = [...new Set(failed.map((f) => f.label))];
    if (els.errorText) els.errorText.textContent = `Could not load: ${labels.join(", ")} (${failed.length} of ${CRITICAL_KEYS.length})`;
    if (els.detail) els.detail.textContent = `${failed.length} FILE${failed.length === 1 ? "" : "S"} FAILED`;
    if (els.retry) els.retry.classList.remove("hidden");
    if (els.cont) els.cont.classList.remove("hidden");
    if (els.error) els.error.classList.remove("hidden");
    if (els.overlay) els.overlay.classList.add("isError");
  },

  retryFailedAssets() {
    const els = this.bootEls || {};
    if (els.error) els.error.classList.add("hidden");
    if (els.overlay) els.overlay.classList.remove("isError");
    const retried = this.failedAssets.map((f) => f.key);
    this.failedAssets = [];
    if (els.detail) els.detail.textContent = "RETRYING…";
    return Assets.retryFailed().then(() => {
      const stillFailed = Assets.stats().errors.filter((e) => retried.includes(e.key));
      for (const e of stillFailed) this.noteAssetError(e);
      if (this.loadingDismissed) return;
      if (this.criticalFailures().length) this.showLoadingError();
      else this.onAssetsReady();
    });
  },

  // 12 s watchdog: offer Continue without the error styling; the hard watchdog dismisses at 30 s.
  onBootSlow() {
    if (this.loadingDismissed) return;
    const els = this.bootEls || {};
    if (els.label) els.label.textContent = "Still spooling… (slow link)";
    if (els.errorText && !this.criticalFailures().length) els.errorText.textContent = "This is taking longer than usual. You can continue while the rest arrives.";
    if (els.retry && !this.criticalFailures().length) els.retry.classList.add("hidden");
    if (els.cont) els.cont.classList.remove("hidden");
    if (els.error) els.error.classList.remove("hidden");
  },

  onAssetsReady() {
    if (this.loadingDismissed) return;
    ExplosionSprite.sheetScale = Assets.sheetScale("fx/explosions");
    this.assetsReady = true;
    if (this.criticalFailures().length) {
      // Hold the overlay for Retry / Continue (the hard watchdog still dismisses at 30 s).
      this.showLoadingError();
      return;
    }
    this.hydrateShipCards();
    this.setLoadingProgress({ loaded: this._bootProgress.total, total: this._bootProgress.total, label: "ready" });
    this.finishLoading("ready");
    this.prefetchMenuSector();
  },

  // .is-dismissed fades the overlay (450 ms); .hidden lands on transitionend so the native sed/harness state stays valid.
  finishLoading(reason = "ready") {
    if (this.loadingDismissed) return;
    this.loadingDismissed = true;
    this.bootReason = reason;
    clearTimeout(this._bootSoftTimer);
    clearTimeout(this._bootHardTimer);
    const overlay = (this.bootEls && this.bootEls.overlay) || this.loadingOverlay;
    if (this.bootEls && this.bootEls.error) this.bootEls.error.classList.add("hidden");
    if (!overlay) return;
    overlay.setAttribute("aria-busy", "false");
    let done = false;
    const hide = () => {
      if (done) return;
      done = true;
      overlay.classList.add("hidden");
      overlay.removeEventListener("transitionend", hide);
    };
    overlay.addEventListener("transitionend", hide);
    overlay.classList.add("is-dismissed");
    setTimeout(hide, LOADING_FADE_MS + 100);
    if (reason !== "ready") this.degradedAssets = this.degradedAssets || !this.assetsReady;
  },

  dismissLoading(reason) {
    return this.finishLoading(reason);
  },

  // Menu ship cards: the versioned x1 WebP the loader already fetched (a cache hit), explicit dimensions, no srcset (C-2).
  hydrateShipCards() {
    const imgs = document.querySelectorAll("img[data-ship-id]");
    for (const img of imgs) {
      const id = img.dataset.shipId;
      const key = "ships/" + id;
      const meta = Assets.meta(key);
      if (!meta) continue;
      const url = Assets.url(key, "x1");
      if (!url) continue;
      const x1 = meta.x1 || null;
      if (x1 && x1.w > 0 && x1.h > 0) {
        img.setAttribute("width", String(x1.w));
        img.setAttribute("height", String(x1.h));
      }
      img.decoding = "async";
      img.setAttribute("fetchpriority", "low");
      if (!img.dataset.fallbackBound && meta.fallback) {
        img.dataset.fallbackBound = "1";
        img.addEventListener("error", () => {
          const fb = typeof withAssetVersion === "function" && !(IS_FILE_ORIGIN || IS_NATIVE_SHELL) ? withAssetVersion(meta.fallback) : meta.fallback;
          if (img.getAttribute("src") !== fb) img.src = fb;
        }, { once: true });
      }
      if (img.getAttribute("src") !== url) img.src = url;
    }
  },

  // After boot: warm the sector the player will enter from the menu (boss 1 for a fresh pilot) at low priority.
  prefetchMenuSector() {
    try {
      if (navigator.connection && navigator.connection.saveData) return;
    } catch (e) { /* no connection info */ }
    let i = 0;
    try {
      if (typeof getResumeLevelIndex === "function") {
        const r = getResumeLevelIndex(this.save);
        if (Number.isInteger(r)) i = r;
      }
    } catch (e) { i = 0; }
    if (this.save && this.save.run && Number.isInteger(this.save.run.levelIndex)) i = this.save.run.levelIndex;
    Assets.prefetchLevel(clamp(i, 0, 9));
  },

  // Start/Continue show "SPOOLING AUDIO…" (aria-busy) only while the one-shot unlock is pending (F014).
  installAudioBusy() {
    const proto = this.ensureAudio;
    if (typeof proto !== "function" || this._audioBusyInstalled) return;
    this._audioBusyInstalled = true;
    this.ensureAudio = (...args) => {
      const pending = !this.audioReady && !this.audioUnavailable;
      const p = proto.apply(this, args);
      if (pending && p && typeof p.then === "function") {
        this.setAudioBusy(true);
        p.then(() => this.setAudioBusy(false), () => this.setAudioBusy(false));
      }
      return p;
    };
  },

  setAudioBusy(on) {
    for (const btn of [this.btnStart, this.btnContinue]) {
      if (!btn) continue;
      const labelEl = btn.querySelector(".btnLabel") || btn;
      if (on) {
        if (btn.dataset.idleLabel == null) btn.dataset.idleLabel = labelEl.textContent;
        btn.setAttribute("aria-busy", "true");
        labelEl.textContent = "SPOOLING AUDIO…";
      } else {
        if (btn.dataset.idleLabel != null) { labelEl.textContent = btn.dataset.idleLabel; delete btn.dataset.idleLabel; }
        btn.removeAttribute("aria-busy");
      }
    }
  },

  // ------------------------- Per-sector assets -------------------------
  // Called at the top of startLevel(i). Releases the previous sector's art (ships + fx stay pinned), loads this
  // sector's bg/fg/boss at high priority, applies the theme accent, and prepares the boss art / finale vista at
  // the size they are drawn so nothing is resampled per frame.
  loadLevelAssets(i) {
    const level = clamp(i | 0, 0, 9);
    this._assetsLevel = level;
    this.levelReady = false;
    this.levelWait = 0;
    this.prefetchedFor = null;
    this._sectorPrefetchKeys = [];
    this.updateSectorPrefetchBar();
    const keys = Assets.levelKeys(level);
    Assets.gc([...keys, ...Assets.levelKeys(level + 1)]);
    this.applyThemeAccent(level);
    if (typeof this.warmPlateCache === "function") this.warmPlateCache(level);
    if (this.degradedAssets && this.toastOnce && !this.toastOnce.has("degraded") && typeof this.showToast === "function") {
      this.toastOnce.add("degraded");
      this.showToast("SOME ART FAILED TO LOAD — USING FALLBACKS", { kind: "warn", key: "degraded" });
    }
    const p = Assets.loadLevel(level).then(() => {
      if (this._assetsLevel !== level) return false;
      this.levelReady = true;
      this.prepareLevelArt(level);
      return true;
    });
    this.levelAssetsPromise = p;
    return p;
  },

  // PALETTE.accent + --theme-accent + data-theme follow the sector's art (VIS-09).
  applyThemeAccent(i) {
    const theme = typeof getThemeForLevel === "function" ? getThemeForLevel(i) : null;
    const name = (theme && theme.accent) || "cyan";
    const hex = PALETTE.setAccent(name);
    try {
      document.documentElement.style.setProperty("--theme-accent", hex);
      document.documentElement.dataset.theme = (theme && (theme.art || theme.id)) || "first";
    } catch (e) { /* no DOM */ }
    return hex;
  },

  // Boss art at the pre-D6 draw box; the tenth foreground as the cover-width finale vista.
  prepareLevelArt(i) {
    const level = i + 1;
    const box = typeof this.bossArtBox === "function" ? this.bossArtBox(level) : null;
    if (box) {
      const s = Assets.sprite(box.key, box.artW);
      if (s.w > 0 && s.h > 0) Assets.prepare(box.key, { w: Math.round(s.w), h: Math.round(s.h) });
    }
    const theme = typeof getThemeForLevel === "function" ? getThemeForLevel(i) : null;
    if (theme && theme.tileFg === false && typeof this.vistaBox === "function") {
      const v = this.vistaBox(theme);
      if (v) Assets.prepare("fg/" + theme.art, { w: Math.round(v.w), h: Math.round(v.h) });
    }
  },

  // Safety net: the first playing frame on a new sector loads its art even if startLevel did not call loadLevelAssets.
  ensureLevelAssets() {
    if (this._assetsLevel !== this.levelIndex) this.loadLevelAssets(this.levelIndex);
  },

  // Spawn / input gate: open once the sector's art is resident or after LEVEL_INTRO_MAX_S (fail-open).
  isLevelGateOpen() {
    const maxWait = typeof LEVEL_INTRO_MAX_S === "number" ? LEVEL_INTRO_MAX_S : 2.5;
    return !!this.levelReady || (this.levelWait || 0) >= maxWait;
  },

  // Runs every playing frame from the loop (before update).
  tickBoot(dt) {
    this.ensureLevelAssets();
    if (!this.levelReady) this.levelWait += dt;
    const cfg = LEVELS[this.levelIndex];
    if (cfg && (this.bossClear || this.levelT >= 0.25 * cfg.duration)) this.prefetchNextSector();
  },

  // Next sector's bg/fg/boss at low priority plus its music; idempotent per sector. Feeds #sectorPrefetch.
  prefetchNextSector() {
    const i = this.levelIndex;
    if (this.prefetchedFor === i) return;
    this.prefetchedFor = i;
    const keys = Assets.levelKeys(i + 1);
    this._sectorPrefetchKeys = keys;
    if (keys.length) Assets.prefetchLevel(i + 1);
    if (i + 1 < LEVELS.length && this.sfx && typeof this.sfx.prefetchMusic === "function" && typeof this.sfx.trackForLevel === "function") {
      try { this.sfx.prefetchMusic(this.sfx.trackForLevel(i + 1)); } catch (e) { /* audio is optional */ }
    }
    this.updateSectorPrefetchBar();
  },

  // Level Complete is a still screen: draw the next sector's resident bitmaps once at 1 px so their GPU upload
  // happens here instead of on the sector's first gameplay frame. Idempotent per sector; waits until resident.
  warmNextSector() {
    const i = this.levelIndex + 1;
    if (this._warmedSector === i) return;
    const keys = Assets.levelKeys(i);
    if (!keys.length) { this._warmedSector = i; return; }
    const drawables = keys.map((k) => Assets.get(k));
    if (drawables.some((d) => !d)) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.01;
    for (const d of drawables) {
      try { ctx.drawImage(d, 0, 0, 1, 1); } catch (e) { /* closed meanwhile */ }
    }
    ctx.restore();
    this._warmedSector = i;
  },

  updateSectorPrefetchBar() {
    const el = this.bootEls && this.bootEls.sectorPrefetch;
    if (!el) return;
    const keys = this._sectorPrefetchKeys || [];
    if (!keys.length) { el.classList.add("hidden"); return; }
    let loaded = 0;
    for (const k of keys) if (Assets.get(k)) loaded++;
    const pct = Math.round((loaded / keys.length) * 100);
    const fill = el.querySelector(".loadingBarFill");
    if (fill) fill.style.width = `${Math.max(4, pct)}%`;
    el.setAttribute("aria-valuenow", String(pct));
    el.classList.toggle("hidden", loaded >= keys.length);
  },
});
