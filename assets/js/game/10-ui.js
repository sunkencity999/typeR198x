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

  prepareShipSprite(img) {
    if (SKIP_CORS_IMAGES) return img;
    const canvas = document.createElement("canvas");
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    try {
      const data = ctx.getImageData(0, 0, w, h);
      const pixels = data.data;
      // sample corners to determine background color
      const sample = (x, y) => {
        const idx = (y * w + x) * 4;
        return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
      };
      const base = sample(0, 0);
      const tol = 12;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        if (Math.abs(r - base[0]) <= tol && Math.abs(g - base[1]) <= tol && Math.abs(b - base[2]) <= tol) {
          pixels[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
    } catch {
      // ignore security errors, fallback to original image
      return img;
    }
    return canvas;
  },
  focusGameCanvas() {
    if (!this.canvas) return;
    if (document.activeElement !== this.canvas) {
      this.canvas.focus({ preventScroll: true });
    }
  },

  bindUI() {
    this.btnStart.addEventListener("click", async () => {
      await this.ensureAudio();
      const name = (this.ui.playerName.value || "").trim();
      if (name) this.save.playerName = name;
      this.save.run = null;
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
        this.save.run = buildResumeRun(resumeIndex, this.player.maxHp, this.getSelectedShipId());
        storeSave(this.save);
        this.continueRun();
        this.focusGameCanvas();
        return;
      }
      this.handleLaunchRequest();
    });

    this.btnResetSave.addEventListener("click", () => {
      this.save = defaultSave();
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

    // Keyboard
    window.addEventListener("keydown", async (e) => {
      if (e.repeat) return;

      const target = e.target;
      const tag = (target && target.tagName) ? target.tagName.toLowerCase() : "";
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (target && target.isContentEditable) ||
        (document.activeElement && document.activeElement.isContentEditable);
      if (isEditable) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (this.mode === "playing" || this.mode === "paused") this.togglePause();
        return;
      }

      if (this.mode !== "playing") return;
      const ch = normalizeKey(e);
      if (!ch) return;

      e.preventDefault();
      await this.ensureAudio();
      this.handleTyped(ch);
    });

    this.bindLifecycle();
  },

  // Page lifecycle: pause + save on blur/hidden, stop the rAF while hidden, save on pagehide (F091).
  bindLifecycle() {
    window.addEventListener("blur", () => {
      if (this.mode === "playing") this.pauseGame("blur");
      this.saveRun(true);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.onPageHidden();
      else this.onPageVisible();
    });

    window.addEventListener("pagehide", () => {
      this.saveRun(true);
    });

    window.addEventListener("beforeunload", () => {
      this.saveRun(true);
    });
  },

  onPageHidden() {
    if (this.mode === "playing") this.pauseGame("hidden");
    this.saveRun(true);
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

  async ensureAudio() {
    if (this.audioUnavailable) return;
    try {
      await this.sfx.unlock();
      this.sfx.setMuted(this.save.settings.muted);
    } catch (err) {
      console.warn("Audio init failed; continuing without sound", err);
      this.audioUnavailable = true;
    }
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

  registerAsset(img, onLoad) {
    this.pendingAssets = (this.pendingAssets ?? 0) + 1;
    const finalize = () => {
      if (onLoad) onLoad();
      this.pendingAssets = Math.max(0, this.pendingAssets - 1);
      this.checkLoadingOverlay();
    };
    img.addEventListener("load", finalize, { once: true });
    img.addEventListener("error", finalize, { once: true });
  },

  checkLoadingOverlay() {
    if (!this.loadingOverlay) return;
    if (this.pendingAssets > 0) return;
    if (this.assetsReady) return;
    this.assetsReady = true;
    requestAnimationFrame(() => this.loadingOverlay.classList.add("hidden"));
  },
});
