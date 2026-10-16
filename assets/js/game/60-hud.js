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
});
