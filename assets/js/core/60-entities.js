// Type-R 198X — game entity classes (Enemy, Powerup, Bullet, ExplosionSprite, Particle, Boss). Classic script; load order is defined in index.html.

// ----------------------------- Game Entities -----------------------------
// Plate width before the renderer measures the text: 20 px monospace advances ~12 px per glyph (+28 padding;
// minions +24; powerup capsules +44 for the 26 px icon cell). The renderer overwrites textW/plateW with the
// measured value (see HANDOFF).
const PLATE_PAD = 28;
const PLATE_PAD_MINION = 24;
const CAPSULE_PAD = 44;
const CAPSULE_H = 36;
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
    this.age = 0;             // seconds since spawn (spawn pop / warp streak)
    this.popScale = 1;        // last drawn spawn-pop width factor (probe / debug)
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
    this.flash = 0;
    this.floatT = rand(0, Math.PI * 2);
    // B-14 entity fields (capsule geometry: h 36, w = labelW + 44)
    this.labelW = this.label.length * GLYPH_ADVANCE_EST;
    this.textW = this.labelW;
    this.plateW = this.labelW + CAPSULE_PAD;
    this.plateH = CAPSULE_H;
    this.fromKill = fromKill;
    this.ttl = ttl;
    this.age = 0;
    this.dying = false;
    this.homing = homing; // { tx, ty }: drifts toward this point (kill drops head for the ship's lane)
  }
  remaining() { return this.label.slice(this.progress); }
  nextChar() { return this.label[this.progress] || null; }
  // bobAmp: +-px of the idle bob (4 by default, 0 under reduce-motion; the game passes it).
  update(dt, bobAmp = 4) {
    this.age += dt;
    this.floatT += dt * 2.1;
    this.flash = Math.max(0, this.flash - dt * 5);
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
    this.y = this.baseY + Math.sin(this.floatT) * bobAmp;
    if (this.age >= this.ttl) this.dying = true;
  }
}

// Staged laser (D2 / JUICE-03): the head races from the muzzle (x, y) to the target in FX_BULLET.head seconds,
// the tail detaches after FX_BULLET.tail and the beam is gone at `life`. drawBullets derives the visible segment
// from tailT()/headT(); the effects clock spawns the impact ring when the head arrives (`arrived`). `impact`
// false marks decorative side beams (SPREAD) that ring nothing.
const FX_BULLET = (() => {
  const m = (typeof FX_MOTION === "object" && FX_MOTION) || {};
  return { life: typeof m.bulletLife === "number" ? m.bulletLife : 0.15, head: typeof m.bulletHeadS === "number" ? m.bulletHeadS : 0.035, tail: typeof m.bulletTailS === "number" ? m.bulletTailS : 0.07 };
})();
class Bullet {
  constructor({ x, y, tx, ty, life = FX_BULLET.life, width = 3, color = "cyan", impact = true }) {
    this.kind = "bullet";
    this.x = x; this.y = y;
    this.tx = tx; this.ty = ty;
    this.life = life;
    this.t = 0;
    this.width = width;
    this.color = color; // PALETTE name (BULLET_COLORS in 75-fx-draw.js)
    this.impact = impact;
    this.arrived = false;
  }
  update(dt) {
    this.t += dt;
  }
  alive() { return this.t < this.life; }
  headT() { return clamp(this.t / FX_BULLET.head, 0, 1); }
  tailT() { return clamp((this.t - FX_BULLET.tail) / Math.max(0.001, this.life - FX_BULLET.tail), 0, 1); }
  alpha() { const u = this.t / this.life; return clamp(1 - u * u, 0, 1); }
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
  // Sheet frame currently shown and whether it is one of the additive flash frames.
  frameIdx() { return this.frames[Math.min(this.frameIndex, this.frames.length - 1)]; }
  isFlash() { return this.flashFrames.includes(this.frameIdx()); }
  // Draws the current frame under whatever composite mode the caller has set. 75-fx-draw.js draws smoke frames
  // source-over first and the flash frames inside the one additive batch, so a frame never flips the blend mode
  // per sprite (CONTRACT: <= 6 globalCompositeOperation sets per frame).
  drawFrame(ctx) {
    if (this.done) return;
    const sheet = this.currentSheet();
    if (!ExplosionSprite.isReady(sheet)) return;
    const fi = Math.min(this.frameIndex, this.frames.length - 1);
    const frame = EXPLOSION_FRAMES[this.frames[fi]];
    if (!frame) return;
    const k = ExplosionSprite.sheetScale || 1;
    const alpha = this.alphaFor(fi);
    if (alpha <= 0) return;
    const grow = alpha < 1 ? 1 + 0.15 * (1 - alpha) : 1;   // last two frames: fade 1 -> 0, scale 1 -> 1.15
    const dw = frame.w * this.scale * grow;
    const dh = frame.h * this.scale * grow;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * alpha;
    ctx.drawImage(sheet, frame.x * k, frame.y * k, frame.w * k, frame.h * k, this.x - dw / 2, this.y - dh / 2, dw, dh);
    ctx.globalAlpha = prevAlpha;
  }
  // Single-sprite path (sets its own blend); the renderer batches through drawFrame instead.
  draw(ctx) {
    if (this.done) return;
    const prevComp = ctx.globalCompositeOperation;
    const blend = this.blendFor(this.frameIdx());
    if (blend !== prevComp) ctx.globalCompositeOperation = blend;
    this.drawFrame(ctx);
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
  constructor({ x, y, vx, vy, life, size, hue, color, drag = 2.2 }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.hue = hue;
    this.color = color || PARTICLE_HUE_NAMES[hue] || "cyan";
    this.drag = drag;
  }
  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const k = Math.max(0, 1 - dt * this.drag);
    this.vx *= k;
    this.vy *= k;
  }
  alive() { return this.t < this.life; }
  alpha() { return 1 - (this.t / this.life); }
  // Radius shrinks with (1 - t/life)^2 (never below .6 px); fast particles draw as streaks (75-fx-draw.js).
  radius() { const u = 1 - this.t / this.life; return Math.max(0.6, this.size * u * u); }
  speed() { return Math.hypot(this.vx, this.vy); }
}

// Shockwave ring (D1/D2, VIS-15): expands from size*.3 to size*2.2 over `life` with an ease-out, stroke alpha
// 1 -> 0. Under reduced motion (`expand` false) it holds a mid radius and only fades.
class Ring {
  constructor({ x, y, size, color = "cyan", life = 0.28, expand = true }) {
    this.kind = "ring";
    this.x = x; this.y = y;
    this.size = size;
    this.r0 = size * 0.3;
    this.r1 = size * 2.2;
    this.color = color;
    this.life = life;
    this.t = 0;
    this.expand = expand;
  }
  update(dt) { this.t += dt; }
  alive() { return this.t < this.life; }
  radius() {
    if (!this.expand) return lerp(this.r0, this.r1, 0.6);
    return lerp(this.r0, this.r1, easeOutCubic(this.t / this.life));
  }
  alpha() { return clamp(1 - this.t / this.life, 0, 1); }
  width() { return this.size >= 100 ? lerp(4, 2, this.t / this.life) : 2; }
}

// Jagged additive bolt (D2): three segments between the endpoints with perpendicular jitter, re-rolled at
// flickerHz while `jitter` is on (static under reduced motion). RAPID chain hits are cyan .12 s; the boss surge
// arc is danger and widens 2 -> 4 px over its life.
class Bolt {
  constructor({ x1, y1, x2, y2, color = "cyan", life = 0.12, width = 2, widthEnd = null, flickerHz = 20, jitter = true }) {
    this.kind = "bolt";
    this.x1 = x1; this.y1 = y1;
    this.x2 = x2; this.y2 = y2;
    this.color = color;
    this.life = life;
    this.t = 0;
    this.w0 = width;
    this.w1 = widthEnd == null ? width : widthEnd;
    this.flickerHz = flickerHz;
    this.jitter = jitter;
    this.flickerAcc = 0;
    this.pts = new Float64Array(8);
    this.reroll();
  }
  reroll() {
    const dx = this.x2 - this.x1, dy = this.y2 - this.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const amp = clamp(len * 0.12, 4, 22);
    const p = this.pts;
    p[0] = this.x1; p[1] = this.y1;
    for (let i = 1; i <= 2; i++) {
      const u = i / 3 + rand(-0.08, 0.08);
      const off = (i === 1 ? 1 : -1) * rand(0.35, 1) * amp;
      p[i * 2] = this.x1 + dx * u + nx * off;
      p[i * 2 + 1] = this.y1 + dy * u + ny * off;
    }
    p[6] = this.x2; p[7] = this.y2;
  }
  update(dt) {
    this.t += dt;
    if (!this.jitter) return;
    this.flickerAcc += dt;
    if (this.flickerAcc >= 1 / this.flickerHz) { this.flickerAcc = 0; this.reroll(); }
  }
  alive() { return this.t < this.life; }
  alpha() { return clamp(1 - this.t / this.life, 0, 1); }
  width() { return lerp(this.w0, this.w1, clamp(this.t / this.life, 0, 1)); }
}

// Explosion debris (D2 / JUICE-04): sheet frame 16 pieces thrown off medium / large blasts, gravity 520 px/s^2,
// spinning, fading over the last .2 s of a .7 s life.
class Debris {
  constructor({ x, y, vx, vy, life = 0.7, gravity = 520, frame = 16, size = 0.2 }) {
    this.kind = "debris";
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.gravity = gravity;
    this.frame = frame;
    this.rot = rand(0, Math.PI * 2);
    this.vr = rand(-9, 9);
    this.size = size;            // draw scale of the sheet frame (logical px per sheet px)
    this.color = choice(["amber", "magenta"]);   // fallback colour while the sheet is not ready
  }
  update(dt) {
    this.t += dt;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.vr * dt;
  }
  alive() { return this.t < this.life; }
  alpha() { const left = this.life - this.t; return left < 0.2 ? Math.max(0, left / 0.2) : 1; }
}

class Boss {
  constructor({ name, segments, artLevel, phaseStarts = [0], artSize = null }) {
    this.kind = "boss";
    this.name = name;
    this.segments = segments.map(s => s.toLowerCase());
    this.segmentIndex = 0;
    this.progress = 0;
    // x/y are the art's content centre; the renderer (bossPlacement) writes them every frame once the art is known.
    this.x = 976;
    this.y = 360;
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
    this.artSize = artSize;   // { w, h } of the untrimmed art (fallback geometry when the loader has no manifest)
    this.contentRect = null;  // opaque box in logical px (written by the renderer; bossAimPoint / minion spawns read it)
  }
  get segment() { return this.segments[this.segmentIndex] || null; }
  get nextSegment() { return this.segments[this.segmentIndex + 1] || null; }
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
  // Trimmed-sprite rect in world space. The renderer's bossArtRect() (VIS-07 composition: art box x 688..w-16,
  // y hudSafeTop+8..h-24) is the source of truth; without it, a box fitted into the right column.
  get artRect() {
    const g = (typeof window !== "undefined" && window.game) || null;
    if (g && typeof g.bossArtRect === "function") {
      const r = g.bossArtRect(this);
      if (r && r.w > 0 && r.h > 0) return r;
    }
    const a = this.artSize || { w: 2816, h: 1536 };
    const h = g ? g.h : 720, w = g ? g.w : 1280, top = ((g && g.hudSafeTop) || 112) + 8;
    const scale = Math.min(576 / a.w, (h - 24 - top) / a.h);
    const aw = a.w * scale, ah = a.h * scale;
    return { x: w - 16 - aw, y: top, w: aw, h: ah };
  }
  // Console slab (VIS-07): x 32..672, y h-120..h-24.
  get slabRect() {
    const g = (typeof window !== "undefined" && window.game) || null;
    const h = g ? g.h : 720;
    return { x: 32, y: h - 120, w: 640, h: 96 };
  }
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
  // Clocks only: position comes from the renderer's placement (float sin(.8 t) * 12 around the art slot).
  update(dt, h) {
    this.phaseT += dt;
    this.enterT += dt;
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
