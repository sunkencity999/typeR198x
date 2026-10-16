// Type-R 198X — effects clock (D1), weapon / particle emitters (D2) and the ship's typing-driven state (D4).
// The trauma camera, hit-stop and slow-mo time scale, flash channels, the rings / bolts / debris lists and the
// cross-track entry points onKeyFx / onKillFx live here; 75-fx-draw.js draws them. Methods are mixed into
// Game.prototype; load order is defined in index.html (after 75-fx-draw.js, before 99-boot.js).

const FXM = (typeof FX_MOTION === "object" && FX_MOTION) || {};
const FX_LIMITS = (typeof FX_CAPS === "object" && FX_CAPS) || { explosionsLarge: 4, explosionsTotal: 10, particles: 600, bullets: 24 };
const FX_TAU = Math.PI * 2;
const FX_MOTION_FULL = Object.freeze({ shake: 1, flash: 1, anim: 1 });
const FX_MOTION_REDUCED = Object.freeze({ shake: 0, flash: 0.3, anim: 0 });
const FX_NO_SHAKE = Object.freeze({ x: 0, y: 0, rot: 0 });
const FX_MEDIA = { q: null };
const FX_LIST_CAPS = Object.freeze({ rings: 40, bolts: 32, debris: 48, muzzles: 6, dyingPlates: 12, flashDiscs: 16, typoGlyphs: 4, glyphParticles: 24 });
const fxNum = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
// Push with an oldest-out cap (keeps the lists bounded under finale load).
function fxPush(list, item, cap) {
  if (list.length >= cap) list.splice(0, list.length - cap + 1);
  list.push(item);
  return item;
}

Object.assign(Game.prototype, {
  // ------------------------- Motion contract -------------------------
  // motion() and game.reduceMotion belong to the shell (C6, resolveMotion). Until they land, fall back to the
  // explicit setting and then to the OS query, so prefers-reduced-motion is honoured from day one.
  fxMotion() {
    if (typeof this.motion === "function") {
      const m = this.motion();
      if (m && typeof m.shake === "number") return m;
    }
    return this.fxReduced() ? FX_MOTION_REDUCED : FX_MOTION_FULL;
  },
  fxReduced() {
    if (typeof this.reduceMotion === "boolean") return this.reduceMotion;
    const s = this.save && this.save.settings;
    if (s && typeof s.reduceMotion === "boolean") return s.reduceMotion;
    if (!FX_MEDIA.q && typeof matchMedia === "function") {
      try { FX_MEDIA.q = matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) { FX_MEDIA.q = null; }
    }
    return !!(FX_MEDIA.q && FX_MEDIA.q.matches);
  },

  // Lists and fields the constructor does not know about (created lazily so the shell's game.js stays untouched).
  ensureFx() {
    if (this._fxReady) return;
    this._fxReady = true;
    for (const name of ["rings", "bolts", "debris", "muzzles", "dyingPlates", "flashDiscs", "typoGlyphs", "glyphParticles"]) {
      if (!Array.isArray(this[name])) this[name] = [];
    }
    this.fxClock = this.fxClock || 0;
    this.slowMo = this.slowMo || null;
    this.exhaustAcc = this.exhaustAcc || 0;
    for (const name of ["typoFlash", "damageFlash", "whiteFlash", "introPulse", "typoEdge"]) this[name] = this[name] || 0;
    this._typoSeen = this._typoSeen || 0;
    this._shieldFlashSeen = this._shieldFlashSeen || 0;
    this._shieldSeen = this._shieldSeen || 0;
    this._introSeen = this._introSeen || null;
    this._segBoss = this._segBoss || null;
    this._segSeen = this._segSeen || 0;
    this._clearSeen = this._clearSeen || null;
    const p = this.player;
    if (p) for (const name of ["recoil", "heat", "kick", "hitT", "shieldFlash", "shieldCap"]) p[name] = p[name] || 0;
  },

  // ------------------------- Trauma camera -------------------------
  // px maps onto trauma (14 px = 1.0); every hit re-rolls the noise phases so no two shakes read the same.
  screenShake(px) {
    const m = this.fxMotion();
    if (m.shake <= 0) return;
    this.trauma = clamp((this.trauma || 0) + (px || 0) / fxNum(FXM.traumaPx, 14), 0, 1);
    this.shake = fxNum(FXM.shakeMaxPx, 18) * this.trauma * this.trauma;
    this.rollShakePhases();
  },

  // Fresh noise phases per hit. 23 + 37 = 60 Hz, so on an exact 60 fps clock the two sines mirror each other;
  // pairing the second phase against the first keeps the two components reinforcing instead of cancelling.
  rollShakePhases() {
    const ph = this._shakePhase || (this._shakePhase = new Float64Array(5));
    const ax = Math.random() * FX_TAU;
    const ay = Math.random() * FX_TAU;
    ph[0] = ax;
    ph[1] = Math.PI - ax + rand(-0.5, 0.5);
    ph[2] = ay;
    ph[3] = Math.PI - ay + rand(-0.5, 0.5);
    ph[4] = Math.random() * FX_TAU;
  },

  // Smooth two-sine noise (23 / 37 Hz) scaled by trauma^2: integer offsets <= 18 px, rotation <= .02 rad.
  shakeOffset() {
    const tr = this.trauma || 0;
    const m = this.fxMotion();
    if (tr <= 0 || m.shake <= 0) return FX_NO_SHAKE;
    const maxPx = fxNum(FXM.shakeMaxPx, 18);
    const amp = maxPx * tr * tr * m.shake;
    const hz = FXM.shakeHz || [23, 37];
    const t = this.fxClock || 0;
    if (!this._shakePhase) this.rollShakePhases();
    const ph = this._shakePhase;
    const w1 = FX_TAU * hz[0] * t;
    const w2 = FX_TAU * hz[1] * t;
    const nx = 0.6 * Math.sin(w1 + ph[0]) + 0.4 * Math.sin(w2 + ph[1]);
    const ny = 0.6 * Math.sin(w1 + ph[2]) + 0.4 * Math.sin(w2 + ph[3]);
    const nr = Math.sin(w1 * 0.5 + ph[4]);
    return {
      x: clamp(Math.round(amp * nx), -maxPx, maxPx),
      y: clamp(Math.round(amp * ny), -maxPx, maxPx),
      rot: fxNum(FXM.shakeRotRad, 0.02) * tr * tr * nr * m.shake
    };
  },

  // ------------------------- Time: hit-stop and slow-mo -------------------------
  addHitStop(s) {
    const m = this.fxMotion();
    const cap = m.anim > 0 ? fxNum(FXM.hitStopCap, 0.18) : fxNum(FXM.hitStopCapReduced, 0.06);
    this.hitStop = Math.min(cap, Math.max(this.hitStop || 0, s || 0));
    return this.hitStop;
  },

  // Boss outro: hold `scale` for holdS, then ease back to 1 over easeS (timeScale scales world dt only).
  setSlowMo(scale, holdS, easeS) {
    this.slowMo = { scale: clamp(fxNum(scale, 0.35), 0.05, 1), hold: Math.max(0, fxNum(holdS, 0.6)), ease: Math.max(0, fxNum(easeS, 0.4)), t: 0 };
    return this.slowMo;
  },

  // ------------------------- Effects clock -------------------------
  // Runs in EVERY mode (the loop calls it before update), so hits settle behind pause / game-over panels.
  tickEffects(dt) {
    this.ensureFx();
    const m = this.fxMotion();
    const p = this.player;
    this.fxClock += dt;

    // camera: linear decay; reduced motion keeps trauma at zero
    this.trauma = m.shake > 0 ? Math.max(0, (this.trauma || 0) - dt * fxNum(FXM.traumaDecay, 1.4)) : 0;
    this.shake = fxNum(FXM.shakeMaxPx, 18) * this.trauma * this.trauma * m.shake;   // legacy mirror (px)

    // time: hit-stop freezes the world at hitStopScale; slow-mo (boss outro) eases back to 1
    const cap = m.anim > 0 ? fxNum(FXM.hitStopCap, 0.18) : fxNum(FXM.hitStopCapReduced, 0.06);
    this.hitStop = clamp(this.hitStop || 0, 0, cap);
    let scale = 1;
    const sm = this.slowMo;
    if (sm) {
      sm.t += dt;
      if (sm.t >= sm.hold + sm.ease) this.slowMo = null;
      else scale = sm.t < sm.hold ? sm.scale : lerp(sm.scale, 1, sm.ease > 0 ? (sm.t - sm.hold) / sm.ease : 1);
    }
    if (this.hitStop > 0) {
      scale = Math.min(scale, fxNum(FXM.hitStopScale, 0.15));
      this.hitStop = Math.max(0, this.hitStop - dt);
    }
    this.timeScale = scale;

    // flash channels and ship timers: while 40-combat.js still decays these inside update() (see HANDOFF) this
    // clock takes over only outside play so nothing decays twice; once those lines are gone it owns every mode
    const own = this.mode !== "playing" || !CAMERA_HOOKS.legacyDecay;
    if (own) {
      this.typoFlash = Math.max(0, this.typoFlash - dt * fxNum(FXM.typoFlashDecay, 3));
      this.damageFlash = Math.max(0, this.damageFlash - dt * fxNum(FXM.damageFlashDecay, 1.8));
      this.whiteFlash = Math.max(0, this.whiteFlash - dt * fxNum(FXM.whiteFlashDecay, 2));
      p.hitT = Math.max(0, p.hitT - dt);
      p.shieldFlash = Math.max(0, p.shieldFlash - dt * 3);
    }
    this.introPulse = Math.max(0, this.introPulse - dt * fxNum(FXM.introPulseDecay, 1.2));
    this.typoEdge = Math.max(0, this.typoEdge - dt);
    p.recoil = Math.max(0, p.recoil - dt * fxNum(FXM.recoilDecay, 6));
    p.heat = Math.max(0, p.heat - dt * fxNum(FXM.heatDecay, 1.2));
    p.kick = p.kick * Math.max(0, 1 - dt * fxNum(FXM.kickEase, 8));
    if (p.kick < 0.05) p.kick = 0;

    this.detectFxEdges(m);
    if (this.mode !== "paused") this.tickFxLists(dt);
    if (this.mode === "playing" && typeof this.emitExhaust === "function") this.emitExhaust(dt);

    // legacy channels still written by 30-input.js / 40-combat.js; nothing draws them any more
    this.flash = Math.max(0, (this.flash || 0) - dt * 3);
    this.damagePulse = Math.max(0, (this.damagePulse || 0) - dt * 1.8);
  },

  // Rising edges of fields other files write (typoFlash, shieldFlash, bossIntro, boss.segmentIndex, bossClear)
  // drive the presentation beats that have no dedicated hook call yet.
  detectFxEdges(m) {
    const p = this.player;
    const tf = this.typoFlash || 0;
    if (tf > this._typoSeen + 1e-6) this.onTypoFx();
    this._typoSeen = tf;

    const sf = p.shieldFlash || 0;
    if (sf > this._shieldFlashSeen + 1e-6) this.onShieldAbsorbFx();
    this._shieldFlashSeen = sf;

    // timer-arc cap: 9 s, 15 s once stacked above 9, cleared when the shield drops
    const sh = p.shield || 0;
    const shield = FXM.shield || {};
    if (sh > this._shieldSeen + 1e-6 || (sh > 0 && !p.shieldCap)) {
      p.shieldCap = Math.max(p.shieldCap || 0, sh > fxNum(shield.cap, 9) ? fxNum(shield.capStacked, 15) : fxNum(shield.cap, 9));
    }
    if (sh <= 0) p.shieldCap = 0;
    this._shieldSeen = sh;

    if (this.bossIntro && this.bossIntro !== this._introSeen) {
      this._introSeen = this.bossIntro;
      this.introPulse = 1;
    }
    const boss = this.inBoss && this.boss ? this.boss : null;
    if (boss) {
      if (this._segBoss !== boss) { this._segBoss = boss; this._segSeen = boss.segmentIndex; }
      else if (boss.segmentIndex > this._segSeen) {
        this._segSeen = boss.segmentIndex;
        if (!boss.done) this.onSegmentFx(boss);
      }
    } else {
      this._segBoss = null;
    }
    if (this.bossClear && this.bossClear !== this._clearSeen) {
      this._clearSeen = this.bossClear;
      this.onBossDeathFx();
    } else if (!this.bossClear) {
      this._clearSeen = null;
    }
  },

  // Advance the presentation lists. World-time items follow timeScale (hit-stop freezes them with the world);
  // muzzle flashes and typo glyphs run on wall time.
  tickFxLists(dt) {
    const wdt = dt * this.timeScale;
    compactInPlace(this.rings, (r) => (r.update(wdt), r.alive()));
    compactInPlace(this.bolts, (b) => (b.update(wdt), b.alive()));
    compactInPlace(this.debris, (d) => (d.update(wdt), d.alive()));
    compactInPlace(this.glyphParticles, (g) => {
      g.t += wdt;
      g.x += g.vx * wdt;
      g.y += g.vy * wdt;
      g.vy += 420 * wdt;
      return g.t < g.life;
    });
    compactInPlace(this.dyingPlates, (d) => (d.t += wdt, d.t < d.life));
    compactInPlace(this.muzzles, (mz) => (mz.t += dt, mz.t < mz.life));
    compactInPlace(this.typoGlyphs, (g) => (g.t += dt, g.t < g.life && g.ref && g.ref.alive !== false));
    // beam heads arriving at the target spawn the impact ring (D2 bullets carry headT / impact)
    const head = fxNum(FXM.bulletHeadS, 0.035);
    for (const b of this.bullets) {
      if (b.arrived || b.impact === false || typeof b.headT !== "function") continue;
      if (b.t >= head) {
        b.arrived = true;
        this.addShockwave(b.tx, b.ty, fxNum((FXM.ring || {}).impact, 12), b.color);
      }
    }
  },

  // ------------------------- Presentation beats -------------------------
  // Wrong key: the expected char rises above the plate (or the boss slab) in danger red; with nothing locked a
  // 2 px danger line flickers along the top edge of the playfield. Never a wash.
  onTypoFx() {
    this.ensureFx();
    const m = this.fxMotion();
    let ref = this.lock && this.lock.ref && this.lock.ref.alive ? this.lock.ref : null;
    if (!ref) {
      // the plate that just took the typo (typoT was set at the same moment) even if the lock was released
      let best = null;
      for (const e of this.enemies) if (e.alive && (e.typoT || 0) >= 0.11 && (!best || e.typoT > best.typoT)) best = e;
      if (!best) for (const e of this.powerups) if (e.alive && (e.typoT || 0) >= 0.11 && (!best || e.typoT > best.typoT)) best = e;
      ref = best;
    }
    let ch = null;
    if (ref) ch = typeof ref.nextChar === "function" ? ref.nextChar() : null;
    else if (this.inBoss && this.boss && !this.boss.done) { ref = this.boss; ch = this.boss.nextChar; }
    if (!ref || !ch) {
      this.typoEdge = fxNum(FXM.typoEdgeS, 0.1);
      return;
    }
    if (ref.kind !== "boss") ref.typoT = Math.max(ref.typoT || 0, 0.12);
    fxPush(this.typoGlyphs, { ch, ref, t: 0, life: fxNum(FXM.typoGlyphS, 0.4), rise: m.anim > 0 ? 10 : 0 }, FX_LIST_CAPS.typoGlyphs);
  },

  // Shield absorb: 10 violet sparks off the hexagon (halved under reduced motion).
  onShieldAbsorbFx() {
    this.ensureFx();
    const m = this.fxMotion();
    const p = this.player;
    const n = m.anim > 0 ? 10 : 5;
    const r = fxNum((FXM.shield || {}).r, 66);
    for (let i = 0; i < n; i++) {
      const a = rand(0, FX_TAU);
      this.pushParticle(new Particle({
        x: p.x + 10 + Math.cos(a) * r * 0.9,
        y: p.y + Math.sin(a) * r * 0.9,
        vx: Math.cos(a) * rand(90, 190),
        vy: Math.sin(a) * rand(90, 190),
        life: rand(0.25, 0.45),
        size: rand(1.5, 3),
        color: "violet"
      }));
    }
  },

  // Boss segment cleared: 60 px ring at the aim point; the slab pop itself is the plates track's.
  onSegmentFx(boss) {
    const aim = typeof this.bossAimPoint === "function" ? this.bossAimPoint() : { x: boss.x, y: boss.y };
    this.addShockwave(aim.x, aim.y, fxNum((FXM.ring || {}).segment, 60), "cyan");
    this.addHitStop(fxNum((FXM.hitStop || {}).segment, 0.09));
  },

  // Boss death: 180 px ring over .6 s and the outro slow-mo (unless the boss track already set one).
  onBossDeathFx() {
    const info = this.bossClear;
    let o = this.bossFinaleOrigin;
    if (!o && info && info.artRect) o = { x: info.artRect.x + info.artRect.w / 2, y: info.artRect.y + info.artRect.h / 2 };
    if (!o) o = { x: this.w * 0.7, y: this.h * 0.4 };
    const ring = FXM.ring || {};
    this.addShockwave(o.x, o.y, fxNum(ring.bossDeath, 180), "amber", fxNum(ring.bossDeathLife, 0.6));
    this.addHitStop(fxNum((FXM.hitStop || {}).bossDeath, 0.16));
    if (!this.slowMo) {
      const s = FXM.finaleSlowMo || {};
      this.setSlowMo(fxNum(s.scale, 0.35), fxNum(s.hold, 0.6), fxNum(s.ease, 0.4));
    }
  },

  // ------------------------- Cross-track entry points -------------------------
  // Every correct key (enemy, powerup, boss char): ship recoil + heat, plate flinch, the spent glyph pops off.
  onKeyFx(ref, ch) {
    this.ensureFx();
    const p = this.player;
    const m = this.fxMotion();
    p.recoil = Math.min(1, p.recoil + fxNum(FXM.recoilPerKey, 0.35));
    p.heat = Math.min(1, p.heat + fxNum(FXM.heatPerKey, 0.25));
    if (!ref || ref.kind === "boss") return;
    ref.flinch = 1;
    if (!ch || m.anim <= 0) return;
    const text = ref.kind === "powerup" ? ref.label : ref.text;
    const len = text ? text.length : 1;
    const i = clamp((ref.progress | 0) - 1, 0, len - 1);
    const tw = ref.textW || len * 12;
    const gx = ref.x - tw / 2 + (i + 0.5) * (tw / len);
    fxPush(this.glyphParticles, { ch, x: gx, y: ref.y - 2, vx: rand(40, 120), vy: rand(-260, -160), t: 0, life: 0.45, color: "text" }, FX_LIST_CAPS.glyphParticles);
  },

  // Every destroyed enemy / minion: impact ring, white impact plate, recoil, hit-stop (the combat code adds the
  // explosion sprite, particles, shake and sound).
  onKillFx(en, x, y) {
    this.ensureFx();
    const p = this.player;
    const len = en && en.text ? en.text.length : 1;
    const small = len <= 1 || (en && en.kind === "bossMinion");
    const ring = FXM.ring || {};
    const hs = FXM.hitStop || {};
    this.addShockwave(x, y, small ? fxNum(ring.letter, 12) : fxNum(ring.kill, 20), "cyan");
    fxPush(this.dyingPlates, { x, y, w: (en && en.plateW) || 64, h: (en && en.plateH) || 40, t: 0, life: 0.09, chip: len <= 1 }, FX_LIST_CAPS.dyingPlates);
    p.recoil = Math.min(1, p.recoil + fxNum(FXM.recoilPerKill, 0.8));
    this.addHitStop(len > 1 ? fxNum(hs.word, 0.045) : fxNum(hs.letter, 0.03));
  },

  // ------------------------- Rings -------------------------
  // r0 = size*.3 -> r1 = size*2.2 over life (default .28 s) plus a one-frame white disc r = size*.5.
  addShockwave(x, y, size, colorName = "cyan", life) {
    this.ensureFx();
    const m = this.fxMotion();
    const color = PALETTE.has(colorName) ? colorName : "cyan";
    const ring = fxPush(this.rings, new Ring({ x, y, size: fxNum(size, 20), color, life: fxNum(life, fxNum(FXM.ringLife, 0.28)), expand: m.anim > 0 }), FX_LIST_CAPS.rings);
    fxPush(this.flashDiscs, { x, y, r: fxNum(size, 20) * 0.5, alpha: 0.8 }, FX_LIST_CAPS.flashDiscs);
    return ring;
  },

  // ------------------------- Ambient -------------------------
  // Stars, parallax and the starT phase clock. The plates track drives currentTheme.speedMul (storm sectors) and
  // parallaxWarp (sector warp-in, x4 -> x1); both multiply the drift here. Called from update() while playing and
  // from the loop's ambient tick on the other screens.
  stepAmbient(dt) {
    this.starT += dt;
    const warp = typeof this.parallaxWarp === "number" && Number.isFinite(this.parallaxWarp) ? this.parallaxWarp : 1;
    const theme = this.currentTheme;
    if (theme) {
      const mul = (typeof theme.speedMul === "number" ? theme.speedMul : 1) * warp;
      this.parallax.bgOffset += (theme.bgSpeed || 0) * mul * dt;
      this.parallax.fgOffset += (theme.fgSpeed || 0) * mul * dt;
    }
    this.updateStars(dt * warp);
  },

  // Zero every transient presentation effect. Called at the top of startLevel(), stopToMenu(), onGameOver().
  resetTransientFx() {
    this.ensureFx();
    this.trauma = 0;
    this.shake = 0;
    this.flash = 0;
    this.damagePulse = 0;
    this.hitStop = 0;
    this.timeScale = 1;
    this.slowMo = null;
    this.typoFlash = 0;
    this.damageFlash = 0;
    this.whiteFlash = 0;
    this.introPulse = 0;
    this.typoEdge = 0;
    this._typoSeen = 0;
    this._shieldFlashSeen = 0;
    this._introSeen = null;
    this._segBoss = null;
    this._segSeen = 0;
    this._clearSeen = null;
    this.bossIntro = null;
    this.exhaustAcc = 0;
    const p = this.player;
    p.recoil = 0;
    p.heat = 0;
    p.kick = 0;
    p.hitT = 0;
    p.shieldFlash = 0;
    const shield = FXM.shield || {};
    this._shieldSeen = p.shield || 0;
    p.shieldCap = p.shield > fxNum(shield.cap, 9) ? fxNum(shield.capStacked, 15) : (p.shield > 0 ? fxNum(shield.cap, 9) : 0);
    for (const name of ["explosions", "particles", "bullets", "rings", "bolts", "debris", "muzzles", "dyingPlates", "flashDiscs", "typoGlyphs", "glyphParticles"]) {
      if (Array.isArray(this[name])) this[name].length = 0;
    }
  },

  // ------------------------- Weapons -------------------------
  // Staged laser (JUICE-03): a beam from the muzzle (player.x + 22) whose head reaches the target in 35 ms and
  // whose tail detaches after 70 ms; a muzzle flash at the gun; the impact ring spawns when the head arrives
  // (tickFxLists). Colour follows the active weapon (POWER_ACCENT): SPREAD magenta, PIERCE violet, RAPID cyan;
  // MULTI never recolours and lime stays reserved for "type this". SPREAD adds two decorative side beams.
  fireLaserTo(tx, ty, color) {
    this.ensureFx();
    const tint = this.beamColor(color);
    const baseWidth = 3 + this.levelIndex * 0.7;
    const ox = this.player.x + 22;
    const oy = this.player.y;
    this.pushBullet(new Bullet({ x: ox, y: oy, tx, ty, width: baseWidth, color: tint }));
    if (this.power.spread > 0) {
      const w = Math.max(2, baseWidth * 0.65);
      this.pushBullet(new Bullet({ x: ox, y: oy, tx: tx + rand(-20, 20), ty: ty + rand(-80, -20), width: w, color: "magenta", impact: false }));
      this.pushBullet(new Bullet({ x: ox, y: oy, tx: tx + rand(-20, 20), ty: ty + rand(20, 80), width: w, color: "magenta", impact: false }));
    }
    this.addMuzzleFlash(ox, oy, tint);
  },

  // Beam tint: explicit hostile / bonus colours pass through; otherwise the active weapon decides.
  beamColor(requested) {
    if (requested === "danger" || requested === "amber" || requested === "violet") return requested;
    const acc = (typeof POWER_ACCENT === "object" && POWER_ACCENT) || {};
    if (this.power.spread > 0) return acc.SPREAD || "magenta";
    if (this.power.pierce > 0) return acc.PIERCE || "violet";
    if (this.power.rapid > 0) return acc.RAPID || "cyan";
    return "cyan";
  },

  // Radial disc r 22 + three spikes for .06 s, drawn at the ship's gun (75-fx-draw.js).
  addMuzzleFlash(x, y, color = "cyan") {
    this.ensureFx();
    return fxPush(this.muzzles, { x, y, t: 0, life: fxNum(FXM.muzzleLife, 0.06), color: PALETTE.has(color) ? color : "cyan", rot: rand(0, Math.PI) }, FX_LIST_CAPS.muzzles);
  },

  // Jagged 3-segment additive bolt: RAPID chain hits (cyan, .12 s) and the boss surge arc (danger, 2 -> 4 px,
  // 20 Hz flicker, static under reduced motion).
  addBolt(x1, y1, x2, y2, colorName = "cyan", life) {
    this.ensureFx();
    const m = this.fxMotion();
    const color = PALETTE.has(colorName) ? colorName : "cyan";
    const surge = color === "danger";
    return fxPush(this.bolts, new Bolt({ x1, y1, x2, y2, color, life: fxNum(life, fxNum(FXM.boltLife, 0.12)), width: 2, widthEnd: surge ? 4 : 2, flickerHz: 20, jitter: m.anim > 0 }), FX_LIST_CAPS.bolts);
  },

  // 2-4 sheet-frame-16 shards with gravity 520 for .7 s (halved under reduced motion).
  addDebris(x, y, n) {
    this.ensureFx();
    const m = this.fxMotion();
    const d = FXM.debris || {};
    let count = Math.max(0, n | 0);
    if (m.anim <= 0) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      fxPush(this.debris, new Debris({
        x: x + rand(-6, 6), y: y + rand(-6, 6),
        vx: rand(-220, 220), vy: rand(-260, -80),
        life: fxNum(d.life, 0.7), gravity: fxNum(d.gravity, 520),
        size: rand(0.16, 0.28)
      }), FX_LIST_CAPS.debris);
    }
    return count;
  },

  pushBullet(b) {
    const cap = fxNum(FX_LIMITS.bullets, 24);
    if (this.bullets.length >= cap) this.bullets.splice(0, this.bullets.length - cap + 1);
    this.bullets.push(b);
    return b;
  },

  // Particle cap (600, halved under reduced motion): oldest out.
  pushParticle(p) {
    const m = this.fxMotion();
    const cap = Math.max(1, Math.round(fxNum(FX_LIMITS.particles, 600) * (m.anim > 0 ? 1 : 0.5)));
    if (this.particles.length >= cap) this.particles.splice(0, this.particles.length - cap + 1);
    this.particles.push(p);
    return p;
  },

  addSparks(x, y, n) {
    this.ensureFx();
    const m = this.fxMotion();
    const count = m.anim > 0 ? n : Math.ceil(n / 2);
    for (let i = 0; i < count; i++) {
      this.pushParticle(new Particle({
        x, y,
        vx: rand(-120, 120),
        vy: rand(-120, 120),
        life: rand(0.12, 0.26),
        size: rand(1, 2.8),
        color: choice(["cyan", "magenta", "text"])
      }));
    }
  },

  addExplosion(x, y, size) {
    this.ensureFx();
    const m = this.fxMotion();
    let n = Math.min(120, Math.floor(size * 1.2));
    if (m.anim <= 0) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0, size);
      this.pushParticle(new Particle({
        x: x + Math.cos(a) * r * 0.2,
        y: y + Math.sin(a) * r * 0.2,
        vx: Math.cos(a) * rand(80, 320),
        vy: Math.sin(a) * rand(80, 320),
        life: rand(0.18, 0.5),
        size: rand(1.2, 4.5),
        color: choice(["cyan", "magenta", "amber"])
      }));
    }
  },

  // Sheet explosions read the loader's sheet each frame (ExplosionSprite.getSheet). Caps (CONTRACT section 7):
  // 4 concurrent large, 10 total; a new one replaces the oldest of its class.
  addExplosionSprite(x, y, type = "small") {
    const caps = FX_LIMITS;
    const list = this.explosions;
    if (type === "large") {
      let larges = 0;
      for (const e of list) if (e.type === "large") larges++;
      if (larges >= caps.explosionsLarge) {
        const i = list.findIndex((e) => e.type === "large");
        if (i >= 0) list.splice(i, 1);
      }
    }
    if (list.length >= caps.explosionsTotal) list.shift();
    const ex = new ExplosionSprite({ x, y, type });
    list.push(ex);
    if (ex.type !== "small") this.addDebris(x, y, randi(2, 4));   // frame-16 shards on medium / large blasts
    return ex;
  },

  getExplosionTypeForEnemy(en) {
    if (!en) return "small";
    if (en.text.length <= 3 || en.kind === "bossMinion") return "small";
    return "medium";
  },
});

// ----------------------------- Cross-track hooks (fallbacks) -----------------------------
// The input / combat / boss files call onKeyFx and onKillFx and write kick 14 / hitT .12 once their owners apply
// the HANDOFF lines. Until then these wraps supply the same calls; each steps aside as soon as the owner's source
// contains the hook, so nothing fires twice after the merge. CAMERA_HOOKS records what is active (probes, report).
const CAMERA_HOOKS = { keyFx: false, bossKeyFx: false, killFx: false, damageFx: false, legacyDecay: false };
(function installCameraHooks(proto) {
  const src = (fn) => (typeof fn === "function" ? Function.prototype.toString.call(fn) : "");
  if (typeof proto.onCorrectKey === "function" && !/onKeyFx/.test(src(proto.onCorrectKey))) {
    const orig = proto.onCorrectKey;
    proto.onCorrectKey = function (ref) {
      const ch = ref ? (typeof ref.nextChar === "function" ? ref.nextChar() : ref.nextChar) : null;
      const out = orig.call(this, ref);
      if (typeof this.onKeyFx === "function") this.onKeyFx(ref, ch);
      return out;
    };
    CAMERA_HOOKS.keyFx = true;
  }
  if (typeof proto.onBossChar === "function" && !/onKeyFx/.test(src(proto.onBossChar))) {
    const orig = proto.onBossChar;
    proto.onBossChar = function () {
      const boss = this.boss;
      const ch = boss ? boss.nextChar : null;
      const out = orig.apply(this, arguments);
      if (boss && typeof this.onKeyFx === "function") this.onKeyFx(boss, ch);
      return out;
    };
    CAMERA_HOOKS.bossKeyFx = true;
  }
  if (typeof proto.killEnemy === "function" && !/onKillFx/.test(src(proto.killEnemy))) {
    const orig = proto.killEnemy;
    proto.killEnemy = function (en, opts) {
      const was = !!(en && en.alive);
      const x = en ? en.x : 0;
      const y = en ? en.y : 0;
      const out = orig.call(this, en, opts);
      if (was && en && !en.alive && typeof this.onKillFx === "function") this.onKillFx(en, x, y);
      return out;
    };
    CAMERA_HOOKS.killFx = true;
  }
  if (typeof proto.takeDamage === "function" && !/kick = 14|kickPx/.test(src(proto.takeDamage))) {
    const orig = proto.takeDamage;
    proto.takeDamage = function () {
      const out = orig.apply(this, arguments);
      if (out > 0 && this.player) {
        this.player.kick = fxNum(FXM.kickPx, 14);
        this.player.hitT = fxNum(FXM.hitT, 0.12);
      }
      return out;
    };
    CAMERA_HOOKS.damageFx = true;
  }
  CAMERA_HOOKS.legacyDecay = /damageFlash/.test(src(proto.tickPowerTimers) + src(proto.update));
})(Game.prototype);
Game.CAMERA_HOOKS = CAMERA_HOOKS;
