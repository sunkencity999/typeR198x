// Type-R 198X — typing input, lock rules v2 (SYS-01), scoring hooks (SYS-07/SYS-09). Methods are mixed into Game.prototype; load order is defined in index.html.
const MODE_SETTLE_MS = 350;   // review R26: Level Complete / Game Over / Victory ignore a trusted Enter / Space this long after appearing

Object.assign(Game.prototype, {
  // ------------------------- Keydown routing (CONTRACT §10) -------------------------
  // Order follows CONTRACT section 10: modal stack, editable targets, fullscreen combos, Tab trap, Escape, Enter, repeat guard,
  // non-play keys, release keys, modifier filter, diagnostics, normalise + type.
  isReleaseKey(e) {
    return e.key === " " || e.key === "Backspace";
  },

  onKeyDown(e) {
    // 1. modal stack (C1): Escape cancels the top modal, Tab wraps inside it, Enter on a non-control clicks its
    //    primary; every other key stays native (sliders, selects, text fields inside the modal keep working).
    if (this.modalStack && this.modalStack.length) {
      const top = this.modalStack[this.modalStack.length - 1];
      if (e.key === "Escape") { e.preventDefault(); if (!e.repeat) this.cancelModal(top.el); return; }
      if (e.key === "Tab") { this.trapFocus(top.el, e); return; }
      if (e.key === "Enter" || e.key === "NumpadEnter") {
        const a = document.activeElement;
        const control = a && top.el.contains(a) && /^(button|input|select|textarea|a|summary)$/i.test(a.tagName);   // review R5: summary
        if (control) return; // native activation
        const primary = this.modalPrimary(top);
        e.preventDefault();
        if (primary && !e.repeat) primary.click();
      }
      return;
    }

    // 2. editable targets keep native behaviour; #typeInput (C7) only passes Escape/Enter/Tab here.
    const target = e.target;
    const tag = (target && target.tagName) ? target.tagName.toLowerCase() : "";
    const isTypeInput = !!(target && target.id === "typeInput");
    const isEditable = !isTypeInput && (
      tag === "input" || tag === "textarea" || tag === "select" ||
      (target && target.isContentEditable) ||
      (document.activeElement && document.activeElement.isContentEditable));
    if (e.isTrusted && /^(Key[A-Z]|Digit\d|Space)$/.test(e.code || "")) this.noteKeyboardEvidence();
    const fsCombo = ((e.key === "Enter" || e.key === "NumpadEnter") && (e.altKey || e.metaKey)) || e.key === "F11";
    // review R11: the pause screen's own settings controls still honour Esc / F1 / fullscreen / M (arrows and Space stay native).
    const pauseSettingsCtl = isEditable && this.mode === "paused" && !!(target.closest && target.closest("#settingsPanel"));
    const passThrough = pauseSettingsCtl && (e.key === "Escape" || e.key === "F1" || fsCombo || e.key === "m" || e.key === "M");
    if (isEditable && !passThrough) return;
    if (isTypeInput && !fsCombo && !["Escape", "Enter", "NumpadEnter", "Tab"].includes(e.key)) return;

    // 3. fullscreen combos (C2): Alt+Enter / Meta+Enter / F11.
    if (fsCombo) {
      if (typeof this.toggleFullscreen === "function") {
        e.preventDefault();
        if (!e.repeat) this.toggleFullscreen();
        return;
      }
    }

    // 4. Tab outside play wraps inside the active screen (plus the top bar); in play it stays native.
    if (e.key === "Tab" && this.mode !== "playing") {
      const screen = document.querySelector(".screen.is-active");
      // review R6: the same regions syncInert releases, so the footer links are reachable
      if (screen) { this.trapFocus([document.getElementById("topBar"), screen, document.querySelector(".footer"), document.getElementById("rotateHint")], e); return; }
    }

    // 5. Escape by mode.
    if (e.key === "Escape") {
      e.preventDefault();
      if (e.repeat) return;
      switch (this.mode) {
        case "playing":
        case "paused": this.togglePause(); break;
        case "levelComplete":
        case "gameOver": this.uiTick("back"); this.stopToMenu(true); break;
        case "victory":
          if (this.ui.endingNext && !this.ui.endingNext.classList.contains("hidden")) this.skipEndingDialogue();
          else { this.uiTick("back"); this.stopToMenu(true); }
          break;
        default: break; // menu: modals are closed in step 1; nothing else to back out of
      }
      return;
    }

    // 5b. review R26: for MODE_SETTLE_MS after Level Complete / Game Over / Victory appear, a trusted Enter or Space is
    //     consumed even on the focused primary (the second Enter of a finale skip must not start the next sector).
    if (e.isTrusted && (e.key === "Enter" || e.key === "NumpadEnter" || e.key === " ") &&
        (this.mode === "levelComplete" || this.mode === "gameOver" || this.mode === "victory") &&
        nowMs() - (this._modeAt || 0) < MODE_SETTLE_MS) {
      e.preventDefault();
      return;
    }

    // 6. Enter / NumpadEnter. Playing: finale skip from 2.0 s, boss-intro skip for returning players; otherwise
    //    ignored and never counted. Other modes: native when a control inside the active screen has focus, else
    //    the mode's primary action. A focused link follows natively in every mode (review R6).
    if (e.key === "Enter" || e.key === "NumpadEnter") {
      const a = document.activeElement;
      if (a && a.closest && a.closest("a[href]")) return;   // review R6: a focused link follows natively in every mode
      if (this.mode === "playing") {
        e.preventDefault();
        if (e.repeat) return;
        if (this.bossClear) { this.skipFinale("enter"); return; }
        if (this.bossIntro && this.bossIntro.locked) this.skipBossIntro();
        return;
      }
      const screen = document.querySelector(".screen.is-active");
      const inScreen = a && (screen && screen.contains(a) || (a.closest && a.closest("#topBar")));
      const control = inScreen && /^(button|input|select|textarea|a)$/i.test(a.tagName);
      if (control) return;
      e.preventDefault();
      if (e.repeat) return;
      const primary = this.primaryFor(this.mode);
      if (primary && !primary.disabled && this.isVisible(primary)) primary.click();
      return;
    }

    // 7. repeat guard: auto-repeat of a key the game owns is swallowed while playing (G007).
    if (e.repeat) {
      if (this.mode === "playing" && (normalizeKey(e) || this.isReleaseKey(e))) e.preventDefault();
      return;
    }

    // 8. not playing: ? / F1 help (menu, paused), m mute (menu, paused).
    if (this.mode !== "playing") {
      if (this.mode === "menu" || this.mode === "paused") {
        if (e.key === "?" || e.key === "F1") { e.preventDefault(); this.showHelp(); return; }
        if (e.key === "m" || e.key === "M") { e.preventDefault(); this.toggleMute(); return; }
      }
      return;
    }

    // 9. Space / Backspace: lock release (B1); during the finale they skip it. Never counted.
    if (this.isReleaseKey(e)) {
      e.preventDefault();
      if (this.bossClear) { this.skipFinale("space"); return; }
      if (this.lock && !this.inBoss) this.releaseLock("manual");
      return;
    }

    // 10. modifier filter: shortcuts stay with the browser and are never preventDefault'ed (F042).
    const altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGraph && !(e.ctrlKey && e.altKey)) return;

    // 11. layout / IME diagnostics (toast once per run per kind, never auto-pause).
    this.noteInputDiagnostic(e);

    // 12. normalise and type.
    const ch = normalizeKey(e);
    if (!ch) return;
    e.preventDefault();
    this.keyboardSeen = true;
    this.pokeAudio();
    if (!this.audioReady && !this.audioUnavailable) {
      // Only keystrokes before the first successful unlock wait for audio; afterwards typing never awaits.
      this.ensureAudio().then(() => this.handleTyped(ch));
      return;
    }
    this.handleTyped(ch);
  },

  // Resume a suspended context on a gesture; when it still needs one, say so (audio-HANDOFF §2).
  pokeAudio() {
    const sfx = this.sfx;
    if (!sfx) return;
    if (typeof sfx.resumeIfNeeded === "function") sfx.resumeIfNeeded();
    if (sfx.needsGesture && typeof this.showToast === "function") {
      this.showToast("TAP TO RESTORE AUDIO", { key: "audio", kind: "warn" });
    }
  },

  // Layout / IME strikes (G001, G002): three non-Latin keys without a correct hit in between, or three
  // composing events, raise one warn toast per run per kind.
  noteInputDiagnostic(e) {
    const k = e.key;
    const nonLatin = typeof k === "string" && k.length === 1 && !/^[a-z0-9 ]$/i.test(k) && /^Key[A-Z]$/.test(e.code || "");
    const ime = !!(e.isComposing || k === "Process" || e.keyCode === 229);
    if (nonLatin) this.layoutStrikes++;
    if (ime) this.imeStrikes++;
    if (this.layoutStrikes >= 3 && !this.toastOnce.has("layout")) {
      this.toastOnce.add("layout");
      this.showToast("NON-LATIN LAYOUT DETECTED: KEYS MAP BY QWERTY POSITION", { kind: "warn", key: "layout", ms: 6000 });
    }
    if (this.imeStrikes >= 3 && !this.toastOnce.has("ime")) {
      this.toastOnce.add("ime");
      this.showToast("IME IS COMPOSING: SWITCH TO DIRECT INPUT TO PLAY", { kind: "warn", key: "ime", ms: 6000 });
    }
  },

  noteCorrectKey() {
    this.layoutStrikes = 0;
    this.imeStrikes = 0;
  },

  // ------------------------- Targetability -------------------------
  // Lockable once the plate's left edge is inside the canvas (CONTRACT §4); dying plates are never targets.
  isTargetable(obj) {
    if (!obj || obj.alive === false || obj.dying) return false;
    const half = (obj.plateW || 60) / 2;
    return obj.x - half <= this.w - TARGETABLE_MARGIN;
  },

  hasVisibleTargets() {
    if (this.inBoss && this.boss) return true;
    for (const en of this.enemies) if (this.isTargetable(en)) return true;
    for (const p of this.powerups) if (this.isTargetable(p)) return true;
    return false;
  },

  // Typing is ignored (not counted) during the sector card, a locked boss intro and while the level gate is shut.
  inputLockedOut() {
    if (this.levelIntro) return true;
    if (this.bossIntro && this.bossIntro.locked) return true;
    if (typeof this.isLevelGateOpen === "function" && !this.isLevelGateOpen()) return true;
    return false;
  },

  // Drawing helper kept for the renderer: generous on-screen test (NOT the lock rule).
  isEntityVisible(obj, padding = 20) {
    if (!obj) return false;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const radius = obj.radius ?? 20;
    return (x + radius) >= -padding && (x - radius) <= (this.w + padding) && y >= -padding && y <= (this.h + padding);
  },

  // ------------------------- Lock rules -------------------------
  // Enemies first (nearest to the ship wins), powerups only when no enemy wants the key.
  findLockCandidate(ch) {
    let best = null;
    for (const en of this.enemies) {
      if (!this.isTargetable(en) || en.nextChar() !== ch) continue;
      if (!best || en.x < best.x) best = en;
    }
    if (best) return { ref: best, kind: "enemy" };
    for (const p of this.powerups) {
      if (!this.isTargetable(p) || p.nextChar() !== ch) continue;
      if (!best || p.x < best.x) best = p;
    }
    return best ? { ref: best, kind: "powerup" } : null;
  },

  acquireLock(ref, kind) {
    this.lock = { kind, ref };
    ref.locked = true;
    ref.cleanSoFar = true;
    this.lockMisses = 0;
    this.sfx.lock(kind);
    return this.lock;
  },

  // reason: 'manual' (Space/Backspace), 'lost' (three wrong keys), 'dead' (target left or died: silent).
  releaseLock(reason = "manual") {
    const lock = this.lock;
    if (!lock) return;
    const ref = lock.ref;
    this.lock = null;
    this.lockMisses = 0;
    if (ref) {
      ref.locked = false;
      if (reason === "manual" || reason === "lost") ref.progress = 0;
    }
    if (reason === "manual") {
      this.sfx.lockRelease();
      if (ref) this.addFloater(ref.x, ref.y - 30, "LOCK RELEASED", "white", 14);
    } else if (reason === "lost") {
      this.sfx.lockLost();
      if (ref) this.addFloater(ref.x, ref.y - 30, "LOCK LOST", "danger", 14);
      if (typeof this.announce === "function") this.announce("Lock lost"); // review R48: the floater is canvas-only
    }
  },

  // ------------------------- Typing -------------------------
  // Order (CONTRACT §10): finale skip -> intro lockouts -> boss branch -> lock branch.
  handleTyped(ch) {
    if (this.bossClear) { this.skipFinale("key"); return; }
    if (this.mode !== "playing") return;
    if (this.inputLockedOut()) {
      if (this.bossIntro && this.bossIntro.locked) this.skipBossIntro();
      else if (typeof this.canSkipLevelIntro === "function" && typeof this.skipLevelIntro === "function" && this.canSkipLevelIntro()) this.skipLevelIntro();
      return;
    }
    // Everything this key scores uses the multiplier in effect when it arrived; a tier reached by this key
    // pays from the next one.
    this.keyMult = this.stats.mult | 0 || 1;
    try {
      this.handleTypedInner(ch);
    } finally {
      this.keyMult = null;
    }
  },

  scoringMult() {
    return this.keyMult || (this.stats.mult | 0) || 1;
  },

  handleTypedInner(ch) {
    if (this.inBoss && this.boss) {
      this.handleBossTyped(ch);
      return;
    }

    const lock = this.lock;
    if (lock && lock.ref && lock.ref.alive && !lock.ref.dying) {
      const ref = lock.ref;
      if (ch === ref.nextChar()) {
        this.lockMisses = 0;
        this.onCorrectKey(ref);
      } else {
        this.lockMisses = (this.lockMisses | 0) + 1;
        this.onHardMiss(ref);
        if (this.lockMisses >= 3) this.releaseLock("lost");
      }
      return;
    }
    if (lock) this.releaseLock("dead");

    const cand = this.findLockCandidate(ch);
    if (cand) {
      this.acquireLock(cand.ref, cand.kind);
      this.onCorrectKey(cand.ref);
      return;
    }
    if (this.hasVisibleTargets()) this.onHardMiss(null);
    else this.onDryFire();
  },

  // A correct key on an enemy or powerup lock: stats, combo, laser, weapon side-effects, kill / collect.
  onCorrectKey(ref) {
    this.noteCorrectKey();
    this.countCorrect();
    const len = ref.kind === "powerup" ? ref.label.length : ref.text.length;
    this.fireLaserTo(ref.x, ref.y, this.power.multiplier > 0 ? "lime" : (this.power.spread > 0 ? "magenta" : "cyan"));
    ref.progress++;
    ref.flash = 0.18;
    this.sfx.zap(clamp(ref.progress / Math.max(1, len), 0, 1));

    const ch = ref.kind === "powerup" ? ref.label[ref.progress - 1] : ref.text[ref.progress - 1];
    if (typeof this.onKeyFx === "function") this.onKeyFx(ref, ch); // camera track: recoil, heat, flinch, glyph eject
    if (ref.kind !== "powerup") {
      if (this.power.pierce > 0) this.applyPierce(ref, ch);
      if (this.power.rapid > 0) this.applyRapid(ref, ch);
    }

    if (ref.progress >= len) {
      if (ref.kind === "powerup") this.collectPowerup(ref);
      else this.killEnemy(ref);
      if (this.lock && this.lock.ref === ref) { this.lock = null; this.lockMisses = 0; }
    } else {
      this.addSparks(ref.x, ref.y, 6);
    }
  },

  // Shared bookkeeping for every counted correct character (enemy, powerup, boss char, minion letter).
  countCorrect() {
    this.stats.total++;
    this.stats.correct++;
    this.stats.chars++;
    this.stats.combo++;
    if (this.stats.combo > (this.stats.maxCombo | 0)) this.stats.maxCombo = this.stats.combo;
    const ls = this.levelStats;
    ls.total++; ls.correct++; ls.chars++;
    if (this.stats.combo > (ls.maxCombo | 0)) ls.maxCombo = this.stats.combo;
    this.noteTypedChar();
    this.bumpMultiplier();
  },

  // Hard miss: wrong key while locked, or nothing matches while targets are visible. Counted, combo breaks,
  // never a score penalty (F033).
  onHardMiss(ref) {
    this.stats.total++;
    this.stats.misses++;
    this.levelStats.total++;
    if (ref) {
      ref.cleanSoFar = false;
      ref.typoT = 0.12;
      ref.flinch = 1;
    }
    const lost = this.stats.combo | 0;
    this.onComboBreak(lost);
    if (lost < 10) this.sfx.error();
    this.typoFlash = 0.08;
  },

  // Dry fire: nothing on screen to type. Nothing changes but a quiet buzz.
  onDryFire() {
    this.sfx.error(0.45);
  },

  // ------------------------- Combo / multiplier -------------------------
  // Returns { old, new }; onMultTier fires only when the BASE tier rose (MULTI pickups do not announce).
  bumpMultiplier() {
    const old = this.stats.mult | 0 || 1;
    const baseTier = comboTier(this.stats.combo | 0);
    const bonus = this.power.multiplier > 0 ? MULTI_TIER_BONUS : 0;
    const next = Math.min(MULT_CAP, baseTier + bonus);
    this.stats.mult = next;
    const prevBase = this._baseTier | 0 || 1;
    this._baseTier = baseTier;
    if (baseTier > prevBase && next > old) this.onMultTier(next, old);
    return { old, new: next };
  },

  onMultTier(newMult, oldMult) {
    this.sfx.comboTier(newMult);
    this.showBanner({ kind: "callout", title: `x${newMult} MULTIPLIER`, color: this.tierColor(newMult) });
  },

  onComboBreak(lost) {
    this.stats.combo = 0;
    this._baseTier = 1;
    this.bumpMultiplier();
    if (lost >= 10) {
      this.sfx.comboBreak(lost);
      this.addFloater(this.player.x + 20, this.player.y - 60, `COMBO LOST -${lost}`, "danger", 16);
    }
  },

  tierColor(mult) {
    return mult >= 4 ? "amber" : mult === 3 ? "violet" : mult === 2 ? "cyan" : "white";
  },

  // ------------------------- Score sink -------------------------
  // The single scoring entry: applies diff().score, banks into stats/levelStats and shows a floater.
  // Callers pass the multiplied amount for kills/pickups/boss chars and the flat amount for bonuses.
  addScore(amount, opts = {}) {
    const n = Math.round(Math.max(0, amount) * (this.diff().score || 1));
    if (n <= 0) return 0;
    this.stats.score += n;
    this.levelStats.levelScore = (this.levelStats.levelScore | 0) + n;
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      const text = opts.label ? `${opts.label} +${formatInt(n)}` : `+${formatInt(n)}`;
      const color = opts.kind === "bonus" ? "amber" : this.tierColor(this.stats.mult | 0);
      this.addFloater(opts.x, opts.y, text, color, opts.kind === "bonus" ? 20 : 16);
    }
    return n;
  },
});
