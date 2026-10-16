// Type-R 198X — game entity classes (Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss). Classic script; load order is defined in index.html.

// ----------------------------- Game Entities -----------------------------
// Plate width before the renderer measures the text: 20 px monospace advances ~12 px per glyph (+28 padding;
// minions +24). The renderer overwrites textW/plateW with the measured value (see HANDOFF).
const PLATE_PAD = 28;
const PLATE_PAD_MINION = 24;
const GLYPH_ADVANCE_EST = 12;

class Enemy {
  constructor({ text, x, y, speed, kind = "enemy", lane = -1 }) {
    this.kind = kind; // enemy | bossMinion
    this.text = text.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.lane = lane;
    this.speed = speed;
    this.radius = 18 + Math.min(42, this.text.length * 6);
    this.alive = true;
    this.flash = 0;
    this.locked = false;
    // B-14 entity fields
    this.textW = this.text.length * GLYPH_ADVANCE_EST;
    this.plateW = this.textW + (kind === "bossMinion" ? PLATE_PAD_MINION : PLATE_PAD);
    this.plateH = kind === "bossMinion" ? PLATE_H_MINION : PLATE_H;
    this.cleanSoFar = true;   // no hard miss between lock and kill
    this.typoT = 0;           // plate flinch after a wrong key
    this.flinch = 0;
    this.dying = false;       // auto-detonating (drain timeout / approach / phase clear): not targetable
    this.age = 0;
  }
  remaining() { return this.text.slice(this.progress); }
  nextChar() { return this.text[this.progress] || null; }
  update(dt) {
    this.x -= this.speed * dt;
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.typoT = Math.max(0, this.typoT - dt);
    this.flinch = Math.max(0, this.flinch - dt * 6);
  }
}

class Powerup {
  constructor({ type, label, x, y, speed, lane = -1, fromKill = false, ttl = 14, homing = null }) {
    this.kind = "powerup";
    this.type = type;
    this.label = label.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.baseY = y;
    this.lane = lane;
    this.speed = speed;
    this.alive = true;
    this.locked = false;
    this.floatT = rand(0, Math.PI * 2);
    // B-14 entity fields
    this.labelW = this.label.length * GLYPH_ADVANCE_EST;
    this.plateW = this.labelW + PLATE_PAD;
    this.plateH = PLATE_H;
    this.fromKill = fromKill;
    this.ttl = ttl;
    this.age = 0;
    this.dying = false;
    this.homing = homing; // { tx, ty }: drifts toward this point (kill drops head for the ship's lane)
  }
  remaining() { return this.label.slice(this.progress); }
  nextChar() { return this.label[this.progress] || null; }
  update(dt) {
    this.age += dt;
    this.floatT += dt * 2.1;
    if (this.homing) {
      const dx = this.homing.tx - this.x;
      const dy = this.homing.ty - this.baseY;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, this.speed * dt);
      this.x += (dx / d) * step;
      this.baseY += (dy / d) * step;
      if (d <= 1) this.homing = null;
    } else {
      this.x -= this.speed * dt;
    }
    this.y = this.baseY + Math.sin(this.floatT) * 4;   // bob +-4 px
    if (this.age >= this.ttl) this.dying = true;
  }
}

class Bullet {
  constructor({ x, y, tx, ty, life = 0.08, width = 3, color = "cyan" }) {
    this.kind = "bullet";
    this.x = x; this.y = y;
    this.tx = tx; this.ty = ty;
    this.life = life;
    this.t = 0;
    this.width = width;
    this.color = color; // PALETTE name: cyan | magenta | lime (BULLET_COLORS in 70-render.js)
  }
  update(dt) {
    this.t += dt;
  }
  alive() { return this.t < this.life; }
}

// Sheet-animated explosion (A7 / JUICE-04). The sheet is owned by the Assets loader and read every frame through
// ExplosionSprite.getSheet() (never cached across frames: a re-prepare closes the previous ImageBitmap).
// ExplosionSprite.sheetScale multiplies the EXPLOSION_FRAMES source rects (1 for the full sheet, 0.5 for the x1
// half sheet). Flash frames composite additively, the fireball/smoke frames source-over; the last two frames fade
// out and grow a little so a blast dissipates instead of ending on a dot.
class ExplosionSprite {
  constructor({ x, y, type = "small", sheet = null }) {
    this.x = x;
    this.y = y;
    this.type = EXPLOSION_SETS[type] ? type : "small";
    this.sheet = sheet; // explicit drawable (tests); null -> ExplosionSprite.getSheet()
    const cfg = EXPLOSION_SETS[this.type];
    this.frames = cfg.frames;
    this.flashFrames = cfg.flashFrames || [];
    this.frameIndex = 0;
    this.scale = cfg.scale ?? 1;
    this.frameTime = 0;
    this.perFrame = cfg.frameTime ?? 0.06;
    this.done = false;
  }
  static get sheet() {
    if (typeof ExplosionSprite.getSheet === "function") {
      try { return ExplosionSprite.getSheet() || null; } catch (e) { return null; }
    }
    return null;
  }
  static isReady(sheet) {
    if (!sheet) return false;
    if (typeof HTMLImageElement !== "undefined" && sheet instanceof HTMLImageElement) return sheet.complete && sheet.naturalWidth > 0;
    return (sheet.width | 0) > 0;
  }
  currentSheet() {
    return this.sheet || ExplosionSprite.sheet;
  }
  blendFor(frameIdx) {
    return this.flashFrames.includes(frameIdx) ? "lighter" : "source-over";
  }
  // Fade over the last two frames (1 -> 0 across their combined duration).
  alphaFor(frameIndex) {
    const n = this.frames.length;
    if (n < 2 || frameIndex < n - 2) return 1;
    const within = (frameIndex - (n - 2)) * this.perFrame + Math.min(this.frameTime, this.perFrame);
    const span = 2 * this.perFrame;
    return Math.max(0, 1 - within / span);
  }
  update(dt) {
    if (this.done) return;
    if (!ExplosionSprite.isReady(this.currentSheet())) return;
    this.frameTime += dt;
    while (this.frameTime >= this.perFrame) {
      this.frameTime -= this.perFrame;
      this.frameIndex++;
      if (this.frameIndex >= this.frames.length) {
        this.done = true;
        break;
      }
    }
  }
  draw(ctx) {
    if (this.done) return;
    const sheet = this.currentSheet();
    if (!ExplosionSprite.isReady(sheet)) return;

    const fi = Math.min(this.frameIndex, this.frames.length - 1);
    const frameIdx = this.frames[fi];
    const frame = EXPLOSION_FRAMES[frameIdx];
    if (!frame) return;
    const k = ExplosionSprite.sheetScale || 1;
    const alpha = this.alphaFor(fi);
    if (alpha <= 0) return;
    const grow = alpha < 1 ? 1 + 0.15 * (1 - alpha) : 1;
    const dw = frame.w * this.scale * grow;
    const dh = frame.h * this.scale * grow;
    const prevAlpha = ctx.globalAlpha;
    const prevComp = ctx.globalCompositeOperation;
    const blend = this.blendFor(frameIdx);
    if (blend !== prevComp) ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = prevAlpha * alpha;
    ctx.drawImage(sheet, frame.x * k, frame.y * k, frame.w * k, frame.h * k, this.x - dw / 2, this.y - dh / 2, dw, dh);
    ctx.globalAlpha = prevAlpha;
    if (blend !== prevComp) ctx.globalCompositeOperation = prevComp;
  }
}
ExplosionSprite.sheetScale = 1;
// Set by the boot code to () => Assets.get("fx/explosions"); a default that reads the loader when present.
ExplosionSprite.getSheet = () => (typeof Assets !== "undefined" && Assets && typeof Assets.get === "function" ? Assets.get("fx/explosions") : null);

// Particle colours are PALETTE names; `hue` is kept for callers that still pass one (185 cyan, 310 magenta,
// 95 lime, 40 amber). Draw code looks the colour string up in a prebuilt table (PARTICLE_COLORS, 70-render.js).
const PARTICLE_HUE_NAMES = { 185: "cyan", 310: "magenta", 95: "lime", 40: "amber" };
class Particle {
  constructor({ x, y, vx, vy, life, size, hue, color }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.hue = hue;
    this.color = color || PARTICLE_HUE_NAMES[hue] || "cyan";
  }
  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= (1 - dt * 2.2);
    this.vy *= (1 - dt * 2.2);
  }
  alive() { return this.t < this.life; }
  alpha() { return 1 - (this.t / this.life); }
}

class Boss {
  constructor({ name, segments, artLevel, phaseStarts = [0], artSize = null }) {
    this.kind = "boss";
    this.name = name;
    this.segments = segments.map(s => s.toLowerCase());
    this.segmentIndex = 0;
    this.progress = 0;
    this.x = 980;
    this.y = 250;
    this.vy = 0;
    this.phaseT = 0;
    this.flash = 0;
    this.alive = true;
    this.artLevel = artLevel;
    // B-14 entity fields
    this.phase = 0;
    this.phaseStarts = phaseStarts.slice();
    this.surge = null;        // { t, dur, armed }
    this.surgeTimer = 0;      // seconds since the last surge (or the intro)
    this.surgeFlash = 0;      // bolt afterglow after fireSurge
    this.enterT = 0;
    this.artSize = artSize;   // { w, h } of the untrimmed art, for artRect before D6 recomposes
    this.contentRect = null;  // set by D6 (opaque box in logical px)
  }
  get segment() { return this.segments[this.segmentIndex] || null; }
  get remaining() {
    const seg = this.segment;
    return seg ? seg.slice(this.progress) : "";
  }
  get nextChar() {
    const seg = this.segment;
    return seg ? (seg[this.progress] || null) : null;
  }
  get done() { return this.segmentIndex >= this.segments.length; }
  get totalChars() { return this.segments.reduce((a,s)=>a+s.length,0); }
  get remainingChars() {
    const seg = this.segment;
    return seg ? seg.length - this.progress : 0;
  }
  // Today's draw box (pre-D6): scale = min(.65*720/h, .7), x = boss.x - .35*artW, y = boss.y - .45*artH.
  // Without known art it falls back to the console slab so minion spawns still have an anchor.
  get artRect() {
    const g = (typeof window !== "undefined" && window.game) || null;
    if (g && typeof g.bossArtRect === "function") {
      const r = g.bossArtRect(this);
      if (r && r.w > 0 && r.h > 0) return r;
    }
    const a = this.artSize;
    if (a && a.w > 0 && a.h > 0) {
      const scale = Math.min((720 * 0.65) / a.h, 0.7);
      const w = a.w * scale, h = a.h * scale;
      return { x: this.x - w * 0.35, y: this.y - h * 0.45, w, h };
    }
    return this.slabRect;
  }
  get slabRect() { return { x: this.x - 260, y: this.y - 95, w: 520, h: 190 }; }
  phaseFor(segmentIndex) {
    let p = 0;
    for (let i = 0; i < this.phaseStarts.length; i++) if (segmentIndex >= this.phaseStarts[i]) p = i;
    return p;
  }
  charsDone() {
    let done = 0;
    for (let i=0;i<this.segmentIndex;i++) done += this.segments[i].length;
    done += this.progress;
    return done;
  }
  hpFrac() {
    const total = this.totalChars;
    return total <= 0 ? 0 : 1 - (this.charsDone() / total);
  }
  update(dt, h) {
    this.phaseT += dt;
    this.enterT += dt;
    // Gentle float
    this.y = 240 + Math.sin(this.phaseT * 0.8) * 60;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.surgeFlash = Math.max(0, this.surgeFlash - dt * 4);
  }
  // One correct character. phaseDone is true when the completed segment closed a phase (never on the kill).
  advance() {
    this.progress++;
    this.flash = 0.25;
    let segmentDone = false;
    let phaseDone = false;
    if (this.progress >= this.segment.length) {
      this.segmentIndex++;
      this.progress = 0;
      segmentDone = true;
      phaseDone = !this.done && this.phaseStarts.includes(this.segmentIndex);
      if (phaseDone) this.phase = this.phaseFor(this.segmentIndex);
    }
    return { segmentDone, phaseDone };
  }
}
