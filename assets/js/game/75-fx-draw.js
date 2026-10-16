// Type-R 198X — effects-side drawing: ship, beams, particles, explosion sprites, world overlays (L14) and the
// vignette (L17). Split out of 70-render.js so the camera/weapons/ship track (D1, D2, D4) owns these paths while
// 70-render.js keeps the frame, parallax, plates, boss and sector card. Methods are mixed into Game.prototype and
// called by render() in 70-render.js; load order is defined in index.html (after 70-render.js, before 80-fx.js).

// Prebuilt colour strings (A11): bullets by PALETTE name, particles by name and alpha bucket, stars by bucket.
const BULLET_COLORS = (() => {
  const out = {};
  for (const name of ["cyan", "magenta", "lime", "amber", "violet", "danger", "text"]) {
    out[name] = { core: PALETTE.rgba(name, 0.92), glow: PALETTE.rgba(name, 0.25) };
  }
  return out;
})();
const PARTICLE_ALPHA_STEPS = 10;
const PARTICLE_COLORS = (() => {
  const out = {};
  for (const name of ["cyan", "magenta", "lime", "amber", "violet", "danger", "text"]) {
    const row = [];
    for (let i = 0; i <= PARTICLE_ALPHA_STEPS; i++) row.push(PALETTE.rgba(name, i / PARTICLE_ALPHA_STEPS));
    out[name] = row;
  }
  return out;
})();

const SHIP_DRAW_W = 150;          // 168 in D4

Object.assign(Game.prototype, {
  // ------------------------- Ship -------------------------
  drawShip(ctx) {
    const x = this.player.x;
    const y = this.player.y;

    ctx.save();
    // engine trail
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = PALETTE.rgba("magenta", 0.25);
    ctx.beginPath();
    ctx.ellipse(x - 30, y, 38, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = PALETTE.rgba("cyan", 0.25);
    ctx.beginPath();
    ctx.ellipse(x - 24, y, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Trimmed sprite placed where the untrimmed master used to go (B-1): dw wide, offsets from Assets.sprite().
    const shipId = this.currentShipId();
    const key = "ships/" + shipId;
    const sp = Assets.sprite(key, SHIP_DRAW_W);
    if (sp.img) {
      const meta = Assets.meta(key);
      const orig = meta && meta.orig;
      const dw = SHIP_DRAW_W;
      const dh = orig && orig.w > 0 ? dw * orig.h / orig.w : sp.h;
      const ox = x - dw * 0.38;
      const oy = y - dh / 2;
      ctx.drawImage(sp.img, ox + sp.x, oy + sp.y, sp.w, sp.h);
    } else {
      ctx.lineWidth = 2;
      ctx.strokeStyle = PALETTE.rgba("cyan", 0.92);
      ctx.fillStyle = PALETTE.rgba("bg2", 0.70);
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 22, y - 18);
      ctx.lineTo(x + 40, y);
      ctx.lineTo(x + 22, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // cockpit
      ctx.fillStyle = PALETTE.rgba("magenta", 0.45);
      ctx.beginPath();
      ctx.ellipse(x + 18, y, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // shield ring (D4 replaces with the hex + timer arc)
    if (this.player.shield > 0) {
      const a = this.reduceMotion ? 0.25 : 0.18 + 0.12 * Math.sin(this.starT * 6);
      ctx.strokeStyle = PALETTE.rgba("violet", clamp(a, 0, 1));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x + 10, y, 52, 28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  // ------------------------- Beams, particles, explosions -------------------------
  // Two strokes (wide soft + thin core), no shadow (D2 adds the third pass and the muzzle flash).
  drawBullets(ctx) {
    if (!this.bullets.length) return;
    ctx.save();
    ctx.lineCap = "round";
    for (const b of this.bullets) {
      const a = clamp((1 - (b.t / b.life)) * 1.1, 0, 1);
      const col = BULLET_COLORS[b.color] || BULLET_COLORS.cyan;
      ctx.globalAlpha = a * 0.25;
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = b.width * 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.tx, b.ty);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = col.core;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.tx, b.ty);
      ctx.stroke();
    }
    ctx.restore();
  },

  drawParticles(ctx) {
    if (!this.particles.length) return;
    for (const p of this.particles) {
      const a = p.alpha();
      if (a <= 0) continue;
      const row = PARTICLE_COLORS[p.color] || PARTICLE_COLORS.cyan;
      ctx.fillStyle = row[Math.round(clamp(a, 0, 1) * PARTICLE_ALPHA_STEPS)];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawExplosionSprites(ctx) {
    for (const ex of this.explosions) ex.draw(ctx);
  },

  // ------------------------- World overlays (L14) and vignette (L17) -------------------------
  // Edge-only danger vignette cached per resize at half device resolution (a drawImage, not a full-frame fill).
  getDangerVignette() {
    if (this.dangerVignette && this.dangerVignette.epoch === this.spriteEpoch) return this.dangerVignette;
    const s = (this.renderScale || 1) * 0.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.w * s));
    canvas.height = Math.max(1, Math.round(this.h * s));
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.28, this.w / 2, this.h / 2, this.h * 0.78);
    grad.addColorStop(0, PALETTE.rgba("danger", 0));
    grad.addColorStop(1, PALETTE.rgba("danger", 0.70));
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    this.dangerVignette = { canvas, epoch: this.spriteEpoch };
    return this.dangerVignette;
  },

  getVignetteSprite() {
    if (this.vignetteSprite && this.vignetteSprite.epoch === this.spriteEpoch) return this.vignetteSprite;
    const s = (this.renderScale || 1) * 0.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.w * s));
    canvas.height = Math.max(1, Math.round(this.h * s));
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.2, this.w / 2, this.h / 2, this.h * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    this.vignetteSprite = { canvas, epoch: this.spriteEpoch };
    return this.vignetteSprite;
  },

  drawWorldOverlays(ctx) {
    // typo / intro flash: full-frame wash capped at .12 (D1 moves this to flash channels)
    if (this.flash > 0) {
      const cap = this.reduceMotion ? 0.08 : 0.12;
      const a = clamp(this.flash * 3, 0, cap);
      ctx.fillStyle = PALETTE.rgba("danger", a);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    // damage: edge vignette only, never a full-frame wash
    if (this.damagePulse > 0) {
      const v = this.getDangerVignette();
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(this.damagePulse * 0.8, 0, 0.8);
      ctx.drawImage(v.canvas, 0, 0, this.w, this.h);
      ctx.globalAlpha = prev;
    }
  },

  drawVignette(ctx) {
    const v = this.getVignetteSprite();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(v.canvas, 0, 0, this.canvas.width, this.canvas.height);
    const s = this.renderScale || 1;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  },
});
