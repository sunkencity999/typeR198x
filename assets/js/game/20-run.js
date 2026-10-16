// Type-R 198X — run / level lifecycle, checkpoints and run persistence. Methods are mixed into Game.prototype; load order is defined in index.html.
//
// One checkpoint model (SYS-08): a 'level' checkpoint is taken on every fresh sector entry and a 'boss'
// checkpoint when a boss fight begins. Restart sector / Retry sector / Retry boss / Continue after a death
// all restore one of those two snapshots, so every button on Pause and Game Over does what its label says.
Object.assign(Game.prototype, {
  // ------------------------- Run identity -------------------------
  // Difficulty is deferred this release: the standard row is the only one.
  diff() {
    return { id: "standard", score: 1 };
  },

  newRunRecord(levelIndex, startLevel) {
    const i = clamp(levelIndex, 0, 9);
    return {
      id: makeRunId(),
      startLevel,
      levelIndex: i,
      levelT: 0,
      wave: 0,
      waveKills: 0,
      wavePhase: "spawn",
      inBoss: false,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      shield: 0,
      power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
      stats: { ...this.stats },
      levelStats: { ...this.levelStats },
      shipId: this.player.shipId || this.getSelectedShipId(),
      difficulty: "standard",
      retries: 0,
      checkpoint: null,
      bossCheckpoint: null,
      boss: null,
      spawnAcc: 0,
      powerAcc: 0,
      minionAcc: 0
    };
  },

  // runMeta outlives save.run (victory and L10 clear null the run) so commitHighScore always knows the run.
  setRunMeta(run) {
    this.runMeta = {
      id: run.id,
      startLevel: run.startLevel,
      ship: run.shipId,
      name: this.save.playerName || "",
      legacy: !!run.legacy,
      victory: false
    };
  },

  // ------------------------- Run/Level control -------------------------
  startNewRun() {
    this.commitHighScore(); // bank whatever run is being abandoned (F009)
    this.setPlayerShip(this.getSelectedShipId());
    this.levelIndex = 0;
    this.stats = defaultStats();
    this.levelStats = defaultLevelStats();
    this.player.maxHp = getHpBonusForLevel(1);
    this.player.hp = this.player.maxHp;
    this.player.shield = 0;
    this.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };
    this.toastOnce.clear();
    this.run = this.save.run = this.newRunRecord(0, 1);
    this.setRunMeta(this.run);
    this.startLevel(0, { fromMenu: true, fresh: true });
  },

  continueRun() {
    const r = this.save.run;
    if (!r) return this.startNewRun();
    this.run = r;
    this.levelIndex = clamp(r.levelIndex ?? 0, 0, 9);
    this.setPlayerShip(r.shipId || this.getSelectedShipId());
    this.setRunMeta(r);
    this.toastOnce.clear();

    // hp 0 marks a death that was saved on the Game Over screen: Continue converges on the same
    // checkpoint the Retry buttons use (B-8).
    const dead = (Number.isFinite(r.hp) ? r.hp : 1) <= 0;
    if (dead && r.inBoss && r.bossCheckpoint && r.boss) return this.retryBoss();
    if (dead) return this.restartLevel();

    this.stats = { ...defaultStats(), ...(r.stats || {}) };
    this.levelStats = { ...defaultLevelStats(), ...(r.levelStats || {}) };
    const curve = getHpBonusForLevel(this.levelIndex + 1);
    this.player.maxHp = Math.max(curve, Number.isFinite(r.maxHp) ? r.maxHp : 0);
    this.player.hp = clamp(r.hp ?? this.player.maxHp, 1, this.player.maxHp);
    this.player.shield = r.shield ?? 0;
    this.power = { ...this.power, ...(r.power || {}) };
    if (!r.checkpoint) r.checkpoint = this.makeCheckpoint("level");
    this.startLevel(this.levelIndex, { fromMenu: true, restoredRun: r });
  },

  // startLevel(levelIndex, { fromMenu, restoredRun, fresh }). A boolean second argument still means
  // { fromMenu } with the restored run third (B-5 shim for the current harness; dropped in E2).
  // fresh: a fresh sector entry — combo/power/shield reset, level stats zeroed, retries 0, level checkpoint taken.
  startLevel(levelIndex, opts = {}, legacyRestoredRun = null) {
    if (typeof opts === "boolean") opts = { fromMenu: opts, restoredRun: legacyRestoredRun };
    const fromMenu = !!(opts && opts.fromMenu);
    const restoredRun = (opts && opts.restoredRun) || null;
    const fresh = !!(opts && opts.fresh);

    this.levelIndex = clamp(levelIndex, 0, 9);
    const cfg = LEVELS[this.levelIndex];

    this.currentTheme = getThemeForLevel(this.levelIndex);
    if (this.sfx && !this.save.settings.muted) {
      this.sfx.playMusic();
    }
    this.parallax.bgOffset = 0;
    this.parallax.fgOffset = 0;

    this.resetTransientFx();
    this.bossClear = null;
    this.bossFinaleBursts.length = 0;
    this.bossFinaleOrigin = null;
    this.enemies.length = 0;
    this.powerups.length = 0;
    this.lock = null;
    this.inBoss = false;
    this.boss = null;
    this.ui.bossBar.classList.add("hidden");
    this.layoutStrikes = 0;
    this.imeStrikes = 0;

    if (!this.run) {
      // Direct entry (harness / debugging) without startNewRun: give the sector a run of its own.
      this.run = this.save.run = this.newRunRecord(this.levelIndex, this.levelIndex + 1);
      this.setRunMeta(this.run);
    }
    const run = this.run;

    if (fresh) {
      this.stats.combo = 0;
      this.stats.mult = 1;
      this.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };
      this.player.shield = 0;
      this.player.maxHp = Math.max(this.player.maxHp, getHpBonusForLevel(cfg.level));
      this.player.hp = this.player.maxHp;
      this.levelStats = defaultLevelStats();
      run.levelIndex = this.levelIndex;
      run.levelT = 0;
      run.wave = 0;
      run.waveKills = 0;
      run.wavePhase = "spawn";
      run.inBoss = false;
      run.boss = null;
      run.bossCheckpoint = null;
      run.retries = 0;
      run.checkpoint = this.makeCheckpoint("level");
    }

    this.levelT = restoredRun ? clamp(restoredRun.levelT ?? 0, 0, cfg.duration - 1) : 0;
    this.wave = restoredRun ? clamp(restoredRun.wave | 0, 0, 2) : 0;
    this.waveKills = restoredRun ? (restoredRun.waveKills | 0) : 0;
    this.wavePhase = (restoredRun && restoredRun.wavePhase) || "spawn";
    this.spawnAcc = restoredRun?.spawnAcc ?? 0;
    this.powerAcc = restoredRun?.powerAcc ?? 0;
    this.minionAcc = restoredRun?.minionAcc ?? 0;
    this.hazardAcc = restoredRun?.hazardAcc ?? 0;

    // A run saved inside a boss resumes the same boss (segments, phase, segment index; progress 0).
    if (restoredRun?.inBoss) {
      this.beginBossFight({ restored: restoredRun.boss });
    }

    if (fromMenu) this.setMode("playing");
    this.updateHUD();
    this.saveRun(true);
    this.sfx.powerup();
  },

  // Pause "Restart sector" / Game Over "Retry sector": back to the level checkpoint.
  restartLevel() {
    if (this.bossClear) return; // the finale is banking the clear; Restart is hidden meanwhile (F039)
    const run = this.run || this.save.run;
    const cp = run && run.checkpoint;
    if (!run || !cp) {
      this.startLevel(this.levelIndex, { fromMenu: true, fresh: true });
      return;
    }
    this.run = run;
    this.restoreCheckpoint(cp);
    run.boss = null;
    run.bossCheckpoint = null;
    run.inBoss = false;
    this.startLevel(cp.levelIndex, { fromMenu: true });
  },

  // Game Over "Retry boss": back to the boss checkpoint, same boss rebuilt at its phase start, intro replayed.
  retryBoss() {
    const run = this.run || this.save.run;
    const cp = run && run.bossCheckpoint;
    if (!run || !cp || !run.boss) {
      this.restartLevel();
      return;
    }
    this.run = run;
    this.restoreCheckpoint(cp);
    const phase = cp.bossPhase | 0;
    const starts = (Array.isArray(run.boss.phaseStarts) && run.boss.phaseStarts.length) ? run.boss.phaseStarts : [0];
    const start = starts[Math.min(phase, starts.length - 1)] | 0;
    run.boss.segmentIndex = clamp(start, 0, run.boss.segments.length - 1);
    run.boss.progress = 0;
    run.boss.phase = phase;
    run.inBoss = true;
    run.levelT = LEVELS[cp.levelIndex].duration - 1;
    this.startLevel(cp.levelIndex, { fromMenu: true, restoredRun: run });
  },

  advanceLevel() {
    if (this.levelIndex >= 9) return;
    this.levelIndex++;
    this.startLevel(this.levelIndex, { fromMenu: true, fresh: true });
  },

  stopToMenu(saveRun = true) {
    if (saveRun) this.saveRun(true); // banks an uncommitted finale first (B-7)
    this.commitHighScore();
    this.resetTransientFx();
    this.bossClear = null;
    this.bossFinaleBursts.length = 0;
    this.bossFinaleOrigin = null;
    this.endBossFight(false);
    this.enemies.length = 0;
    this.powerups.length = 0;
    this.lock = null;
    this.setMode("menu");
    this.refreshMenu();
  },

  // ------------------------- Checkpoints -------------------------
  makeCheckpoint(kind, levelIndex = this.levelIndex) {
    const retries = this.run ? (this.run.retries | 0) : 0;
    const extra = kind === "boss" ? { bossPhase: (this.boss ? this.boss.phase : 0) | 0 } : null;
    return snapshotCheckpoint(kind, levelIndex, this.stats, this.player.maxHp, retries, extra);
  },

  // stats <- snapshot, combo 0, mult recomputed, full HP, no shield/power, retries + 1 on the run and the level.
  restoreCheckpoint(cp) {
    const run = this.run;
    const stats = defaultStats();
    for (const f of STAT_SNAPSHOT_FIELDS) if (Number.isFinite(cp[f])) stats[f] = cp[f];
    stats.combo = 0;
    stats.mult = 1;
    this.stats = stats;
    this.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };
    this.player.shield = 0;
    this.bumpMultiplier();
    this.player.maxHp = Math.max(getHpBonusForLevel(cp.levelIndex + 1), Number.isFinite(cp.maxHp) ? cp.maxHp : 0);
    this.player.hp = this.player.maxHp;
    if (run) run.retries = (run.retries | 0) + 1;
    this.stats.retries = (this.stats.retries | 0) + 1;
    this.levelStats = { ...defaultLevelStats(), retries: run ? run.retries : 1 };
    this.levelIndex = clamp(cp.levelIndex | 0, 0, 9);
  },

  // ------------------------- Level clear -------------------------
  // Runs exactly once per clear (info.committed). Nothing is banked at kill time (F039/F040): the finale
  // ending, or any forced save during it, calls this.
  commitLevelClear(info) {
    if (!info || info.committed) return;
    info.committed = true;
    const L = info.level;
    const i = info.levelIndex;
    const clear = 2500 + 450 * L;
    const tally = info.tally || { clear, total: clear }; // B8 itemises time/accuracy/flawless bonuses
    info.tally = tally;
    this.stats.score += tally.total | 0;

    this.save.lastUnlockedLevel = Math.max(this.save.lastUnlockedLevel || 1, Math.min(10, L + 1));
    const nextMax = getHpBonusForLevel(Math.min(L + 1, 10));
    if (nextMax > this.player.maxHp) this.player.maxHp = nextMax;
    this.player.hp = this.player.maxHp;

    this.recordSectorBest(L, this.buildClearResults());

    const run = this.run;
    if (L >= 10) {
      if (this.runMeta) this.runMeta.victory = true;
      this.commitHighScore({ store: false });
      this.save.victories = (this.save.victories | 0) + 1;
      this.save.run = null;
      this.run = null;
    } else if (run) {
      run.levelIndex = i + 1;
      run.levelT = 0;
      run.wave = 0;
      run.waveKills = 0;
      run.wavePhase = "spawn";
      run.inBoss = false;
      run.boss = null;
      run.bossCheckpoint = null;
      run.retries = 0;
      run.hp = this.player.maxHp;
      run.maxHp = this.player.maxHp;
      run.shield = 0;
      run.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 };
      run.stats = { ...this.stats, combo: 0, mult: 1 };
      run.levelStats = defaultLevelStats();
      run.spawnAcc = 0;
      run.powerAcc = 0;
      run.minionAcc = 0;
      run.checkpoint = this.makeCheckpoint("level", i + 1);
      this.save.run = run;
      this.commitHighScore({ store: false });
    }
    storeSave(this.save);
  },

  // Stand-in for B9's buildResults('level'): score earned this sector, accuracy, best combo.
  buildClearResults() {
    const cpScore = (this.run && this.run.checkpoint) ? (this.run.checkpoint.score | 0) : 0;
    return {
      score: Math.max(0, (this.stats.score | 0) - cpScore),
      rank: null,
      wpm: 0,
      acc: this.getAccuracyPct(),
      maxCombo: this.stats.maxCombo | 0,
      date: Date.now()
    };
  },

  recordSectorBest(level, results) {
    if (!results) return;
    if (!this.save.sectorBests || typeof this.save.sectorBests !== "object") this.save.sectorBests = {};
    const key = String(level);
    const prev = this.save.sectorBests[key];
    if (!prev || (results.score | 0) > (prev.score | 0)) this.save.sectorBests[key] = { ...results };
  },

  onLevelComplete(info) {
    this.commitLevelClear(info);
    this.setMode("levelComplete");
    const bonus = (info && info.tally) ? info.tally.total : 0;
    this.ui.levelCompleteText.textContent = `Level ${info.level} cleared! Bonus +${formatInt(bonus)} • Max HP boosted to ${this.player.maxHp}!`;
  },

  onGameOver() {
    if (this.mode === "gameOver") return;
    const lvl = LEVELS[this.levelIndex].level;
    this.deathsBySector[lvl] = (this.deathsBySector[lvl] || 0) + 1;
    this.deathInBoss = !!(this.inBoss && this.boss);
    this.resetTransientFx();
    // Keep the real run (no resume stub): hp 0 tells Continue to restore the checkpoint (F030).
    if (this.run) this.writeRunSave({ dead: true });
    this.setMode("gameOver");
    const acc = this.getAccuracyPct();
    this.ui.gameOverText.textContent = `Final score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.commitHighScore();
    const canRetryBoss = this.deathInBoss && !!(this.run && this.run.bossCheckpoint && this.run.boss);
    if (this.btnRetryBoss) this.btnRetryBoss.classList.toggle("hidden", !canRetryBoss);
  },

  onVictory() {
    // Bank the score first: the dialogue below must never stand between a win and the high score (F001).
    this.commitHighScore();
    this.save.run = null;
    this.run = null;
    storeSave(this.save);
    this.setMode("victory");
    const acc = this.getAccuracyPct();
    this.ui.victoryText.textContent = `You beat all 10 levels! Score: ${formatInt(this.stats.score)} • Accuracy: ${acc}%`;
    this.resetEndingDialogue();
    this.advanceEndingDialogue();
  },

  // ------------------------- High scores -------------------------
  // Headline high score only for runs that started at sector 1 (or were migrated from v1); the top-10 table
  // gets one row per run. Idempotent per (run id, score).
  commitHighScore(opts = {}) {
    const meta = this.runMeta;
    if (!meta) return false;
    const score = this.stats.score | 0;
    if (this._hsCommitted && this._hsCommitted.id === meta.id && this._hsCommitted.score === score && this._hsCommitted.victory === !!meta.victory) return false;
    this._hsCommitted = { id: meta.id, score, victory: !!meta.victory };
    let changed = false;
    if ((meta.startLevel === 1 || meta.legacy) && score > (this.save.highScore || 0)) {
      this.save.highScore = score;
      changed = true;
    }
    if (this.upsertHighScore()) changed = true;
    if (changed && opts.store !== false) storeSave(this.save);
    return changed;
  },

  upsertHighScore() {
    const meta = this.runMeta;
    const score = this.stats.score | 0;
    if (!meta || score <= 0) return false;
    if (!Array.isArray(this.save.highScores)) this.save.highScores = [];
    const list = this.save.highScores;
    const row = {
      runId: meta.id,
      name: this.save.playerName || meta.name || "PILOT",
      score,
      levelReached: meta.victory ? 11 : this.levelIndex + 1,
      startLevel: meta.startLevel,
      wpm: 0, // B9 fills grossWpm
      acc: this.getAccuracyPct(),
      maxCombo: this.stats.maxCombo | 0,
      ship: meta.ship,
      difficulty: "standard",
      date: Date.now()
    };
    const idx = list.findIndex(h => h && h.runId === meta.id);
    if (idx >= 0) {
      if ((list[idx].score | 0) >= score && list[idx].levelReached === row.levelReached) return false;
      list[idx] = { ...list[idx], ...row };
    } else {
      list.push(row);
    }
    list.sort((a, b) => ((b.score | 0) - (a.score | 0)) || ((b.date | 0) - (a.date | 0)));
    if (list.length > 10) list.length = 10;
    return true;
  },

  // storeSave failed: keep playing from memory and say so once per run (F044).
  onPersistUnavailable() {
    this.persistUnavailable = true;
    if (this.toastOnce.has("persist")) return;
    this.toastOnce.add("persist");
    if (typeof this.showToast === "function") {
      this.showToast("PROGRESS WILL NOT BE SAVED IN THIS BROWSER", { kind: "warn", key: "persist", ms: 5000 });
    }
  },

  // ------------------------- Save state -------------------------
  // Serialise the live run into run (=== save.run) and persist. opts.dead writes hp 0 (a saved death).
  writeRunSave(opts = {}) {
    if (!this.run) return false;
    const run = this.run;
    const cfg = LEVELS[this.levelIndex];
    const dead = !!opts.dead;
    run.levelIndex = this.levelIndex;
    run.levelT = clamp(this.levelT, 0, cfg.duration - 1);
    run.wave = this.wave | 0;
    run.waveKills = this.waveKills | 0;
    run.wavePhase = this.wavePhase || "spawn";
    run.inBoss = !!this.inBoss;
    run.hp = dead ? 0 : clamp(Math.round(this.player.hp ?? this.player.maxHp), 1, this.player.maxHp);
    run.maxHp = this.player.maxHp;
    run.shield = this.player.shield;
    run.power = { ...this.power };
    run.stats = { ...this.stats };
    run.levelStats = { ...this.levelStats };
    run.shipId = this.player.shipId || this.getSelectedShipId();
    run.difficulty = run.difficulty || "standard";
    run.boss = (this.inBoss && this.boss) ? {
      segments: [...this.boss.segments],
      segmentIndex: this.boss.segmentIndex,
      progress: this.boss.progress,
      phase: this.boss.phase | 0,
      phaseStarts: Array.isArray(this.boss.phaseStarts) ? [...this.boss.phaseStarts] : [0]
    } : null;
    run.spawnAcc = this.spawnAcc;
    run.powerAcc = this.powerAcc;
    run.minionAcc = this.minionAcc;

    this.save.playerName = this.save.playerName || this.ui.playerName.value || "";
    this.save.run = run;
    this.commitHighScore({ store: false });
    return storeSave(this.save);
  },

  saveRun(force = false) {
    const t = nowMs();
    if (!force && t - this.lastSaveAt < 1500) return;
    this.lastSaveAt = t;

    // A finale in progress banks its clear exactly once; the committed run (next sector, or null after
    // sector 10) is authoritative until the level actually ends (B-7).
    if (this.bossClear) {
      if (!this.bossClear.committed) this.commitLevelClear(this.bossClear);
      return;
    }

    if (this.mode === "menu" || this.mode === "victory" || this.mode === "gameOver" || this.mode === "levelComplete") return;
    this.writeRunSave();
  },
});
