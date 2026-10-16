// Type-R 198X — visual FX: lasers, sparks, explosions, screen shake. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  // Trauma camera (C-8): px maps onto trauma; render derives the shake amplitude from trauma.
  screenShake(px) {
    if (this.reduceMotion) return;
    this.trauma = clamp(this.trauma + (px || 0) / 14, 0, 1);
    this.shake = 18 * this.trauma * this.trauma;
  },

  // Effects clock: runs in EVERY mode (loop calls it before update), so hits settle behind pause/game-over panels.
  tickEffects(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.shake = 18 * this.trauma * this.trauma; // legacy mirror (amplitude in px)
    this.flash = Math.max(0, this.flash - dt * 3);
    this.damagePulse = Math.max(0, this.damagePulse - dt * 1.8);
    this.hitStop = Math.max(0, this.hitStop - dt);
  },

  // Ambient drift only: stars, parallax, the starT phase clock. Called from update() while playing and
  // from the loop's ambient tick on menu/pause/level-complete/victory screens.
  stepAmbient(dt) {
    this.starT += dt;
    if (this.currentTheme) {
      this.parallax.bgOffset += (this.currentTheme.bgSpeed || 0) * dt;
      this.parallax.fgOffset += (this.currentTheme.fgSpeed || 0) * dt;
    }
    for (const s of this.stars) {
      const spd = lerp(30, 140, 1 - s.z);
      s.x -= spd * dt;
      if (s.x < -5) { s.x = this.w + rand(0, 80); s.y = rand(0, this.h); s.z = Math.random(); }
    }
  },

  // Zero every transient presentation effect. Called at the top of startLevel(), stopToMenu(), onGameOver().
  resetTransientFx() {
    this.trauma = 0;
    this.shake = 0;
    this.flash = 0;
    this.damagePulse = 0;
    this.hitStop = 0;
    this.timeScale = 1;
    this.bossIntro = null;
    this.explosions.length = 0;
    this.particles.length = 0;
    this.bullets.length = 0;
  },

  fireLaserTo(tx, ty, color) {
    // Multi-shot if spread or rapid: create extra beams to nearby points
    const shots = [];
    const baseWidth = 3 + this.levelIndex * 0.7;
    const spreadWidth = Math.max(2, baseWidth * 0.65);
    shots.push({ tx, ty, color, width: baseWidth });

    if (this.power.spread > 0) {
      shots.push({ tx: tx + rand(-20, 20), ty: ty + rand(-80, -20), color: "magenta", width: spreadWidth });
      shots.push({ tx: tx + rand(-20, 20), ty: ty + rand(20, 80), color: "magenta", width: spreadWidth });
    }

    for (const s of shots) {
      this.bullets.push(new Bullet({
        x: this.player.x + 20,
        y: this.player.y,
        tx: s.tx,
        ty: s.ty,
        width: s.width,
        color: s.color
      }));
    }
  },

  addSparks(x, y, n) {
    for (let i=0;i<n;i++) {
      this.particles.push(new Particle({
        x, y,
        vx: rand(-120, 120),
        vy: rand(-120, 120),
        life: rand(0.12, 0.26),
        size: rand(1, 2.8),
        hue: choice([185, 310, 95])
      }));
    }
  },

  addExplosion(x, y, size) {
    const n = Math.floor(size * 1.2);
    for (let i=0;i<n;i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0, size);
      this.particles.push(new Particle({
        x: x + Math.cos(a) * r * 0.2,
        y: y + Math.sin(a) * r * 0.2,
        vx: Math.cos(a) * rand(80, 320),
        vy: Math.sin(a) * rand(80, 320),
        life: rand(0.18, 0.5),
        size: rand(1.2, 4.5),
        hue: choice([185, 310, 95, 40])
      }));
    }
  },

  addExplosionSprite(x, y, type = "small") {
    if (!this.explosionSheet) return;
    this.explosions.push(new ExplosionSprite({ x, y, type, sheet: this.explosionSheet }));
  },

  getExplosionTypeForEnemy(en) {
    if (!en) return "small";
    if (en.text.length <= 3 || en.kind === "bossMinion") return "small";
    return "medium";
  },
});
