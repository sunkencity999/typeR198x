// Type-R 198X — screens: title cabinet (resume card, sector grid, records), results cards, onboarding toasts, the
// CRT overlay layers and the typewriter. Methods are mixed into Game.prototype; load order is defined in index.html
// (right after 10-ui.js, before 20-run.js).
//
// Shell hooks (openModal / closeModal / confirm / announce / focusPrimary / openSettingsModal, the loop's tickUI(raw),
// refreshMenu's renderMenuScreens(), bindUI's initScreens()) are called through the screens* wrappers below, which
// null-guard the shell so a probe page without it still runs. The keydown fallbacks that duplicated the shell's
// router (menu Enter, ? / F1, ending keys) are gone: 30-input.js owns every key.

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

    // #hudPause and #btnPauseHelp are bound by the shell (bindUI).

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

  // openModal(el, {returnFocusTo, initialFocus, onClose}) / closeModal(el): the shell's when present. initialFocus /
  // returnFocusTo may be selectors here; the shell wants elements (a string reached its .hasAttribute and threw,
  // leaving the modal on the stack and every key swallowed: E2).
  screensOpenModal(el, opts = {}) {
    if (!el) return false;
    const o = { ...opts };
    if (typeof o.initialFocus === "string") o.initialFocus = el.querySelector(o.initialFocus) || null;
    if (typeof o.returnFocusTo === "string") o.returnFocusTo = document.querySelector(o.returnFocusTo) || null;
    if (!o.primary && o.initialFocus) o.primary = o.initialFocus;
    if (typeof this.openModal === "function") { this.openModal(el, o); return true; }
    return this.screensOpenModalFallback(el, o);
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
    el._screensOpen = { returnFocusTo: opts.returnFocusTo || document.activeElement, onClose: opts.onClose || null, hadHidden: el.classList.contains("hidden") };
    el.classList.remove("hidden");
    el.classList.remove("is-dismissed");
    el.setAttribute("aria-hidden", "false");
    this.modalStack.push(el);
    const focusEl = typeof opts.initialFocus === "string" ? el.querySelector(opts.initialFocus) : opts.initialFocus;
    const target = focusEl || el.querySelector(".modalActions .btn-arcade:last-child, .modalActions .btn-arcade, button");
    // The overlay's visibility transition keeps its content unfocusable for the first frame: retry until it sticks.
    let tries = 0;
    const tryFocus = () => {
      if (!el._screensOpen || !target) return;
      try { target.focus({ preventScroll: true }); } catch (_) { /* not focusable yet */ }
      if (document.activeElement !== target && ++tries < 30) requestAnimationFrame(tryFocus);
    };
    requestAnimationFrame(tryFocus);
    this.screensBindModalKeys();
    return true;
  },

  screensCloseModalFallback(el) {
    if (!el || !el._screensOpen) return false;
    const state = el._screensOpen;
    el._screensOpen = null;
    if (state.hadHidden) { el.classList.add("hidden"); el.classList.remove("is-dismissed"); }
    else el.classList.add("is-dismissed");
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
        const focusable = Array.from(top.querySelectorAll('button:not([disabled]),input:not([disabled]),select,a[href],[tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null && n.tabIndex >= 0);   // review R20
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

// ------------------------- Title cabinet (C5 / VIS-11 / UX-02 / UX-03 / SYS-12) -------------------------
// renderSectorGrid(): ten .sectorCard tiles from save.lastUnlockedLevel / save.sectorBests with roving tabindex;
// renderResumeCard(): "Resume Sector N" for a live run, "Replay Sector N" for a saved death; renderMenuStats();
// records modal (top-10 with the B-12 tag column); Start / Reset confirm guards. #btnBriefing is the shell's
// (showStoryModal({launch:false}) in bindUI relabels Launch to Close and hides Back).
const SECTOR_TAG = (h) => (h.levelReached === 11 ? "LEGEND" : (h.startLevel > 1 ? `FROM S${h.startLevel}` : "FULL"));

function screensCompact(n) {
  const v = Math.max(0, n | 0);
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return formatInt(v);
}

function screensEscape(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

Object.assign(Game.prototype, {
  initMenuScreens() {
    const E = this.screenEls || {};
    const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
    on(E.btnRecords, "click", () => this.openRecords());
    on(E.btnRecordsClose, "click", () => this.closeRecords());
    on(E.btnHelp, "click", () => { if (typeof this.openHelp === "function") this.openHelp(); });
    on(E.btnHelpClose, "click", () => { if (typeof this.closeHelp === "function") this.closeHelp(); });
    // Re-read briefing (C5): the shell's read-only story (Launch relabelled Close, Back hidden, no storySeen write).
    on(E.btnBriefing, "click", () => { if (typeof this.showStoryModal === "function") this.showStoryModal({ launch: false }); });
    on(E.btnMenuSettings, "click", () => this.openSettingsFromMenu());
    on(E.sectorGrid, "click", (e) => {
      const card = e.target && e.target.closest ? e.target.closest(".sectorCard") : null;
      if (!card || card.disabled || card.getAttribute("aria-disabled") === "true") return;
      this.enterSectorFromMenu(Number(card.dataset.level) - 1);
    });
    on(E.sectorGrid, "keydown", (e) => this.onSectorGridKey(e));

    // Destructive actions confirm first. The guards run in the capture phase ahead of the shell's handlers and
    // step aside when the shell marks its own handler as confirming (startHandlesConfirm / resetHandlesConfirm).
    this.guardClick(E.btnStart, () => !this.startHandlesConfirm && this.runHasProgress(this.save.run), () => {
      const run = this.save.run;
      return {
        eyebrow: "Saved run", title: "Abandon current run?",
        body: `Sector ${(run.levelIndex | 0) + 1}, ${formatInt((run.stats && run.stats.score) | 0)} pts. Starting a new run replaces it.`,
        okLabel: "Start new run", cancelLabel: "Keep my run", danger: true
      };
    });
    this.guardClick(E.btnResetSave, () => !this.resetHandlesConfirm, () => ({
      eyebrow: "Reset save", title: "Erase all progress?",
      body: "High scores, sector bests, unlocked sectors and settings on this device will be reset.",
      okLabel: "Erase everything", cancelLabel: "Keep my save", danger: true
    }), () => this.renderMenuScreens(SCREENS_SELF));

  },

  guardClick(btn, needsConfirm, makeOpts, afterPass) {
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      if (btn._screensPass) { btn._screensPass = false; return; }
      let need = false;
      try { need = !!needsConfirm(); } catch (_) { need = false; }
      if (!need) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.screensConfirm(makeOpts()).then((ok) => {
        if (!ok) { this.screensUiTick("back"); return; }
        this.screensUiTick("confirm");
        btn._screensPass = true;
        btn.click();
        if (typeof afterPass === "function") afterPass();
      });
    }, true);
  },

  // A run worth a confirm: anything typed, any sector entered, or a saved death (its checkpoint still counts).
  runHasProgress(run) {
    if (!run) return false;
    const dead = (Number.isFinite(run.hp) ? run.hp : 1) <= 0;
    const score = (run.stats && run.stats.score) | 0;
    return dead || (run.levelT || 0) > 0 || !!run.inBoss || score > 0 || (run.levelIndex | 0) > ((run.startLevel | 0) - 1);
  },

  // ------------------------- Sector grid -------------------------
  renderSectorGrid() {
    const grid = this.screenEls && this.screenEls.sectorGrid;
    if (!grid) return;
    const save = this.save;
    const unlocked = clamp((save.lastUnlockedLevel | 0) || 1, 1, 10);
    const bests = save.sectorBests || {};
    const run = save.run;
    let cards = Array.from(grid.querySelectorAll(".sectorCard"));
    if (cards.length !== LEVELS.length) {
      grid.textContent = "";
      cards = LEVELS.map((cfg) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sectorCard";
        b.dataset.level = String(cfg.level);
        b.innerHTML = '<span class="sectorNum"></span><span class="sectorBoss"></span><span class="sectorStatus"></span>';
        grid.appendChild(b);
        return b;
      });
    }
    let focusIndex = -1;
    cards.forEach((card, i) => {
      const L = i + 1;
      const cfg = LEVELS[i];
      const best = bests[String(L)];
      const locked = L > unlocked;
      const cleared = !!best;
      const current = !locked && !cleared && L === unlocked;
      const saved = !!run && (run.levelIndex | 0) === i;
      let accent = "cyan";
      try { accent = (typeof getThemeForLevel === "function" && getThemeForLevel(i).accent) || "cyan"; } catch (_) { accent = "cyan"; }
      card.dataset.level = String(L);
      card.className = `sectorCard${cleared ? " is-cleared" : ""}${current ? " is-current" : ""}${locked ? " is-locked" : ""}${saved ? " is-saved" : ""}`;
      card.disabled = locked;
      card.setAttribute("aria-disabled", locked ? "true" : "false");
      card.style.setProperty("--sector-accent", `var(--neon-${accent})`);
      const num = card.querySelector(".sectorNum"), boss = card.querySelector(".sectorBoss"), status = card.querySelector(".sectorStatus");
      if (num) num.textContent = String(L).padStart(2, "0");
      if (boss) boss.textContent = cfg.bossName;
      let aria = `Sector ${L}, ${cfg.bossName}`;
      if (status) {
        if (cleared) {
          const rank = best.rank || "C";
          status.innerHTML = `<span class="rankBadge" data-rank="${screensEscape(rank)}">${screensEscape(rank)}</span><span class="sectorBest mono">${screensEscape(screensCompact(best.score))}</span>`;
          aria += `, cleared, rank ${rank}, best ${formatInt(best.score | 0)}`;
        } else if (current) {
          status.textContent = saved ? "RESUME" : "NEXT";
          aria += saved ? ", saved run" : ", next";
        } else if (locked) {
          status.textContent = "";
          aria += ", locked";
        } else {
          status.textContent = "CLEARED";
          aria += ", cleared";
        }
      }
      card.setAttribute("aria-label", aria);
      if (!locked && (current || focusIndex < 0 || L === unlocked)) focusIndex = i;
    });
    cards.forEach((card, i) => card.setAttribute("tabindex", i === focusIndex ? "0" : "-1"));
  },

  // Roving focus: arrows move ±1 / ±5, Home / End jump; locked tiles are skipped over.
  onSectorGridKey(e) {
    const grid = this.screenEls && this.screenEls.sectorGrid;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll(".sectorCard"));
    const cur = cards.indexOf(document.activeElement);
    if (cur < 0) return;
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
    let next = -1;
    if (delta) {
      let j = cur + delta;
      while (j >= 0 && j < cards.length && cards[j].disabled) j += Math.sign(delta) * (Math.abs(delta) === 5 ? 5 : 1);
      if (j >= 0 && j < cards.length) next = j;
    } else if (e.key === "Home") next = cards.findIndex((c) => !c.disabled);
    else if (e.key === "End") { for (let j = cards.length - 1; j >= 0; j--) if (!cards[j].disabled) { next = j; break; } }
    if (next < 0) return;
    e.preventDefault();
    cards.forEach((c, i) => c.setAttribute("tabindex", i === next ? "0" : "-1"));
    try { cards[next].focus({ preventScroll: true }); } catch (_) { /* no focus */ }
  },

  // Sector tile -> confirm when a run is at stake -> audio unlock -> startSector(i) (20-run.js).
  async enterSectorFromMenu(levelIndex) {
    if (this._sectorEntering) return false;
    this._sectorEntering = true;
    try {
      const i = clamp(levelIndex | 0, 0, 9);
      if (i + 1 > ((this.save.lastUnlockedLevel | 0) || 1)) return false;
      const run = this.save.run;
      if (run && this.runHasProgress(run)) {
        const ok = await this.screensConfirm({
          eyebrow: "Saved run", title: `Start Sector ${i + 1} fresh?`,
          body: `Your saved run (Sector ${(run.levelIndex | 0) + 1}, ${formatInt((run.stats && run.stats.score) | 0)} pts) will be replaced.`,
          okLabel: `Start Sector ${i + 1}`, cancelLabel: "Keep my run", danger: true
        });
        if (!ok) { this.screensUiTick("back"); return false; }
      }
      const name = (this.ui && this.ui.playerName && this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.screensUiTick("confirm");
      if (typeof this.ensureAudio === "function") await this.ensureAudio();
      // A fresh pilot's first sector goes through the briefing like Start does.
      if (i === 0 && !this.save.storySeen && this.storyModal && typeof this.showStoryModal === "function") {
        this.commitHighScore();
        this.save.run = null;
        this.run = null;
        storeSave(this.save);
        this.pendingLaunch = "new";
        this.showStoryModal();
        return true;
      }
      this.startSector(i);
      if (typeof this.focusGameCanvas === "function") this.focusGameCanvas();
      return true;
    } finally {
      this._sectorEntering = false;
    }
  },

  // ------------------------- Resume card -------------------------
  renderResumeCard() {
    const E = this.screenEls || {};
    const card = E.resumeCard;
    if (!card) return;
    const run = this.save.run;
    const show = !!run && this.runHasProgress(run);
    card.classList.toggle("hidden", !show);
    if (E.btnStart) {
      const labelEl = E.btnStart.querySelector(".btnLabel") || E.btnStart;
      const label = (show || (this.save.victories | 0) > 0) ? "NEW RUN" : "START NEW RUN";
      if (E.btnStart.getAttribute("aria-busy") === "true") E.btnStart.dataset.idleLabel = label;
      else if (labelEl.textContent !== label) labelEl.textContent = label;
    }
    if (!show) return;
    const i = clamp(run.levelIndex | 0, 0, 9);
    const L = i + 1;
    const cfg = LEVELS[i];
    const dead = (Number.isFinite(run.hp) ? run.hp : 1) <= 0;
    const bossRetry = dead && !!(run.inBoss && run.bossCheckpoint && run.boss);
    const cp = (bossRetry ? run.bossCheckpoint : run.checkpoint) || null;
    const stats = run.stats || {};
    const acc = (stats.total | 0) > 0 ? Math.round((stats.correct / stats.total) * 100) : 100;
    const clearedInRun = Math.max(0, i - ((run.startLevel | 0) - 1));
    const shipId = run.shipId || this.getSelectedShipId();
    card.dataset.state = dead ? "dead" : "live";
    const label = card.querySelector(".resumeMeta .label");
    if (label) label.textContent = dead ? "Signal lost" : (run.inBoss ? "Saved run · in the boss" : "Saved run");
    if (E.resumeTitle) E.resumeTitle.textContent = `Sector ${L}`;
    if (E.resumeStats) {
      const where = `${cfg.bossName} · ${screensShipName(shipId)}`;
      const numbers = dead
        ? `Checkpoint ${formatInt(cp ? cp.score | 0 : 0)} pts · ${bossRetry ? `boss phase ${((cp && cp.bossPhase) | 0) + 1}` : "sector start"} · HP ${run.maxHp}/${run.maxHp}`
        : `${formatInt(stats.score | 0)} pts · ${acc}% acc · HP ${Math.round(run.hp)}/${run.maxHp} · ${clearedInRun} sector${clearedInRun === 1 ? "" : "s"} cleared this run`;
      E.resumeStats.textContent = `${where}\n${numbers}`;
    }
    if (E.btnContinue) {
      const btnLabel = E.btnContinue.querySelector(".btnLabel") || E.btnContinue;
      const text = `${dead ? (bossRetry ? "Retry boss" : "Replay") : "Resume"} Sector ${L}`;
      if (E.btnContinue.getAttribute("aria-busy") === "true") E.btnContinue.dataset.idleLabel = text;
      else if (btnLabel.textContent !== text) btnLabel.textContent = text;
      E.btnContinue.disabled = false;
      E.btnContinue.classList.remove("disabled");
    }
    if (E.resumeShip) {
      const src = screensShipSrc(shipId);
      if (src && E.resumeShip.getAttribute("src") !== src) E.resumeShip.src = src;
      E.resumeShip.alt = screensShipName(shipId);
    }
  },

  renderMenuStats() {
    const E = this.screenEls || {};
    const save = this.save;
    if (E.statHigh) E.statHigh.textContent = formatInt(save.highScore || 0);
    const unlocked = clamp((save.lastUnlockedLevel | 0) || 1, 1, 10);
    const bestCount = Object.keys(save.sectorBests || {}).filter((k) => save.sectorBests[k]).length;
    const cleared = (save.victories | 0) > 0 ? 10 : Math.min(10, Math.max(bestCount, unlocked - 1));
    if (E.statUnlocked) E.statUnlocked.textContent = `${cleared}/10`;
  },

  // ------------------------- Records -------------------------
  renderRecordsTable() {
    const table = this.screenEls && this.screenEls.highScoreTable;
    if (!table) return;
    const tbody = table.querySelector("tbody") || table;
    const rows = (Array.isArray(this.save.highScores) ? this.save.highScores : [])
      .filter((h) => h && typeof h === "object")
      .slice()
      .sort((a, b) => ((b.score | 0) - (a.score | 0)) || ((b.date | 0) - (a.date | 0)))
      .slice(0, 10);
    if (!rows.length) {
      tbody.innerHTML = '<tr class="hsRow hsEmpty"><td colspan="6">No runs recorded yet. Clear a sector to enter the hall.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((h, i) => {
      const tag = SECTOR_TAG(h);
      const sector = h.levelReached === 11 ? "ALL" : String(h.levelReached | 0 || 1);
      return `<tr class="hsRow${tag === "LEGEND" ? " is-legend" : ""}"><td>${i + 1}</td><td>${screensEscape(h.name || "PILOT")}</td><td>${formatInt(h.score | 0)}</td><td>${sector}</td><td>${h.wpm | 0}</td><td><span class="hsTag" data-tag="${screensEscape(tag)}">${screensEscape(tag)}</span></td></tr>`;
    }).join("");
  },

  openRecords() {
    const E = this.screenEls || {};
    if (!E.recordsModal) return;
    this.renderRecordsTable();
    this.screensOpenModal(E.recordsModal, { returnFocusTo: E.btnRecords, initialFocus: "#btnRecordsClose" });
  },

  closeRecords() {
    const E = this.screenEls || {};
    this.screensCloseModal(E.recordsModal);
  },

  openSettingsFromMenu() {
    if (typeof this.openSettingsModal === "function") { this.openSettingsModal(); return; }
    const btn = document.getElementById("btnSettings");
    if (btn) btn.click();
  },
});

// ------------------------- Onboarding (C8 / UX-11) -------------------------
// Tutorial tips are driven from tickTutorial(dt) by polling game state (no hooks in other tracks' files): first
// enemy on screen (t >= 1 s), first lock, first powerup on screen, boss intro end, first lock loss, the accuracy tip
// after a sector-1 death below 70 %. Flags live in save.tutorialSeen; everything is suppressed for returning players
// (lastUnlockedLevel > 1), deferred behind the sector card, DROPPED (never queued) while a boss intro or the finale
// is on, and cleared outside play. The boss tip itself waits for the intro to end.
const TUTORIAL_TIPS = {
  lock: { text: "TYPE THE FIRST LETTER OF A TARGET TO LOCK ON", ms: 4000 },
  finish: { text: "KEEP TYPING TO FINISH IT", ms: 2600 },
  powerup: { text: (label) => `TYPE ${String(label || "").toUpperCase()} TO GRAB IT`, ms: 3500 },
  boss: { text: "BOSS: TYPE THE HIGHLIGHTED WORD — MINIONS COUNT TOO", ms: 4000 },
  release: { text: "LOCK LOST — 3 MISSES DROP A LOCK, SPACE OR BACKSPACE RELEASES IT", ms: 3200 },
  accuracy: { text: "TIP: ACCURACY BEATS SPEED — EVERY TYPO BREAKS THE COMBO", ms: 4500 }
};
const TUTORIAL_KEY = "tut";

Object.assign(Game.prototype, {
  initOnboarding() {
    this._tut = { shown: {}, prevLock: null, prevCorrect: null, prevMisses: null, prevKills: null, prevMode: null, watchPowerup: null, visible: false };
  },

  tutorialEnabled() {
    return !!this.save && ((this.save.lastUnlockedLevel | 0) || 1) <= 1;
  },

  markTutorial(kind) {
    if (!this.save.tutorialSeen || typeof this.save.tutorialSeen !== "object") this.save.tutorialSeen = {};
    if (this.save.tutorialSeen[kind]) return;
    this.save.tutorialSeen[kind] = true;
    storeSave(this.save);
  },

  tutorialToast(kind, text, ms) {
    if (!this._tut) return;
    this._tut.shown[kind] = true;
    this._tut.visible = true;
    if (typeof this.showToast === "function") this.showToast(text, { kind: "tip", key: TUTORIAL_KEY, ms });
  },

  dismissTutorialToast() {
    if (!this._tut || !this._tut.visible) return;
    this._tut.visible = false;
    if (typeof this.dismissToast === "function") this.dismissToast(TUTORIAL_KEY);
  },

  hasEnemyOnScreen() {
    for (const en of this.enemies) {
      if (!en.alive || en.dying) continue;
      if (typeof this.isEntityVisible === "function" ? this.isEntityVisible(en) : en.x < this.w + 40) return true;
    }
    return false;
  },

  firstPowerupOnScreen() {
    for (const p of this.powerups) {
      if (!p.alive || p.dying) continue;
      if (typeof this.isEntityVisible === "function" ? this.isEntityVisible(p) : p.x < this.w + 40) return p;
    }
    return null;
  },

  tickTutorial(dt) {
    const T = this._tut;
    if (!T) return;
    const mode = this.mode;
    if (mode !== "playing") {
      if (T.prevMode === "playing") this.dismissTutorialToast();
      T.prevMode = mode;
      T.prevLock = null;
      T.prevCorrect = null;
      T.prevMisses = null;
      T.prevKills = null;
      return;
    }
    T.prevMode = mode;
    const seen = (this.save && this.save.tutorialSeen) || {};
    const lock = this.lock;
    const st = this.stats || {};
    const correct = st.correct | 0, misses = st.misses | 0, kills = st.kills | 0;
    if (T.prevCorrect === null) { T.prevCorrect = correct; T.prevMisses = misses; T.prevKills = kills; }
    // Keystrokes land between frames, so the counters carry the events: the first correct key in wave play IS a lock
    // (single-letter targets lock and die inside one keystroke), a kill is a finished target, and a miss that leaves
    // the previous target alive at progress 0 is a lost lock.
    const firstCorrect = correct > T.prevCorrect && !this.inBoss;
    const killed = kills > T.prevKills;
    const prevRef = T.prevLock && T.prevLock.ref;
    const lost = !!(T.prevLock && !lock && misses > T.prevMisses && prevRef && prevRef.alive && !prevRef.dying && (prevRef.progress | 0) === 0);

    // Progress flags are tracked whether or not a tip is on screen.
    if (firstCorrect && !seen.lock) this.markTutorial("lock");
    if (killed && !seen.finish && !this.inBoss) this.markTutorial("finish");
    if (T.watchPowerup && T.watchPowerup.alive === false) {
      if ((T.watchPowerup.progress | 0) >= (T.watchPowerup.label || "").length && !seen.powerup) this.markTutorial("powerup");
      T.watchPowerup = null;
    }

    // Boss intro (the whole ceremony, not only the locked part) and the finale: no event tip appears and one already
    // on screen goes away when the intro locks or the finale starts; the events of those frames are consumed below,
    // so nothing is queued for afterwards. The boss tip itself shows the moment the intro unlocks.
    const introLocked = !!(this.bossIntro && this.bossIntro.locked);
    if (introLocked || this.bossClear) this.dismissTutorialToast();
    const gated = !!this.levelIntro || !!this.bossIntro || !!this.bossClear;
    const enabled = this.tutorialEnabled();
    if (enabled && !seen.boss && !T.shown.boss && this.inBoss && this.boss && !introLocked && !this.bossClear) {
      this.tutorialToast("boss", TUTORIAL_TIPS.boss.text, TUTORIAL_TIPS.boss.ms);
      this.markTutorial("boss");
    }
    if (enabled && !gated) {
      const levelT = this.levelT || 0;
      if (!seen.lock && !T.shown.lock && !lock && this.levelIndex === 0 && levelT >= 1 && this.hasEnemyOnScreen()) {
        this.tutorialToast("lock", TUTORIAL_TIPS.lock.text, TUTORIAL_TIPS.lock.ms);
      }
      // The lock landed on a word (still alive): teach the finish; a letter target already taught it by dying.
      if (!seen.finish && !T.shown.finish && firstCorrect && lock && lock.kind === "enemy") {
        this.tutorialToast("finish", TUTORIAL_TIPS.finish.text, TUTORIAL_TIPS.finish.ms);
      }
      if (!seen.powerup && !T.shown.powerup && !T.watchPowerup) {
        const p = this.firstPowerupOnScreen();
        if (p) {
          this.tutorialToast("powerup", TUTORIAL_TIPS.powerup.text(p.label), TUTORIAL_TIPS.powerup.ms);
          T.watchPowerup = p;
        }
      }
      if (!seen.release && !T.shown.release && lost) {
        this.tutorialToast("release", TUTORIAL_TIPS.release.text, TUTORIAL_TIPS.release.ms);
        this.markTutorial("release");
      }
      if (this._accuracyTipPending && !seen.accuracy && !T.shown.accuracy && levelT >= 0.5) {
        this._accuracyTipPending = false;
        this.tutorialToast("accuracy", TUTORIAL_TIPS.accuracy.text, TUTORIAL_TIPS.accuracy.ms);
        this.markTutorial("accuracy");
      }
    }
    T.prevLock = lock;
    T.prevCorrect = correct;
    T.prevMisses = misses;
    T.prevKills = kills;
  },

  // ------------------------- Help (pilot manual) -------------------------
  openHelp() {
    const E = this.screenEls || {};
    const modal = E.helpModal;
    if (!modal) return;
    if (modal._screensOpen || (Array.isArray(this.modalStack) && this.modalStack.includes(modal))) return;
    if (this.mode === "playing" && typeof this.togglePause === "function") this.togglePause();
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : (this.mode === "paused" ? E.btnPauseHelp : E.btnHelp);
    this.screensOpenModal(modal, { returnFocusTo: opener, initialFocus: "#btnHelpClose" });
    if (typeof this.openModal !== "function") this.screensScrollAffordance(modal);
  },

  closeHelp() {
    const E = this.screenEls || {};
    this.screensCloseModal(E.helpModal);
  },

  // .modalScroll.is-scrollable / .at-bottom drive the fade + "scroll" hint (ui-HANDOFF section 1) in the fallback path.
  screensScrollAffordance(modal) {
    const scroll = modal.querySelector(".modalScroll");
    const body = modal.querySelector(".modalBody");
    if (!scroll || !body) return;
    const update = () => {
      scroll.classList.toggle("is-scrollable", body.scrollHeight > body.clientHeight + 2);
      scroll.classList.toggle("at-bottom", body.scrollTop + body.clientHeight >= body.scrollHeight - 2);
    };
    if (!body._screensScrollBound) {
      body._screensScrollBound = true;
      body.addEventListener("scroll", update, { passive: true });
    }
    requestAnimationFrame(update);
  },
});

// ------------------------- Results cards (C4 / UX-08 / SYS-11) -------------------------
// renderResultsCard(cardEl, results, {animate}) fills the CONTRACT 2.1 markup from buildResults() output:
// six tiles count up over 600 ms (easeOutCubic, 80 ms stagger, a tallyTick per visible step), the rank badge
// stamps in at 700 ms (180 ms pop + rankStamp), badges newBest / newHigh / newWpm, bonus rows from the tally.
// animate:false or reduced motion -> every value is final on the first frame.
const RESULTS_COUNT_MS = 600;
const RESULTS_STAGGER_MS = 80;
const RESULTS_RANK_AT_MS = 700;
const RESULTS_RANK_POP_MS = 180;
const RESULTS_TICK_MIN_MS = 45;
const RANK_TITLES = { S: "FLAWLESS SIGNAL", A: "CLEAN SWEEP", B: "SOLID FLYING", C: "ROUGH PASSAGE", D: "BARELY THROUGH" };

Object.assign(Game.prototype, {
  resultsTitleFor(results) {
    if (results.scope === "run") return "LEGEND STATUS GRANTED";
    if (results.scope === "over") return "RUN REPORT";
    return RANK_TITLES[results.rank] || `SECTOR ${results.level} REPORT`;
  },

  resultsSubFor(results) {
    const ship = screensShipName(this.currentShipId ? this.currentShipId() : (this.player && this.player.shipId));
    if (results.scope === "run") return `All ten sectors · ${this.save.playerName || "PILOT"}`;
    if (results.scope === "over") {
      const start = (this.runMeta && this.runMeta.startLevel) || results.level;
      return start < results.level ? `Sectors ${start}–${results.level} · ${ship}` : `Sector ${results.level} · ${ship}`;
    }
    const retries = results.retries | 0;
    return `Sector ${results.level} · ${ship}${retries > 0 ? ` · retry ×${retries}` : ""}`;
  },

  renderResultsCard(cardEl, results, opts = {}) {
    if (!cardEl || !results) return;
    this.cancelResultsAnimation(cardEl);
    const animate = opts.animate !== false && !screensReducedMotion(this);
    const q = (sel) => cardEl.querySelector(sel);
    const level = results.scope === "level";
    const rank = results.rank || "C";
    cardEl.dataset.rank = rank;
    cardEl.dataset.scope = results.scope || "level";

    const title = q(".resultsTitle");
    const sub = q(".resultsHead .resultsSub");
    if (title) title.textContent = this.resultsTitleFor(results);
    if (sub) sub.textContent = this.resultsSubFor(results);
    const toggle = (sel, on) => { const el = q(sel); if (el) el.classList.toggle("hidden", !on); };
    toggle(".newBest", level && !!results.newSectorBest);
    toggle(".newHigh", !!results.newHigh);
    toggle(".newWpm", !!results.newWpm && (results.wpm | 0) > 0);

    const tally = level ? (this.lastTally || null) : null;
    const bonusTotal = tally ? (tally.total | 0) : 0;
    const tiles = {
      wpm: { to: results.wpm | 0, fmt: (n) => String(Math.round(n)) },
      acc: { to: Number(results.acc) || 0, fmt: (n) => `${Math.round(n)}%` },
      maxCombo: { to: results.maxCombo | 0, fmt: (n) => `x${Math.round(n)}` },
      words: { to: results.words | 0, fmt: (n) => String(Math.round(n)) },
      time: { to: results.timeMs | 0, fmt: (n) => screensFormatTime(n) },
      bonus: { to: bonusTotal, fmt: (n) => `+${formatInt(Math.round(n))}` },
      score: { to: results.score | 0, fmt: (n) => formatInt(Math.round(n)) }
    };
    const anim = cardEl._resultsAnim = { counts: [], timers: [] };
    let i = 0;
    for (const el of cardEl.querySelectorAll(".statTile__value[data-stat]")) {
      const t = tiles[el.dataset.stat];
      if (!t) continue;
      el.classList.remove("is-counting");
      if (animate && t.to > 0) {
        anim.counts.push(this.animateCount(el, 0, t.to, RESULTS_COUNT_MS, { delay: i * RESULTS_STAGGER_MS, format: t.fmt, tick: true }));
      } else {
        el.textContent = t.fmt(t.to);
      }
      i++;
    }

    const list = q(".bonusList");
    if (list) {
      list.textContent = "";
      const lines = level && Array.isArray(results.bonusLines) ? results.bonusLines : [];
      for (const row of lines) {
        const li = document.createElement("li");
        li.className = "bonusRow";
        const label = document.createElement("span");
        label.className = "bonusLabel";
        label.textContent = row.label;
        const value = document.createElement("span");
        value.className = "bonusValue mono";
        if (typeof row.value === "number") value.textContent = `+${formatInt(row.value)}`;
        else { value.textContent = String(row.value); li.classList.add("bonusRow--penalty"); }
        li.append(label, value);
        list.appendChild(li);
      }
    }

    const badge = q(".rankBadge");
    if (badge) {
      badge.dataset.rank = rank;
      badge.textContent = rank;
      badge.classList.remove("stamp");
      badge.classList.toggle("is-pending", animate);
      if (animate) {
        // The frame holds its place from the first frame (dim, unstamped); the letter stamps in at 700 ms.
        anim.timers.push(setTimeout(() => {
          badge.classList.remove("is-pending");
          badge.classList.add("stamp");
          const sfx = this.sfx;
          if (sfx) {
            if (typeof sfx.rankStamp === "function") sfx.rankStamp();
            else if (typeof sfx.uiTick === "function") sfx.uiTick("stamp");
          }
          anim.timers.push(setTimeout(() => badge.classList.remove("stamp"), RESULTS_RANK_POP_MS));
        }, RESULTS_RANK_AT_MS));
      }
    }
  },

  cancelResultsAnimation(cardEl) {
    const anim = cardEl && cardEl._resultsAnim;
    if (!anim) return;
    for (const c of anim.counts) if (c && typeof c.cancel === "function") c.cancel();
    for (const t of anim.timers) clearTimeout(t);
    const badge = cardEl.querySelector(".rankBadge");
    if (badge) badge.classList.remove("is-pending", "stamp");
    cardEl._resultsAnim = null;
  },

  // Count el from `from` to `to` over ms (easeOutCubic) after an optional delay. Returns { cancel(), done }.
  animateCount(el, from, to, ms, opts = {}) {
    const handle = { done: false, cancel() { handle.done = true; if (handle.raf) cancelAnimationFrame(handle.raf); el.classList.remove("is-counting"); } };
    if (!el) { handle.done = true; return handle; }
    const format = typeof opts.format === "function" ? opts.format : (n) => String(Math.round(n));
    const delay = Math.max(0, opts.delay || 0);
    const total = Math.max(1, ms || RESULTS_COUNT_MS);
    const ease = typeof easeOutCubic === "function" ? easeOutCubic : (t) => 1 - Math.pow(1 - t, 3);
    let start = null;
    let last = null;
    el.textContent = format(from);
    el.classList.add("is-counting");
    const step = (t) => {
      if (handle.done) return;
      if (start === null) start = t + delay;
      const k = clamp((t - start) / total, 0, 1);
      const v = from + (to - from) * ease(k);
      const text = format(v);
      if (text !== last) {
        last = text;
        el.textContent = text;
        if (opts.tick && k > 0) this.resultsTallyTick();
      }
      if (k >= 1) {
        handle.done = true;
        el.classList.remove("is-counting");
        if (typeof opts.onDone === "function") opts.onDone();
        return;
      }
      handle.raf = requestAnimationFrame(step);
    };
    handle.raf = requestAnimationFrame(step);
    return handle;
  },

  // One tallyTick per visible step across all counting tiles, at most every RESULTS_TICK_MIN_MS.
  resultsTallyTick() {
    const sfx = this.sfx;
    if (!sfx) return;
    const now = nowMs();
    if (now - (this._tallyTickAt || 0) < RESULTS_TICK_MIN_MS) return;
    this._tallyTickAt = now;
    try {
      if (typeof sfx.tallyTick === "function") sfx.tallyTick();
      else if (typeof sfx.uiTick === "function") sfx.uiTick("count");
    } catch (_) { /* audio optional */ }
  },

  // ------------------------- Ending controls (victory) -------------------------
  // #btnEndingSkip and a click on the transmission window are ours; #btnEndingNext and the keys (Enter advances,
  // Escape skips) are the shell's (bindUI / onKeyDown).
  initEndingControls() {
    const E = this.screenEls || {};
    if (E.btnEndingSkip && !E.btnEndingSkip._screensBound) {
      E.btnEndingSkip._screensBound = true;
      E.btnEndingSkip.addEventListener("click", () => this.skipEndingDialogue());
    }
    const win = document.querySelector("#screenVictory .dialogueWindow");
    if (win) win.addEventListener("click", () => { if (this.mode === "victory") this.advanceEndingDialogue(); });
  },
});

// ------------------------- CRT overlay v2 (D9 / VIS-12) -------------------------
// Three CSS layers (#crtShade normal-blend vignette, #crtLines screen-blend scanlines + grille + rolling band,
// #crtNoise tiled from makeNoiseTile()). JS owns: the noise tile, documentElement.dataset.crt + --crt-k from
// save.settings (the shell's applySettings writes the same values once it lands), crtTear() for 120 ms on real HP
// loss (takeDamage calls it once the plates track lands; tickCrtWatch covers it until then).
const CRT_TEAR_MS = 120;
const CRT_NOISE_SIZE = 128;
const CRT_NOISE_ALPHA = 0.35;

Object.assign(Game.prototype, {
  initCrt() {
    const E = this.screenEls || {};
    if (E.crtNoise) {
      const url = this.makeNoiseTile();
      if (url) E.crtNoise.style.backgroundImage = `url("${url}")`;
    }
    this._crtWatch = { hp: this.player ? this.player.hp : null, crt: undefined, k: undefined, tearAt: -Infinity };
    this.applyCrtSettings();
    // Every applySettings() pass re-applies the CRT state; identical to what the shell writes, so a double write is harmless.
    if (!this._crtWrapped && typeof this.applySettings === "function") {
      this._crtWrapped = true;
      const orig = this.applySettings;
      this.applySettings = (...args) => {
        const r = orig.apply(this, args);
        this.applyCrtSettings();
        return r;
      };
    }
  },

  // :root[data-crt=on|off] + --crt-k (0.25..1, default .75) from save.settings.
  applyCrtSettings() {
    const s = (this.save && this.save.settings) || {};
    const on = s.crt !== false;
    const k = clamp(Number.isFinite(s.crtIntensity) ? s.crtIntensity : 0.75, 0.25, 1);
    const root = document.documentElement;
    const crt = on ? "on" : "off";
    if (root.dataset.crt !== crt) root.dataset.crt = crt;
    const kStr = String(Math.round(k * 100) / 100);
    if (root.style.getPropertyValue("--crt-k").trim() !== kStr) root.style.setProperty("--crt-k", kStr);
    if (this._crtWatch) { this._crtWatch.crt = s.crt; this._crtWatch.k = s.crtIntensity; }
    return crt;
  },

  // 128x128 grey noise (alpha .35) as a PNG data URL, generated once.
  makeNoiseTile() {
    if (this._noiseTileUrl !== undefined) return this._noiseTileUrl;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = CRT_NOISE_SIZE;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(CRT_NOISE_SIZE, CRT_NOISE_SIZE);
      const d = img.data;
      const a = Math.round(CRT_NOISE_ALPHA * 255);
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 256) | 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = a;
      }
      ctx.putImageData(img, 0, 0);
      this._noiseTileUrl = c.toDataURL("image/png");
    } catch (_) {
      this._noiseTileUrl = null;
    }
    return this._noiseTileUrl;
  },

  // #crtOverlay.tear for 120 ms (scanlines jump 6 px and skew); nothing under reduced motion.
  crtTear() {
    const overlay = (this.screenEls && this.screenEls.crtOverlay) || document.getElementById("crtOverlay");
    if (!overlay) return;
    if (this._crtWatch) this._crtWatch.tearAt = nowMs();
    if (screensReducedMotion(this)) return;
    this.pulseClass(overlay, "tear", CRT_TEAR_MS);
  },

  // Per frame: tear on a real HP drop (unless takeDamage already called crtTear this frame) and follow settings changes
  // made without applySettings().
  tickCrtWatch(dt) {
    const W = this._crtWatch;
    if (!W) return;
    const hp = this.player ? this.player.hp : null;
    if (this.mode === "playing" && W.hp != null && hp != null && hp < W.hp - 0.5 && nowMs() - W.tearAt > 100) this.crtTear();
    W.hp = hp;
    const s = this.save && this.save.settings;
    if (s && (s.crt !== W.crt || s.crtIntensity !== W.k)) this.applyCrtSettings();
  },

  // ------------------------- Typewriter (D9 / JUICE-12) -------------------------
  // typewrite(el, text, {cps=38, tickEvery=2, variant, onDone}) -> {complete(), cancel(), done}. rAF-driven (pauses
  // while document.hidden), lime .twCaret while typing (CSS blinks it; steady under reduce-motion), SFX.typeTick(variant)
  // every tickEvery glyphs. complete() lands the whole line and fires onDone; cancel() stops silently.
  typewrite(el, text, opts = {}) {
    const full = String(text == null ? "" : text);
    const cps = Math.max(1, Number(opts.cps) || 38);
    const tickEvery = Math.max(1, (opts.tickEvery | 0) || 2);
    const variant = opts.variant;
    const h = { done: false, cancelled: false, complete: () => {}, cancel: () => {} };
    if (!el) { h.done = true; return h; }
    const textNode = document.createTextNode("");
    const caret = document.createElement("span");
    caret.className = "twCaret";
    caret.setAttribute("aria-hidden", "true");
    el.textContent = "";
    el.append(textNode, caret);
    el.setAttribute("aria-label", full);
    let shown = 0, acc = 0, typed = 0, last = null, raf = 0;
    const tick = () => {
      const sfx = this.sfx;
      if (sfx && typeof sfx.typeTick === "function") { try { sfx.typeTick(variant); } catch (_) { /* audio optional */ } }
    };
    const finish = () => {
      if (h.done) return;
      h.done = true;
      if (raf) cancelAnimationFrame(raf);
      textNode.data = full;
      if (caret.parentNode) caret.remove();
      if (!h.cancelled && typeof opts.onDone === "function") opts.onDone();
    };
    const step = (t) => {
      if (h.done) return;
      if (last === null) last = t;
      let dt = (t - last) / 1000;
      last = t;
      if (document.hidden) dt = 0;
      acc += clamp(dt, 0, 0.1) * cps;
      const n = Math.min(full.length, shown + Math.floor(acc));
      if (n > shown) {
        acc -= n - shown;
        for (let i = shown; i < n; i++) {
          if (full[i] !== " " && (++typed % tickEvery) === 0) tick();
        }
        shown = n;
        textNode.data = full.slice(0, shown);
      }
      if (shown >= full.length) { finish(); return; }
      raf = requestAnimationFrame(step);
    };
    h.complete = finish;
    h.cancel = () => {
      if (h.done) return;
      h.cancelled = true;
      h.done = true;
      if (raf) cancelAnimationFrame(raf);
      if (caret.parentNode) caret.remove();
    };
    raf = requestAnimationFrame(step);
    return h;
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
