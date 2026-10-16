// Type-R 198X — DOM HUD. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // getAccuracyPct is the stats helper the HUD and end screens read; kept beside updateHUD as in the original.

  updateHUD() {
    this.ui.hudName.textContent = this.save.playerName || "(unnamed)";
    this.ui.hudLevel.textContent = `${LEVELS[this.levelIndex].level}/10`;
    this.ui.hudScore.textContent = formatInt(this.stats.score);
    this.ui.hudCombo.textContent = `${this.stats.combo} ×${this.stats.mult}`;
    this.ui.hudAcc.textContent = `${this.getAccuracyPct()}%`;
    const shield = this.player.shield > 0 ? `+S` : "";
    this.ui.hudHP.textContent = `${Math.round(this.player.hp)}${shield}`;

    if (!this.inBoss) {
      this.ui.bossBar.classList.add("hidden");
    }
  },

  getAccuracyPct() {
    if (this.stats.total <= 0) return 100;
    return Math.round((this.stats.correct / this.stats.total) * 100);
  },

  // Characters still to type across every live enemy (pressure-valve input for B3; debug telemetry now).
  liveChars() {
    let n = 0;
    for (const en of this.enemies) if (en.alive) n += en.text.length - en.progress;
    return n;
  },

  // TypeRDebug.stats(): trailing-window telemetry for the balance pass and the harness.
  debugStats() {
    const now = nowMs();
    const spawnLog = this._spawnLog || [];
    const leakLog = this._leakLog || [];
    while (spawnLog.length && now - spawnLog[0].t > 10000) spawnLog.shift();
    while (leakLog.length && now - leakLog[0] > 60000) leakLog.shift();
    let chars = 0;
    for (const s of spawnLog) chars += s.n;
    return {
      incomingCps: Math.round((chars / 10) * 100) / 100,
      leaksPerMin: leakLog.length,
      deathsBySector: { ...(this.deathsBySector || {}) },
      liveChars: this.liveChars()
    };
  },
});
