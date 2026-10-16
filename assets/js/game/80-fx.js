// Type-R 198X — visual FX: lasers, sparks, explosions, screen shake. Methods are mixed into Game.prototype; load order is defined in index.html.
Object.assign(Game.prototype, {
  screenShake(amount) {
    this.shake = Math.max(this.shake, amount);
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
