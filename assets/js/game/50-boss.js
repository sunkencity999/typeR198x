// Type-R 198X — boss fight logic (intro, finale bursts); boss drawing lives in 70-render.js. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // beginBossFight({ restored }) — restored is run.boss ({ segments, segmentIndex, progress, phase, phaseStarts })
  // when a saved fight resumes or Retry boss rebuilds it; otherwise a fresh boss is rolled.
  beginBossFight(opts = {}) {
    const cfg = LEVELS[this.levelIndex];
    const restored = (opts && opts.restored) || null;
    this.inBoss = true;
    this.lock = null;
    this.bossClear = null;

    this.enemies.length = 0;
    this.powerups.length = 0;

    this.triggerBossIntro(cfg.boss.name);

    // buildBossSegments returns a plain array today and { segments, phaseStarts } once B7 lands.
    const built = buildBossSegments(cfg.level);
    const builtSegments = Array.isArray(built) ? built : (built && built.segments) || ["neon", "boss"];
    const builtStarts = (!Array.isArray(built) && built && Array.isArray(built.phaseStarts)) ? built.phaseStarts : [0];
    const segments = (restored && Array.isArray(restored.segments) && restored.segments.length) ? restored.segments : builtSegments;
    const phaseStarts = (restored && Array.isArray(restored.phaseStarts) && restored.phaseStarts.length) ? restored.phaseStarts : builtStarts;

    this.boss = new Boss({
      name: cfg.boss.name,
      segments,
      artLevel: cfg.level
    });
    this.boss.phaseStarts = [...phaseStarts];
    this.boss.phase = restored ? (restored.phase | 0) : 0;
    if (restored) {
      this.boss.segmentIndex = clamp(restored.segmentIndex | 0, 0, segments.length - 1);
      this.boss.progress = 0;
    }

    const run = this.run;
    if (run) {
      run.inBoss = true;
      run.boss = {
        segments: [...this.boss.segments],
        segmentIndex: this.boss.segmentIndex,
        progress: 0,
        phase: this.boss.phase,
        phaseStarts: [...phaseStarts]
      };
      // Boss checkpoint: fresh for a new fight; a resumed fight keeps the one taken at its phase start.
      if (!restored || !run.bossCheckpoint) run.bossCheckpoint = this.makeCheckpoint("boss");
    }
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
