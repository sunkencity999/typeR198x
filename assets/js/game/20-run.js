// Type-R 198X — run / level lifecycle and run persistence. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // ------------------------- Run/Level control -------------------------
  startNewRun() {
    this.setPlayerShip(this.getSelectedShipId());
    this.levelIndex = 0;
    this.player.maxHp = BASE_PLAYER_HP;
    this.stats.score = 0;
    this.stats.combo = 0;
    this.stats.mult = 1;
    this.stats.correct = 0;
    this.stats.total = 0;
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.power.spread = 0;
    this.power.pierce = 0;
    this.power.rapid = 0;
    this.power.multiplier = 0;
    this.startLevel(this.levelIndex, true);
  },

  continueRun() {
    const r = this.save.run;
    if (!r) return this.startNewRun();
    this.levelIndex = clamp(r.levelIndex ?? 0, 0, 9);
    this.stats = { ...this.stats, ...(r.stats || {}) };
    if (typeof r.maxHp === "number" && r.maxHp > 0) {
      this.player.maxHp = Math.max(BASE_PLAYER_HP, r.maxHp);
    }
    const restoredHp = clamp(r.hp ?? this.player.maxHp, 0, this.player.maxHp);
    this.player.hp = restoredHp > 0 ? restoredHp : this.player.maxHp;
    this.player.shield = r.shield ?? 0;
    this.power = { ...this.power, ...(r.power || {}) };
    this.setPlayerShip(r.shipId || this.getSelectedShipId());
    this.startLevel(this.levelIndex, true, r);
  },

  startLevel(levelIndex, fromMenu = false, restoredRun = null) {
    this.levelIndex = clamp(levelIndex, 0, 9);
    const cfg = LEVELS[this.levelIndex];

    this.currentTheme = getThemeForLevel(this.levelIndex);
    if (this.sfx && !this.save.settings.muted) {
      this.sfx.playMusic();
    }
    this.parallax.bgOffset = 0;
    this.parallax.fgOffset = 0;

    this.bossClear = null;
    this.bossFinaleBursts.length = 0;
    this.bossFinaleOrigin = null;
    this.enemies.length = 0;
    this.powerups.length = 0;
    this.particles.length = 0;
    this.bullets.length = 0;
    this.lock = null;
    this.inBoss = false;
    this.boss = null;

    this.levelT = restoredRun?.levelT ?? 0;
    this.spawnAcc = restoredRun?.spawnAcc ?? 0;
    this.powerAcc = restoredRun?.powerAcc ?? 0;
    this.minionAcc = restoredRun?.minionAcc ?? 0;
    this.hazardAcc = restoredRun?.hazardAcc ?? 0;

    // If restoring, we can choose to restore active enemies, but keeping it simple:
    // restore only the timers and overall run stats. Keeps "Continue" robust.
    // (Level restarts are available via R.)
    if (restoredRun?.inBoss) {
      this.beginBossFight();
      // If the run was in boss, keep it in boss (still restarts boss fresh for sanity)
    }

    if (fromMenu) this.setMode("playing");
    this.updateHUD();
    this.saveRun(true);
    this.sfx.powerup();
  },

  restartLevel() {
    // Keep overall score and stats, but reset level-specific spawns
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.power.spread = 0;
    this.power.pierce = 0;
    this.power.rapid = 0;
    this.power.multiplier = 0;
    this.startLevel(this.levelIndex, true, null);
    if (this.sfx && !this.save.settings.muted) this.sfx.playMusic();
  },

  advanceLevel() {
    if (this.levelIndex >= 9) return;
    this.levelIndex++;
    this.startLevel(this.levelIndex, true);
    if (this.sfx && !this.save.settings.muted) this.sfx.playMusic();
  },

  stopToMenu(saveRun = true) {
    if (saveRun) this.saveRun(true);
    this.setMode("menu");
    this.refreshMenu();
  },

  onLevelComplete(bonus) {
    this.setMode("levelComplete");
    const levelNumber = LEVELS[this.levelIndex].level;
    this.applyLevelHpBonus(levelNumber);
    const hpMessage = `Max HP boosted to ${this.player.maxHp}!`;
    this.ui.levelCompleteText.textContent = `Level ${levelNumber} cleared! Bonus +${formatInt(bonus)} • ${hpMessage}`;
    this.saveRun(true);
  },

  onGameOver() {
    this.setMode("gameOver");
    const acc = this.getAccuracyPct();
    this.ui.gameOverText.textContent = `Final score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.commitHighScore();
    const shipId = this.player.shipId || this.getSelectedShipId();
    this.save.run = buildResumeRun(this.levelIndex, this.player.maxHp, shipId);
    storeSave(this.save);
  },

  onVictory() {
    this.setMode("victory");
    const acc = this.getAccuracyPct();
    this.ui.victoryText.textContent = `You beat all 10 levels! Score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.resetEndingDialogue();
    this.advanceEndingDialogue();
    this.commitHighScore();
    this.save.run = null;
    storeSave(this.save);
  },

  applyLevelHpBonus(levelNumber) {
    const nextLevel = clamp(Math.min(levelNumber + 1, 10), 1, 10);
    const targetMax = getHpBonusForLevel(nextLevel);
    if (targetMax > this.player.maxHp) {
      this.player.maxHp = targetMax;
    }
    this.player.hp = this.player.maxHp;
  },

  commitHighScore() {
    if (this.stats.score > (this.save.highScore || 0)) {
      this.save.highScore = this.stats.score;
    }
    storeSave(this.save);
    this.refreshMenu();
  },

  // ------------------------- Save state -------------------------
  saveRun(force = false) {
    const t = nowMs();
    if (!force && t - this.lastSaveAt < 1500) return;
    this.lastSaveAt = t;

    if (this.mode === "menu" || this.mode === "victory" || this.mode === "gameOver") return;

    if (this.bossClear) {
      if (this.bossClear.target === "victory") {
        this.save.run = null;
        storeSave(this.save);
        return;
      }
      const nextIndex = clamp(this.bossClear.nextLevelIndex ?? (this.levelIndex + 1), 0, 9);
      const safeHp = clamp(Math.round(this.player.hp ?? this.player.maxHp), 1, this.player.maxHp);
      const run = {
        levelIndex: nextIndex,
        levelT: 0,
        inBoss: false,
        hp: safeHp,
        shield: this.player.shield,
        power: { ...this.power },
        stats: { ...this.stats },
        spawnAcc: 0,
        powerAcc: 0,
        minionAcc: 0,
        hazardAcc: 0,
        shipId: this.player.shipId || this.getSelectedShipId(),
        maxHp: this.player.maxHp
      };
      this.save.run = run;
      storeSave(this.save);
      return;
    }

    const safeHp = clamp(Math.round(this.player.hp ?? this.player.maxHp), 1, this.player.maxHp);
    const run = {
      levelIndex: this.levelIndex,
      levelT: this.levelT,
      inBoss: this.inBoss,
      hp: safeHp,
      shield: this.player.shield,
      power: { ...this.power },
      stats: { ...this.stats },
      spawnAcc: this.spawnAcc,
      powerAcc: this.powerAcc,
      minionAcc: this.minionAcc,
      hazardAcc: this.hazardAcc,
      shipId: this.player.shipId || this.getSelectedShipId(),
      maxHp: this.player.maxHp
    };

    this.save.playerName = this.save.playerName || this.ui.playerName.value || "";
    this.save.run = run;
    storeSave(this.save);
  },
});
