// Type-R 198X — BOSSFX (presentation): a boss that is alive and wears its damage. Methods are mixed into
// Game.prototype; load order is defined in index.html (after 75-fx-draw.js; this file overrides drawBossArt and
// drawBossDissolve from 70-render.js, whose bossPlacement / bossArtBox it keeps using).
//
// 1. Motion. On top of the placement's hover and intro slide: a slow roll (BOSSFX.rollRad) and a breathing scale,
//    a scale punch when a phase clears or the damage state steps, and two motion ghosts behind the art during the
//    intro slide. All of it is skipped under reduced motion (motionProfile().anim === 0).
// 2. Emissive. The art's neon (bright, saturated pixels) is extracted without pixel reads by multiplying the sprite
//    by itself (luminance^3 keeps the lamps and strips, kills the hull), clipped to the sprite's alpha, then blurred
//    by a downscale / upscale pass. It is drawn additively with a pulse that quickens as the hull fails; the
//    Counter-Signal's red glow (50-boss.js) and the hit flash share the same additive set, so the per-frame composite
//    budget grows by at most one set.
// 3. Damage. Three states by hpFrac (BOSSFX.states): pristine, scorched, critical. The scorched and critical sprites
//    are baked once per fight from the loaded sprite: seeded (per level) multiply blotches, jagged cracks with a hot
//    core on the critical state, a global char, all clipped to the silhouette. A state step crossfades the sprites
//    over BOSSFX.crossfadeS and bursts sparks + a small blast + a shockwave; while damaged the boss sheds sparks and
//    smoke from the tick hook. The dissolve draws the state the boss died in.
// 4. Cost. The bake (sprite-sized canvases: two damage states, two glow layers) runs from an idle callback the first
//    frame the boss draws, so the intro's first frame pays nothing; until it lands the plain sprite draws as before.
//    Per frame: the state sprite (two draws during a crossfade), the glow pair inside one additive set, ghosts only
//    during the intro. Everything is cached per (level, sprite drawable, size) and dropped when the fight ends.

const BOSSFX = {
  rollRad: 0.02, rollHz: 0.33,
  breathe: 0.012, breatheHz: 0.5,
  punch: 0.07, punchS: 0.32,
  glowA: 0.30, glowPulse: 0.22, glowHz: 0.9, glowHzCritical: 2.0, sharpA: 0.16,
  states: [0.66, 0.33],              // hpFrac at or below which state 1 / state 2 begins
  crossfadeS: 0.35,
  sparkRate: [0, 5, 13],             // sparks / s by state
  smokeRate: [0, 1.5, 5],            // smoke puffs / s by state
  ghostAlpha: [0.16, 0.08], ghostDx: [26, 52],
  blotches: [0, 5, 9], cracks: [0, 0, 6]
};

function bossfxRng(seed) {           // mulberry32: the same scorch on every retry of a sector
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

Object.assign(Game.prototype, {
  bossfxState() {
    return this._bossfx || (this._bossfx = { sheet: null, pending: false, state: 0, prevState: 0, fadeT: 0, punchT: 0, lastPhase: -1, sparkAcc: 0, smokeAcc: 0, level: 0 });
  },

  bossfxReset() {
    const s = this._bossfx;
    if (s && s.sheet) for (const c of Object.values(s.sheet.canvases || {})) if (c) c.width = 0;
    this._bossfx = null;
  },

  // The per-fight sheet for the current sprite drawable: { canvases: {d1, d2, glow, sharp}, img, w, h, level }.
  bossfxSheet(boss, sp) {
    const S = this.bossfxState();
    const rs = this.renderScale || 1;
    const sh = S.sheet;
    if (sh && sh.img === sp.img && sh.level === boss.artLevel && sh.rs === rs && Math.abs(sh.w - sp.w) < 1) return sh;
    if (!sp.img || !(sp.w > 0) || !(sp.h > 0) || S.pending) return null;
    S.pending = true;
    const run = () => { S.pending = false; try { S.sheet = this.bossfxBake(boss.artLevel, sp, rs); } catch (_) { S.sheet = null; } };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 200 }); else setTimeout(run, 0);
    return null;
  },

  bossfxBake(level, sp, rs) {
    const W = Math.max(1, Math.round(sp.w * rs)), H = Math.max(1, Math.round(sp.h * rs));
    const rng = bossfxRng(level * 7919 + 17);
    const make = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const base = make(W, H);
    base.getContext("2d").drawImage(sp.img, 0, 0, W, H);

    // Damage states
    const damage = (state) => {
      const c = make(W, H), g = c.getContext("2d");
      g.drawImage(base, 0, 0);
      const inset = 0.1;
      const blot = BOSSFX.blotches[state], cracks = BOSSFX.cracks[state];
      const pts = [];
      g.globalCompositeOperation = "multiply";
      for (let i = 0; i < blot; i++) {
        const cx = W * (inset + rng() * (1 - 2 * inset)), cy = H * (inset + rng() * (1 - 2 * inset));
        const r = W * (0.07 + rng() * 0.11);
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        const a = 0.78 + rng() * 0.2;
        grad.addColorStop(0, `rgba(8,4,10,${a})`);
        grad.addColorStop(0.5, `rgba(26,14,26,${a * 0.7})`);
        grad.addColorStop(1, "rgba(40,30,40,0)");
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        pts.push([cx, cy]);
      }
      if (state === 2) {
        g.fillStyle = "rgba(70,52,78,0.5)";           // global char
        g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < cracks; i++) {
        const [sx, sy] = pts[i % Math.max(1, pts.length)] || [W / 2, H / 2];
        const segs = 5 + Math.floor(rng() * 4);
        let x = sx, y = sy, ang = rng() * Math.PI * 2;
        const path = [[x, y]];
        for (let k = 0; k < segs; k++) {
          ang += (rng() - 0.5) * 1.6;
          const len = W * (0.025 + rng() * 0.05);
          x += Math.cos(ang) * len; y += Math.sin(ang) * len;
          path.push([x, y]);
        }
        const stroke = (width, style, op) => {
          g.globalCompositeOperation = op;
          g.strokeStyle = style; g.lineWidth = width; g.lineCap = "round"; g.lineJoin = "round";
          g.beginPath(); g.moveTo(path[0][0], path[0][1]);
          for (let k = 1; k < path.length; k++) g.lineTo(path[k][0], path[k][1]);
          g.stroke();
        };
        stroke(7 * rs, PALETTE.rgba("amber", 0.22), "lighter");       // halo first, so the hot core sits on it
        stroke(4.2 * rs, "rgba(10,5,12,0.95)", "source-over");
        stroke(1.6 * rs, PALETTE.rgba("amber", 0.95), "lighter");
      }
      g.globalCompositeOperation = "destination-in";
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = "source-over";
      return c;
    };

    // Emissive: luminance^3 keeps the neon, clipped to the silhouette; a blurred copy for the halo.
    const hw = Math.max(1, Math.round(W / 2)), hh = Math.max(1, Math.round(H / 2));
    const sharp = make(hw, hh), sg = sharp.getContext("2d");
    sg.drawImage(base, 0, 0, hw, hh);
    sg.globalCompositeOperation = "multiply";
    sg.drawImage(base, 0, 0, hw, hh);
    sg.drawImage(base, 0, 0, hw, hh);
    sg.globalCompositeOperation = "destination-in";
    sg.drawImage(base, 0, 0, hw, hh);
    sg.globalCompositeOperation = "source-over";
    const tiny = make(Math.max(1, Math.round(hw / 6)), Math.max(1, Math.round(hh / 6)));
    const tg = tiny.getContext("2d");
    tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
    tg.drawImage(sharp, 0, 0, tiny.width, tiny.height);
    const glow = make(hw, hh), gg = glow.getContext("2d");
    gg.imageSmoothingEnabled = true; gg.imageSmoothingQuality = "high";
    gg.drawImage(tiny, 0, 0, hw, hh);
    gg.drawImage(tiny, 0, 0, hw, hh);          // twice: the halo reads at about the sprite's own brightness
    tiny.width = 0;

    return { canvases: { d0: base, d1: damage(1), d2: damage(2), glow, sharp }, img: sp.img, w: sp.w, h: sp.h, level, rs };
  },

  bossfxStateFor(boss) {
    const hp = boss.hpFrac();
    if (hp <= BOSSFX.states[1]) return 2;
    if (hp <= BOSSFX.states[0]) return 1;
    return 0;
  },

  // A damage step or a phase clear: punch, burst, and (damage) the crossfade.
  bossfxPunch(boss, p, kind) {
    const S = this.bossfxState();
    S.punchT = BOSSFX.punchS;
    const c = p ? p.contentRect : null;
    if (!c) return;
    const rm = !!this.reduceMotion;
    const x = c.x + c.w * (0.25 + Math.random() * 0.5), y = c.y + c.h * (0.3 + Math.random() * 0.4);
    if (typeof this.addShockwave === "function") this.addShockwave(x, y, kind === "phase" ? 140 : 90, kind === "phase" ? "magenta" : "amber");
    if (typeof this.addSparks === "function") this.addSparks(x, y, rm ? 8 : 18);
    if (kind === "damage" && typeof this.addExplosionSprite === "function") this.addExplosionSprite(x, y, "small");
    if (kind === "damage" && typeof this.addDebris === "function") this.addDebris(x, y, 3);
    if (!rm && typeof this.screenShake === "function") this.screenShake(kind === "phase" ? 6 : 4);
    boss.flash = Math.max(boss.flash || 0, 0.6);
  },

  // Replaces 70-render.js drawBossArt.
  drawBossArt(ctx, boss) {
    const p = this.bossPlacement(boss);
    boss.contentRect = p.contentRect;
    boss.x = p.contentRect.x + p.contentRect.w / 2;
    boss.y = p.contentRect.y + p.contentRect.h / 2;
    if (!p.sp.img) return;
    const S = this.bossfxState();
    const m = this.motionProfile();
    const anim = m.anim > 0 && !this.reduceMotion;
    const sheet = this.bossfxSheet(boss, p.sp);
    if (S.level !== boss.artLevel) { S.level = boss.artLevel; S.state = S.prevState = this.bossfxStateFor(boss); S.fadeT = 0; S.lastPhase = boss.phase; }
    const t = boss.phaseT || 0;
    const r = p.artRect;
    const cx = p.contentRect.x + p.contentRect.w / 2, cy = p.contentRect.y + p.contentRect.h / 2;
    const intro = this.bossIntro;
    const sliding = !!(intro && intro.locked);

    ctx.save();
    if (p.alpha < 1) ctx.globalAlpha *= p.alpha;
    if (anim) {
      const roll = Math.sin(t * BOSSFX.rollHz * Math.PI * 2) * BOSSFX.rollRad;
      const punch = S.punchT > 0 ? BOSSFX.punch * easeOutExpo(S.punchT / BOSSFX.punchS) : 0;
      const sc = 1 + Math.sin(t * BOSSFX.breatheHz * Math.PI * 2 + 1) * BOSSFX.breathe + punch;
      ctx.translate(cx, cy); ctx.rotate(roll); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    }
    const cur = sheet ? sheet.canvases["d" + S.state] : p.sp.img;
    // Intro slide ghosts (behind, in the slide direction)
    if (sliding && anim && p.slide > 2) {
      const baseA = ctx.globalAlpha;
      for (let i = 0; i < 2; i++) {
        ctx.globalAlpha = baseA * BOSSFX.ghostAlpha[i] * clamp(p.slide / 80, 0, 1);
        ctx.drawImage(cur, r.x + BOSSFX.ghostDx[i], r.y, r.w, r.h);
      }
      ctx.globalAlpha = baseA;
    }
    if (sheet && S.fadeT > 0 && S.prevState !== S.state) {
      const k = clamp(1 - S.fadeT / BOSSFX.crossfadeS, 0, 1);
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * (1 - k);
      ctx.drawImage(sheet.canvases["d" + S.prevState], r.x, r.y, r.w, r.h);
      ctx.globalAlpha = a * k;
      ctx.drawImage(cur, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = a;
    } else {
      ctx.drawImage(cur, r.x, r.y, r.w, r.h);
    }
    // Additive pass: emissive pulse, Counter-Signal glow, hit flash. One composite set; ctx.restore() undoes it.
    const csGlow = !!boss.surge && typeof this.drawCounterSignalGlow === "function";
    const emissive = !!(sheet && !this.bossClear);
    if (emissive || csGlow || boss.flash > 0) {
      ctx.globalCompositeOperation = "lighter";
      const a0 = p.alpha;
      if (emissive) {
        const hz = S.state === 2 ? BOSSFX.glowHzCritical : (S.state === 1 ? (BOSSFX.glowHz + BOSSFX.glowHzCritical) / 2 : BOSSFX.glowHz);
        const pulse = anim ? 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2) : 0.5;
        const flicker = (S.state === 2 && anim) ? (Math.random() < 0.08 ? 0.5 : 1) : 1;
        ctx.globalAlpha = a0 * (BOSSFX.glowA + BOSSFX.glowPulse * pulse) * flicker;
        ctx.drawImage(sheet.canvases.glow, r.x - r.w * 0.03, r.y - r.h * 0.03, r.w * 1.06, r.h * 1.06);
        ctx.globalAlpha = a0 * BOSSFX.sharpA * (0.6 + 0.4 * pulse);
        ctx.drawImage(sheet.canvases.sharp, r.x, r.y, r.w, r.h);
      }
      if (csGlow) this.drawCounterSignalGlow(ctx, boss, p);
      if (boss.flash > 0) { ctx.globalAlpha = a0 * clamp(boss.flash * 0.5, 0, 0.5); ctx.drawImage(cur, r.x, r.y, r.w, r.h); }
    }
    ctx.restore();
    S.lastP = p;
  },

  // Replaces 70-render.js drawBossDissolve: the dying boss keeps the state it died in.
  drawBossDissolve(ctx) {
    const info = this.bossClear;
    const d = this.bossDissolve;
    if (!info || !d || !info.artRect || !info.artLevel) return;
    const t = info.t;
    const k = clamp((t - d.start) / d.dur, 0, 1);
    if (k >= 1) return;
    const box = this.bossArtBox(info.artLevel);
    const sp = Assets.sprite(box.key, box.artW);
    if (!sp.img) return;
    const S = this._bossfx;
    const img = (S && S.sheet && S.sheet.img === sp.img) ? (S.sheet.canvases["d" + S.state] || sp.img) : sp.img;
    const rm = !!this.reduceMotion;
    const r = info.artRect;
    const alpha = 1 - easeInOutCubic(k);
    const scale = rm ? 1 : 1 + 0.08 * k;
    const jitter = (!rm && t < 1.6) ? BOSS_JITTER_PX : 0;
    const jx = jitter ? rand(-jitter, jitter) : 0;
    const jy = jitter ? rand(-jitter, jitter) : 0;
    const cx = r.x + r.w / 2 + jx, cy = r.y + r.h / 2 + jy;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
    const flashK = (t - d.start) / d.dur;
    if (flashK >= 0 && flashK < 0.15 && !rm) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.8 * (1 - flashK / 0.15);
      ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
    }
    ctx.restore();
  },

  // Per frame (tick hook): damage-state steps, phase punches, sparks and smoke while damaged.
  bossfxTick(dt) {
    const boss = (this.inBoss && this.boss) ? this.boss : null;
    const S = this._bossfx;
    if (!boss) { if (S && !this.bossClear) this.bossfxReset(); return; }
    if (!S) return;
    if (S.punchT > 0) S.punchT = Math.max(0, S.punchT - dt);
    if (S.fadeT > 0) S.fadeT = Math.max(0, S.fadeT - dt);
    const intro = this.bossIntro;
    if ((intro && intro.locked) || this.bossClear) return;
    const st = this.bossfxStateFor(boss);
    if (st > S.state) { S.prevState = S.state; S.state = st; S.fadeT = BOSSFX.crossfadeS; this.bossfxPunch(boss, S.lastP, "damage"); }
    if (S.lastPhase >= 0 && boss.phase !== S.lastPhase) this.bossfxPunch(boss, S.lastP, "phase");
    S.lastPhase = boss.phase;
    const m = this.motionProfile();
    if (m.anim <= 0 || !S.lastP || S.state === 0) return;
    const c = S.lastP.contentRect;
    S.sparkAcc += BOSSFX.sparkRate[S.state] * dt;
    while (S.sparkAcc >= 1) {
      S.sparkAcc -= 1;
      const x = c.x + c.w * (0.1 + Math.random() * 0.6), y = c.y + c.h * (0.2 + Math.random() * 0.6);
      this.pushParticle(new Particle({ x, y, vx: rand(-160, 40), vy: rand(-90, 90), life: rand(0.18, 0.4), size: rand(1, 2.4), color: Math.random() < 0.5 ? "amber" : "text" }));
    }
    S.smokeAcc += BOSSFX.smokeRate[S.state] * dt;
    while (S.smokeAcc >= 1) {
      S.smokeAcc -= 1;
      const x = c.x + c.w * (0.15 + Math.random() * 0.5), y = c.y + c.h * (0.25 + Math.random() * 0.5);
      this.pushParticle(new Particle({ x, y, vx: rand(-70, -20), vy: rand(-60, -20), life: rand(0.6, 1.1), size: rand(3, 6), color: "violet", drag: 1.0 }));
    }
  }
});

onGameHook("tick", function (evt) {
  if (typeof this.bossfxTick === "function") this.bossfxTick(evt && typeof evt.dt === "number" ? evt.dt : (1 / 60));
});
