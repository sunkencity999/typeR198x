// Type-R 198X — screens: title cabinet (resume card, sector grid, records), results cards, onboarding toasts, the
// CRT overlay layers and the typewriter. Methods are mixed into Game.prototype; load order is defined in index.html
// (right after 10-ui.js, before 20-run.js).
//
// Every cross-track hook is feature-detected (Phase 3 lead notes, section 3): the shell's openModal / closeModal /
// confirm / announce / focusPrimary / openSettingsModal, the loop's tickUI(raw) call, refreshMenu's
// renderMenuScreens() call and bindUI's initScreens() call. Each has a local fallback, so this file runs on the base
// alone: initScreens() self-boots on DOMContentLoaded, tickUI() runs from its own rAF until the loop calls it, and
// renderMenuScreens() is called from the run-lifecycle paths (20-run.js) until refreshMenu does.

// Marker for self-driven calls. A call WITHOUT it comes from the other side of the hook contract, which switches the
// fallback off for good (the loop's tickUI, refreshMenu's renderMenuScreens).
const SCREENS_SELF = "self";

// Reduced motion: the shell's resolveMotion() sets game.reduceMotion; before it lands, the root class / OS query decide.
function screensReducedMotion(game) {
  if (game && typeof game.reduceMotion === "boolean") return game.reduceMotion;
  try {
    if (document.documentElement.classList.contains("reduce-motion")) return true;
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_) { return false; }
}

function screensShipName(id) {
  try {
    const cfg = typeof getShipConfig === "function" ? getShipConfig(id) : null;
    return (cfg && cfg.name) || "The S.S. Coconut";
  } catch (_) { return "The S.S. Coconut"; }
}

// The ship card art the loader already fetched (x1 WebP), else the PNG master.
function screensShipSrc(id) {
  try {
    if (typeof Assets !== "undefined" && Assets && typeof Assets.url === "function") {
      const url = Assets.url("ships/" + id, "x1");
      if (url) return url;
    }
  } catch (_) { /* loader not ready */ }
  const cfg = typeof getShipConfig === "function" ? getShipConfig(id) : null;
  return cfg ? cfg.src : "";
}

function screensFormatTime(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

Object.assign(Game.prototype, {
  // ------------------------- Boot -------------------------
  // Idempotent: the shell calls it at the end of bindUI(); until then the DOMContentLoaded hook below does.
  initScreens() {
    if (this._screensInited) return;
    this._screensInited = true;
    const $ = (id) => document.getElementById(id);
    const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

    this.screenEls = {
      hudPause: $("hudPause"),
      resumeCard: $("resumeCard"), resumeShip: $("resumeShip"), resumeTitle: $("resumeTitle"), resumeStats: $("resumeStats"),
      btnContinue: $("btnContinue"), btnStart: $("btnStart"), btnResetSave: $("btnResetSave"),
      sectorGrid: $("sectorGrid"), statHigh: $("statHigh"), statUnlocked: $("statUnlocked"),
      btnRecords: $("btnRecords"), btnHelp: $("btnHelp"), btnPauseHelp: $("btnPauseHelp"), btnBriefing: $("btnBriefing"),
      btnMenuSettings: $("btnMenuSettings"), btnHelpClose: $("btnHelpClose"), btnRecordsClose: $("btnRecordsClose"),
      helpModal: $("helpModal"), recordsModal: $("recordsModal"), storyModal: $("storyModal"), confirmModal: $("confirmModal"),
      highScoreTable: $("highScoreTable"),
      btnEndingSkip: $("btnEndingSkip"), btnEndingNext: $("btnEndingNext"), btnNewRun: $("btnNewRun"),
      crtOverlay: $("crtOverlay"), crtNoise: $("crtNoise")
    };

    on(this.screenEls.hudPause, "click", () => { if (typeof this.togglePause === "function") this.togglePause(); });

    if (typeof this.initMenuScreens === "function") this.initMenuScreens();
    if (typeof this.initOnboarding === "function") this.initOnboarding();
    if (typeof this.initCrt === "function") this.initCrt();
    if (typeof this.initEndingControls === "function") this.initEndingControls();

    // Until the loop calls tickUI(raw) every frame, drive it from here.
    this.startScreensTick();
    this.renderMenuScreens(SCREENS_SELF);
  },

  startScreensTick() {
    if (this._screensRaf) return;
    let prev = nowMs();
    const step = (t) => {
      this._screensRaf = requestAnimationFrame(step);
      const dt = clamp((t - prev) / 1000, 0, 0.1);
      prev = t;
      if (this._tickUIFromLoop) return;
      try { this.tickUI(dt, SCREENS_SELF); } catch (err) { console.error("[TypeR] tickUI", err); }
    };
    this._screensRaf = requestAnimationFrame(step);
  },

  // Per-frame DOM-side work in every mode: tutorial toasts, CRT watch, anything time-based on the DOM side.
  // The loop (game.js) calls this right after tickEffects once the shell lands; the self ticker then stops.
  tickUI(dt, src) {
    if (src !== SCREENS_SELF) {
      if (!this._tickUIFromLoop) {
        this._tickUIFromLoop = true;
        if (this._screensRaf) { cancelAnimationFrame(this._screensRaf); this._screensRaf = null; }
      }
    } else if (this._tickUIFromLoop) return;
    const step = clamp(Number(dt) || 0, 0, 0.1);
    if (typeof this.tickCrtWatch === "function") this.tickCrtWatch(step);
    if (typeof this.tickTutorial === "function") this.tickTutorial(step);
  },

  // ------------------------- Menu composition -------------------------
  // = renderSectorGrid + renderResumeCard + stats. refreshMenu() calls it (without the marker) once the shell lands;
  // the run-lifecycle paths call it themselves until then (see 20-run.js stopToMenu).
  renderMenuScreens(src) {
    if (src !== SCREENS_SELF) this._menuScreensHooked = true;
    if (typeof this.renderSectorGrid === "function") this.renderSectorGrid();
    if (typeof this.renderResumeCard === "function") this.renderResumeCard();
    if (typeof this.renderMenuStats === "function") this.renderMenuStats();
  },

  // ------------------------- Shared fallbacks (shell hooks) -------------------------
  // confirm({eyebrow,title,body,okLabel,cancelLabel,danger}) -> Promise<boolean>; the shell's modal when it exists,
  // else a minimal driver of the same #confirmModal markup.
  screensConfirm(opts = {}) {
    if (typeof this.confirm === "function") {
      try { return Promise.resolve(this.confirm(opts)); } catch (err) { return Promise.resolve(false); }
    }
    const modal = this.screenEls && this.screenEls.confirmModal;
    if (!modal) return Promise.resolve(window.confirm(`${opts.title || "Confirm"}\n\n${opts.body || ""}`));
    return new Promise((resolve) => {
      const $ = (id) => document.getElementById(id);
      const title = $("confirmTitle"), body = $("confirmBody"), eyebrow = $("confirmEyebrow");
      const ok = $("btnConfirmOk"), cancel = $("btnConfirmCancel");
      if (title) title.textContent = opts.title || "Confirm";
      if (body) body.textContent = opts.body || "";
      if (eyebrow) eyebrow.textContent = opts.eyebrow || (opts.danger ? "Careful" : "Confirm");
      if (ok) { ok.textContent = opts.okLabel || "OK"; ok.classList.toggle("danger", !!opts.danger); ok.classList.toggle("primary", !opts.danger); }
      if (cancel) cancel.textContent = opts.cancelLabel || "Cancel";
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (ok) ok.removeEventListener("click", onOk);
        if (cancel) cancel.removeEventListener("click", onCancel);
        this.screensCloseModalFallback(modal);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      if (ok) ok.addEventListener("click", onOk);
      if (cancel) cancel.addEventListener("click", onCancel);
      this.screensOpenModalFallback(modal, { initialFocus: opts.danger ? cancel : ok, returnFocusTo: document.activeElement, onClose: () => finish(false) });
    });
  },

  // openModal(el, {returnFocusTo, initialFocus, onClose}) / closeModal(el): the shell's when present.
  screensOpenModal(el, opts = {}) {
    if (!el) return false;
    if (typeof this.openModal === "function") { this.openModal(el, opts); return true; }
    return this.screensOpenModalFallback(el, opts);
  },

  screensCloseModal(el) {
    if (!el) return false;
    if (typeof this.closeModal === "function") { this.closeModal(el); return true; }
    return this.screensCloseModalFallback(el);
  },

  // Minimal modal driver: .is-dismissed/.hidden toggles, a modalStack entry (the shell's key router returns early
  // while the stack is non-empty), Escape closes, focus restored on close.
  screensOpenModalFallback(el, opts = {}) {
    if (!el || el._screensOpen) return false;
    if (!Array.isArray(this.modalStack)) this.modalStack = [];
    el._screensOpen = { returnFocusTo: opts.returnFocusTo || document.activeElement, onClose: opts.onClose || null };
    el.classList.remove("hidden");
    el.classList.remove("is-dismissed");
    el.setAttribute("aria-hidden", "false");
    this.modalStack.push(el);
    const focusEl = typeof opts.initialFocus === "string" ? el.querySelector(opts.initialFocus) : opts.initialFocus;
    const target = focusEl || el.querySelector(".modalActions .btn-arcade:last-child, .modalActions .btn-arcade, button");
    requestAnimationFrame(() => { try { if (target) target.focus({ preventScroll: true }); } catch (_) { /* no focus */ } });
    this.screensBindModalKeys();
    return true;
  },

  screensCloseModalFallback(el) {
    if (!el || !el._screensOpen) return false;
    const state = el._screensOpen;
    el._screensOpen = null;
    el.classList.add("is-dismissed");
    el.setAttribute("aria-hidden", "true");
    if (Array.isArray(this.modalStack)) {
      const i = this.modalStack.indexOf(el);
      if (i >= 0) this.modalStack.splice(i, 1);
    }
    if (state.onClose) { try { state.onClose(); } catch (_) { /* listener error */ } }
    const back = state.returnFocusTo;
    if (back && typeof back.focus === "function" && back.isConnected) {
      try { back.focus({ preventScroll: true }); } catch (_) { /* no focus */ }
    }
    return true;
  },

  screensTopFallbackModal() {
    if (!Array.isArray(this.modalStack) || !this.modalStack.length) return null;
    const top = this.modalStack[this.modalStack.length - 1];
    return top && top._screensOpen ? top : null;
  },

  // Escape closes the top fallback modal; Tab wraps inside it. Registered once, inert while the shell's modals run.
  screensBindModalKeys() {
    if (this._screensModalKeysBound) return;
    this._screensModalKeysBound = true;
    window.addEventListener("keydown", (e) => {
      const top = this.screensTopFallbackModal();
      if (!top) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.screensCloseModalFallback(top);
        return;
      }
      if (e.key === "Tab") {
        const focusable = Array.from(top.querySelectorAll('button:not([disabled]),input:not([disabled]),select,a[href],[tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  },

  screensAnnounce(text) {
    if (typeof this.announce === "function" && text) {
      try { this.announce(text); } catch (_) { /* announcer error */ }
    }
  },

  screensFocusPrimary(mode, fallbackEl) {
    if (typeof this.focusPrimary === "function") {
      try { this.focusPrimary(mode); return; } catch (_) { /* fall through */ }
    }
    if (fallbackEl && this.mode === mode) {
      requestAnimationFrame(() => { try { fallbackEl.focus({ preventScroll: true }); } catch (_) { /* no focus */ } });
    }
  },

  screensUiTick(kind) {
    const sfx = this.sfx;
    if (sfx && typeof sfx.uiTick === "function") { try { sfx.uiTick(kind); } catch (_) { /* audio optional */ } }
  },
});

// Self-boot: bindUI() calls initScreens() once the shell lands; until then run it after every script has executed
// (99-boot.js constructs the game synchronously, so window.game exists by DOMContentLoaded).
if (typeof document !== "undefined") {
  const bootScreens = () => {
    const g = window.game;
    if (g && typeof g.initScreens === "function") {
      try { g.initScreens(); } catch (err) { console.error("[TypeR] initScreens", err); }
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootScreens);
  else setTimeout(bootScreens, 0);
}
