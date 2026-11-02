// Type-R 198X — AMBIENT (presentation pass 2026-11): the living world between the painted parallax layers.
// Methods are mixed into Game.prototype; load order is defined in index.html (after 72-atmos.js, before 74-drones.js).
// 70-render.js calls drawMidLayer after the stars (L2b) and drawAmbientFront after the near parallax (L3b).
//
// 1. Mid-depth silhouettes (L2b). A third parallax strip (tools/art/gen_midlayer.py: wreckage / gantry / asteroids,
//    AMBIENT_MID_FOR_LEVEL picks one per sector) drifts at a speed between the backdrop and the foreground, graded
//    through the ATMOS bake like the other layers, so the world has depth in motion instead of two sliding paintings.
// 2. Blinking emissives (bg + fg). The ATMOS bake is wrapped: from each baked tile a DIM layer is derived with blend
//    modes only (T x (1 - lum(T^4)): the painted lights go dark, everything else is unchanged) and cut into two phase
//    groups by a 128 px cell hash. Drawing a group over its tile at alpha a dims those lights by a; a slow pulse plus
//    random dropouts per group reads as beacons, windows and signs blinking out of step (the bloom pass follows them).
//    Half-resolution layers, so the memory cost is a quarter of the tiles' own.
// 3. Weather (L3b). Per sector: rain streaks (Abyssal Relay), falling ash (Logic Foundry), rising embers (Night
//    Engine), slow motes in the nebula and the finale city. Plain fills and strokes, two style sets per frame.
// 4. Explosion light (L3b). addExplosionSprite is wrapped: every blast drops a warm radial splash on the environment
//    under the plates (one pre-rendered sprite, drawImage at a fading alpha).
// 5. Lightning bolts. drawThemeFx is wrapped: on the storm flash a jagged bolt (one branch) is struck for .16 s in the
//    sector accent with a white core; the storm timer itself got tighter (STORM_BOLT_MIN/MAX_S in 70-render.js).
//
// Budget: no composite set per frame (every blend mode is used at bake time), no filters, no pixel reads; the
// per-frame additions are tiled drawImages (mid strip 2-3, dim groups 2 x 2-3, fg dim 1 x 2) plus weather primitives.
// Reduce-motion: the mid strip still scrolls with the parallax (it is part of it), lights do not blink, no weather,
// no bolts; splashes fade without growth.

const AMBIENT = Object.freeze({
  mid: Object.freeze({ height: 0.46, bottom: 0.72, speedK: 0.45, alpha: 0.92 }),
  blink: Object.freeze({ groups: 2, cell: 128, power: 4, res: 0.5, pulseHz: 0.33, pulseA: 0.28, dropA: 0.62, dropEvery: [1.8, 5.5], dropFrames: [2, 5], fgA: 0.16, fgHz: 0.21 }),
  weather: Object.freeze({
    rain: Object.freeze({ n: 90, speed: [720, 980], len: [16, 34], slant: -0.22, alpha: [0.18, 0.42], color: "cyan", drift: -140 }),
    ash: Object.freeze({ n: 64, vy: [26, 58], vx: [-70, -30], size: [2, 3], alpha: [0.35, 0.75], color: "amber", sway: 18 }),
    embers: Object.freeze({ n: 56, vy: [-96, -42], vx: [-120, -60], size: [2, 2], alpha: [0.5, 0.95], color: "danger", twinkleHz: 6 }),
    motes: Object.freeze({ n: 26, vy: [-8, 8], vx: [-40, -18], size: [1, 2], alpha: [0.1, 0.22], color: "violet", sway: 10 }),
    gold: Object.freeze({ n: 26, vy: [-8, 8], vx: [-40, -18], size: [1, 2], alpha: [0.1, 0.24], color: "amber", sway: 10 })
  }),
  splash: Object.freeze({ small: [84, 0.28], kill: [130, 0.36], medium: [130, 0.36], large: [260, 0.6], alpha: 0.62, cap: 12, sprite: 256 }),
  bolt: Object.freeze({ life: 0.16, step: 36, jitter: 30, branchAt: [0.35, 0.65], coreW: 2, glowW: 7, glowA: 0.34, coreA: 0.95 })
});

// Mid strip per sector (levelIndex 0..9): manifest keys mid/<id> (assets/opt/mid, fallback assets/midgrounds/<id>.png).
const AMBIENT_MID_FOR_LEVEL = Object.freeze(["gantry", "asteroids", "wreckage", "gantry", "asteroids", "wreckage", "gantry", "asteroids", "wreckage", "gantry"]);
// Weather per theme art id (30-content.js LEVEL_THEMES art).
const AMBIENT_WEATHER_FOR_ART = Object.freeze({ seventh: "rain", eighth: "ash", ninth: "embers", third: "motes", tenth: "gold" });

function ambientHash2(cx, cy) {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

Object.assign(Game.prototype, {
  ambientState() {
    return this._ambient || (this._ambient = {
      midOffset: 0, midKey: null,
      blink: { t: 0, drops: [], nextDrop: [] },
      weather: { kind: null, parts: [], color: null },
      splashes: [], splashSprite: null, splashEpoch: -1,
      bolts: [], lastBoltFrame: -1
    });
  },

  // ------------------------- 1. mid-depth strip -------------------------
  ambientMidKey() {
    const id = AMBIENT_MID_FOR_LEVEL[clamp(this.levelIndex | 0, 0, AMBIENT_MID_FOR_LEVEL.length - 1)];
    return id ? "mid/" + id : null;
  },

  ambientWarm() {
    const st = this.ambientState();
    const key = this.ambientMidKey();
    st.midKey = key;
    if (key && typeof Assets !== "undefined" && Assets && typeof Assets.loadMany === "function" && typeof Assets.meta === "function" && Assets.meta(key)) {
      try { Assets.loadMany([key], null, { priority: "low" }); } catch (_) { /* optional layer */ }
    }
    // weather for the sector
    const theme = this.currentTheme;
    const art = theme ? (theme.art || theme.id) : null;
    this.ambientSetWeather(AMBIENT_WEATHER_FOR_ART[art] || null);
    st.bolts.length = 0;
    st.splashes.length = 0;
  },

  drawMidLayer(ctx) {
    if (this.ambientOff()) return;
    const st = this.ambientState();
    const key = st.midKey || this.ambientMidKey();
    if (!key || typeof Assets === "undefined" || !Assets || typeof Assets.get !== "function") return;
    const raw = Assets.get(key);
    if (!raw || !(raw.width > 0)) return;
    const id = key.slice(4);
    const tile = (typeof this.atmosTile === "function") ? this.atmosTile("mid", id, raw, { edges: "none" }) : null;
    const img = tile ? tile.canvas : raw;
    const tileH = Math.round(this.h * AMBIENT.mid.height);
    const tileW = tileH * (img.width / img.height);
    const y = Math.round(this.h * AMBIENT.mid.bottom) - tileH;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * AMBIENT.mid.alpha;
    this.debug.ambientDraws = (this.debug.ambientDraws | 0) + this.drawTiledImage(ctx, img, tileW, tileH, y, st.midOffset, 0);
    ctx.globalAlpha = prev;
  },

  // ------------------------- 2. blinking emissives -------------------------
  // Derived from a baked ATMOS tile: groups[i] is the tile with its lights darkened, masked to the cells of group i.
  ambientDimLayers(tile, groups) {
    const B = AMBIENT.blink;
    const src = tile.canvas;
    const w = Math.max(1, Math.round(src.width * B.res)), h = Math.max(1, Math.round(src.height * B.res));
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    // M = 1 - lum(T^power)
    const M = mk(); const m = M.getContext("2d");
    m.drawImage(src, 0, 0, w, h);
    m.globalCompositeOperation = "multiply";
    for (let i = 1; i < B.power; i++) m.drawImage(src, 0, 0, w, h);
    m.globalCompositeOperation = "saturation";
    m.fillStyle = "#808080"; m.fillRect(0, 0, w, h);
    m.globalCompositeOperation = "difference";
    m.fillStyle = "#ffffff"; m.fillRect(0, 0, w, h);
    // D = T * M, alpha restored to T's
    const D = mk(); const d = D.getContext("2d");
    d.drawImage(src, 0, 0, w, h);
    d.globalCompositeOperation = "multiply";
    d.drawImage(M, 0, 0);
    d.globalCompositeOperation = "destination-in";
    d.drawImage(src, 0, 0, w, h);
    M.width = 0;
    if (groups <= 1) return [D];
    const out = [];
    const cell = Math.max(16, Math.round(B.cell * B.res));
    for (let gi = 0; gi < groups; gi++) {
      const G = mk(); const g = G.getContext("2d");
      g.drawImage(D, 0, 0);
      // cell mask: keep the cells hashed to this group
      const mask = mk(); const k = mask.getContext("2d");
      k.fillStyle = "#000";
      for (let cy = 0; cy * cell < h; cy++) for (let cx = 0; cx * cell < w; cx++) {
        if (ambientHash2(cx + 1, cy + 1) % groups === gi) k.fillRect(cx * cell, cy * cell, cell, cell);
      }
      g.globalCompositeOperation = "destination-in";
      g.drawImage(mask, 0, 0);
      mask.width = 0;
      out.push(G);
    }
    D.width = 0;
    return out;
  },

  ambientBlinkAlpha(group, isFg) {
    const B = AMBIENT.blink;
    const st = this.ambientState().blink;
    const t = this.starT || 0;
    if (isFg) return B.fgA * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * B.fgHz + 1.7));
    const phase = group * 2.1 + 0.4;
    let a = B.pulseA * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * B.pulseHz + phase));
    const drop = st.drops[group] | 0;
    if (drop > 0) { a = Math.max(a, B.dropA); st.drops[group] = drop - 1; }
    return a;
  },

  ambientBlinkTick(dt) {
    const B = AMBIENT.blink;
    const st = this.ambientState().blink;
    for (let g = 0; g < B.groups; g++) {
      if (!(st.nextDrop[g] > 0)) st.nextDrop[g] = rand(B.dropEvery[0], B.dropEvery[1]);
      st.nextDrop[g] -= dt;
      if (st.nextDrop[g] <= 0) { st.nextDrop[g] = rand(B.dropEvery[0], B.dropEvery[1]); st.drops[g] = randi(B.dropFrames[0], B.dropFrames[1]); }
    }
  },

  // Draw a tile's dim groups over the tiles 70-render.js just laid (same geometry).
  drawAmbientDim(ctx, tile, tileW, tileH, y, offset, overlap, isFg) {
    if (!tile || this.reduceMotion || this.ambientOff()) return;
    const m = typeof this.motion === "function" ? this.motion() : { anim: 1 };
    if (m.anim <= 0) return;
    if (!tile.dim) {
      try { tile.dim = this.ambientDimLayers(tile, isFg ? 1 : AMBIENT.blink.groups); } catch (_) { tile.dim = []; }
    }
    const layers = tile.dim;
    if (!layers || !layers.length) return;
    const prev = ctx.globalAlpha;
    for (let i = 0; i < layers.length; i++) {
      const a = this.ambientBlinkAlpha(i, isFg);
      if (a <= 0.01) continue;
      ctx.globalAlpha = prev * a;
      this.debug.ambientDraws = (this.debug.ambientDraws | 0) + this.drawTiledImage(ctx, layers[i], tileW, tileH, y, offset, overlap);
    }
    ctx.globalAlpha = prev;
  },

  // ------------------------- 3. weather -------------------------
  ambientSetWeather(kind) {
    const st = this.ambientState().weather;
    if (st.kind === kind) return;
    st.kind = kind;
    st.parts.length = 0;
    const cfg = kind ? AMBIENT.weather[kind] : null;
    if (!cfg) return;
    for (let i = 0; i < cfg.n; i++) st.parts.push(this.ambientSpawnPart(cfg, kind, true));
  },

  ambientSpawnPart(cfg, kind, anywhere) {
    const W = this.w, H = this.h;
    const p = { x: rand(-40, W + 40), y: anywhere ? rand(-20, H + 20) : 0, a: rand(cfg.alpha[0], cfg.alpha[1]), s: cfg.size ? randi(cfg.size[0], cfg.size[1]) : 1, ph: rand(0, Math.PI * 2) };
    if (kind === "rain") {
      p.len = rand(cfg.len[0], cfg.len[1]); p.vy = rand(cfg.speed[0], cfg.speed[1]); p.vx = p.vy * cfg.slant + cfg.drift;
      if (!anywhere) p.y = -p.len - rand(0, 40);
    } else {
      p.vy = rand(cfg.vy[0], cfg.vy[1]); p.vx = rand(cfg.vx[0], cfg.vx[1]);
      if (!anywhere) { if (p.vy > 0) p.y = -8; else if (p.vy < 0) p.y = H + 8; else { p.x = W + 8; p.y = rand(0, H); } }
    }
    return p;
  },

  ambientWeatherTick(dt) {
    const st = this.ambientState().weather;
    if (!st.kind || !st.parts.length || this.reduceMotion) return;
    const cfg = AMBIENT.weather[st.kind];
    const W = this.w, H = this.h;
    const sway = cfg.sway || 0;
    const t = this.starT || 0;
    const scroll = this.currentTheme ? ((this.currentTheme.fgSpeed || 0) * 0.5) : 0;
    for (let i = 0; i < st.parts.length; i++) {
      const p = st.parts[i];
      p.x += (p.vx - scroll + (sway ? Math.sin(t * 1.3 + p.ph) * sway : 0)) * dt;
      p.y += p.vy * dt;
      if (p.y > H + 40 || p.y < -60 || p.x < -80) st.parts[i] = this.ambientSpawnPart(cfg, st.kind, false);
    }
  },

  drawWeather(ctx) {
    const st = this.ambientState().weather;
    if (!st.kind || !st.parts.length || this.reduceMotion) return;
    const cfg = AMBIENT.weather[st.kind];
    const t = this.starT || 0;
    ctx.save();
    if (st.kind === "rain") {
      // two alpha buckets, one stroke each
      for (let b = 0; b < 2; b++) {
        ctx.strokeStyle = PALETTE.rgba(cfg.color, b ? 0.38 : 0.2);
        ctx.lineWidth = b ? 1.5 : 1;
        ctx.beginPath();
        for (const p of st.parts) {
          if ((p.a > 0.3) !== !!b) continue;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + cfg.slant * p.len, p.y + p.len);
        }
        ctx.stroke();
      }
    } else {
      const tw = cfg.twinkleHz || 0;
      for (let b = 0; b < 2; b++) {
        ctx.fillStyle = PALETTE.rgba(cfg.color, b ? Math.min(1, cfg.alpha[1]) : cfg.alpha[0] + (cfg.alpha[1] - cfg.alpha[0]) * 0.35);
        for (const p of st.parts) {
          const bright = p.a > (cfg.alpha[0] + cfg.alpha[1]) / 2;
          if (bright !== !!b) continue;
          if (tw && Math.sin(t * tw * Math.PI * 2 + p.ph) < -0.55) continue;   // embers twinkle
          ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
        }
      }
    }
    ctx.restore();
  },

  // ------------------------- 4. explosion light -------------------------
  ambientSplashSprite() {
    const st = this.ambientState();
    if (st.splashSprite && st.splashEpoch === this.spriteEpoch) return st.splashSprite;
    const n = AMBIENT.splash.sprite;
    const c = document.createElement("canvas");
    c.width = n; c.height = n;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, "rgba(255,226,178,0.95)");
    grad.addColorStop(0.35, "rgba(255,170,110,0.55)");
    grad.addColorStop(0.7, "rgba(255,90,140,0.18)");
    grad.addColorStop(1, "rgba(255,60,160,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    st.splashSprite = c;
    st.splashEpoch = this.spriteEpoch;
    return c;
  },

  ambientSplash(x, y, type) {
    const st = this.ambientState();
    const S = AMBIENT.splash;
    const cfg = S[type] || S.small;
    if (st.splashes.length >= S.cap) st.splashes.shift();
    st.splashes.push({ x, y, r: cfg[0], life: cfg[1], t: 0 });
  },

  ambientSplashTick(dt) {
    const st = this.ambientState();
    if (!st.splashes.length) return;
    compactInPlace(st.splashes, (s) => { s.t += dt; return s.t < s.life; });
  },

  drawSplashes(ctx) {
    const st = this.ambientState();
    if (!st.splashes.length) return;
    const spr = this.ambientSplashSprite();
    const rm = !!this.reduceMotion;
    const prev = ctx.globalAlpha;
    for (const s of st.splashes) {
      const u = clamp(s.t / s.life, 0, 1);
      const grow = rm ? 1 : (0.75 + 0.45 * u);
      const r = s.r * grow;
      ctx.globalAlpha = prev * AMBIENT.splash.alpha * (1 - u) * (1 - u);
      ctx.drawImage(spr, s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = prev;
  },

  // ------------------------- 5. lightning bolts -------------------------
  ambientStrikeBolt() {
    const st = this.ambientState();
    const B = AMBIENT.bolt;
    const pts = [];
    let x = rand(this.w * 0.12, this.w * 0.88), y = -12;
    const yEnd = rand(this.h * 0.32, this.h * 0.58);
    pts.push([x, y]);
    while (y < yEnd) { y += B.step; x += rand(-B.jitter, B.jitter); pts.push([x, y]); }
    const bi = clamp(Math.round(pts.length * rand(B.branchAt[0], B.branchAt[1])), 1, pts.length - 1);
    const branch = [pts[bi]];
    let bx = pts[bi][0], by = pts[bi][1];
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 3 + randi(0, 2); i++) { bx += dir * rand(14, 34); by += rand(14, 30); branch.push([bx, by]); }
    st.bolts.push({ pts, branch, t: 0, life: B.life });
    if (st.bolts.length > 2) st.bolts.shift();
  },

  ambientBoltTick(dt) {
    const st = this.ambientState();
    if (!st.bolts.length) return;
    compactInPlace(st.bolts, (b) => { b.t += dt; return b.t < b.life; });
  },

  drawStormBolts(ctx) {
    const st = this.ambientState();
    if (!st.bolts.length || this.reduceMotion) return;
    const B = AMBIENT.bolt;
    const theme = this.currentTheme;
    const accent = (theme && theme.accent && PALETTE.has(theme.accent)) ? theme.accent : "accent";
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const b of st.bolts) {
      const u = clamp(b.t / b.life, 0, 1);
      const k = (1 - u) * (1 - u);
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? PALETTE.rgba("text", B.coreA * k) : PALETTE.rgba(accent, B.glowA * k);
        ctx.lineWidth = pass ? B.coreW : B.glowW;
        ctx.beginPath();
        ctx.moveTo(b.pts[0][0], b.pts[0][1]);
        for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
        ctx.moveTo(b.branch[0][0], b.branch[0][1]);
        for (let i = 1; i < b.branch.length; i++) ctx.lineTo(b.branch[i][0], b.branch[i][1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  ambientOff() {
    const h = (typeof window !== "undefined") ? window.TypeRHarness : null;
    return !!(h && h.ambient === false);
  },

  // L3b: in front of the near parallax, under rails / plates / ship.
  drawAmbientFront(ctx) {
    if (this.ambientOff()) return;
    this.drawSplashes(ctx);
    this.drawWeather(ctx);
    this.drawStormBolts(ctx);
  },

  ambientTick(dt) {
    const st = this.ambientState();
    const theme = this.currentTheme;
    if (theme) {
      const warp = Number.isFinite(this.parallaxWarp) ? this.parallaxWarp : 1;
      const mul = (typeof theme.speedMul === "number" ? theme.speedMul : 1) * warp;
      const v = ((theme.bgSpeed || 0) + (theme.fgSpeed || 0)) * AMBIENT.mid.speedK;
      st.midOffset += v * mul * dt;
    }
    this.ambientBlinkTick(dt);
    this.ambientWeatherTick(dt);
    this.ambientSplashTick(dt);
    this.ambientBoltTick(dt);
  }
});

(function wrapAmbient() {
  const P = Game.prototype;
  // clocks ride on the ambient step (play and ambient screens alike; frozen with the world on pause)
  const stepAmbient = P.stepAmbient;
  if (typeof stepAmbient === "function") {
    P.stepAmbient = function (dt) { stepAmbient.call(this, dt); if (typeof this.ambientTick === "function") this.ambientTick(dt * ((typeof this.timeScale === "number" && this.timeScale > 0) ? 1 : 1)); };
  }
  // blinking emissives over the backdrop and the near layer, same tiling geometry as 70-render.js
  const drawBackground = P.drawBackground;
  P.drawBackground = function (ctx) {
    this.debug.ambientDraws = 0;
    drawBackground.call(this, ctx);
    const theme = this.currentTheme;
    const art = this.themeArt(theme);
    const raw = art ? Assets.get("bg/" + art) : null;
    const tile = (raw && typeof this.atmosTile === "function") ? this.atmosTile("bg", art, raw) : null;
    if (!tile) return;
    const tileH = this.h + 2 * SHAKE_PAD;
    const tileW = tileH * (tile.canvas.width / tile.canvas.height);
    this.drawAmbientDim(ctx, tile, tileW, tileH, -SHAKE_PAD, this.parallax.bgOffset, tileW * tile.overlapFrac, false);
  };
  const drawForegroundParallax = P.drawForegroundParallax;
  P.drawForegroundParallax = function (ctx) {
    drawForegroundParallax.call(this, ctx);
    const theme = this.currentTheme;
    if (!theme || theme.tileFg === false) return;   // the untiled vistas keep their lights steady
    const art = this.themeArt(theme);
    const raw = art ? Assets.get("fg/" + art) : null;
    const tile = (raw && typeof this.atmosTile === "function") ? this.atmosTile("fg", art, raw, { edges: "left" }) : null;
    if (!tile) return;
    const fgHeight = theme.fgHeight || 0.6;
    const tileH = Math.round(this.h * fgHeight);
    const tileW = tileH * (tile.canvas.width / tile.canvas.height);
    this.drawAmbientDim(ctx, tile, tileW, tileH, this.h - tileH, this.parallax.fgOffset, tileW * tile.overlapFrac, true);
  };
  // the storm flash strikes a bolt
  const drawThemeFx = P.drawThemeFx;
  P.drawThemeFx = function (ctx) {
    const fire = (this.stormBoltFrames | 0) === 2 && !this.reduceMotion && this.currentTheme && this.currentTheme.storm;
    drawThemeFx.call(this, ctx);
    if (fire) {
      const st = this.ambientState();
      const young = st.bolts.some((b) => b.t < 0.08);   // one strike per flash, whatever the update/render cadence
      if (!young && st.lastBoltFrame !== this.frameCount) { st.lastBoltFrame = this.frameCount; this.ambientStrikeBolt(); }
    }
  };
  // every blast lights the environment
  const addExplosionSprite = P.addExplosionSprite;
  P.addExplosionSprite = function (x, y, type = "small") {
    const ex = addExplosionSprite.call(this, x, y, type);
    if (typeof this.ambientSplash === "function") this.ambientSplash(x, y, type);
    return ex;
  };
})();

onGameHook("sectorStart", function () { if (typeof this.ambientWarm === "function") this.ambientWarm(); });
