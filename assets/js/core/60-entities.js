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
    this.color = color; // cyan | magenta | lime
  }
  update(dt) {
    this.t += dt;
  }
  alive() { return this.t < this.life; }
}

class ExplosionSprite {
  constructor({ x, y, type = "small", sheet }) {
    this.x = x;
    this.y = y;
    this.sheet = sheet;
    const cfg = EXPLOSION_SETS[type] || EXPLOSION_SETS.small;
    this.frames = cfg.frames;
    this.frameIndex = 0;
    this.scale = cfg.scale ?? 1;
    this.frameTime = 0;
    this.perFrame = cfg.frameTime ?? 0.06;
    this.done = false;
  }
  update(dt) {
    if (this.done) return;
    const ready = this.sheet && this.sheet.complete && this.sheet.naturalWidth > 0;
    if (!ready) return;
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
    if (this.done || !this.sheet) return;
    const ready = this.sheet.complete && this.sheet.naturalWidth > 0;
    if (!ready) return;

    const frameIdx = this.frames[Math.min(this.frameIndex, this.frames.length - 1)];
    const frame = EXPLOSION_FRAMES[frameIdx];
    if (!frame) return;
    const { x, y, w, h } = frame;
    const dw = w * this.scale;
    const dh = h * this.scale;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(this.sheet, x, y, w, h, this.x - dw / 2, this.y - dh / 2, dw, dh);
    ctx.restore();
  }
}

class Particle {
  constructor({ x, y, vx, vy, life, size, hue }) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life;
    this.t = 0;
    this.size = size;
    this.hue = hue;
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
