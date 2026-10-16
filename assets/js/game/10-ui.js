// Type-R 198X — UI shell. Methods are mixed into Game.prototype; load order is defined in index.html.
//
//   boot & menu wiring      bindUI, Start / Continue / Reset (through confirm()), story modal {launch}
//   screen state machine    setMode -> body[data-mode] + .screen.is-active, focusPrimary, announce, trapFocus (C1)
//   modals                  openModal / closeModal / confirm with inert, Tab fallback, focus restore, modalStack (C1)
//   top bar & viewport      topBtn, fullscreen, visualViewport -> --vvh / body.kb-open, rotate hint (C2)
//   pause & settings        pause meta, #settingsPanel moved by mountSettings, setSetting / applySettings / resolveMotion (C6)
//   touch input             touchMode, #typeInput beforeinput path, tap-to-type pill (C7)
//   toasts, ending dialogue
//
// Everything another track provides (initScreens, renderMenuScreens, openHelp, openRecords, tickUI, onKeyFx...) is
// feature-detected; the shell runs without it.

const PAUSE_REASON_COPY = { user: "Paused", blur: "Window lost focus", hidden: "Tab hidden", fullscreen: "Left fullscreen" };
const MODAL_FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
const SETTINGS_SAVE_DEBOUNCE_MS = 300;
const TAP_TO_TYPE_DELAY_MS = 1200;
const DEATH_FREEZE_MS = 600;
const CRT_OFF_MS = 420;
const TOGGLE_GUARD_MS = 60;
const ROTATE_HINT_KEY = "typer.rotateHintDismissed";

Object.assign(Game.prototype, {
  // ------------------------- Ship helpers -------------------------
  getSelectedShipId() {
    return this.save.selectedShip || "coconut";
  },

  setPlayerShip(id) {
    const cfg = getShipConfig(id);
    this.player.shipId = cfg.id;
  },

  currentShipId() {
    return this.player.shipId || this.getSelectedShipId();
  },

  // ------------------------- Element helpers -------------------------
  $(id) {
    return document.getElementById(id);
  },

  screens() {
    if (!this._screens) {
      this._screens = {
        menu: this.ui.menu,
        paused: this.ui.paused,
        levelComplete: this.ui.levelComplete,
        gameOver: this.ui.gameOver,
        victory: this.ui.victory
      };
    }
    return this._screens;
  },

  topButtons() {
    const bar = this.$("topBar");
    return bar ? Array.from(bar.querySelectorAll("button")) : [];
  },

  // Labels live in .btnLabel so the icon mask and status dot survive every write (ui-HANDOFF section 2).
  setBtnLabel(btn, text) {
    if (!btn) return;
    const label = btn.querySelector(".btnLabel");
    if (label) { if (label.textContent !== text) label.textContent = text; }
    else if (btn.textContent !== text) btn.textContent = text;
  },

  isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.classList.contains("hidden")) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  },

  focusables(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(MODAL_FOCUSABLE)).filter((el) => this.isVisible(el) && !el.closest("[inert]"));
  },

  // Canvas normally; #typeInput on touch devices while playing (the soft keyboard needs a real text field).
  // The input is only taken inside a gesture (a tap on the playfield) or when it already holds focus: a
  // programmatic focus cannot raise a soft keyboard, and the tap-to-type pill must stay visible until it does.
  focusGameCanvas(opts = {}) {
    const input = this.typeInput;
    const wantInput = !!(input && this.touchMode && this.mode === "playing" && (opts.gesture || document.activeElement === input));
    const target = wantInput ? input : this.canvas;
    if (!target) return;
    if (document.activeElement === target) return;
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
  },

  // Game Over gains #btnRetryBoss and #retryNote when index.html lacks them; the retry buttons carry the checkpoint copy.
  ensureGameOverControls() {
    const over = this.ui.gameOver;
    if (!over) return;
    if (this.btnTryAgain) this.btnTryAgain.textContent = "Retry sector";
    if (this.btnRestart) this.btnRestart.textContent = "Restart sector";
    if (!this.btnRetryBoss) {
      const b = document.createElement("button");
      b.id = "btnRetryBoss";
      b.type = "button";
      b.className = "btn-arcade hidden";
      b.textContent = "Retry boss";
      if (this.btnTryAgain && this.btnTryAgain.parentElement) this.btnTryAgain.insertAdjacentElement("afterend", b);
      else over.appendChild(b);
      this.btnRetryBoss = b;
    }
    if (!this.$("retryNote")) {
      const p = document.createElement("p");
      p.id = "retryNote";
      p.className = "small";
      p.textContent = "Score returns to sector start";
      const host = (this.btnTryAgain && this.btnTryAgain.parentElement && this.btnTryAgain.parentElement.parentElement) || over;
      host.appendChild(p);
    }
  },

  // ------------------------- bindUI -------------------------
  bindUI() {
    // Start-with-run and Reset Save confirm in their own handlers; the screens track's capture-phase guards step aside.
    this.startHandlesConfirm = true;
    this.resetHandlesConfirm = true;
    this.modalStack = this.modalStack || [];
    this.typeInput = this.$("typeInput");
    this.tapToType = this.$("tapToType");
    this.srAnnounce = this.$("srAnnounce");
    this.mainEl = this.$("main");
    this.touchMode = this.detectTouchMode();
    this.ensureGameOverControls();

    // Menu: the form submit is the single Start path (click on the submit button, Enter in #playerName).
    const menuForm = this.$("menuForm");
    if (menuForm) menuForm.addEventListener("submit", (e) => { e.preventDefault(); this.onStartPressed(); });
    else this.btnStart.addEventListener("click", () => this.onStartPressed());
    this.btnContinue.addEventListener("click", () => this.onContinuePressed());
    this.btnResetSave.addEventListener("click", () => this.onResetSavePressed());

    // Top bar: every handler blurs its button and hands focus back to the playfield while playing.
    this.btnPause.addEventListener("click", this.topBtn(() => this.togglePause()));
    this.btnStop.addEventListener("click", this.topBtn(() => { this.uiTick("back"); this.stopToMenu(true); }));
    this.btnMute.addEventListener("click", this.topBtn(() => this.toggleMute()));
    this.btnCRT.addEventListener("click", this.topBtn(() => this.toggleCRT()));
    const btnFs = this.$("btnFullscreen");
    if (btnFs) btnFs.addEventListener("click", this.topBtn(() => this.toggleFullscreen()));
    const btnSettings = this.$("btnSettings");
    if (btnSettings) btnSettings.addEventListener("click", this.topBtn(() => this.openSettingsModal()));
    const btnMenuSettings = this.$("btnMenuSettings");
    if (btnMenuSettings) btnMenuSettings.addEventListener("click", () => this.openSettingsModal());
    const btnSettingsClose = this.$("btnSettingsClose");
    if (btnSettingsClose) btnSettingsClose.addEventListener("click", () => this.closeSettingsModal());

    // Pause screen
    this.btnResume.addEventListener("click", () => { this.uiTick("confirm"); this.setMode("playing"); });
    this.btnRestart.addEventListener("click", () => this.onRestartPressed());
    const btnPauseQuit = this.$("btnPauseQuit");
    if (btnPauseQuit) btnPauseQuit.addEventListener("click", () => { this.uiTick("back"); this.stopToMenu(true); });
    const btnPauseHelp = this.$("btnPauseHelp");
    if (btnPauseHelp) btnPauseHelp.addEventListener("click", () => this.showHelp());
    const hudPause = this.$("hudPause");
    if (hudPause) hudPause.addEventListener("click", () => { this.togglePause(); this.focusPrimary(this.mode); });

    // End screens
    this.btnNextLevel.addEventListener("click", () => { this.uiTick("confirm"); this.advanceLevel(); this.focusGameCanvas(); });
    this.btnBackToMenu1.addEventListener("click", () => { this.uiTick("back"); this.stopToMenu(true); });
    this.btnBackToMenu2.addEventListener("click", () => { this.uiTick("back"); this.stopToMenu(true); });
    this.btnBackToMenu3.addEventListener("click", () => { this.uiTick("back"); this.stopToMenu(true); });
    this.btnTryAgain.addEventListener("click", () => { this.uiTick("confirm"); this.restartLevel(); this.focusGameCanvas(); });
    if (this.btnRetryBoss) this.btnRetryBoss.addEventListener("click", () => { this.uiTick("confirm"); this.retryBoss(); this.focusGameCanvas(); });
    this.btnNewRun.addEventListener("click", () => { this.uiTick("confirm"); this.startNewRun(); this.focusGameCanvas(); });
    if (this.ui.endingNext) this.ui.endingNext.addEventListener("click", () => this.advanceEndingDialogue());
    if (this.ui.endingSkip) this.ui.endingSkip.addEventListener("click", () => this.skipEndingDialogue());

    // Story modal: Launch starts the run in {launch:true} mode and closes in read-only mode; Back/Escape destroy nothing.
    if (this.storyLaunchBtn) this.storyLaunchBtn.addEventListener("click", () => this.onStoryLaunch());
    const storyBack = this.$("btnStoryBack");
    if (storyBack) storyBack.addEventListener("click", () => this.closeModal(this.storyModal, { result: "cancel" }));

    this.shipInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.save.selectedShip = input.value;
        storeSave(this.save);
      });
    });

    this.bindModals();
    this.bindSettings();
    this.bindPlayfieldInput();
    this.bindViewport();
    this.bindFullscreen();

    // Keyboard (routing order lives in 30-input.js onKeyDown)
    window.addEventListener("keydown", (e) => this.onKeyDown(e));

    this.bindLifecycle();
    this.applySettings();

    // Screens track (15-screens.js): menu cabinet, records/help modals, results cards. Fallbacks keep the buttons alive.
    if (typeof this.initScreens === "function") this.initScreens();
    else this.bindScreensFallbacks();
  },

  // Bindings the screens track owns once 15-screens.js lands; until then the shell keeps every button working.
  bindScreensFallbacks() {
    const on = (id, fn) => { const el = this.$(id); if (el) el.addEventListener("click", fn); };
    on("btnRecords", () => this.showRecords());
    on("btnHelp", () => this.showHelp());
    on("btnBriefing", () => this.showStoryModal({ launch: false }));
    on("btnHelpClose", () => this.closeModal(this.$("helpModal"), { result: "ok" }));
    on("btnRecordsClose", () => this.closeModal(this.$("recordsModal"), { result: "ok" }));
  },

  // Page lifecycle: pause + save on blur/hidden, stop the rAF while hidden, save on pagehide (F091).
  bindLifecycle() {
    window.addEventListener("blur", () => {
      if (this.mode === "playing") this.pauseGame("blur");
      this.saveRun(true);
      this.commitHighScore();
    });

    window.addEventListener("focus", () => {
      if (this.mode === "playing" && !this.modalStack.length) this.focusGameCanvas();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.onPageHidden();
      else this.onPageVisible();
    });

    window.addEventListener("pagehide", () => {
      this.flushSettingsSave();
      this.saveRun(true);
      this.commitHighScore();
    });

    window.addEventListener("beforeunload", () => {
      this.flushSettingsSave();
      this.saveRun(true);
      this.commitHighScore();
    });
  },

  onPageHidden() {
    if (this.mode === "playing") this.pauseGame("hidden");
    this.saveRun(true);
    this.commitHighScore();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.sfx && typeof this.sfx.onHidden === "function") this.sfx.onHidden();
  },

  onPageVisible() {
    this.prev = nowMs();
    if (this.rafId === null && this._loop) this.rafId = requestAnimationFrame(this._loop);
    if (this.sfx && typeof this.sfx.onVisible === "function") this.sfx.onVisible();
  },

  pauseGame(reason = "user") {
    if (this.mode !== "playing") return;
    this.pauseReason = reason;
    this.setMode("paused");
  },

  togglePause() {
    const t = nowMs();
    if (t - (this._lastToggleAt || -1e9) < TOGGLE_GUARD_MS) return; // one toggle per gesture (double-bound buttons, double taps)
    this._lastToggleAt = t;
    if (this.mode === "playing") this.pauseGame("user");
    else if (this.mode === "paused") this.setMode("playing");
  },

  uiTick(kind) {
    const sfx = this.sfx;
    if (sfx && typeof sfx.uiTick === "function") {
      try { sfx.uiTick(kind); } catch (_) { /* audio is optional */ }
    }
  },

  // Unlock audio once (memoised while in flight). Resolves immediately after the first success, so
  // keystrokes never wait on it (A4).
  ensureAudio() {
    if (this.audioReady || this.audioUnavailable) return Promise.resolve();
    if (this._audioPromise) return this._audioPromise;
    this._audioPromise = (async () => {
      try {
        await this.sfx.unlock();
        this.applySettings();
        this.audioReady = true;
      } catch (err) {
        console.warn("Audio init failed; continuing without sound", err);
        this.audioUnavailable = true;
      } finally {
        this._audioPromise = null;
      }
    })();
    return this._audioPromise;
  },

  // Start/Continue show "SPOOLING AUDIO…" only while the one-shot unlock is pending (F014).
  async unlockAudioWithBusy() {
    const pending = !this.audioReady && !this.audioUnavailable;
    if (pending) this.setAudioBusy(true);
    try { await this.ensureAudio(); }
    finally { if (pending) this.setAudioBusy(false); }
  },

  // ------------------------- Start / Continue / Reset -------------------------
  runHasProgress(run) {
    if (!run) return false;
    const st = run.stats || {};
    return (run.levelIndex | 0) > 0 || (st.score | 0) > 0 || (run.levelT || 0) > 0 || (run.wave | 0) > 0 || !!run.inBoss;
  },

  readPilotName() {
    const name = (this.ui.playerName && this.ui.playerName.value || "").trim();
    if (name) this.save.playerName = name;
  },

  async onStartPressed() {
    if (this._launchBusy) return;
    const run = this.save.run;
    if (this.runHasProgress(run)) {
      const ok = await this.confirm({
        eyebrow: "New run",
        title: "Abandon the saved run?",
        body: `Sector ${(run.levelIndex | 0) + 1} · score ${formatInt((run.stats && run.stats.score) || 0)}. Starting a new run erases it.`,
        okLabel: "Start new run",
        cancelLabel: "Keep it",
        danger: true
      });
      if (!ok) return;
    }
    this.readPilotName();
    if (this.storyModal && !this.save.storySeen) {
      this.showStoryModal({ launch: true });
      return;
    }
    await this.launchNewRun();
  },

  // The real start: audio unlock (busy label), bank the abandoned run's score (F009), wipe it, go.
  async launchNewRun() {
    if (this._launchBusy) return;
    this._launchBusy = true;
    try {
      await this.unlockAudioWithBusy();
      this.uiTick("confirm");
      this.commitHighScore();
      this.save.run = null;
      this.run = null;
      this.storeAndRefresh();
      this.startGameplayFlow(true);
    } finally {
      this._launchBusy = false;
    }
  },

  async onContinuePressed() {
    if (this._launchBusy) return;
    this._launchBusy = true;
    try {
      await this.unlockAudioWithBusy();
      this.readPilotName();
      this.storeAndRefresh();
      this.uiTick("confirm");
      if (this.save.run) {
        this.continueRun();
        this.focusGameCanvas();
        return;
      }
      const resumeIndex = getResumeLevelIndex(this.save);
      if (resumeIndex !== null) {
        // HP from the level curve, never the menu-time player object (F004)
        this.save.run = buildResumeRun(resumeIndex, getHpBonusForLevel(resumeIndex + 1), this.getSelectedShipId());
        storeSave(this.save);
        this.continueRun();
        this.focusGameCanvas();
        return;
      }
      this.startGameplayFlow(true);
    } finally {
      this._launchBusy = false;
    }
  },

  async onResetSavePressed() {
    const s = this.save;
    const run = s.run;
    const parts = [`High score ${formatInt(s.highScore || 0)}`, `${s.lastUnlockedLevel || 1}/10 sectors unlocked`];
    if (run) parts.push(`saved run in Sector ${(run.levelIndex | 0) + 1}`);
    const ok = await this.confirm({
      eyebrow: "Reset save",
      title: "Erase everything?",
      body: `${parts.join(" · ")}. This cannot be undone.`,
      okLabel: "Erase everything",
      cancelLabel: "Keep it",
      danger: true
    });
    if (!ok) return;
    this.save = defaultSave();
    this.run = null;
    this.runMeta = null;
    this._hsCommitted = null;
    storeSave(this.save);
    this.applySettings();
    this.refreshMenu();
    this.announce("Save erased");
    this.showToast("SAVE ERASED", { kind: "success", key: "save" });
  },

  async onRestartPressed() {
    const cp = this.run && this.run.checkpoint;
    const cpScore = cp ? (cp.score | 0) : 0;
    if ((this.stats.score | 0) > cpScore) {
      const L = LEVELS[this.levelIndex].level;
      const ok = await this.confirm({
        eyebrow: "Restart sector",
        title: `Restart Sector ${L}?`,
        body: `Score returns to the sector checkpoint (${formatInt(cpScore)} pts).`,
        okLabel: "Restart",
        cancelLabel: "Keep playing"
      });
      if (!ok) return;
    }
    this.uiTick("confirm");
    this.restartLevel();
    this.focusGameCanvas();
  },

  // ------------------------- Story modal -------------------------
  // {launch:true}: Launch starts the run, Back/Escape return to the menu with nothing erased.
  // {launch:false}: read-only re-read (#btnBriefing); Launch is relabelled Close and Back is hidden.
  showStoryModal(opts = {}) {
    const modal = this.storyModal;
    if (!modal) return;
    const launch = opts.launch !== false;
    this.storyLaunchMode = launch;
    if (this.storyLaunchBtn) this.storyLaunchBtn.textContent = launch ? "Launch the Keystream" : "Close";
    const back = this.$("btnStoryBack");
    if (back) back.classList.toggle("hidden", !launch);
    this.openModal(modal, { primary: this.storyLaunchBtn, initialFocus: this.storyLaunchBtn, silent: !launch });
  },

  hideStoryModal() {
    if (this.storyModal) this.closeModal(this.storyModal, { result: "cancel", silent: true });
  },

  onStoryLaunch() {
    if (this.storyLaunchMode) {
      this.closeModal(this.storyModal, { result: "ok", silent: true, restoreFocus: false });
      this.launchNewRun();
    } else {
      this.closeModal(this.storyModal, { result: "ok" });
    }
  },

  // Kept for callers that only know the old name: Start with the story unseen shows the briefing first.
  handleLaunchRequest() {
    if (this.storyModal && !this.save.storySeen) this.showStoryModal({ launch: true });
    else this.launchNewRun();
  },

  startGameplayFlow(resetRun) {
    if (resetRun) this.startNewRun();
    else this.continueRun();
    this.save.storySeen = true;
    storeSave(this.save);
    this.focusGameCanvas();
  },

  // ------------------------- Modal system (C1 / UX-04) -------------------------
  bindModals() {
    this.modalStack = this.modalStack || [];
    for (const overlay of document.querySelectorAll(".modalOverlay")) {
      if (overlay.dataset.modalBound) continue;
      overlay.dataset.modalBound = "1";
      // Backdrop click = cancel (never for a danger alertdialog).
      overlay.addEventListener("click", (e) => {
        if (e.target !== overlay) return;
        const entry = this.modalEntry(overlay);
        if (!entry || entry.danger) return;
        this.cancelModal(overlay);
      });
      for (const body of overlay.querySelectorAll(".modalScroll .modalBody")) {
        body.addEventListener("scroll", () => this.updateModalScroll(overlay), { passive: true });
      }
    }
    const ok = this.$("btnConfirmOk");
    const cancel = this.$("btnConfirmCancel");
    if (ok) ok.addEventListener("click", () => this.resolveConfirm(true));
    if (cancel) cancel.addEventListener("click", () => this.resolveConfirm(false));
    window.addEventListener("resize", () => { for (const m of this.modalStack) this.updateModalScroll(m.el); });
  },

  modalEntry(el) {
    return this.modalStack.find((m) => m.el === el) || null;
  },

  topModal() {
    return this.modalStack.length ? this.modalStack[this.modalStack.length - 1] : null;
  },

  isModalOpen(el) {
    return !!this.modalEntry(el);
  },

  // Everything behind the top modal is inert: page chrome, the playfield (with its active screen) and lower modals.
  syncInert() {
    const top = this.topModal();
    const parts = [this.$("topBar"), this.mainEl || this.$("main"), document.querySelector(".footer"), this.$("rotateHint")];
    for (const el of parts) {
      if (!el) continue;
      if (top) el.setAttribute("inert", ""); else el.removeAttribute("inert");
    }
    for (const m of this.modalStack) {
      if (m === top) m.el.removeAttribute("inert"); else m.el.setAttribute("inert", "");
    }
  },

  // openModal(el, { primary, initialFocus, returnFocusTo, onClose, danger, silent }). Idempotent per element.
  openModal(el, opts = {}) {
    if (!el) return null;
    const existing = this.modalEntry(el);
    if (existing) {
      if (opts.onClose) existing.onClose = opts.onClose;
      return el;
    }
    const entry = {
      el,
      primary: opts.primary || null,
      returnFocusTo: opts.returnFocusTo || document.activeElement || null,
      onClose: typeof opts.onClose === "function" ? opts.onClose : null,
      danger: !!opts.danger
    };
    this.modalStack.push(entry);
    el.classList.remove("hidden", "is-dismissed");
    el.removeAttribute("aria-hidden");
    this.syncInert();
    this.updateModalScroll(el);
    let focusEl = opts.initialFocus;
    if (typeof focusEl === "string") focusEl = el.querySelector(focusEl);   // selectors are accepted (screens track)
    if (!(focusEl && typeof focusEl.focus === "function")) focusEl = entry.primary || this.focusables(el)[0] || el.querySelector(".modalInner");
    if (focusEl) {
      if (!focusEl.hasAttribute("tabindex") && !focusEl.matches(MODAL_FOCUSABLE)) focusEl.setAttribute("tabindex", "-1");
      const tryFocus = () => {
        if (this.topModal() !== entry || el.contains(document.activeElement)) return;
        try { focusEl.focus({ preventScroll: true }); } catch (_) {}
      };
      tryFocus();
      requestAnimationFrame(() => { tryFocus(); requestAnimationFrame(tryFocus); });
    }
    if (!opts.silent) this.uiTick("confirm");
    return el;
  },

  // closeModal(el, { result: 'ok'|'cancel', silent, restoreFocus }). Fades via .is-dismissed; focus returns to the opener.
  closeModal(el, opts = {}) {
    if (!el) return false;
    const idx = this.modalStack.findIndex((m) => m.el === el);
    if (idx < 0) {
      el.classList.add("is-dismissed");
      return false;
    }
    const [entry] = this.modalStack.splice(idx, 1);
    el.classList.add("is-dismissed");
    this.syncInert();
    if (el === this.$("settingsModal")) this.flushSettingsSave();
    const result = opts.result || "cancel";
    if (!opts.silent) this.uiTick(result === "ok" ? "confirm" : "back");
    if (opts.restoreFocus !== false) {
      const top = this.topModal();
      if (top) {
        const first = this.focusables(top.el)[0];
        if (first) { try { first.focus({ preventScroll: true }); } catch (_) {} }
      } else {
        const back = entry.returnFocusTo;
        if (back && back.isConnected && this.isVisible(back) && !back.closest(".modalOverlay")) {
          try { back.focus({ preventScroll: true }); } catch (_) {}
        } else {
          this.focusPrimary(this.mode);
        }
      }
    }
    if (entry.onClose) {
      try { entry.onClose(result); } catch (err) { console.error("[TypeR] modal onClose", err); }
    }
    return true;
  },

  // Escape / backdrop / Back: the modal's cancel path (confirm resolves false).
  cancelModal(el) {
    const top = this.topModal();
    const target = el || (top && top.el);
    if (!target) return;
    if (target === this.$("confirmModal")) { this.resolveConfirm(false); return; }
    if (target === this.$("settingsModal")) { this.closeSettingsModal("cancel"); return; }
    if (typeof this.closeHelp === "function" && target === this.$("helpModal") && this.isModalOpen(target)) {
      this.closeHelp();
      if (this.isModalOpen(target)) this.closeModal(target, { result: "cancel" });
      return;
    }
    this.closeModal(target, { result: "cancel" });
  },

  // Enter on a non-control inside a modal clicks its primary (confirm: OK, or Cancel when flagged danger).
  modalPrimary(entry) {
    if (!entry) return null;
    if (entry.primary && this.isVisible(entry.primary)) return entry.primary;
    const actions = entry.el.querySelector(".modalActions");
    if (!actions) return null;
    return actions.querySelector(".btn-arcade.primary") || Array.from(actions.querySelectorAll("button")).filter((b) => this.isVisible(b)).pop() || null;
  },

  // Tab fallback for engines without inert: focus wraps inside the container (modal or active screen + top bar).
  trapFocus(container, e) {
    const list = Array.isArray(container) ? container.flatMap((c) => this.focusables(c)) : this.focusables(container);
    if (!list.length) { e.preventDefault(); return; }
    const active = document.activeElement;
    const i = list.indexOf(active);
    const n = list.length;
    let next;
    if (i < 0) next = e.shiftKey ? list[n - 1] : list[0];
    else next = list[(i + (e.shiftKey ? -1 : 1) + n) % n];
    e.preventDefault();
    try { next.focus({ preventScroll: true }); } catch (_) {}
  },

  // confirm({ eyebrow, title, body, okLabel, cancelLabel, danger }) -> Promise<boolean>
  confirm(opts = {}) {
    const modal = this.$("confirmModal");
    if (!modal) return Promise.resolve(true);
    if (this._confirmResolve) this.resolveConfirm(false);
    const eyebrow = this.$("confirmEyebrow");
    const title = this.$("confirmTitle");
    const body = this.$("confirmBody");
    const ok = this.$("btnConfirmOk");
    const cancel = this.$("btnConfirmCancel");
    if (eyebrow) eyebrow.textContent = opts.eyebrow || "Confirm";
    if (title) title.textContent = opts.title || "";
    if (body) body.textContent = opts.body || "";
    if (ok) {
      ok.textContent = opts.okLabel || "OK";
      ok.classList.toggle("danger", !!opts.danger);
      ok.classList.toggle("primary", !opts.danger);
    }
    if (cancel) cancel.textContent = opts.cancelLabel || "Cancel";
    const focusEl = opts.danger ? (cancel || ok) : (ok || cancel);
    return new Promise((resolve) => {
      this._confirmResolve = resolve;
      this.openModal(modal, { primary: focusEl, initialFocus: focusEl, danger: !!opts.danger, silent: true });
    });
  },

  resolveConfirm(value) {
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    const modal = this.$("confirmModal");
    if (modal && this.isModalOpen(modal)) this.closeModal(modal, { result: value ? "ok" : "cancel" });
    if (resolve) resolve(!!value);
  },

  // .modalScroll fade + hint: is-scrollable / at-bottom live on the wrapper (ui-HANDOFF section 1).
  updateModalScroll(modalEl) {
    if (!modalEl) return;
    for (const wrap of modalEl.querySelectorAll(".modalScroll")) {
      const body = wrap.querySelector(".modalBody");
      if (!body) continue;
      const scrollable = body.scrollHeight > body.clientHeight + 2;
      const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
      wrap.classList.toggle("is-scrollable", scrollable);
      wrap.classList.toggle("at-bottom", !scrollable || atBottom);
    }
  },

  // Help / records: the screens track's openHelp/openRecords when they exist, else the modals through openModal.
  showHelp() {
    const t = nowMs();
    if (t - (this._helpOpenedAt || -1e9) < 150) return; // double-bound buttons open it once
    this._helpOpenedAt = t;
    if (typeof this.openHelp === "function") return this.openHelp();
    const el = this.$("helpModal");
    if (el) this.openModal(el, { primary: this.$("btnHelpClose") });
  },

  showRecords() {
    if (typeof this.openRecords === "function") return this.openRecords();
    const el = this.$("recordsModal");
    if (el) this.openModal(el, { primary: this.$("btnRecordsClose") });
  },

  // ------------------------- Toasts -------------------------
  // #toastStack lives in #main (created here when index.html lacks it); style.css carries .toastStack/.toast.
  ensureToastStack() {
    if (this.toastStack && this.toastStack.isConnected) return this.toastStack;
    let el = this.$("toastStack");
    if (!el) {
      el = document.createElement("div");
      el.id = "toastStack";
      el.className = "toastStack";
      el.setAttribute("aria-hidden", "true");
      (this.$("main") || document.body).appendChild(el);
    }
    this.toastStack = el;
    this.toasts = this.toasts || [];
    return el;
  },

  showToast(text, opts = {}) {
    const TOAST_MS = { info: 3200, tip: 4000, warn: 4200, success: 2400 };
    const kind = opts.kind || "info";
    const ms = (typeof opts.ms === "number") ? opts.ms : (TOAST_MS[kind] || 3200);
    const key = opts.key ?? null;
    const stack = this.ensureToastStack();
    let entry = key ? this.toasts.find(t => t.key === key) : null;
    if (entry) {
      // same key: replace in place and restart the timer
      clearTimeout(entry.timer);
      entry.el.textContent = text;
      entry.el.className = `toast toast--${kind} is-in`;
      entry.el.dataset.kind = kind;
    } else {
      const el = document.createElement("div");
      el.className = `toast toast--${kind}`;
      el.dataset.kind = kind;
      if (key) el.dataset.key = key;
      el.textContent = text;
      stack.appendChild(el);
      entry = { el, key, timer: null };
      this.toasts.push(entry);
      while (this.toasts.length > 2) this.removeToast(this.toasts[0], true);
      void el.offsetWidth; // commit the start state so the enter transition runs
      el.classList.add("is-in");
    }
    entry.timer = setTimeout(() => this.removeToast(entry), ms);
    this.announce(text);
    return entry.el;
  },

  removeToast(entry, immediate = false) {
    if (!entry || !this.toasts) return;
    const i = this.toasts.indexOf(entry);
    if (i >= 0) this.toasts.splice(i, 1);
    clearTimeout(entry.timer);
    if (immediate) { entry.el.remove(); return; }
    entry.el.classList.remove("is-in");
    entry.el.classList.add("is-out", "is-leaving");
    setTimeout(() => entry.el.remove(), 220);
  },

  dismissToast(key) {
    const entry = (this.toasts || []).find(t => t.key === key);
    if (entry) this.removeToast(entry);
  },

  // ------------------------- Announcer -------------------------
  // Clear, then write 30 ms later, so a repeated message is re-announced by the live region.
  announce(text) {
    const el = this.srAnnounce || this.$("srAnnounce");
    if (!el) return;
    clearTimeout(this._announceTimer);
    el.textContent = "";
    this._announceTimer = setTimeout(() => { el.textContent = String(text || ""); }, 30);
  },

  announceMode(m, prev) {
    const cfg = LEVELS[this.levelIndex] || LEVELS[0];
    const L = cfg.level;
    const score = formatInt(this.stats.score || 0);
    switch (m) {
      case "menu": this.announce(this.primaryFor("menu") === this.btnContinue ? "Main menu. Press Enter to continue your saved run." : "Main menu. Press Enter to start."); break;
      case "paused": this.announce("Paused. Press Enter to resume."); break;
      case "levelComplete": this.announce(`Sector ${L} cleared. Score ${score}.${L < 10 ? ` Press Enter for Sector ${L + 1}.` : ""}`); break;
      case "gameOver": this.announce(`Game over in Sector ${L}. Score ${score}. Press Enter to retry.`); break;
      case "victory": this.announce("Victory. All ten sectors cleared."); break;
      case "playing": if (prev !== "paused") this.announce(`Sector ${L}. Type the first letter of a target to lock on.`); break;
      default: break;
    }
  },

  // ------------------------- Screen state machine (C1) -------------------------
  primaryFor(mode = this.mode) {
    switch (mode) {
      case "menu": {
        const card = this.$("resumeCard");
        const cont = this.btnContinue;
        if (card && cont && this.isVisible(card) && this.isVisible(cont) && !cont.disabled) return cont;
        return this.btnStart;
      }
      case "paused": return this.btnResume;
      case "levelComplete": return this.btnNextLevel;
      case "gameOver": return this.btnTryAgain;
      case "victory": {
        const next = this.ui.endingNext;
        if (next && this.isVisible(next)) return next;
        return this.btnNewRun;
      }
      default: return null;
    }
  },

  // Focus the mode's primary control now and again on the next frame (the screen's transition may still be settling).
  focusPrimary(mode = this.mode) {
    const seq = (this._focusSeq = (this._focusSeq | 0) + 1);
    const apply = () => {
      if (seq !== this._focusSeq || this.mode !== mode || this.modalStack.length) return;
      if (mode === "playing") { this.focusGameCanvas(); return; }
      const el = this.primaryFor(mode);
      if (el && document.activeElement !== el) {
        try { el.focus({ preventScroll: true }); } catch (_) {}
      }
    };
    apply();
    requestAnimationFrame(apply);
  },

  // Top-bar buttons never keep focus: blur after the action and hand focus back to the playfield while playing.
  topBtn(fn) {
    return (e) => {
      const result = fn(e);
      const btn = e && e.currentTarget;
      if (btn && typeof btn.blur === "function" && document.activeElement === btn) btn.blur();
      if (this.mode === "playing") this.focusGameCanvas();
      return result;
    };
  },

  syncTopBar() {
    const playing = this.mode === "playing";
    for (const b of this.topButtons()) b.tabIndex = playing ? -1 : 0;
    const paused = this.mode === "paused";
    this.setBtnLabel(this.btnPause, paused ? "Resume" : "Pause");
    if (this.btnPause) this.btnPause.setAttribute("aria-pressed", paused ? "true" : "false");
  },

  setMode(m) {
    const prev = this.mode;
    if (prev === "menu" && m !== "menu" && typeof this.stopAttract === "function") this.stopAttract();   // D8
    this.mode = m;
    document.body.dataset.mode = m;
    const screens = this.screens();
    for (const key of Object.keys(screens)) {
      const el = screens[key];
      if (!el) continue;
      el.classList.remove("hidden"); // body[data-mode] + .is-active own screen visibility now
      el.classList.toggle("is-active", key === m);
    }
    this.clearDeathFreeze();
    this.syncTopBar();
    this.hideTapToType();

    if (m === "paused") {
      // Freeze-frame: the pause screen sits on a still canvas.
      this.trauma = 0;
      this.shake = 0;
      // Restart is unavailable while a finale is banking the clear (F039).
      if (this.btnRestart) this.btnRestart.classList.toggle("hidden", !!this.bossClear);
      this.fillPauseScreen();
      this.mountSettings(this.$("pauseSettingsHost"));
      if (prev === "playing" && this.sfx) {
        if (typeof this.sfx.setMusicState === "function") this.sfx.setMusicState("pause");
        this.uiTick("pause");
      }
    } else if (prev === "paused") {
      this.pauseReason = "user";
      this.flushSettingsSave();
      if (m === "playing" && this.sfx) {
        if (typeof this.sfx.setMusicState === "function") this.sfx.setMusicState("resume");
        this.uiTick("resume");
      }
    }
    if (m === "gameOver") this.startDeathFreeze();
    if (m === "playing") this.scheduleTapToType(TAP_TO_TYPE_DELAY_MS);
    // Autosave when leaving playing
    if (m !== "playing") this.saveRun(true);
    this.announceMode(m, prev);
    this.focusPrimary(m);
    this.requestFrame();
    if (m === "menu" && typeof this.startAttract === "function") this.startAttract();   // D8 (idempotent; waits for the menu bitmaps)
  },

  // Game Over: the CRT power-off line (once, full motion only) and a desaturated frozen canvas 600 ms after the hit lands.
  startDeathFreeze() {
    const main = this.mainEl || this.$("main");
    if (main && !this.reduceMotion) {
      main.classList.remove("crtOff");
      void main.offsetWidth;
      main.classList.add("crtOff");
      clearTimeout(this._crtOffTimer);
      this._crtOffTimer = setTimeout(() => main.classList.remove("crtOff"), CRT_OFF_MS + 80);
    }
    clearTimeout(this._freezeTimer);
    this._freezeTimer = setTimeout(() => { if (this.mode === "gameOver") this.canvas.classList.add("freeze"); }, DEATH_FREEZE_MS);
  },

  clearDeathFreeze() {
    clearTimeout(this._freezeTimer);
    this._freezeTimer = null;
    if (this.canvas) this.canvas.classList.remove("freeze");
  },

  // ------------------------- Pause screen (C6) -------------------------
  fillPauseScreen() {
    const cfg = LEVELS[this.levelIndex] || LEVELS[0];
    const set = (id, text) => { const el = this.$(id); if (el && el.textContent !== text) el.textContent = text; };
    set("pauseSector", `${cfg.level} / 10`);
    set("pauseWave", (this.inBoss || this.wavePhase === "boss" || this.wavePhase === "finale") ? "BOSS" : `${Math.min((this.wave | 0) + 1, 3)} / 3`);
    set("pauseScore", formatInt(this.stats.score || 0));
    set("pauseAcc", `${this.getAccuracyPct()}%`);
    set("pauseEyebrow", `Paused // Sector ${String(cfg.level).padStart(2, "0")} · ${cfg.bossName || ""}`.replace(/ · $/, ""));
    if (this.ui.pauseReason) this.ui.pauseReason.textContent = PAUSE_REASON_COPY[this.pauseReason] || PAUSE_REASON_COPY.user;
  },

  // ------------------------- Settings (C6) -------------------------
  settingsEls() {
    if (this._settingsEls) return this._settingsEls;
    const $ = (id) => this.$(id);
    this._settingsEls = {
      panel: $("settingsPanel"),
      music: $("setMusic"), musicOut: $("setMusicOut"),
      sfx: $("setSfx"), sfxOut: $("setSfxOut"),
      mute: $("setMute"), crt: $("setCRT"),
      crtInt: $("setCRTIntensity"), crtIntOut: $("setCRTIntensityOut"),
      motion: $("setMotion"), fs2: $("btnFullscreen2"),
      pauseHost: $("pauseSettingsHost"), menuHost: $("menuSettingsHost"), modal: $("settingsModal")
    };
    return this._settingsEls;
  },

  bindSettings() {
    const s = this.settingsEls();
    const pct = (el) => clamp(Number(el.value) || 0, 0, 100) / 100;
    if (s.music) s.music.addEventListener("input", () => this.setSetting("musicVolume", pct(s.music)));
    if (s.sfx) {
      s.sfx.addEventListener("input", () => this.setSetting("sfxVolume", pct(s.sfx)));
      s.sfx.addEventListener("change", () => this.uiTick("tick"));
    }
    if (s.mute) s.mute.addEventListener("change", () => this.setSetting("muted", !!s.mute.checked));
    if (s.crt) s.crt.addEventListener("change", () => this.setSetting("crt", !!s.crt.checked));
    if (s.crtInt) s.crtInt.addEventListener("input", () => this.setSetting("crtIntensity", clamp(pct(s.crtInt), 0.25, 1)));
    if (s.motion) {
      s.motion.addEventListener("change", () => {
        const v = s.motion.value;
        this.setSetting("reduceMotion", v === "reduced" ? true : v === "full" ? false : null);
      });
    }
    if (s.fs2) s.fs2.addEventListener("click", () => this.toggleFullscreen());
    if (s.panel) s.panel.addEventListener("submit", (e) => e.preventDefault());
  },

  // The panel is one node; it lives wherever settings are shown (pause screen or the title's modal).
  mountSettings(host) {
    const panel = this.settingsEls().panel;
    if (!panel || !host) return;
    if (panel.parentElement !== host) host.appendChild(panel);
  },

  openSettingsModal() {
    const s = this.settingsEls();
    if (!s.modal) return;
    this.mountSettings(s.menuHost);
    this.openModal(s.modal, {
      primary: this.$("btnSettingsClose"),
      initialFocus: s.music || this.$("btnSettingsClose"),
      onClose: () => {
        this.flushSettingsSave();
        if (this.mode === "paused") this.mountSettings(s.pauseHost);
      }
    });
  },

  closeSettingsModal(result = "ok") {
    const s = this.settingsEls();
    if (s.modal) this.closeModal(s.modal, { result });
  },

  setSetting(key, value) {
    this.save.settings[key] = value;
    this.applySettings();
    this.scheduleSettingsSave();
  },

  scheduleSettingsSave() {
    clearTimeout(this._settingsSaveTimer);
    this._settingsSaveTimer = setTimeout(() => this.flushSettingsSave(), SETTINGS_SAVE_DEBOUNCE_MS);
  },

  flushSettingsSave() {
    if (!this._settingsSaveTimer) return;
    clearTimeout(this._settingsSaveTimer);
    this._settingsSaveTimer = null;
    storeSave(this.save);
  },

  // Settings -> audio buses, button mirrors, CRT attribute + intensity, motion, control values.
  applySettings() {
    const st = this.save.settings;
    const sfx = this.sfx;
    if (sfx) {
      if (typeof sfx.setMusicVolume === "function") sfx.setMusicVolume(st.musicVolume ?? 0.7);
      if (typeof sfx.setSfxVolume === "function") sfx.setSfxVolume(st.sfxVolume ?? 0.8);
      sfx.setMuted(!!st.muted);
    }
    if (this.btnMute) this.btnMute.setAttribute("aria-pressed", st.muted ? "false" : "true");
    if (this.btnCRT) this.btnCRT.setAttribute("aria-pressed", st.crt ? "true" : "false");
    this.setBtnLabel(this.btnMute, "Sound");
    this.setBtnLabel(this.btnCRT, "CRT");

    const root = document.documentElement;
    root.dataset.crt = st.crt ? "on" : "off";
    root.style.setProperty("--crt-k", String(clamp(Number(st.crtIntensity) || 0.75, 0.25, 1)));

    const s = this.settingsEls();
    const setRange = (el, out, v) => {
      if (!el) return;
      const p = Math.round(clamp(v, 0, 1) * 100);
      if (Number(el.value) !== p) el.value = String(p);
      const min = Number(el.min) || 0, max = Number(el.max) || 100;
      el.style.setProperty("--val", `${((p - min) / Math.max(1, max - min)) * 100}%`);
      if (out) out.textContent = `${p}%`;
    };
    setRange(s.music, s.musicOut, st.musicVolume ?? 0.7);
    setRange(s.sfx, s.sfxOut, st.sfxVolume ?? 0.8);
    setRange(s.crtInt, s.crtIntOut, st.crtIntensity ?? 0.75);
    if (s.mute) s.mute.checked = !!st.muted;
    if (s.crt) s.crt.checked = !!st.crt;
    if (s.crtInt) s.crtInt.disabled = !st.crt;
    if (s.motion) {
      const want = st.reduceMotion === true ? "reduced" : st.reduceMotion === false ? "full" : "system";
      if (s.motion.value !== want) s.motion.value = want;
    }
    this.resolveMotion();
    this.syncFullscreenButtons();
  },

  toggleMute() {
    this.setSetting("muted", !this.save.settings.muted);
    this.flushSettingsSave();
    this.announce(this.save.settings.muted ? "Sound off" : "Sound on");
  },

  toggleCRT() {
    this.setSetting("crt", !this.save.settings.crt);
    this.flushSettingsSave();
  },

  // ------------------------- Motion (C6 / UX-10) -------------------------
  // settings.reduceMotion: null follows the OS query, true/false override it. Only :root.reduce-motion is written.
  resolveMotion() {
    if (this._motionMq === undefined) {
      this._motionMq = null;
      try {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onChange = () => { if (this.save.settings.reduceMotion == null) this.resolveMotion(); };
        if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
        else if (typeof mq.addListener === "function") mq.addListener(onChange);
        this._motionMq = mq;
      } catch (_) { this._motionMq = null; }
    }
    const pref = this.save.settings.reduceMotion;
    const system = !!(this._motionMq && this._motionMq.matches);
    const reduce = (pref === null || pref === undefined) ? system : !!pref;
    this.reduceMotion = reduce;
    document.documentElement.classList.toggle("reduce-motion", reduce);
    if (reduce) { this.trauma = 0; this.shake = 0; }
    return reduce;
  },

  motion() {
    return this.reduceMotion ? { shake: 0, flash: 0.3, anim: 0 } : { shake: 1, flash: 1, anim: 1 };
  },

  // ------------------------- Fullscreen (C2) -------------------------
  fullscreenSupported() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  },

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  bindFullscreen() {
    this.fullscreenCalls = 0;
    const onChange = () => this.onFullscreenChange();
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("fullscreenerror", () => this.syncFullscreenButtons());
    this.syncFullscreenButtons();
  },

  // On documentElement (never #main: the fixed modals would hide under the top layer). Orientation lock and the
  // Escape keyboard lock only ever apply inside fullscreen.
  toggleFullscreen() {
    this.fullscreenCalls = (this.fullscreenCalls | 0) + 1;
    try {
      if (this.isFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
        return;
      }
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) return;
      const p = req.call(el, { navigationUI: "hide" });
      if (p && p.then) p.then(() => this.afterEnterFullscreen()).catch(() => this.syncFullscreenButtons());
      else setTimeout(() => this.afterEnterFullscreen(), 50);
    } catch (_) {
      this.syncFullscreenButtons();
    }
  },

  afterEnterFullscreen() {
    if (!this.isFullscreen()) return;
    try {
      if (window.matchMedia("(pointer: coarse)").matches && screen.orientation && typeof screen.orientation.lock === "function") {
        screen.orientation.lock("landscape").catch(() => {});
      }
    } catch (_) {}
    try {
      if (navigator.keyboard && typeof navigator.keyboard.lock === "function") navigator.keyboard.lock(["Escape"]).catch(() => {});
    } catch (_) {}
  },

  onFullscreenChange() {
    const fs = this.isFullscreen();
    this.syncFullscreenButtons();
    if (!fs) {
      try { if (navigator.keyboard && typeof navigator.keyboard.unlock === "function") navigator.keyboard.unlock(); } catch (_) {}
      try { if (screen.orientation && typeof screen.orientation.unlock === "function") screen.orientation.unlock(); } catch (_) {}
      if (this.mode === "playing") this.pauseGame("fullscreen");
    }
    if (typeof this.resizeCanvas === "function") setTimeout(() => this.resizeCanvas(), 60);
  },

  syncFullscreenButtons() {
    const fs = this.isFullscreen();
    const supported = this.fullscreenSupported();
    const btn = this.$("btnFullscreen");
    const fs2 = this.settingsEls().fs2;
    if (btn) {
      btn.classList.toggle("hidden", !supported);
      btn.setAttribute("aria-pressed", fs ? "true" : "false");
    }
    if (fs2) {
      const row = fs2.closest(".settingsRow");
      if (row) row.classList.toggle("hidden", !supported);
      fs2.setAttribute("aria-pressed", fs ? "true" : "false");
      fs2.textContent = fs ? "Exit fullscreen" : "Enter fullscreen";
    }
  },

  // ------------------------- Viewport: soft keyboard + rotate hint (C2) -------------------------
  bindViewport() {
    const vv = window.visualViewport;
    if (vv) {
      const update = () => {
        const h = Math.round(vv.height);
        document.documentElement.style.setProperty("--vvh", `${h}px`);
        document.body.classList.toggle("kb-open", h < window.innerHeight * 0.75);
      };
      vv.addEventListener("resize", update);
      update();
    }

    const hint = this.$("rotateHint");
    if (hint) {
      let mq = null;
      try { mq = window.matchMedia("(pointer: coarse) and (orientation: portrait)"); } catch (_) {}
      const dismissed = () => { try { return !!sessionStorage.getItem(ROTATE_HINT_KEY); } catch (_) { return false; } };
      const update = () => hint.classList.toggle("hidden", !(mq && mq.matches) || dismissed());
      const close = hint.querySelector(".rotateHintClose");
      if (close) {
        close.addEventListener("click", () => {
          try { sessionStorage.setItem(ROTATE_HINT_KEY, "1"); } catch (_) {}
          hint.classList.add("hidden");
        });
      }
      if (mq) {
        if (typeof mq.addEventListener === "function") mq.addEventListener("change", update);
        else if (typeof mq.addListener === "function") mq.addListener(update);
      }
      window.addEventListener("orientationchange", () => setTimeout(update, 50));
      update();
    }
  },

  // ------------------------- Touch input path (C7) -------------------------
  detectTouchMode() {
    try {
      if (window.matchMedia("(pointer: coarse) and (hover: none)").matches) return true;
    } catch (_) {}
    try {
      if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") return navigator.userAgentData.mobile;
    } catch (_) {}
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent || "");
  },

  // A trusted hardware key: the device has a keyboard, the soft-keyboard path and the pill retire.
  noteKeyboardEvidence() {
    this.keyboardSeen = true;
    if (this.touchMode) {
      this.touchMode = false;
      if (this.mode === "playing" && document.activeElement === this.typeInput) this.focusGameCanvas();
    }
    this.hideTapToType();
  },

  bindPlayfieldInput() {
    const canvas = this.canvas;
    const input = this.typeInput;
    const main = this.mainEl || this.$("main");
    const typingRing = () => {
      if (!main) return;
      const a = document.activeElement;
      main.classList.toggle("is-typing", a === canvas || (a === input && this.mode === "playing"));
    };

    // Mouse/pen: focus on pointerdown. Touch: focus on touchend inside the gesture (so the soft keyboard may open)
    // and swallow the synthesized mousedown/click that would hand focus back to the canvas.
    canvas.addEventListener("pointerdown", (e) => {
      if (this.modalStack.length) return;
      this.pokeAudio();
      if (e.pointerType === "touch") return;
      if (this.mode === "playing") { this.focusGameCanvas({ gesture: true }); this.hideTapToType(); }
      else if (document.activeElement !== canvas) { try { canvas.focus({ preventScroll: true }); } catch (_) {} }
    });
    canvas.addEventListener("touchend", (e) => {
      if (this.modalStack.length) return;
      this.pokeAudio();
      if (this.mode !== "playing") return;
      if (e.cancelable) e.preventDefault();
      if (!this.keyboardSeen) this.touchMode = true;
      this.focusGameCanvas({ gesture: true });
      this.hideTapToType();
    }, { passive: false });
    canvas.addEventListener("focus", typingRing);
    canvas.addEventListener("blur", typingRing);

    window.addEventListener("touchstart", () => { if (!this.keyboardSeen) this.touchMode = true; }, { passive: true, once: true });

    if (!input) return;
    this.lastTypeValue = "";
    input.addEventListener("beforeinput", (e) => this.onTypeInputBeforeInput(e));
    input.addEventListener("input", (e) => this.onTypeInputInput(e));
    input.addEventListener("compositionend", () => { input.value = ""; this.lastTypeValue = ""; });
    input.addEventListener("focus", () => {
      this.hideTapToType();
      typingRing();
      requestAnimationFrame(() => { try { window.scrollTo(0, 0); } catch (_) {} });
    });
    input.addEventListener("blur", () => {
      typingRing();
      if (this.mode === "playing" && this.touchMode && !this.keyboardSeen) this.scheduleTapToType(400);
    });
  },

  // Soft keyboards deliver letters here (no keydown). insertText is consumed per code point; composition is
  // diffed on 'input'; Backspace and Space release the lock like their hardware keys.
  onTypeInputBeforeInput(e) {
    const t = e.inputType || "";
    if (t === "insertText" || t === "insertFromPaste" || t === "insertReplacementText") {
      e.preventDefault();
      const data = e.data || "";
      for (const ch of data) this.handleTextInput(ch);
      return;
    }
    if (t === "insertLineBreak" || t === "insertParagraph") { e.preventDefault(); return; }
    if (t.startsWith("delete")) {
      e.preventDefault();
      this.handleTextInput("\b");
    }
    // insertCompositionText (and anything with null data) goes through; onTypeInputInput diffs the value.
  },

  onTypeInputInput(e) {
    const el = this.typeInput;
    if (!el) return;
    const v = el.value || "";
    const prev = this.lastTypeValue || "";
    const appended = v.startsWith(prev) ? v.slice(prev.length) : v;
    for (const ch of appended) this.handleTextInput(ch);
    if (e && (e.isComposing || e.inputType === "insertCompositionText")) {
      this.lastTypeValue = v;
      return;
    }
    el.value = "";
    this.lastTypeValue = "";
  },

  // One typed code point from the text-input path -> the same handleTyped(ch) the keyboard uses (NFKD, a-z only).
  handleTextInput(ch) {
    if (ch == null) return;
    const raw = String(ch);
    if (raw === "\b" || raw === " " || raw === "　") {
      if (this.mode === "playing" && this.lock && !this.inBoss) this.releaseLock("manual");
      this.hideTapToType();
      return;
    }
    const folded = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase();
    if (!/^[a-z]$/.test(folded)) return;
    this.hideTapToType();
    this.pokeAudio();
    if (!this.audioReady && !this.audioUnavailable) {
      this.ensureAudio().then(() => this.handleTyped(folded));
      return;
    }
    this.handleTyped(folded);
  },

  scheduleTapToType(ms = TAP_TO_TYPE_DELAY_MS) {
    clearTimeout(this._tapToTypeTimer);
    this._tapToTypeTimer = null;
    if (!this.tapToType || !this.touchMode || this.keyboardSeen) return;
    this._tapToTypeTimer = setTimeout(() => {
      this._tapToTypeTimer = null;
      if (this.mode !== "playing" || !this.touchMode || this.keyboardSeen) return;
      if (document.activeElement === this.typeInput) return;
      this.tapToType.classList.remove("hidden");
    }, ms);
  },

  hideTapToType() {
    clearTimeout(this._tapToTypeTimer);
    this._tapToTypeTimer = null;
    if (this.tapToType) this.tapToType.classList.add("hidden");
  },

  // ------------------------- Menu -------------------------
  refreshMenu() {
    this.ui.playerName.value = this.save.playerName || "";
    this.ui.statHigh.textContent = formatInt(this.save.highScore || 0);
    this.ui.statUnlocked.textContent = `${this.save.lastUnlockedLevel || 1}/10`;
    const resumeIndex = getResumeLevelIndex(this.save);
    const canContinue = resumeIndex !== null;
    this.btnContinue.disabled = !canContinue;
    this.btnContinue.classList.toggle("disabled", !canContinue);
    const shipId = this.getSelectedShipId();
    this.shipInputs.forEach(input => {
      input.checked = (input.value === shipId);
    });
    if (typeof this.renderMenuScreens === "function") this.renderMenuScreens();
  },

  storeAndRefresh() {
    storeSave(this.save);
    this.refreshMenu();
  },
});
