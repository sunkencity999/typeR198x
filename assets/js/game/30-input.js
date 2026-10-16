// Type-R 198X — typing input, lock acquisition, combo/multiplier. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // isEntityVisible is the lock-acquisition visibility filter used by handleTyped.

  // ------------------------- Keydown routing (CONTRACT §10) -------------------------
  // Steps 1, 4 (full), 5, 7 and 8 (release) are owned by C1/B1; their slots are kept in order so the
  // routing survives when they land.
  isReleaseKey(e) {
    return e.key === " " || e.key === "Backspace";
  },

  onKeyDown(e) {
    // 1. modal stack (C1): Escape cancels, Tab traps, Enter = primary.
    if (this.modalStack && this.modalStack.length) return;

    // 2. editable targets keep native behaviour; #typeInput (C7) only passes Escape/Enter/Tab here.
    const target = e.target;
    const tag = (target && target.tagName) ? target.tagName.toLowerCase() : "";
    const isTypeInput = !!(target && target.id === "typeInput");
    const isEditable = !isTypeInput && (
      tag === "input" || tag === "textarea" ||
      (target && target.isContentEditable) ||
      (document.activeElement && document.activeElement.isContentEditable));
    if (e.isTrusted && /^(Key|Digit)/.test(e.code || "")) this.keyboardSeen = true;
    if (isEditable) return;
    if (isTypeInput && !["Escape", "Enter", "NumpadEnter", "Tab"].includes(e.key)) return;

    // 3. fullscreen combos (C2): Alt+Enter / Meta+Enter / F11.
    if (((e.key === "Enter" || e.key === "NumpadEnter") && (e.altKey || e.metaKey)) || e.key === "F11") {
      if (typeof this.toggleFullscreen === "function") {
        e.preventDefault();
        this.toggleFullscreen();
        return;
      }
    }

    // 4. Escape (C1 extends this to every screen).
    if (e.key === "Escape") {
      if (e.repeat) return;
      e.preventDefault();
      if (this.mode === "playing" || this.mode === "paused") this.togglePause();
      return;
    }

    // 5. Enter / NumpadEnter (C1): primary action per screen; B8 adds the finale skip.

    // 6. repeat guard: auto-repeat of a key the game owns is swallowed while playing (G007).
    if (e.repeat) {
      if (this.mode === "playing" && (normalizeKey(e) || this.isReleaseKey(e))) e.preventDefault();
      return;
    }

    // 7. not playing (C1): ? / F1 help, m mute.
    if (this.mode !== "playing") return;

    // 8. Space / Backspace: lock release (B1). Until then ignored and never counted.
    if (this.isReleaseKey(e)) {
      e.preventDefault();
      return;
    }

    // 9. modifier filter: shortcuts stay with the browser and are never preventDefault'ed (F042).
    const altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGraph && !(e.ctrlKey && e.altKey)) return;

    // 10. layout / IME diagnostics (toast once per run per kind, never auto-pause).
    this.noteInputDiagnostic(e);

    // 11. normalise and type.
    const ch = normalizeKey(e);
    if (!ch) return;
    e.preventDefault();
    this.keyboardSeen = true;
    if (this.sfx && typeof this.sfx.resumeIfNeeded === "function") this.sfx.resumeIfNeeded();
    if (!this.audioReady && !this.audioUnavailable) {
      // Only keystrokes before the first successful unlock wait for audio; afterwards typing never awaits.
      this.ensureAudio().then(() => this.handleTyped(ch));
      return;
    }
    this.handleTyped(ch);
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

  // ------------------------- Typing -------------------------
  handleTyped(ch) {
    if (this.bossClear) return;
    this.stats.total++;

    // Boss priority: if inBoss, we type against boss (lock implied).
    if (this.inBoss && this.boss) {
      const expect = this.boss.nextChar;
      if (ch === expect) {
        this.noteCorrectKey();
        this.stats.correct++;
        this.stats.combo++;
        this.bumpMultiplier();

        this.fireLaserTo(this.boss.x - 140, this.boss.y + 10, "cyan");
        this.sfx.laser();
        this.sfx.hit();

        this.boss.advance();
        this.addSparks(this.boss.x - 180, this.boss.y + rand(-40, 40), 10);

        // segment change hint
        this.ui.bossSegment.textContent = `segment ${Math.min(this.boss.segmentIndex + 1, this.boss.segments.length)}/${this.boss.segments.length}  •  ${this.boss.remaining}`;

        if (this.boss.done) {
          // boss defeated
          const centerX = this.boss.x - 150;
          const centerY = this.boss.y;
          this.sfx.explosion();
          this.screenShake(10);
          this.addExplosion(centerX, centerY, 120);
          this.sfx.bossExplosion();
          for (let i = 0; i < 9; i++) {
            this.addExplosionSprite(
              centerX + rand(-140, 140),
              centerY + rand(-120, 120),
              "large"
            );
          }
          for (let i = 0; i < 6; i++) {
            this.addExplosionSprite(
              centerX + rand(-220, 220),
              centerY + rand(-200, 200),
              "medium"
            );
          }

          this.endBossFight(true);

          // Nothing is banked here (F039/F040): commitLevelClear(bossClear) runs once when the finale ends
          // or earlier on any forced save (pause, blur, Stop, hidden tab).
          const completedLevel = LEVELS[this.levelIndex].level;
          const target = (this.levelIndex >= 9) ? "victory" : "level";
          const finaleS = (typeof BOSS_FINALE_S === "number") ? BOSS_FINALE_S : 6.3;
          this.bossClear = {
            t: 0,
            duration: finaleS,
            target,
            level: completedLevel,
            levelIndex: this.levelIndex,
            elapsed: this.levelT,
            bossName: LEVELS[this.levelIndex].boss.name,
            nextLevelIndex: target === "level" ? Math.min(this.levelIndex + 1, 9) : null,
            tally: null,
            committed: false
          };
          this.startBossFinale(centerX, centerY);
        }
      } else {
        this.onWrongKey();
      }

      return;
    }

    // If we have a lock, try to type into it
    if (this.lock?.ref && this.lock.ref.alive) {
      const ref = this.lock.ref;
      const expect = ref.nextChar();
      if (ch === expect) {
        this.onCorrectKey(ref);
      } else {
        this.onWrongKey();
      }
      return;
    }

    // Acquire a new lock: check powerups first (reward), then enemies.
    const candPower = this.powerups
      .filter(p => p.alive && this.isEntityVisible(p) && p.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candPower) {
      this.lock = { kind: "powerup", ref: candPower };
      candPower.locked = true;
      this.onCorrectKey(candPower);
      return;
    }

    const candEnemy = this.enemies
      .filter(en => en.alive && this.isEntityVisible(en) && en.nextChar() === ch)
      .sort((a,b) => a.x - b.x)[0];

    if (candEnemy) {
      this.lock = { kind: "enemy", ref: candEnemy };
      candEnemy.locked = true;
      this.onCorrectKey(candEnemy);
      return;
    }

    this.onWrongKey(true);
  },

  onCorrectKey(ref) {
    this.noteCorrectKey();
    this.stats.correct++;
    this.stats.combo++;
    this.bumpMultiplier();

    // Fire visuals
    const beamColor = this.power.multiplier > 0 ? "lime" : (this.power.spread > 0 ? "magenta" : "cyan");
    this.fireLaserTo(ref.x, ref.y, beamColor);
    this.sfx.laser();
    ref.progress++;
    ref.flash = 0.18;

    const isDone = (ref.kind === "powerup")
      ? (ref.progress >= ref.label.length)
      : (ref.progress >= ref.text.length);

    if (isDone) {
      // Resolve
      if (ref.kind === "powerup") {
        this.collectPowerup(ref);
      } else {
        this.killEnemy(ref);
      }
      this.lock = null;
    } else {
      // Mild hit feedback
      if (ref.kind !== "powerup") this.sfx.hit();
      this.addSparks(ref.x, ref.y, 6);
    }
  },

  onWrongKey(noTarget = false) {
    // Break combo
    this.stats.combo = 0;
    this.stats.mult = 1;
    this.sfx.error();
    this.flash = 0.08;

    // Optional small penalty when typing truly wrong (but not too harsh)
    if (!noTarget) {
      this.stats.score = Math.max(0, this.stats.score - 15);
    }

    // If we had a lock on something, keep lock (so user can recover) in early levels.
    // In later levels, drop lock sometimes.
    const lvl = LEVELS[this.levelIndex].level;
    if (this.lock?.ref && lvl >= 6 && Math.random() < 0.35) {
      this.lock.ref.locked = false;
      this.lock = null;
    }
  },

  bumpMultiplier() {
    // using combo brackets + active multiplier powerup
    const base = this.stats.combo >= 30 ? 3 : this.stats.combo >= 15 ? 2 : 1;
    const pu = this.power.multiplier > 0 ? 2 : 1;
    this.stats.mult = base * pu;
    if (this.stats.combo > (this.stats.maxCombo || 0)) this.stats.maxCombo = this.stats.combo;
  },

  isEntityVisible(obj, padding = 20) {
    if (!obj) return false;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const radius = obj.radius ?? 20;
    return (x + radius) >= -padding && (x - radius) <= (this.w + padding) && y >= -padding && y <= (this.h + padding);
  },
});
