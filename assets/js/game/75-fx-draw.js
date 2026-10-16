// Type-R 198X — effects-side drawing: ship (L11), beams (L7), explosion sprites / dying plates / particles /
// debris / rings / bolts (L12, one additive batch), world overlays (L14), active-target redraw (L16) and the
// vignette (L17). Split out of 70-render.js so the camera / weapons / ship track (D1, D2, D4) owns these paths
// while 70-render.js keeps the frame, parallax, plates, boss and sector card. Methods are mixed into
// Game.prototype and called by render(); load order is defined in index.html (after 70-render.js, before 80-fx.js).
//
// Budget: no shadowBlur in any per-frame path (the ship shadow is a one-time bake), globalCompositeOperation is
// assigned at most four times per frame (beam batch open/close, L12 batch open/close), no full-frame fill above
// alpha .12.

// Prebuilt colour strings (A11): beams by PALETTE name (three passes), particles by name and alpha bucket.
const BULLET_COLORS = (() => {
  const out = {};
  for (const name of ["cyan", "magenta", "lime", "amber", "violet", "danger", "text"]) {
    out[name] = { wide: PALETTE.rgba(name, 0.22), core: PALETTE.rgba(name, 0.95) };
  }
  return out;
})();
const BEAM_WHITE = PALETTE.rgba("text", 0.60);
const PARTICLE_ALPHA_STEPS = 8;
const PARTICLE_COLORS = (() => {
  const out = {};
  for (const name of ["cyan", "magenta", "lime", "amber", "violet", "danger", "text"]) {
    const row = [];
    for (let i = 0; i <= PARTICLE_ALPHA_STEPS; i++) row.push(PALETTE.rgba(name, i / PARTICLE_ALPHA_STEPS));
    out[name] = row;
  }
  return out;
})();
const FXD = (typeof FX_MOTION === "object" && FX_MOTION) || {};
const FXD_TAU = Math.PI * 2;

const SHIP_DRAW_W = 168;          // logical width of the untrimmed master; the trimmed sprite is placed inside it (B-1)
const SHIP_ANCHOR_X = 0.45;       // VIS-06: hull box drawn at (player.x - dw*.45, player.y - dh/2)
const SHIP_SHADOW_PAD = 20;       // bake margin for the 12 px blur + 6 px drop
const SHIP_COCKPIT_DX = 18;       // vector fallback only
// Nozzle and gun anchors per ship as fractions of the trimmed sprite box, read off the engine side of the four
// sprites (coconut: two bells top-left; little dark one: twin cylinders; sofrito: single painted flame nozzle;
// honeybee: two cones). The muzzle sits on the player's centre line at the hull's nose.
const THRUSTER_OFFSET = Object.freeze({
  coconut:           { nozzles: [{ fx: 0.07, fy: 0.24 }, { fx: 0.04, fy: 0.41 }], muzzleFx: 0.86 },
  "little-dark-one": { nozzles: [{ fx: 0.22, fy: 0.34 }, { fx: 0.22, fy: 0.64 }], muzzleFx: 0.95 },
  sofrito:           { nozzles: [{ fx: 0.23, fy: 0.47 }], muzzleFx: 0.98 },
  honeybee:          { nozzles: [{ fx: 0.06, fy: 0.32 }, { fx: 0.06, fy: 0.73 }], muzzleFx: 0.92 },
  default:           { nozzles: [{ fx: 0.04, fy: 0.5 }], muzzleFx: 0.96 }
});

Object.assign(Game.prototype, {
  // ------------------------- Ship (L11 hull, additive parts in the L12 batch) -------------------------
  // Where the trimmed sprite sits this frame (B-1 placement inside the 168 px master box).
  shipGeometry() {
    const shipId = this.currentShipId();
    const key = "ships/" + shipId;
    const sp = Assets.sprite(key, SHIP_DRAW_W);
    const meta = Assets.meta(key);
    const orig = meta && meta.orig;
    const dw = SHIP_DRAW_W;
    const dh = orig && orig.w > 0 ? dw * orig.h / orig.w : sp.h;
    const ox = this.player.x - dw * SHIP_ANCHOR_X;
    const oy = this.player.y - dh / 2;
    return { shipId, key, sp, dw, dh, left: ox + sp.x, top: oy + sp.y, w: sp.w, h: sp.h };
  },

  // One-time bake per ship / spriteEpoch / renderScale / drawable: the hull with its rim shadow (the only
  // shadowBlur in the game) and a white silhouette for the hit overlay. Never in the per-frame path.
  getShipSprite(shipId, geo) {
    const sp = geo.sp;
    if (!sp.img) return null;
    const cache = this._shipSprites || (this._shipSprites = {});
    const rs = this.renderScale || 1;
    const hit = cache[shipId];
    if (hit && hit.epoch === this.spriteEpoch && hit.img === sp.img && hit.rs === rs && hit.w === sp.w && hit.h === sp.h) return hit;
    const pad = SHIP_SHADOW_PAD;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil((sp.w + pad * 2) * rs));
    canvas.height = Math.max(1, Math.ceil((sp.h + pad * 2) * rs));
    const g = canvas.getContext("2d");
    g.setTransform(rs, 0, 0, rs, 0, 0);
    g.shadowColor = "rgba(0,0,0,0.65)";
    g.shadowBlur = 12;
    g.shadowOffsetY = 6;
    g.drawImage(sp.img, pad, pad, sp.w, sp.h);
    g.shadowColor = "rgba(0,0,0,0)";
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    g.drawImage(sp.img, pad, pad, sp.w, sp.h);
    const white = document.createElement("canvas");
    white.width = Math.max(1, Math.ceil(sp.w * rs));
    white.height = Math.max(1, Math.ceil(sp.h * rs));
    const wg = white.getContext("2d");
    wg.setTransform(rs, 0, 0, rs, 0, 0);
    wg.drawImage(sp.img, 0, 0, sp.w, sp.h);
    wg.globalCompositeOperation = "source-in";
    wg.fillStyle = PALETTE.rgba("text", 1);
    wg.fillRect(0, 0, sp.w, sp.h);
    const entry = { canvas, white, pad, epoch: this.spriteEpoch, img: sp.img, rs, w: sp.w, h: sp.h };
    cache[shipId] = entry;
    return entry;
  },

  // Soft dark ellipse behind the hull (240x100) so the ship separates from busy parallax art.
  getLaneScrim() {
    const rs = this.renderScale || 1;
    const hit = this._laneScrim;
    if (hit && hit.epoch === this.spriteEpoch && hit.rs === rs) return hit;
    const s = rs * 0.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(240 * s));
    canvas.height = Math.max(1, Math.round(100 * s));
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s * (100 / 240), 0, 0);
    const grad = g.createRadialGradient(120, 120, 0, 120, 120, 120);
    grad.addColorStop(0, PALETTE.rgba("bg0", 0.45));
    grad.addColorStop(1, PALETTE.rgba("bg0", 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 240);
    const entry = { canvas, epoch: this.spriteEpoch, rs };
    this._laneScrim = entry;
    return entry;
  },

  // Thruster plume layers baked once: outer magenta ellipse and a white -> cyan core, both brightest at the
  // nozzle (right edge) and fading to the left; drawn scaled to the live plume length in the additive batch.
  getPlumeSprites() {
    const rs = this.renderScale || 1;
    const hit = this._plumeSprites;
    if (hit && hit.epoch === this.spriteEpoch && hit.rs === rs) return hit;
    const make = (stops) => {
      const w = 96, h = 40;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * rs));
      canvas.height = Math.max(1, Math.round(h * rs));
      const g = canvas.getContext("2d");
      g.setTransform(rs, 0, 0, rs, 0, 0);
      const grad = g.createLinearGradient(w, 0, 0, 0);
      for (const [p, c] of stops) grad.addColorStop(p, c);
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
      return canvas;
    };
    const entry = {
      outer: make([[0, PALETTE.rgba("magenta", 1)], [0.6, PALETTE.rgba("magenta", 0.85)], [1, PALETTE.rgba("magenta", 0)]]),
      core: make([[0, PALETTE.rgba("text", 1)], [0.35, PALETTE.rgba("cyan", 1)], [1, PALETTE.rgba("cyan", 0)]]),
      epoch: this.spriteEpoch, rs
    };
    this._plumeSprites = entry;
    return entry;
  },

  drawShip(ctx) {
    const m = this.fxMotion();
    const p = this.player;
    const geo = this.shipGeometry();
    const t = this.fxClock || 0;
    const bobHz = typeof FXD.bobHz === "number" ? FXD.bobHz : 1.6;
    const bob = m.anim > 0 ? Math.sin(t * bobHz) * (typeof FXD.bobPx === "number" ? FXD.bobPx : 3) : 0;
    const roll = m.anim > 0 ? Math.sin(t * bobHz + 0.6) * (typeof FXD.rollRad === "number" ? FXD.rollRad : 0.02) : 0;
    const dx = -(typeof FXD.recoilPx === "number" ? FXD.recoilPx : 10) * (p.recoil || 0) - (p.kick || 0);
    const cx = p.x + 10;
    const cy = p.y;

    const scrim = this.getLaneScrim();
    ctx.drawImage(scrim.canvas, cx - 120 + dx, cy - 50 + bob, 240, 100);

    ctx.save();
    ctx.translate(cx + dx, cy + bob);
    if (roll) ctx.rotate(roll);
    ctx.translate(-cx, -cy);
    const sprite = this.getShipSprite(geo.shipId, geo);
    if (sprite) {
      ctx.drawImage(sprite.canvas, geo.left - sprite.pad, geo.top - sprite.pad, geo.w + sprite.pad * 2, geo.h + sprite.pad * 2);
    } else {
      // vector fallback while the sprite loads (keeps its cockpit)
      const x = p.x, y = p.y;
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
      ctx.fillStyle = PALETTE.rgba("magenta", 0.45);
      ctx.beginPath();
      ctx.ellipse(x + SHIP_COCKPIT_DX, y, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // pose for the additive pass (plume, hit overlay, shield, muzzle flash) and the exhaust emitter
    const off = THRUSTER_OFFSET[geo.shipId] || THRUSTER_OFFSET.default;
    const nozzles = sprite
      ? off.nozzles.map((n) => ({ x: geo.left + n.fx * geo.w, y: geo.top + n.fy * geo.h }))
      : [{ x: p.x - 12, y: p.y }];
    const muzzleX = sprite ? geo.left + off.muzzleFx * geo.w : p.x + 40;
    this._shipPose = { cx, cy, dx, bob, roll, geo, sprite, nozzles, muzzle: { x: muzzleX + dx, y: p.y + bob } };
  },

  shipAdditiveActive() {
    return !!this._shipPose;
  },

  // Plume + hit overlay + shield + absorb flash, drawn inside the L12 additive batch so the frame spends no extra
  // composite assignments on the ship.
  drawShipAdditive(ctx) {
    const pose = this._shipPose;
    if (!pose) return;
    const m = this.fxMotion();
    const p = this.player;
    const t = this.fxClock || 0;
    const pl = FXD.plume || {};
    const heat = clamp(p.heat || 0, 0, 1);
    const recoil = clamp(p.recoil || 0, 0, 1);
    const base = typeof pl.base === "number" ? pl.base : 26;
    const live = base + (typeof pl.heat === "number" ? pl.heat : 30) * heat + (typeof pl.flicker === "number" ? pl.flicker : 6) * Math.sin(t * (typeof pl.flickerHz === "number" ? pl.flickerHz : 23));
    const len = (m.anim > 0 ? live : (typeof pl.staticLen === "number" ? pl.staticLen : 36)) * (1 + (typeof pl.recoil === "number" ? pl.recoil : 0.6) * recoil);
    const hh = 7 + 3 * heat;
    const sprites = this.getPlumeSprites();

    ctx.save();
    ctx.translate(pose.cx + pose.dx, pose.cy + pose.bob);
    if (pose.roll) ctx.rotate(pose.roll);
    ctx.translate(-pose.cx, -pose.cy);
    for (const n of pose.nozzles) {
      ctx.globalAlpha = 0.35 + 0.35 * heat;
      ctx.drawImage(sprites.outer, n.x - len + 4, n.y - hh, len, hh * 2);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sprites.core, n.x - len * 0.5 + 3, n.y - hh * 0.55, len * 0.5, hh * 1.1);
    }
    if ((p.hitT || 0) > 0 && pose.sprite) {
      const hitT0 = typeof FXD.hitT === "number" ? FXD.hitT : 0.12;
      ctx.globalAlpha = clamp(p.hitT / hitT0, 0, 1) * 0.7;
      ctx.drawImage(pose.sprite.white, pose.geo.left, pose.geo.top, pose.geo.w, pose.geo.h);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if ((p.shield || 0) > 0 || (p.shieldFlash || 0) > 0) this.drawShield(ctx, pose);
  },

  // Flat-top hexagon r 66 (dashed 8/6, 30 deg/s, violet .55 over a .06 fill), a timer arc sweeping shield/cap,
  // the last 2 s blinking at 3 Hz (dimmed to .35 under reduced motion), white .4 while an absorb flashes.
  drawShield(ctx, pose) {
    const p = this.player;
    const m = this.fxMotion();
    const sh = FXD.shield || {};
    const r = typeof sh.r === "number" ? sh.r : 66;
    const cx = pose.cx + pose.dx;
    const cy = pose.cy + pose.bob;
    const t = this.fxClock || 0;
    const capBase = typeof sh.cap === "number" ? sh.cap : 9;
    const cap = p.shieldCap || (p.shield > capBase ? (typeof sh.capStacked === "number" ? sh.capStacked : 15) : capBase);
    const frac = clamp((p.shield || 0) / Math.max(1, cap), 0, 1);
    let dim = 1;
    if ((p.shield || 0) > 0 && p.shield < (typeof sh.blinkS === "number" ? sh.blinkS : 2)) {
      dim = m.anim > 0 ? (Math.sin(t * FXD_TAU * (typeof sh.blinkHz === "number" ? sh.blinkHz : 3)) > 0 ? 1 : 0.35) : 0.35;
    }
    const spin = m.anim > 0 ? t * ((typeof sh.spinDegS === "number" ? sh.spinDegS : 30) * Math.PI / 180) : 0;
    const flash = clamp((p.shieldFlash || 0) / 0.09, 0, 1);
    const hex = (g, rad) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.closePath();
    };
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    if ((p.shield || 0) > 0) {
      hex(ctx, r);
      ctx.fillStyle = PALETTE.rgba("violet", 0.06);
      ctx.fill();
      ctx.setLineDash(sh.dash || [8, 6]);
      ctx.lineWidth = 2;
      ctx.globalAlpha = dim;
      ctx.strokeStyle = PALETTE.rgba("violet", 0.55);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (flash > 0) {
      hex(ctx, r + 2);
      ctx.globalAlpha = flash * 0.4;
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.rgba("text", 1);
      ctx.stroke();
    }
    ctx.restore();
    if ((p.shield || 0) > 0 && frac > 0) {
      ctx.globalAlpha = dim;
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.rgba("violet", 0.92);
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, -Math.PI / 2, -Math.PI / 2 + FXD_TAU * frac);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // ------------------------- Beams (L7) -------------------------
  // Three passes per beam in one additive batch: w*3 at .22, w at .95, 1 px white at .60, round caps. The visible
  // segment runs from the detached tail to the travelling head (Bullet.tailT / headT). No shadowBlur.
  drawBullets(ctx) {
    const list = this.bullets;
    if (!list.length) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let pass = 0; pass < 3; pass++) {
      for (const b of list) {
        const a = typeof b.alpha === "function" ? b.alpha() : clamp(1 - b.t / b.life, 0, 1);
        if (a <= 0) continue;
        const head = typeof b.headT === "function" ? b.headT() : 1;
        const tail = typeof b.tailT === "function" ? b.tailT() : 0;
        if (head <= tail) continue;
        const col = BULLET_COLORS[b.color] || BULLET_COLORS.cyan;
        ctx.globalAlpha = a;
        if (pass === 0) { ctx.strokeStyle = col.wide; ctx.lineWidth = b.width * 3; }
        else if (pass === 1) { ctx.strokeStyle = col.core; ctx.lineWidth = b.width; }
        else { ctx.strokeStyle = BEAM_WHITE; ctx.lineWidth = 1; }
        ctx.beginPath();
        ctx.moveTo(lerp(b.x, b.tx, tail), lerp(b.y, b.ty, tail));
        ctx.lineTo(lerp(b.x, b.tx, head), lerp(b.y, b.ty, head));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.globalCompositeOperation = "source-over";
  },

  // Muzzle flash: radial disc r 22 -> 0 with three spikes over .06 s at the ship's gun (pose) or the beam origin.
  drawMuzzles(ctx) {
    const pose = this._shipPose;
    for (const mz of this.muzzles) {
      const u = clamp(mz.t / mz.life, 0, 1);
      const r = 22 * (1 - u);
      if (r < 1) continue;
      const x = pose && pose.muzzle ? pose.muzzle.x : mz.x;
      const y = pose && pose.muzzle ? pose.muzzle.y : mz.y;
      const a = 0.9 * (1 - u);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, PALETTE.rgba("text", a));
      g.addColorStop(0.35, PALETTE.rgba(mz.color, a * 0.8));
      g.addColorStop(1, PALETTE.rgba(mz.color, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, FXD_TAU);
      ctx.fill();
      ctx.strokeStyle = PALETTE.rgba("text", a * 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const ang = mz.rot + i * (FXD_TAU / 3);
        const len = 30 * (1 - u * 0.5);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      }
      ctx.stroke();
    }
  },

  // Debris shards: sheet frame 16, rotated, fading over the last .2 s (small tinted squares until the sheet is up).
  drawDebris(ctx) {
    const sheet = ExplosionSprite.sheet;
    const ready = ExplosionSprite.isReady(sheet);
    const frame = (typeof EXPLOSION_FRAMES !== "undefined" && EXPLOSION_FRAMES[16]) || null;
    const k = ExplosionSprite.sheetScale || 1;
    for (const d of this.debris) {
      const a = d.alpha();
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      if (ready && frame) {
        const dw = frame.w * d.size, dh = frame.h * d.size;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.drawImage(sheet, frame.x * k, frame.y * k, frame.w * k, frame.h * k, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = PALETTE.rgba(d.color, 0.9);
        ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
  },

  // Jagged bolts: wide tint pass, core pass, thin white centre; the surge arc (danger) widens 2 -> 4 px.
  drawBolts(ctx) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const b of this.bolts) {
      const a = b.alpha();
      if (a <= 0) continue;
      const w = b.width();
      const p = b.pts;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.lineTo(p[4], p[5]);
      ctx.lineTo(p[6], p[7]);
      ctx.globalAlpha = a * 0.35;
      ctx.strokeStyle = PALETTE.rgba(b.color, 1);
      ctx.lineWidth = w * 3;
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = PALETTE.rgba("text", 1);
      ctx.lineWidth = Math.max(1, w * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // ------------------------- L12: explosions, dying plates, particles, rings, bolts -------------------------
  // The additive batch opens at the end of drawExplosionSprites (after the source-over smoke frames and the white
  // impact plates) and closes at the end of drawParticles: two composite assignments for the whole layer.
  openAdditive(ctx) {
    if (this._fxAdditive) return;
    ctx.globalCompositeOperation = "lighter";
    this._fxAdditive = true;
  },
  closeAdditive(ctx) {
    if (!this._fxAdditive) return;
    ctx.globalCompositeOperation = "source-over";
    this._fxAdditive = false;
  },

  drawExplosionSprites(ctx) {
    const list = this.explosions;
    let flashes = 0;
    for (const ex of list) {
      if (ex.done) continue;
      if (ex.isFlash()) { flashes++; continue; }
      ex.drawFrame(ctx);
    }
    if (!this.needsAdditiveBatch(flashes)) return;
    this.openAdditive(ctx);
    if (flashes) for (const ex of list) if (!ex.done && ex.isFlash()) ex.drawFrame(ctx);
  },

  // Anything the additive batch would draw this frame? (Keeps idle frames at zero composite assignments.)
  needsAdditiveBatch(flashes) {
    if (flashes) return true;
    if (this.particles.length) return true;
    for (const name of ["rings", "bolts", "debris", "glyphParticles", "flashDiscs", "muzzles"]) {
      const l = this[name];
      if (l && l.length) return true;
    }
    return typeof this.shipAdditiveActive === "function" && this.shipAdditiveActive();
  },

  drawParticles(ctx) {
    if (!this._fxAdditive) {
      if (!this.needsAdditiveBatch(0)) return;
      this.openAdditive(ctx);
    }
    if (typeof this.drawShipAdditive === "function") this.drawShipAdditive(ctx);
    if (this.muzzles && this.muzzles.length) this.drawMuzzles(ctx);
    const list = this.particles;
    if (list.length) {
      ctx.lineCap = "round";
      for (const p of list) {
        const a = p.alpha();
        if (a <= 0) continue;
        const row = PARTICLE_COLORS[p.color] || PARTICLE_COLORS.cyan;
        const col = row[Math.max(1, Math.round(clamp(a, 0, 1) * PARTICLE_ALPHA_STEPS))];
        const r = p.radius();
        if (p.speed() > 200) {
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(0.8, r * 2);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
        } else {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, FXD_TAU);
          ctx.fill();
        }
      }
    }
    if (this.debris && this.debris.length && typeof this.drawDebris === "function") this.drawDebris(ctx);
    if (this.glyphParticles && this.glyphParticles.length) this.drawGlyphParticles(ctx);
    if (this.rings && this.rings.length) this.drawRings(ctx);
    if (this.bolts && this.bolts.length && typeof this.drawBolts === "function") this.drawBolts(ctx);
    if (this.flashDiscs && this.flashDiscs.length) this.drawFlashDiscs(ctx);
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    this.closeAdditive(ctx);
  },

  // Spent letters popping off the plate (onKeyFx).
  drawGlyphParticles(ctx) {
    ctx.font = FONT.target(18, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const g of this.glyphParticles) {
      const u = clamp(g.t / g.life, 0, 1);
      ctx.globalAlpha = (1 - u) * 0.92;
      ctx.fillStyle = PALETTE.rgba(g.color || "text", 1);
      ctx.fillText(g.ch, g.x, g.y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  },

  drawRings(ctx) {
    for (const r of this.rings) {
      const a = r.alpha();
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = PALETTE.rgba(r.color, 0.92);
      ctx.lineWidth = r.width();
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius(), 0, FXD_TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // One-frame white discs (impact / kill flash). Drawn once, then dropped.
  drawFlashDiscs(ctx) {
    for (const d of this.flashDiscs) {
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = PALETTE.rgba("text", 1);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, FXD_TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.flashDiscs.length = 0;
  },

  // ------------------------- World overlays (L14) and vignette (L17) -------------------------
  // Edge vignettes are cached per colour at half device resolution (a drawImage, never a full-frame fill).
  getEdgeVignette(name) {
    const cache = this._edgeVignettes || (this._edgeVignettes = {});
    const hit = cache[name];
    if (hit && hit.epoch === this.spriteEpoch) return hit;
    const s = (this.renderScale || 1) * 0.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.w * s));
    canvas.height = Math.max(1, Math.round(this.h * s));
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    const grad = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.5, this.w / 2, this.h / 2, this.w * 0.56);
    grad.addColorStop(0, PALETTE.rgba(name, 0));
    grad.addColorStop(0.55, PALETTE.rgba(name, 0.45));
    grad.addColorStop(1, PALETTE.rgba(name, 1));
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    const entry = { canvas, epoch: this.spriteEpoch, name };
    cache[name] = entry;
    if (name === "danger") this.dangerVignette = entry;
    return entry;
  },
  getDangerVignette() { return this.getEdgeVignette("danger"); },

  drawEdgeVignette(ctx, name, alpha) {
    const v = this.getEdgeVignette(name);
    const pad = typeof SHAKE_PAD === "number" ? SHAKE_PAD : 20;
    ctx.globalAlpha = alpha;
    ctx.drawImage(v.canvas, -pad, -pad, this.w + 2 * pad, this.h + 2 * pad);
    ctx.globalAlpha = 1;
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

  // Flash channels (JUICE-07 / VIS-15): damage and low-HP as a danger edge vignette, the boss intro as a violet
  // edge, whiteFlash as the only full-frame fill (<= .12, .08 under reduced motion), a typo with nothing locked
  // as a 2 px flicker along the top of the playfield. Never a red wash over the typing target.
  drawFlashChannels(ctx) {
    const m = this.fxMotion();
    const p = this.player;
    const maxV = typeof FXD.vignetteMax === "number" ? FXD.vignetteMax : 0.35;
    let danger = clamp((this.damageFlash || 0) * maxV * m.flash, 0, maxV);
    if (this.mode !== "menu" && p.maxHp > 0 && p.hp > 0 && p.hp / p.maxHp < 0.25) {
      const low = FXD.lowHp || {};
      const base = typeof low.base === "number" ? low.base : 0.10;
      const amp = typeof low.amp === "number" ? low.amp : 0.08;
      const hz = typeof low.hz === "number" ? low.hz : 1.2;
      danger += m.anim > 0 ? base + amp * Math.sin(FXD_TAU * hz * (this.fxClock || 0)) : (typeof low.reduced === "number" ? low.reduced : 0.12);
    }
    danger = Math.min(maxV, danger);
    if (danger > 0.004) this.drawEdgeVignette(ctx, "danger", danger);

    const introMax = typeof FXD.introPulseMax === "number" ? FXD.introPulseMax : 0.25;
    const intro = clamp((this.introPulse || 0) * introMax * m.flash, 0, introMax);
    if (intro > 0.004) this.drawEdgeVignette(ctx, "violet", intro);

    const wf = this.whiteFlash || 0;
    if (wf > 0.004) {
      const cap = m.anim > 0 ? (typeof FXD.whiteFlashMax === "number" ? FXD.whiteFlashMax : 0.12) : (typeof FXD.whiteFlashMaxReduced === "number" ? FXD.whiteFlashMaxReduced : 0.08);
      const a = Math.min(cap, wf * 0.24 * m.flash);
      if (a > 0.004) {
        ctx.fillStyle = PALETTE.rgba("text", a);
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }

    if ((this.typoEdge || 0) > 0) {
      const top = this.hudSafeTop || 0;
      const a = m.anim > 0 ? ((this.frameCount & 1) ? 0.9 : 0.35) : 0.7;
      ctx.fillStyle = PALETTE.rgba("danger", a);
      ctx.fillRect(0, top, this.w, 2);
    }
  },

  drawWorldOverlays(ctx) {
    this.drawFlashChannels(ctx);
  },

  // ------------------------- L16: active target over banners -------------------------
  // The locked plate (or the boss slab) is redrawn above a centre banner that covers it, re-applying the frame's
  // shake transform; a typo'd plate ghosts +-3 px for its 120 ms; the expected char rises above the plate.
  activePlate() {
    const lock = this.lock && this.lock.ref;
    if (lock && lock.alive && lock.kind !== "boss") return lock;
    const last = this.lastPlateDrawn;
    if (last && last.alive && last.locked) return last;
    return null;
  },

  activeBannerRects(ctx) {
    const out = [];
    const presets = typeof BANNER_PRESETS === "object" && BANNER_PRESETS ? BANNER_PRESETS : null;
    if (!presets) return out;
    for (const b of [this.banner, this.callout]) {
      if (!b) continue;
      const preset = presets[b.kind] || presets.callout || {};
      if (preset.align && preset.align !== "center") continue;
      const size = preset.size || 24;
      let y = b.y != null ? b.y : (typeof preset.y === "function" ? preset.y(this) : this.h * 0.46);
      if (b.kind === "callout" && this.banner && this.banner !== b && this.banner.kind === "wave") y += 44;
      ctx.font = FONT.display(size, 800);
      const tw = b.title ? ctx.measureText(String(b.title)).width : 0;
      const halfW = Math.max(tw, this.w * 0.25) / 2 + 24;
      const top = y - size * 1.2;
      const bottom = y + size * (b.sub ? 1.6 : 1.0);
      out.push({ x: this.w / 2 - halfW, y: top, w: halfW * 2, h: bottom - top });
      if (preset.letterbox) out.push({ x: 0, y: y - size * 1.1, w: this.w, h: size * 2.6 });
    }
    return out;
  },

  redrawActiveTarget(ctx) {
    const m = this.fxMotion();
    const glyphs = this.typoGlyphs && this.typoGlyphs.length ? this.typoGlyphs : null;
    const plate = this.activePlate();
    const boss = this.inBoss && this.boss ? this.boss : null;
    const hit = typeof rectsIntersect === "function" ? rectsIntersect : (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const banners = (this.banner || this.callout) ? this.activeBannerRects(ctx) : [];
    let needPlate = false;
    let jitter = false;
    if (plate) {
      jitter = (plate.typoT || 0) > 0 && m.anim > 0;
      if (jitter) needPlate = true;
      else if (banners.length) {
        const w = plate.plateW || 64, h = plate.plateH || 40;
        const r = { x: plate.x - w / 2, y: plate.y - h / 2, w, h };
        needPlate = banners.some((b) => hit(b, r));
      }
    }
    let needSlab = false;
    if (boss && banners.length && typeof this.drawBossSlab === "function" && !(this.bossIntro && this.bossIntro.locked)) {
      const sr = boss.slabRect;
      needSlab = !!sr && banners.some((b) => hit(b, sr));
    }
    if (!needPlate && !needSlab && !glyphs) return;

    const sh = this.shakeNow || { x: 0, y: 0, rot: 0 };
    ctx.save();
    ctx.translate(sh.x, sh.y);
    if (sh.rot) { ctx.translate(this.w / 2, this.h / 2); ctx.rotate(sh.rot); ctx.translate(-this.w / 2, -this.h / 2); }
    if (needSlab) this.drawBossSlab(ctx, boss);
    if (needPlate) {
      ctx.save();
      if (jitter) ctx.translate(randi(-3, 3), randi(-3, 3));
      if (plate.kind === "powerup") { if (typeof this.drawPowerup === "function") this.drawPowerup(ctx, plate); }
      else if (typeof this.drawEnemy === "function") this.drawEnemy(ctx, plate);
      ctx.restore();
    }
    if (glyphs) this.drawTypoGlyphs(ctx);
    ctx.restore();
  },

  drawTypoGlyphs(ctx) {
    ctx.font = FONT.target(14, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    for (const g of this.typoGlyphs) {
      const ref = g.ref;
      if (!ref) continue;
      const u = clamp(g.t / g.life, 0, 1);
      let top;
      if (ref.kind === "boss") {
        const sr = ref.slabRect;
        top = sr ? sr.y : ref.y - 95;
      } else {
        top = ref.y - (ref.plateH || 40) / 2;
      }
      const y = top - 8 - g.rise * easeOutCubic(u);
      ctx.globalAlpha = u < 0.7 ? 1 : (1 - u) / 0.3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.rgba("bg0", 0.85);
      ctx.strokeText(g.ch, ref.x, y);
      ctx.fillStyle = PALETTE.rgba("danger", 1);
      ctx.fillText(g.ch, ref.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  },

  drawVignette(ctx) {
    const v = this.getVignetteSprite();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(v.canvas, 0, 0, this.canvas.width, this.canvas.height);
    const s = this.renderScale || 1;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  },
});
