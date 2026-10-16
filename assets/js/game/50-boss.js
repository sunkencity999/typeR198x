// Type-R 198X — boss fight logic (intro, finale bursts); boss drawing lives in 70-render.js. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  beginBossFight() {
    const cfg = LEVELS[this.levelIndex];
    this.inBoss = true;
    this.lock = null;
    this.bossClear = null;

    this.enemies.length = 0;
    this.powerups.length = 0;

    this.triggerBossIntro(cfg.boss.name);

    this.boss = new Boss({
      name: cfg.boss.name,
      segments: buildBossSegments(cfg.level),
      artLevel: cfg.level
    });
    this.ui.bossBar.classList.remove("hidden");
    this.ui.bossName.textContent = cfg.boss.name;
    this.ui.bossSegment.textContent = "";
    this.sfx.bossSiren();
  },

  endBossFight(victory = true) {
    this.inBoss = false;
    this.ui.bossBar.classList.add("hidden");
    this.lock = null;
    this.boss = null;
  },

  triggerBossIntro(name) {
    this.flash = Math.max(this.flash, 0.45);
    this.damagePulse = 1;
    this.screenShake(14);
    this.bossIntro = { t: 0, name };
  },

  startBossFinale(cx, cy) {
    this.bossFinaleOrigin = { x: cx, y: cy };
    this.bossFinaleBursts = [];
    const finaleDuration = 6;
    const interval = 0.3;
    for (let t = 0; t <= finaleDuration; t += interval) {
      const step = Math.floor(t / interval) % 3;
      if (step === 0) this.bossFinaleBursts.push({ time: t, kind: "shock" });
      else if (step === 1) this.bossFinaleBursts.push({ time: t, kind: "large" });
      else this.bossFinaleBursts.push({ time: t, kind: "medium" });
    }
  },

  runBossFinaleBurst(burst) {
    const origin = this.bossFinaleOrigin || { x: this.player.x + 20, y: this.player.y };
    const ox = origin.x;
    const oy = origin.y;
    switch (burst.kind) {
      case "shock":
        this.addExplosion(ox + rand(-40, 40), oy + rand(-40, 40), 140);
        this.addExplosionSprite(ox + rand(-40, 40), oy + rand(-40, 40), "large");
        this.screenShake(6);
        this.sfx.explosion();
        break;
      case "medium":
        for (let i = 0; i < 3; i++) {
          this.addExplosionSprite(
            ox + rand(-260, 260),
            oy + rand(-220, 220),
            "medium"
          );
        }
        break;
      default:
        for (let i = 0; i < 4; i++) {
          this.addExplosionSprite(
            ox + rand(-200, 200),
            oy + rand(-160, 160),
            "large"
          );
        }
        break;
    }
  },
});
