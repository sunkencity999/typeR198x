// Type-R 198X — game entity classes (Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss). Classic script; load order is defined in index.html.

// ----------------------------- Game Entities -----------------------------
class Enemy {
  constructor({ text, x, y, speed, kind = "enemy" }) {
    this.kind = kind; // enemy | bossMinion
    this.text = text.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.radius = 18 + Math.min(42, this.text.length * 6);
    this.alive = true;
    this.flash = 0;
    this.locked = false;
  }
  remaining() { return this.text.slice(this.progress); }
  nextChar() { return this.text[this.progress] || null; }
  update(dt) {
    this.x -= this.speed * dt;
    this.flash = Math.max(0, this.flash - dt * 5);
  }
}

class Powerup {
  constructor({ type, label, x, y, speed }) {
    this.kind = "powerup";
    this.type = type;
    this.label = label.toLowerCase();
    this.progress = 0;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.alive = true;
    this.locked = false;
    this.floatT = rand(0, Math.PI * 2);
  }
  remaining() { return this.label.slice(this.progress); }
  nextChar() { return this.label[this.progress] || null; }
  update(dt) {
    this.x -= this.speed * dt;
    this.floatT += dt * 2.1;
    this.y += Math.sin(this.floatT) * dt * 10;
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
  constructor({ name, segments, artLevel }) {
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
  get maxLen() { return Math.max(...this.segments.map(s => s.length)); }
  get totalChars() { return this.segments.reduce((a,s)=>a+s.length,0); }
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
    // Gentle float
    this.y = 240 + Math.sin(this.phaseT * 0.8) * 60;
    this.flash = Math.max(0, this.flash - dt * 5);
  }
  advance() {
    this.progress++;
    this.flash = 0.25;
    if (this.progress >= this.segment.length) {
      this.segmentIndex++;
      this.progress = 0;
    }
  }
}
