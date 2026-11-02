// Type-R 198X — ACCESS / PLATFORM (12-access.js): accessibility options, keyboard layout awareness, installable PWA.
// Methods are mixed into Game.prototype; load order is defined in index.html (right after 10-ui.js, before the render
// modules). Everything here wraps or listens: it edits no render module.
//
//   settings  plateColor "neon" | "contrast", plateFont "mono" | "dyslexic", plateScale 1..1.3 (step .1),
//             shakeAmount 0..1, reduceFlashes, keyboardLayout "auto" | qwerty | azerty | qwertz | dvorak | colemak.
//             Defaults and sanitising in 40-save.js; persistence through the shell's setSetting / applySettings path
//             (applySettings and bindSettings are wrapped below; the rows live in #settingsPanel, the one node the pause
//             screen and the title modal share).
//   wrappers  plateFontPx (x plateScale), motion (shake x shakeAmount; flash capped at ACCESS_FLASH_CAP under
//             reduceFlashes), drawThemeFx (no storm lightning frames under reduceFlashes), FONT.target (the
//             dyslexia-friendly family once it has loaded). The render modules load after this file, so the
//             Game.prototype wrappers are installed on the first applySettings call (the constructor, after every
//             module has run): accessInstallWrappers, once.
//   contrast  "High contrast" swaps PLATE_STYLES strokes for a colour-blind-safe set with distinct luminance (idle
//             near-white, locked yellow, danger orange, minion light violet; every one >= 4.5:1 on the bg0 plate
//             fill, see ACCESS_CONTRAST_HEX) and invalidates the plate sprite cache through spriteEpoch, and adds
//             shape cues that do not rely on colour from the renderOverlay hook (source-over strokes only): a second,
//             white bracket pair outside the lime lock brackets and a dashed hazard underline under danger plates.
//   layout    navigator.keyboard.getLayoutMap() classifies QWERTY / AZERTY / QWERTZ / Dvorak / Colemak from the
//             characters at KeyQ KeyW KeyY KeyA KeyZ KeyS (ACCESS_LAYOUT_SIGNATURES); keyboardLayout() resolves the
//             setting ("auto" = detected, else QWERTY) and keyboardRows() feeds the Flight log heatmap (32-typist.js).
//             Typing reads event.key (normalizeKey, 00-util.js) and needs no layout.
//   pwa       registerServiceWorker() is the one post-boot entry point (finishLoading, 05-boot.js): it schedules the
//             deferred work (font, layout) and registers ./sw.js, never on a file: origin, under the native UA or when
//             window.TypeRHarness.sw === false (every harness context). An installed update shows the "NEW VERSION
//             READY" toast and the footer "Reload to update" link at the menu only (deferred while a run is live); the
//             reload happens after the worker takes over. The Install link appears on beforeinstallprompt and goes
//             away on appinstalled or in display-mode: standalone.
//
// Harness: window.TypeRHarness.sw === false disables registration. Probe: tools/playtest/probes/t-platform.mjs.

const ACCESS_PLATE_SCALE_MIN = 1;
const ACCESS_PLATE_SCALE_MAX = 1.3;
const ACCESS_FLASH_CAP = 0.3;
const ACCESS_DYSLEXIC_FAMILY = "TypeR Dyslexic Mono";   // assets/fonts/TypeRDyslexicMono-Regular.woff2 (OpenDyslexic Mono, OFL; tokens.css)
const ACCESS_FONT_LOAD_MS = 8000;
const ACCESS_SW_PATH = "./sw.js";
const ACCESS_SW_REGISTER_DELAY_MS = 1500;
const ACCESS_TOAST_UPDATE = "NEW VERSION READY — RELOAD";
// High-contrast strokes: PALETTE token names registered below, hex for the probe's contrast check. Relative luminance
// .83 / .70 / .35 / .46 against the bg0 fill (.002): 15.6 / 13.5 / 7.7 / 9.8 to one.
const ACCESS_CONTRAST_HEX = Object.freeze({ hcIdle: "#E8ECF8", hcLocked: "#FFD60A", hcDanger: "#FF7A00", hcMinion: "#C9A4FF" });
const ACCESS_CONTRAST_STROKES = Object.freeze({ idle: "hcIdle", locked: "hcLocked", danger: "hcDanger", dangerBase: "hcDanger", minion: "hcMinion" });
const ACCESS_LAYOUTS = Object.freeze(["qwerty", "azerty", "qwertz", "dvorak", "colemak"]);
const ACCESS_LAYOUT_LABELS = Object.freeze({ qwerty: "QWERTY", azerty: "AZERTY", qwertz: "QWERTZ", dvorak: "Dvorak", colemak: "Colemak" });
// Letter rows per layout (a-z only: the heatmap keys on typistCode). The CSS staggers rows 2 and 3.
const ACCESS_LAYOUT_ROWS = Object.freeze({
  qwerty: Object.freeze(["qwertyuiop", "asdfghjkl", "zxcvbnm"]),
  azerty: Object.freeze(["azertyuiop", "qsdfghjklm", "wxcvbn"]),
  qwertz: Object.freeze(["qwertzuiop", "asdfghjkl", "yxcvbnm"]),
  dvorak: Object.freeze(["pyfgcrl", "aoeuidhtns", "qjkxbmwvz"]),
  colemak: Object.freeze(["qwfpgjluy", "arstdhneio", "zxcvbkm"])
});
// What KeyQ KeyW KeyY KeyA KeyZ KeyS produce on each layout (Dvorak: quote, comma, f, a, semicolon, o).
const ACCESS_LAYOUT_SIGNATURES = Object.freeze({ qwerty: "qwyazs", azerty: "azyqws", qwertz: "qwzays", dvorak: "',fa;o", colemak: "qwjazr" });
const ACCESS_LAYOUT_CODES = Object.freeze(["KeyQ", "KeyW", "KeyY", "KeyA", "KeyZ", "KeyS"]);

// Best layout for a six-character signature: an exact match, else the layout agreeing on at least four keys, else null.
function accessClassifyLayout(sig) {
  if (typeof sig !== "string" || sig.length !== 6) return null;
  let best = null, bestScore = 3;
  for (const id of ACCESS_LAYOUTS) {
    const want = ACCESS_LAYOUT_SIGNATURES[id];
    if (sig === want) return id;
    let score = 0;
    for (let i = 0; i < 6; i++) if (sig[i] === want[i]) score++;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

// The high-contrast strokes join PALETTE (10-tokens.js) so PLATE_STYLES can name them like any token.
(function accessRegisterPalette() {
  if (typeof PALETTE === "undefined" || !PALETTE || !PALETTE.rgb || typeof parseColorToRgb !== "function") return;
  for (const name of Object.keys(ACCESS_CONTRAST_HEX)) {
    if (PALETTE.rgb[name]) continue;
    const c = parseColorToRgb(ACCESS_CONTRAST_HEX[name]);
    if (!c) continue;
    PALETTE.rgb[name] = c;
    if (PALETTE.hex) PALETTE.hex[name] = ACCESS_CONTRAST_HEX[name];
    if (Array.isArray(PALETTE.names)) PALETTE.names.push(name);
  }
})();

// FONT.target (10-tokens.js) is the monospace stack everything typable is drawn with; the dyslexia-friendly family
// replaces it only once document.fonts has loaded the face (FONT.accessFamily is null until then).
(function accessWrapFont() {
  if (typeof FONT === "undefined" || !FONT || typeof FONT.target !== "function" || FONT._accessWrapped) return;
  const origTarget = FONT.target;
  FONT.accessFamily = null;
  FONT.accessBaseMono = FONT.mono;
  FONT.target = (px, weight = 600) => (FONT.accessFamily ? `${weight} ${Math.round(px)}px ${FONT.accessFamily}` : origTarget(px, weight));
  FONT._accessWrapped = true;
})();

Object.assign(Game.prototype, {
  accessState() {
    return this._access || (this._access = {
      wrappersInstalled: false, applied: false, contrast: false, plateScale: 1, neonStrokes: null,
      fontLoaded: false, fontLoading: null, fontFailed: false,
      layoutDetected: null, layoutSignature: null, layoutListening: false,
      booted: false, swAttempted: false, swReg: null, swWaiting: null, swReloadArmed: false, swUpdatePending: false,
      installEvent: null, installedNow: false, standalone: false
    });
  },

  // ------------------------- Setting readers (public) -------------------------
  // Plate glyph multiplier 1..1.3 (settings.plateScale); plateFontPx is wrapped to apply it.
  plateScale() {
    const s = this.save && this.save.settings;
    const v = Number(s && s.plateScale);
    return Number.isFinite(v) && v > 0 ? clamp(Math.round(v * 10) / 10, ACCESS_PLATE_SCALE_MIN, ACCESS_PLATE_SCALE_MAX) : 1;
  },

  shakeAmount() {
    const s = this.save && this.save.settings;
    const v = Number(s && s.shakeAmount);
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  },

  reduceFlashes() {
    const s = this.save && this.save.settings;
    return !!(s && s.reduceFlashes);
  },

  plateColorMode() {
    const s = this.save && this.save.settings;
    return s && s.plateColor === "contrast" ? "contrast" : "neon";
  },

  plateFontMode() {
    const s = this.save && this.save.settings;
    return s && s.plateFont === "dyslexic" ? "dyslexic" : "mono";
  },

  // The effective layout id: the setting, or the detected layout under "auto" (QWERTY until detection lands).
  keyboardLayout() {
    const s = this.save && this.save.settings;
    const v = s && s.keyboardLayout;
    if (ACCESS_LAYOUTS.includes(v)) return v;
    return this.accessState().layoutDetected || "qwerty";
  },

  // Flight log heatmap rows for the effective layout (32-typist.js typistFlightLogHtml).
  keyboardRows() {
    return ACCESS_LAYOUT_ROWS[this.keyboardLayout()] || ACCESS_LAYOUT_ROWS.qwerty;
  },

  // ------------------------- Prototype wrappers (installed once every module has loaded) -------------------------
  accessInstallWrappers() {
    const st = this.accessState();
    if (st.wrappersInstalled) return;
    st.wrappersInstalled = true;
    const P = Game.prototype;
    if (typeof P.plateFontPx === "function" && !P.plateFontPx._access) {
      const orig = P.plateFontPx;
      const wrapped = function () {
        const base = orig.call(this);
        const k = this.plateScale();
        return k === 1 ? base : Math.round(base * k);
      };
      wrapped._access = true;
      P.plateFontPx = wrapped;
    }
    if (typeof P.motion === "function" && !P.motion._access) {
      const orig = P.motion;
      const wrapped = function () {
        const m = orig.call(this);
        const k = this.shakeAmount();
        const rf = this.reduceFlashes();
        if (!m || (k === 1 && !rf)) return m;
        // one reused object: fxMotion() reads it synchronously several times per frame, nobody retains it
        const o = this._accessMotion || (this._accessMotion = { shake: 1, flash: 1, anim: 1 });
        o.shake = m.shake * k;
        o.flash = rf ? Math.min(m.flash, ACCESS_FLASH_CAP) : m.flash;
        o.anim = m.anim;
        return o;
      };
      wrapped._access = true;
      P.motion = wrapped;
    }
    if (typeof P.drawThemeFx === "function" && !P.drawThemeFx._access) {
      const orig = P.drawThemeFx;
      const wrapped = function (ctx) {
        if ((this.stormBoltFrames | 0) > 0 && this.reduceFlashes()) this.stormBoltFrames = 0;   // the tint stays, the lightning frames do not
        return orig.call(this, ctx);
      };
      wrapped._access = true;
      P.drawThemeFx = wrapped;
    }
  },

  // ------------------------- Settings: elements, binding, apply -------------------------
  accessSettingsEls() {
    if (this._accessEls) return this._accessEls;
    const $ = (id) => document.getElementById(id);
    this._accessEls = {
      plateColor: $("setPlateColor"), plateFont: $("setPlateFont"),
      plateSize: $("setPlateSize"), plateSizeOut: $("setPlateSizeOut"),
      shake: $("setShake"), shakeOut: $("setShakeOut"),
      flashes: $("setReduceFlashes"), layout: $("setKeyboardLayout"),
      install: $("btnInstall"), reload: $("btnPwaReload")
    };
    return this._accessEls;
  },

  accessBindSettings() {
    const e = this.accessSettingsEls();
    if (e.plateColor) e.plateColor.addEventListener("change", () => this.setSetting("plateColor", e.plateColor.value === "contrast" ? "contrast" : "neon"));
    if (e.plateFont) e.plateFont.addEventListener("change", () => this.setSetting("plateFont", e.plateFont.value === "dyslexic" ? "dyslexic" : "mono"));
    if (e.plateSize) e.plateSize.addEventListener("input", () => this.setSetting("plateScale", clamp(Math.round((Number(e.plateSize.value) || 100) / 10) * 10, 100, 130) / 100));
    if (e.shake) e.shake.addEventListener("input", () => this.setSetting("shakeAmount", clamp(Number(e.shake.value) || 0, 0, 100) / 100));
    if (e.flashes) e.flashes.addEventListener("change", () => this.setSetting("reduceFlashes", !!e.flashes.checked));
    if (e.layout) e.layout.addEventListener("change", () => this.setSetting("keyboardLayout", ACCESS_LAYOUTS.includes(e.layout.value) ? e.layout.value : "auto"));
    if (e.install) e.install.addEventListener("click", () => this.installPwa());
    if (e.reload) e.reload.addEventListener("click", () => this.pwaApplyUpdate());
    this.accessBindPwa();
  },

  // Runs after the shell's applySettings (wrapped below), including the constructor's first call.
  accessApplySettings() {
    this.accessInstallWrappers();
    const st = this.accessState();
    const first = !st.applied;
    st.applied = true;

    const contrast = this.plateColorMode() === "contrast";
    if (contrast !== st.contrast || first) this.accessApplyPlateStyles(contrast, first);
    st.contrast = contrast;

    const k = this.plateScale();
    if (k !== st.plateScale && !first) this.accessInvalidatePlates();
    st.plateScale = k;

    this.accessApplyPlateFont(this.plateFontMode());

    document.documentElement.dataset.plateColor = contrast ? "contrast" : "neon";

    const e = this.accessSettingsEls();
    const setRange = (el, out, pct) => {
      if (!el) return;
      if (Number(el.value) !== pct) el.value = String(pct);
      const min = Number(el.min) || 0, max = Number(el.max) || 100;
      el.style.setProperty("--val", `${((pct - min) / Math.max(1, max - min)) * 100}%`);
      if (out) out.textContent = `${pct}%`;
    };
    setRange(e.plateSize, e.plateSizeOut, Math.round(k * 100));
    setRange(e.shake, e.shakeOut, Math.round(this.shakeAmount() * 100));
    if (e.flashes) e.flashes.checked = this.reduceFlashes();
    const colorWant = contrast ? "contrast" : "neon";
    if (e.plateColor && e.plateColor.value !== colorWant) e.plateColor.value = colorWant;
    const fontWant = this.plateFontMode();
    if (e.plateFont && e.plateFont.value !== fontWant) e.plateFont.value = fontWant;
    this.accessSyncLayoutOptions();
  },

  // PLATE_STYLES (70-render.js) strokes: the neon set is remembered on the first swap and restored on the way back.
  accessApplyPlateStyles(contrast, first) {
    if (typeof PLATE_STYLES === "undefined" || !PLATE_STYLES) return;
    const st = this.accessState();
    if (!st.neonStrokes) {
      st.neonStrokes = {};
      for (const k of Object.keys(ACCESS_CONTRAST_STROKES)) if (PLATE_STYLES[k]) st.neonStrokes[k] = PLATE_STYLES[k].stroke;
    }
    let changed = false;
    for (const k of Object.keys(ACCESS_CONTRAST_STROKES)) {
      const style = PLATE_STYLES[k];
      if (!style || Object.isFrozen(style)) continue;
      const want = contrast ? ACCESS_CONTRAST_STROKES[k] : st.neonStrokes[k];
      if (want && style.stroke !== want) { style.stroke = want; changed = true; }
    }
    if (changed && !first) this.accessInvalidatePlates();
  },

  // Same invalidation as resizeCanvas: new epoch, cache cleared, the active content re-baked in idle slices.
  accessInvalidatePlates() {
    if (typeof this.spriteEpoch === "number") this.spriteEpoch++;
    if (this.plateCache && typeof this.plateCache.clear === "function") this.plateCache.clear();
    if (this.loadingDismissed && typeof this.warmPlateCache === "function") {
      try { this.warmPlateCache(this.mode === "menu" ? 0 : (this.levelIndex | 0)); } catch (_) { /* not ready */ }
    }
    if (typeof this.requestFrame === "function" && this.loadingDismissed) {
      try { this.requestFrame(); } catch (_) { /* no frame yet */ }
    }
  },

  // The dyslexia-friendly face is fetched only when chosen (never preloaded) and only after the first load; until
  // document.fonts has it, the mono stack stays so no plate is measured with a fallback and redrawn with the face.
  accessApplyPlateFont(mode) {
    const st = this.accessState();
    const stack = `"${ACCESS_DYSLEXIC_FAMILY}", ${FONT.accessBaseMono || FONT.mono || "monospace"}`;
    if (mode === "dyslexic") {
      if (st.fontLoaded) {
        if (FONT.accessFamily !== stack) { FONT.accessFamily = stack; this.accessInvalidatePlates(); }
        return;
      }
      if (st.fontLoading || st.fontFailed || !this.loadingDismissed) return;   // registerServiceWorker() retries after boot
      st.fontLoading = this.accessLoadDyslexicFont().then((ok) => {
        st.fontLoading = null;
        if (!ok) {
          st.fontFailed = true;
          if (typeof this.showToast === "function") this.showToast("DYSLEXIA FONT UNAVAILABLE — KEEPING MONO", { kind: "warn", key: "accessFont" });
          return;
        }
        st.fontLoaded = true;
        if (this.plateFontMode() === "dyslexic") { FONT.accessFamily = stack; this.accessInvalidatePlates(); }
      });
      return;
    }
    if (FONT.accessFamily) { FONT.accessFamily = null; this.accessInvalidatePlates(); }
  },

  accessLoadDyslexicFont() {
    let load;
    try {
      if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve(false);
      const spec = `600 25px "${ACCESS_DYSLEXIC_FAMILY}"`;
      load = document.fonts.load(spec).then((faces) => (Array.isArray(faces) ? faces.length > 0 : true) && (typeof document.fonts.check !== "function" || document.fonts.check(spec))).catch(() => false);
    } catch (_) { return Promise.resolve(false); }
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), ACCESS_FONT_LOAD_MS));
    return Promise.race([load, timeout]);
  },

  // ------------------------- Keyboard layout -------------------------
  // Resolves to the detected id (or null when the API is missing or the map is not one of the five layouts).
  accessDetectLayout() {
    const st = this.accessState();
    let kb = null;
    try { kb = navigator.keyboard || null; } catch (_) { kb = null; }
    if (!kb || typeof kb.getLayoutMap !== "function") return Promise.resolve(null);
    if (!st.layoutListening && typeof kb.addEventListener === "function") {
      st.layoutListening = true;
      try { kb.addEventListener("layoutchange", () => { this.accessDetectLayout(); }); } catch (_) { /* optional */ }
    }
    let p;
    try { p = kb.getLayoutMap(); } catch (_) { return Promise.resolve(null); }
    return Promise.resolve(p).then((map) => {
      const sig = ACCESS_LAYOUT_CODES.map((code) => {
        const v = map && typeof map.get === "function" ? map.get(code) : null;
        return typeof v === "string" && v.length === 1 ? v.toLowerCase() : "?";
      }).join("");
      const id = accessClassifyLayout(sig);
      const changed = id !== st.layoutDetected;
      st.layoutDetected = id;
      st.layoutSignature = sig;
      if (changed) { this.accessSyncLayoutOptions(); this.accessRefreshFlightLog(); }
      return id;
    }).catch(() => null);
  },

  // "Auto" names the detected layout; the stored value is kept in sync with the select.
  accessSyncLayoutOptions() {
    const e = this.accessSettingsEls();
    const sel = e.layout;
    if (!sel) return;
    const st = this.accessState();
    const auto = sel.querySelector('option[value="auto"]');
    if (auto) {
      const label = st.layoutDetected ? `Auto (${ACCESS_LAYOUT_LABELS[st.layoutDetected]})` : "Auto";
      if (auto.textContent !== label) auto.textContent = label;
    }
    const s = this.save && this.save.settings;
    const want = s && ACCESS_LAYOUTS.includes(s.keyboardLayout) ? s.keyboardLayout : "auto";
    if (sel.value !== want) sel.value = want;
  },

  // The Flight log is rebuilt on every Records open; while it is open, a layout change redraws its heatmap.
  accessRefreshFlightLog() {
    const modal = document.getElementById("recordsModal");
    const log = document.getElementById("panelLog");
    if (!modal || !log || modal.classList.contains("is-dismissed")) return;
    if (typeof this.typistFlightLogHtml === "function") {
      try { log.innerHTML = this.typistFlightLogHtml(); } catch (_) { /* profile not ready */ }
    }
  },

  // ------------------------- High-contrast shape cues (renderOverlay hook) -------------------------
  // Unshaken layer: the listener applies shakeNow like the other overlay listeners. Source-over strokes only (the
  // frame's composite budget is already at its cap), no shadowBlur, no filter.
  accessDrawCues(ctx) {
    if (!ctx || this.plateColorMode() !== "contrast") return;
    if (this.mode !== "playing" && this.mode !== "paused") return;
    const enemies = this.enemies || [];
    const powerups = this.powerups || [];
    if (!enemies.length && !powerups.length) return;
    const bucket = typeof PLATE_BUCKET === "number" ? PLATE_BUCKET : 8;
    const sh = this.shakeNow || null;
    ctx.save();
    if (sh && (sh.x || sh.y || sh.rot)) {
      ctx.translate(sh.x || 0, sh.y || 0);
      if (sh.rot) { ctx.translate(this.w / 2, this.h / 2); ctx.rotate(sh.rot); ctx.translate(-this.w / 2, -this.h / 2); }
    }
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    let dashes = 0;
    for (const en of enemies) {
      if (!en || en.alive === false || en.dying) continue;
      const w = en.plateW, h = en.plateH;
      if (!(w > 0 && h > 0)) continue;
      const state = typeof this.enemyState === "function" ? this.enemyState(en) : (en.locked ? "locked" : "idle");
      if (state === "locked") this.accessDrawLockCue(ctx, en.x, en.y, Math.max(h, Math.ceil(w / bucket) * bucket), h);
      else if (state === "danger") { this.accessDrawHazardCue(ctx, en.x, en.y, w, h); dashes++; }
    }
    for (const p of powerups) {
      if (!p || p.alive === false || p.dying || !p.locked) continue;
      const w = p.plateW, h = p.plateH;
      if (w > 0 && h > 0) this.accessDrawLockCue(ctx, p.x, p.y, Math.max(h, Math.ceil(w / bucket) * bucket), h);
    }
    ctx.restore();
    this.debug.accessCues = (this.debug.accessCues | 0) + 1;
  },

  // A second bracket pair, white and heavier, 6 px outside the lime one: the lock reads by shape alone.
  accessDrawLockCue(ctx, x, y, wB, h) {
    ctx.strokeStyle = PALETTE.rgba("hcIdle", 0.95);
    ctx.lineWidth = 3;
    bracketRect(ctx, x - wB / 2 - 12, y - h / 2 - 12, wB + 24, h + 24, 12);
  },

  // Short dashes under a plate that has crossed the danger line.
  accessDrawHazardCue(ctx, x, y, w, h) {
    const y0 = y + h / 2 + 5;
    ctx.strokeStyle = PALETTE.rgba("hcDanger", 0.95);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 4, y0);
    ctx.lineTo(x + w / 2 - 4, y0);
    ctx.stroke();
    ctx.setLineDash([]);
  },

  // ------------------------- PWA: service worker -------------------------
  // The post-boot entry point (finishLoading): deferred work first, then the registration a little later so it never
  // competes with the first load or the menu's own prefetch. Returns the registration promise, or null when skipped.
  registerServiceWorker() {
    this.accessAfterBoot();
    const st = this.accessState();
    if (st.swAttempted) return null;
    st.swAttempted = true;
    try {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
      if (!/^https?:$/.test(location.protocol)) return null;
      if (typeof IS_NATIVE_SHELL !== "undefined" && IS_NATIVE_SHELL) return null;
      if (/TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "")) return null;
      if (window.TypeRHarness && window.TypeRHarness.sw === false) return null;
    } catch (_) { return null; }
    const register = () => navigator.serviceWorker.register(ACCESS_SW_PATH)
      .then((reg) => { st.swReg = reg; this.accessWatchRegistration(reg); return reg; })
      .catch((err) => { console.warn("[TypeR] service worker registration failed", err); return null; });
    try {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (st.swReloadArmed) { st.swReloadArmed = false; location.reload(); }
      });
    } catch (_) { /* optional */ }
    const delayed = new Promise((resolve) => {
      const go = () => resolve(register());
      if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: ACCESS_SW_REGISTER_DELAY_MS * 2 });
      else setTimeout(go, ACCESS_SW_REGISTER_DELAY_MS);
    });
    st.swPromise = delayed;
    return delayed;
  },

  accessAfterBoot() {
    const st = this.accessState();
    if (st.booted) return;
    st.booted = true;
    if (this.plateFontMode() === "dyslexic") this.accessApplyPlateFont("dyslexic");
    setTimeout(() => { this.accessDetectLayout(); }, 400);
  },

  accessWatchRegistration(reg) {
    const ready = () => {
      if (reg.waiting && navigator.serviceWorker.controller) this.pwaUpdateReady(reg.waiting);
    };
    ready();   // a worker already waiting from an earlier visit
    try {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => { if (nw.state === "installed") ready(); });
      });
    } catch (_) { /* optional */ }
  },

  // A new release is installed and waiting. Shown at the menu; a live run defers it to the next modeChange to menu.
  pwaUpdateReady(worker) {
    const st = this.accessState();
    st.swWaiting = worker || st.swWaiting;
    st.swUpdatePending = true;
    this.accessShowUpdateUi();
  },

  accessShowUpdateUi() {
    const st = this.accessState();
    if (!st.swUpdatePending) return;
    if (this.mode !== "menu") return;   // never during play: shown when the menu returns (modeChange hook)
    const e = this.accessSettingsEls();
    if (e.reload) e.reload.classList.remove("hidden");
    if (typeof this.showToast === "function") {
      const el = this.showToast(ACCESS_TOAST_UPDATE, { kind: "tip", key: "pwaUpdate", ms: 12000 });
      if (el && !el.dataset.pwaBound) {
        el.dataset.pwaBound = "1";
        el.style.cursor = "pointer";
        el.addEventListener("click", () => this.pwaApplyUpdate());
      }
    }
  },

  // Asks the waiting worker to take over and reloads once it controls the page (4 s fallback reload).
  pwaApplyUpdate() {
    const st = this.accessState();
    if (this.mode === "playing") return;
    const worker = st.swWaiting || (st.swReg && st.swReg.waiting) || null;
    st.swReloadArmed = true;
    if (typeof this.flushSettingsSave === "function") this.flushSettingsSave();
    if (worker) {
      try { worker.postMessage({ type: "SKIP_WAITING" }); } catch (_) { /* gone */ }
    }
    setTimeout(() => { if (st.swReloadArmed) { st.swReloadArmed = false; location.reload(); } }, 4000);
  },

  accessOnMenu() {
    this.accessShowUpdateUi();
    this.accessSyncInstallUi();
  },

  // ------------------------- PWA: install affordance -------------------------
  accessBindPwa() {
    const st = this.accessState();
    const readStandalone = () => {
      try {
        return !!(window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || window.matchMedia("(display-mode: minimal-ui)").matches || navigator.standalone === true);
      } catch (_) { return false; }
    };
    st.standalone = readStandalone();
    document.documentElement.dataset.display = st.standalone ? "standalone" : "browser";
    window.addEventListener("beforeinstallprompt", (e) => {
      try { e.preventDefault(); } catch (_) { /* fine */ }
      st.installEvent = e;
      this.accessSyncInstallUi();
    });
    window.addEventListener("appinstalled", () => {
      st.installEvent = null;
      st.installedNow = true;
      this.accessSyncInstallUi();
      if (typeof this.showToast === "function") this.showToast("INSTALLED — TYPE-R 198X IS ON YOUR DEVICE", { kind: "success", key: "pwaInstalled" });
    });
    try {
      const mq = window.matchMedia("(display-mode: standalone)");
      const onChange = () => { st.standalone = readStandalone(); document.documentElement.dataset.display = st.standalone ? "standalone" : "browser"; this.accessSyncInstallUi(); };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
      else if (typeof mq.addListener === "function") mq.addListener(onChange);
    } catch (_) { /* optional */ }
    this.accessSyncInstallUi();
  },

  accessSyncInstallUi() {
    const st = this.accessState();
    const e = this.accessSettingsEls();
    if (!e.install) return;
    const show = !!st.installEvent && !st.standalone && !st.installedNow;
    e.install.classList.toggle("hidden", !show);
  },

  // The browser's install prompt (only ever from the Install link; the event is single-use).
  installPwa() {
    const st = this.accessState();
    const ev = st.installEvent;
    if (!ev) return Promise.resolve("unavailable");
    st.installEvent = null;
    this.accessSyncInstallUi();
    try {
      const p = ev.prompt();
      return Promise.resolve(p).then(() => ev.userChoice || { outcome: "unknown" }).then((c) => (c && c.outcome) || "unknown").catch(() => "unknown");
    } catch (_) {
      return Promise.resolve("unknown");
    }
  },

  // Probe / debug surface.
  accessInfo() {
    const st = this.accessState();
    return {
      plateColor: this.plateColorMode(), plateFont: this.plateFontMode(), plateScale: this.plateScale(), shakeAmount: this.shakeAmount(),
      reduceFlashes: this.reduceFlashes(), keyboardLayout: this.keyboardLayout(), layoutDetected: st.layoutDetected, layoutSignature: st.layoutSignature,
      fontLoaded: st.fontLoaded, fontFamily: FONT.accessFamily, standalone: st.standalone, swAttempted: st.swAttempted,
      swRegistered: !!st.swReg, swUpdatePending: st.swUpdatePending, installAvailable: !!st.installEvent
    };
  }
});

// The shell's settings path (10-ui.js) gains the new rows: bindSettings wires them, applySettings syncs and applies them.
(function accessWrapShell() {
  const P = Game.prototype;
  if (typeof P.applySettings === "function" && !P.applySettings._access) {
    const orig = P.applySettings;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { this.accessApplySettings(); } catch (err) { console.warn("[TypeR] access settings", err); }
      return r;
    };
    wrapped._access = true;
    P.applySettings = wrapped;
  }
  if (typeof P.bindSettings === "function" && !P.bindSettings._access) {
    const orig = P.bindSettings;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { this.accessBindSettings(); } catch (err) { console.warn("[TypeR] access bind", err); }
      return r;
    };
    wrapped._access = true;
    P.bindSettings = wrapped;
  }
})();

onGameHook("renderOverlay", function (evt) { if (evt && evt.ctx) this.accessDrawCues(evt.ctx); });
onGameHook("modeChange", function (evt) { if (evt && evt.to === "menu") this.accessOnMenu(); });
