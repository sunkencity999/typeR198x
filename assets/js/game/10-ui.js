// Type-R 198X — UI / boot / menu / asset loading. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // Ship-picker helpers (getSelectedShipId/setPlayerShip/currentShipId) live here with the menu code that owns ship selection.
  // The window keydown listener is registered inline inside bindUI (unchanged); typing logic itself is in 30-input.js.

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

  focusGameCanvas() {
    if (!this.canvas) return;
    if (document.activeElement !== this.canvas) {
      this.canvas.focus({ preventScroll: true });
    }
  },

  // Game Over gains #btnRetryBoss and #retryNote when index.html lacks them (see HANDOFF.md); the retry
  // buttons carry the checkpoint copy.
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
    if (!document.getElementById("retryNote")) {
      const p = document.createElement("p");
      p.id = "retryNote";
      p.className = "small";
      p.textContent = "Score returns to sector start";
      const host = (this.btnTryAgain && this.btnTryAgain.parentElement && this.btnTryAgain.parentElement.parentElement) || over;
      host.appendChild(p);
    }
  },

  bindUI() {
    this.ensureGameOverControls();

    this.btnStart.addEventListener("click", async () => {
      await this.ensureAudio();
      const name = (this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.commitHighScore(); // the abandoned run's score counts (F009)
      this.save.run = null;
      this.run = null;
      this.storeAndRefresh();
      this.handleLaunchRequest();
    });

    this.btnContinue.addEventListener("click", async () => {
      await this.ensureAudio();
      const name = (this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.storeAndRefresh();
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
      this.handleLaunchRequest();
    });

    this.btnResetSave.addEventListener("click", () => {
      this.save = defaultSave();
      this.run = null;
      this.runMeta = null;
      this._hsCommitted = null;
      storeSave(this.save);
      this.applySettings();
      this.refreshMenu();
    });

    this.btnPause.addEventListener("click", () => this.togglePause());
    this.btnStop.addEventListener("click", () => this.stopToMenu(true));
    this.btnMute.addEventListener("click", () => this.toggleMute());
    this.btnCRT.addEventListener("click", () => this.toggleCRT());

    this.btnResume.addEventListener("click", () => { this.setMode("playing"); this.focusGameCanvas(); });
    this.btnRestart.addEventListener("click", () => { this.restartLevel(); this.focusGameCanvas(); });

    this.btnNextLevel.addEventListener("click", () => { this.advanceLevel(); this.focusGameCanvas(); });
    this.btnBackToMenu1.addEventListener("click", () => this.stopToMenu(true));
    this.btnBackToMenu2.addEventListener("click", () => this.stopToMenu(true));
    this.btnBackToMenu3.addEventListener("click", () => this.stopToMenu(true));
    this.btnTryAgain.addEventListener("click", () => { this.restartLevel(); this.focusGameCanvas(); });
    if (this.btnRetryBoss) this.btnRetryBoss.addEventListener("click", () => { this.retryBoss(); this.focusGameCanvas(); });
    this.btnNewRun.addEventListener("click", () => { this.startNewRun(); this.focusGameCanvas(); });

    if (this.ui.endingNext) {
      this.ui.endingNext.addEventListener("click", () => this.advanceEndingDialogue());
    }
    if (this.ui.endingSkip) {
      this.ui.endingSkip.addEventListener("click", () => this.skipEndingDialogue());
    }

    if (this.keyboardHintBtn) {
      this.keyboardHintBtn.addEventListener("click", () => this.dismissKeyboardHint());
    }

    if (this.storyLaunchBtn) {
      this.storyLaunchBtn.addEventListener("click", () => {
        this.hideStoryModal();
        if (this.pendingLaunch === "continue") {
          this.startGameplayFlow(false);
        } else {
          this.startGameplayFlow(true);
        }
      });
    }

    this.shipInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.save.selectedShip = input.value;
        storeSave(this.save);
      });
    });

    // Keyboard (routing order lives in 30-input.js onKeyDown)
    window.addEventListener("keydown", (e) => this.onKeyDown(e));

    this.bindLifecycle();
  },

  // Page lifecycle: pause + save on blur/hidden, stop the rAF while hidden, save on pagehide (F091).
  bindLifecycle() {
    window.addEventListener("blur", () => {
      if (this.mode === "playing") this.pauseGame("blur");
      this.saveRun(true);
      this.commitHighScore();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.onPageHidden();
      else this.onPageVisible();
    });

    window.addEventListener("pagehide", () => {
      this.saveRun(true);
      this.commitHighScore();
    });

    window.addEventListener("beforeunload", () => {
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

  // Unlock audio once (memoised while in flight). Resolves immediately after the first success, so
  // keystrokes never wait on it (A4).
  ensureAudio() {
    if (this.audioReady || this.audioUnavailable) return Promise.resolve();
    if (this._audioPromise) return this._audioPromise;
    this._audioPromise = (async () => {
      try {
        await this.sfx.unlock();
        this.sfx.setMuted(this.save.settings.muted);
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

  // ------------------------- Toasts (primitive; C8 adds the tutorial kinds) -------------------------
  // #toastStack lives in #main (created here when index.html lacks it); style.css carries .toastStack/.toast.
  ensureToastStack() {
    if (this.toastStack && this.toastStack.isConnected) return this.toastStack;
    let el = document.getElementById("toastStack");
    if (!el) {
      el = document.createElement("div");
      el.id = "toastStack";
      el.className = "toastStack";
      el.setAttribute("aria-hidden", "true");
      (document.getElementById("main") || document.body).appendChild(el);
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
    if (typeof this.announce === "function") this.announce(text);
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

  applySettings() {
    this.sfx.setMuted(this.save.settings.muted);
    this.btnMute.textContent = this.save.settings.muted ? "Unmute" : "Mute";
    this.ui.crtOverlay.style.display = this.save.settings.crt ? "block" : "none";
    this.btnCRT.textContent = this.save.settings.crt ? "CRT:ON" : "CRT:OFF";
  },

  toggleMute() {
    this.save.settings.muted = !this.save.settings.muted;
    this.applySettings();
    storeSave(this.save);
  },

  toggleCRT() {
    this.save.settings.crt = !this.save.settings.crt;
    this.applySettings();
    storeSave(this.save);
  },

  togglePause() {
    if (this.mode === "playing") this.pauseGame("user");
    else if (this.mode === "paused") this.setMode("playing");
  },

  setMode(m) {
    this.mode = m;
    document.body.dataset.mode = m;
    // screens: .hidden (today's CSS) + .is-active (C1's transitions)
    const screens = {
      menu: this.ui.menu,
      paused: this.ui.paused,
      levelComplete: this.ui.levelComplete,
      gameOver: this.ui.gameOver,
      victory: this.ui.victory
    };
    for (const key of Object.keys(screens)) {
      const el = screens[key];
      if (!el) continue;
      const active = key === m;
      el.classList.toggle("hidden", !active);
      el.classList.toggle("is-active", active);
    }
    // Pause button label
    this.btnPause.textContent = (m === "paused") ? "Resume" : "Pause";
    if (m === "paused") {
      // Freeze-frame: the pause screen sits on a still canvas.
      this.trauma = 0;
      this.shake = 0;
      // Restart is unavailable while a finale is banking the clear (F039).
      if (this.btnRestart) this.btnRestart.classList.toggle("hidden", !!this.bossClear);
      if (this.ui.pauseReason) {
        const copy = { user: "Paused", blur: "Window lost focus", hidden: "Tab hidden", fullscreen: "Left fullscreen" };
        this.ui.pauseReason.textContent = copy[this.pauseReason] || copy.user;
      }
    } else {
      this.pauseReason = "user";
    }
    // Autosave when leaving playing
    if (m !== "playing") this.saveRun(true);
    // Focus canvas
    if (m === "playing") this.canvas.focus();
    this.requestFrame();
  },

  // ------------------------- Ending dialogue (victory) -------------------------
  resetEndingDialogue() {
    this.endingScript = getVictoryScript();
    this.endingIndex = 0;
    const u = this.ui;
    if (u.endingStage) { u.endingStage.textContent = ""; u.endingStage.classList.add("hidden"); }
    if (u.endingSpeaker) { u.endingSpeaker.textContent = ""; u.endingSpeaker.classList.add("hidden"); }
    if (u.endingLine) u.endingLine.textContent = "";
    if (u.creditsLine) u.creditsLine.classList.add("hidden");
    if (this.btnNewRun) this.btnNewRun.classList.add("hidden");
    if (u.endingNext) u.endingNext.classList.remove("hidden");
    if (u.endingSkip) u.endingSkip.classList.remove("hidden");
  },

  showEndingLine(i) {
    const n = this.endingScript.length;
    const line = this.endingScript[i];
    if (!line) return;
    const u = this.ui;
    if (u.endingStage) { u.endingStage.textContent = `TRANSMISSION ${i + 1}/${n}`; u.endingStage.classList.remove("hidden"); }
    if (u.endingSpeaker) { u.endingSpeaker.textContent = line.speaker || ""; u.endingSpeaker.classList.remove("hidden"); }
    if (u.endingLine) u.endingLine.textContent = line.text || "";
    const win = u.endingLine ? u.endingLine.closest(".dialogueWindow") : null;
    if (win) win.dataset.speaker = (line.speaker || "").toLowerCase().replace(/[^a-z]+/g, "-");
  },

  advanceEndingDialogue() {
    const n = this.endingScript.length;
    if (this.endingIndex >= n) { this.finishEndingDialogue(); return; }
    this.showEndingLine(this.endingIndex);
    this.endingIndex++;
    if (this.endingIndex >= n) this.finishEndingDialogue();
  },

  skipEndingDialogue() {
    const n = this.endingScript.length;
    if (n) this.showEndingLine(n - 1);
    this.endingIndex = n;
    this.finishEndingDialogue();
  },

  // Last line shown: reveal Play again + credits, retire Next/Skip.
  finishEndingDialogue() {
    const u = this.ui;
    if (u.creditsLine) u.creditsLine.classList.remove("hidden");
    if (this.btnNewRun) this.btnNewRun.classList.remove("hidden");
    if (u.endingNext) u.endingNext.classList.add("hidden");
    if (u.endingSkip) u.endingSkip.classList.add("hidden");
    if (this.btnNewRun && this.mode === "victory") {
      try { this.btnNewRun.focus({ preventScroll: true }); } catch (_) {}
    }
  },

  refreshMenu() {
    this.ui.playerName.value = this.save.playerName || "";
    this.ui.statHigh.textContent = formatInt(this.save.highScore || 0);
    this.ui.statUnlocked.textContent = `${this.save.lastUnlockedLevel || 1}/10`;
    const resumeIndex = getResumeLevelIndex(this.save);
    const canContinue = resumeIndex !== null;
    this.btnContinue.disabled = !canContinue;
    this.btnContinue.classList.toggle("disabled", !canContinue);
    // Stopgap until renderResumeCard (C5) owns the card: Continue must be clickable whenever a run can resume.
    document.getElementById("resumeCard")?.classList.toggle("hidden", !canContinue);
    const shipId = this.getSelectedShipId();
    this.shipInputs.forEach(input => {
      input.checked = (input.value === shipId);
    });
  },

  handleLaunchRequest() {
    const shipPicked = !!this.getSelectedShipId();
    if (!shipPicked) return;
    if (this.storyModal && !this.save.storySeen) {
      this.pendingLaunch = "new";
      this.showStoryModal();
    } else {
      this.startGameplayFlow(true);
    }
  },

  showStoryModal() {
    this.storyModal.classList.remove("hidden");
    this.storyLaunchBtn?.focus();
  },

  hideStoryModal() {
    this.storyModal?.classList.add("hidden");
  },

  startGameplayFlow(resetRun) {
    if (resetRun) this.startNewRun();
    else this.continueRun();
    this.save.storySeen = true;
    storeSave(this.save);
    this.focusGameCanvas();
  },

  maybeShowKeyboardHint() {
    if (this.save.keyboardHintSeen) return;
    const prefersTouch = ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 1) ||
      /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    const narrow = window.matchMedia("(max-width: 820px)").matches;
    if (!(prefersTouch || narrow)) return;
    this.keyboardHintModal?.classList.remove("hidden");
  },

  dismissKeyboardHint() {
    this.keyboardHintModal?.classList.add("hidden");
    this.save.keyboardHintSeen = true;
    storeSave(this.save);
  },

  storeAndRefresh() {
    storeSave(this.save);
    this.refreshMenu();
  },
});
