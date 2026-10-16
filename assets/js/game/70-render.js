// Type-R 198X — canvas rendering: resizeCanvas, render(dt) in the CONTRACT section 8 layer order, parallax, stars,
// theme FX (storm pass), lane rails, enemy plates, powerup capsules, dying plates, the boss composition (art box
// top-right + console slab bottom-left + dissolve), the glow-sprite cache. Ship/beams/particles/explosions/overlays/
// vignette live in 75-fx-draw.js. Methods are mixed into Game.prototype; load order is defined in index.html.
//
// Performance rules (CONTRACT section 3 / PLAN A11): no shadowBlur or filter in the per-frame path (glows are
// baked once into sprites by makeGlowSprite/getPlateSprite), no translucent full-frame fill above alpha .12 (the
// storm tint and the two-frame lightning are the contract's exceptions), parallax from the loader's pre-scaled
// bitmaps drawn 1:1 at integer device x, stars batched by alpha bucket, the vignette cached per resize. Drawables
// are read through Assets.get()/Assets.sprite() every frame.

const STAR_ALPHAS = [0.9, 0.68, 0.46, 0.25];
const STAR_COLORS = STAR_ALPHAS.map((a) => PALETTE.rgba("text", a));
const STAR_TINT_MIX = 0.2;          // a third of the stars take 20 % of the sector accent (VIS-09)

// Plate signature per state (VIS-04 colours). Glow is baked into the cached sprite. Tube strokes are opaque so a
// stroke pixel is the token colour itself (the .92 step of the ladder is reserved for fills / text).
const PLATE_STYLES = {
  idle:   { stroke: "cyan",    strokeA: 1.0, lw: 2.5, glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  locked: { stroke: "lime",    strokeA: 1.0, lw: 3,   glowA: 0.70, blur: 14, fill: "bg0", fillA: 0.92 },
  danger: { stroke: "danger",  strokeA: 1.0, lw: 2.5, glowA: 0.70, blur: 14, fill: "bg0", fillA: 0.92 },
  dangerBase: { stroke: "danger", strokeA: 1.0, lw: 2.5, glowA: 0, blur: 0, fill: "bg0", fillA: 0.92 },   // solid stroke under the pulsing glow
  minion: { stroke: "magenta", strokeA: 1.0, lw: 2.5, glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  power:  { stroke: "violet",  strokeA: 1.0, lw: 2,   glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  boss:   { stroke: "magenta", strokeA: 0.92, lw: 2,  glowA: 0.45, blur: 26, fill: "bg0", fillA: 0.92 }
};
const PLATE_CACHE_MAX = 96;
const PLATE_BUCKET = 8;
const GLOW_PAD = 16;
const SLAB_PAD = 32;
const SLAB = { x: 32, w: 640, h: 96, r: 16, pad: 16, leftW: 200, centreW: 320, rightW: 88, bottom: 24 };
const CAPSULE_CHAMFER = 10;
const CAPSULE_ICON_X = 19;          // icon centre from the capsule's left tip
const CAPSULE_DIVIDER_X = 32;       // divider after the icon cell
const SPAWN_POP_S = 0.16;           // easeOutBack scale-in
const SPAWN_STRETCH_S = 0.4;        // warp stretch / streak window (the plate reads >= 5 % wide at .15 s)
const SPAWN_STRETCH = 0.3;          // horizontal stretch at age 0 (settles with the streak)
const DIM_BAND_ALPHA = 0.45;
const IMPACT_FRAME_S = 0.09;        // white / danger plate before the .2 s fade
const DYING_FADE_S = 0.2;
const DYING_PLATES_CAP = 24;
const RAIL_FROM = 0.40;
const VISTA_DRIFT_PX = 20;          // tenth-sector foreground drift amplitude
const BOSS_BOX_LEFT = 688;          // art box x 688..w-16, y hudSafeTop+8+float..h-24 (VIS-07)
const BOSS_BOX_RIGHT_PAD = 16;
const BOSS_BOX_BOTTOM_PAD = 24;
const BOSS_FLOAT_PX = 12;
const BOSS_SLIDE_PX = 320;
const BOSS_SLIDE_S = 0.9;
const BOSS_SLAB_IN_AT = 1.9;        // slab scales .6 -> 1 over the last .5 s of the 2.4 s intro
const BOSS_DISSOLVE_START_S = 0.4;  // the bossKill crack starts the dissolve
const BOSS_DISSOLVE_S = 1.2;
const BOSS_JITTER_PX = 4;
const STORM_TINT_ALPHA = 0.22;
const STORM_BOLT_MIN_S = 6;
const STORM_BOLT_MAX_S = 11;

// Procedural powerup icons (VIS-05): 16 x 16 box centred on the origin, 2 px strokes in the type accent.
const POWER_ICON = {
  SPREAD(ctx) {
    for (const a of [-25, 0, 25]) {
      const r = a * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-7 + Math.cos(r) * 14, Math.sin(r) * 14); ctx.stroke();
    }
  },
  PIERCE(ctx) {
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(4, -4); ctx.lineTo(8, 0); ctx.lineTo(4, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(-3, 5); ctx.moveTo(1, -5); ctx.lineTo(1, 5); ctx.stroke();
  },
  RAPID(ctx) {
    const bolt = () => { ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(-4, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 8); ctx.lineTo(4, -1); ctx.lineTo(0, -1); ctx.closePath(); };
    bolt(); ctx.stroke();
    const prev = ctx.strokeStyle; ctx.strokeStyle = PALETTE.rgba("text", 0.92); ctx.lineWidth = 0.8; bolt(); ctx.stroke(); ctx.strokeStyle = prev; ctx.lineWidth = 2;
  },
  SHIELD(ctx) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const px = Math.cos(a) * 7, py = Math.sin(a) * 7; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.stroke();
  },
  MULTI(ctx) {
    const prevFill = ctx.fillStyle;
    ctx.globalAlpha *= 1;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.rgba("amber", 0.25); ctx.fill();
    ctx.fillStyle = PALETTE.rgba("text", 0.98);
    ctx.font = FONT.target(11, 700); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("×2", 0, 0.5);
    ctx.fillStyle = prevFill;
  },
  REPAIR(ctx) {
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
    const prevFill = ctx.fillStyle; ctx.fillStyle = PALETTE.rgba("text", 0.12); ctx.fill(); ctx.fillStyle = prevFill;
    ctx.fillRect(-5, -1.5, 10, 3); ctx.fillRect(-1.5, -5, 3, 10);
  }
};

Object.assign(Game.prototype, {
  // ------------------------- Canvas sizing (PERF-07 / VIS-02 / VIS-07) -------------------------
  // The backing store follows the element's CSS size x device pixel ratio (capped by settings.renderScaleCap);
  // every gameplay number stays in the 1280x720 logical space and render() applies the scale transform.
  resizeCanvas() {
    const cap = clamp(Number(this.save && this.save.settings && this.save.settings.renderScaleCap) || 2, 0.5, 2);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const rect = this.canvas.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const s = clamp((rect.width * dpr) / LOGICAL_W, 0.5, 2);
    this.cssScale = rect.width / LOGICAL_W;
    const wantW = Math.round(LOGICAL_W * s);
    const wantH = Math.round(LOGICAL_H * s);
    const scaleDelta = Math.abs(s - this.renderScale) / (this.renderScale || 1);
    const changed = scaleDelta >= 0.02 || this.canvas.width !== wantW || this.canvas.height !== wantH;
    if (changed) {
      this.renderScale = s;
      this.canvas.width = wantW;   // resets the context state
      this.canvas.height = wantH;
      this.spriteEpoch++;
      if (this.plateCache) this.plateCache.clear();
      this.vignetteSprite = null;
      this.dangerVignette = null;
      if (typeof Assets !== "undefined" && Assets && typeof Assets.setRenderScale === "function") Assets.setRenderScale(s);
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    this.updateHudSafeTop();
    if (changed && this._loop) this.requestFrame();
  },

  // Logical y below which the canvas is not covered by the DOM HUD (clamp 72..140, fallback 112).
  updateHudSafeTop() {
    const hud = document.getElementById("hud");
    const cr = this.canvas.getBoundingClientRect();
    let top = 112;
    if (hud && cr.width > 0 && this.cssScale > 0) {
      const hr = hud.getBoundingClientRect();
      const overlaps = hr.height > 0 && hr.bottom > cr.top && hr.top < cr.bottom;
      top = overlaps ? ((hr.bottom - cr.top) / this.cssScale) + 8 : 72;
    }
    this.hudSafeTop = clamp(Math.round(top), 72, 140);
  },

  // Resize triggers: #main / #hud size (ResizeObserver), window resize, monitor DPR change. Debounced 120 ms.
  bindResize() {
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.resizeCanvas(), 120);
    };
    this.scheduleResize = schedule;
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(schedule);
      const main = document.getElementById("main");
      const hud = document.getElementById("hud");
      if (main) ro.observe(main);
      if (hud) ro.observe(hud);
      this._resizeObserver = ro;
    }
    window.addEventListener("resize", schedule);
    const watchDpr = () => {
      if (typeof matchMedia !== "function") return;
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const onChange = () => {
        if (mq.removeEventListener) mq.removeEventListener("change", onChange);
        else if (mq.removeListener) mq.removeListener(onChange);
        schedule();
        watchDpr();
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    };
    watchDpr();
  },

  // Motion profile from the shell (C6) when it exists; the contract's reduce-motion values otherwise.
  motionProfile() {
    if (typeof this.motion === "function") {
      try { const m = this.motion(); if (m) return m; } catch (e) { /* fall through */ }
    }
    return this.reduceMotion ? { shake: 0, flash: 0.3, anim: 0 } : { shake: 1, flash: 1, anim: 1 };
  },

  // ------------------------- Glow sprites (PERF-08 / VIS-04) -------------------------
  // Renders drawFn(ctx, w, h) once into an offscreen canvas at the current renderScale with `pad` logical px of
  // margin on every side (room for the blur). Draw it with drawGlowSprite() or ctx.drawImage at (x - pad, y - pad).
  makeGlowSprite(drawFn, w, h, pad = GLOW_PAD) {
    const s = this.renderScale || 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((w + 2 * pad) * s));
    canvas.height = Math.max(1, Math.round((h + 2 * pad) * s));
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    g.translate(pad, pad);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    drawFn(g, w, h);
    return { canvas, w, h, pad, scale: s, epoch: this.spriteEpoch };
  },

  drawGlowSprite(ctx, sprite, cx, cy) {
    const full = sprite.w + 2 * sprite.pad;
    const fullH = sprite.h + 2 * sprite.pad;
    ctx.drawImage(sprite.canvas, cx - full / 2, cy - fullH / 2, full, fullH);
  },

  // Outline path for a plate shape with its top-left at (0,0) (sprite space) or centred on (cx, cy).
  plateShapePath(g, shape, w, h, cx = w / 2, cy = h / 2) {
    if (shape === "capsule") capsulePath(g, cx, cy, w, h, CAPSULE_CHAMFER);
    else roundRect(g, cx - w / 2, cy - h / 2, w, h, shape === "slab" ? SLAB.r : shape === "chip" ? 10 : 12);
  },

  // LRU (cap 96) of plate sprites keyed by shape, width bucket (8 px), height, state and spriteEpoch.
  // Shapes: chip (40x40) | pill (h 40) | capsule (chamfered hexagon, h 36) | slab (640x96 boss console).
  getPlateSprite(shape, wBucket, h, state) {
    const key = `${shape}:${wBucket}:${h}:${state}:${this.spriteEpoch}`;
    const cache = this.plateCache || (this.plateCache = new Map());
    let sprite = cache.get(key);
    if (sprite) {
      cache.delete(key);
      cache.set(key, sprite);
      return sprite;
    }
    const style = PLATE_STYLES[state] || PLATE_STYLES.idle;
    const pad = shape === "slab" ? SLAB_PAD : GLOW_PAD;
    sprite = this.makeGlowSprite((g, w, hh) => {
      if (style.blur > 0) {
        g.shadowBlur = style.blur;
        g.shadowColor = PALETTE.rgba(style.stroke, style.glowA);
      }
      g.fillStyle = PALETTE.rgba(style.fill, style.fillA);
      g.strokeStyle = PALETTE.rgba(style.stroke, style.strokeA);
      g.lineWidth = style.lw;
      g.lineJoin = "round";
      this.plateShapePath(g, shape, w, hh);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      // inner top highlight
      const inset = shape === "capsule" ? CAPSULE_CHAMFER : (shape === "slab" ? SLAB.r : 10);
      g.strokeStyle = PALETTE.rgba("text", 0.12);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(inset, 1.5);
      g.lineTo(w - inset, 1.5);
      g.stroke();
      if (shape === "capsule") {
        // icon cell divider
        g.strokeStyle = PALETTE.rgba(style.stroke, 0.45);
        g.beginPath();
        g.moveTo(CAPSULE_DIVIDER_X, 4);
        g.lineTo(CAPSULE_DIVIDER_X, hh - 4);
        g.stroke();
      }
      if (shape === "slab") {
        // cyan hairline under the top edge and the two cell dividers (VIS-07)
        g.strokeStyle = PALETTE.rgba("cyan", 0.25);
        g.beginPath();
        g.moveTo(SLAB.r, 1);
        g.lineTo(w - SLAB.r, 1);
        g.stroke();
        g.strokeStyle = PALETTE.rgba("cyan", 0.12);
        const x1 = SLAB.pad + SLAB.leftW, x2 = w - SLAB.pad - SLAB.rightW;
        g.beginPath();
        g.moveTo(x1, 12); g.lineTo(x1, hh - 12);
        g.moveTo(x2, 12); g.lineTo(x2, hh - 12);
        g.stroke();
      }
    }, wBucket, h, pad);
    cache.set(key, sprite);
    while (cache.size > PLATE_CACHE_MAX) cache.delete(cache.keys().next().value);
    return sprite;
  },

  // Backing dim band (VIS-04): 256x16 horizontal gradient, stretched under every plate so signage never fights the text.
  getDimBandSprite() {
    if (this.dimBandSprite) return this.dimBandSprite;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 16;
    const g = canvas.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, PALETTE.rgba("bg0", 0));
    grad.addColorStop(0.2, PALETTE.rgba("bg0", 0.70));
    grad.addColorStop(0.8, PALETTE.rgba("bg0", 0.70));
    grad.addColorStop(1, PALETTE.rgba("bg0", 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 16);
    this.dimBandSprite = canvas;
    return canvas;
  },

  drawDimBand(ctx, x, y, w, h) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * DIM_BAND_ALPHA;
    ctx.drawImage(this.getDimBandSprite(), x - w / 2 - 48, y - h / 2 - 10, w + 96, h + 20);
    ctx.globalAlpha = prev;
  },

  // Plate = cached glow sprite + dynamic parts (danger pulse, typo flash, hit flash, lock brackets); no shadows
  // per frame. Options object: { state, flash, shape, scale, typo }. The legacy positional form
  // (ctx, x, y, w, h, state, flash, { shape }) is still accepted.
  drawGlyphPlate(ctx, x, y, w, h, stateOrOpts, flash = 0, extra = {}) {
    const o = (stateOrOpts && typeof stateOrOpts === "object") ? stateOrOpts : Object.assign({ state: stateOrOpts, flash }, extra || {});
    const state = o.state || "idle";
    const shape = o.shape || (w <= h + 1 ? "chip" : "pill");
    const wBucket = Math.max(h, Math.ceil(w / PLATE_BUCKET) * PLATE_BUCKET);
    const scale = o.scale || 1;
    const scaled = scale !== 1;
    if (scaled) { ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.translate(-x, -y); }
    if (state === "danger") {
      // solid danger stroke; only the glow pulses .45 + .45 sin(6 pi t) (static .70 under reduce-motion)
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, "dangerBase"), x, y);
      const pulse = this.reduceMotion ? 0.70 : 0.45 + 0.45 * Math.sin(this.starT * Math.PI * 6);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(pulse, 0, 1);
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, "danger"), x, y);
      ctx.globalAlpha = prev;
    } else {
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, state), x, y);
    }
    // wrong key on this plate: the stroke flashes danger for 120 ms (D1 supplies en.typoT)
    if (o.typo > 0 && state !== "danger") {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(o.typo / 0.12, 0, 1) * 0.92;
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, "danger"), x, y);
      ctx.globalAlpha = prev;
    }
    const f = o.flash || 0;
    if (f > 0) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(f * 2, 0, 0.45);
      ctx.fillStyle = PALETTE.rgba("text", 0.45);
      this.plateShapePath(ctx, shape, wBucket, h, x, y);
      ctx.fill();
      ctx.globalAlpha = prev;
    }
    if (state === "locked") {
      // lock brackets are always lime, whatever the target kind
      ctx.strokeStyle = PALETTE.rgba("lime", 0.92);
      ctx.lineWidth = 2;
      bracketRect(ctx, x - wBucket / 2 - 6, y - h / 2 - 6, wBucket + 12, h + 12, 10);
    }
    if (scaled) ctx.restore();
  },

  // Bakes every plate sprite a sector can need (word lengths, powerup capsules, minion chip, boss slab) in idle
  // slices while the sector art loads, so the per-frame path never sets shadowBlur during a wave (A11).
  warmPlateCache(levelIndex) {
    const cfg = LEVELS[levelIndex];
    if (!cfg) return;
    const ctx = this.ctx;
    const epoch = this.spriteEpoch;
    const bucket = (w) => Math.ceil(w / PLATE_BUCKET) * PLATE_BUCKET;
    const jobs = [];
    const seen = new Set();
    const add = (shape, wb, h, state) => {
      const k = `${shape}:${wb}:${h}:${state}`;
      if (seen.has(k)) return;
      seen.add(k);
      jobs.push([shape, wb, h, state]);
    };
    const geo = this.plateGeometry();
    ctx.font = geo.font;
    const maxLen = clamp((cfg.wordMax || 8) + 3, 4, 14);
    for (let len = 1; len <= maxLen; len++) {
      const tw = ctx.measureText("m".repeat(len)).width;
      const w = len === 1 ? geo.h : Math.ceil(tw + PLATE_PAD);
      for (const state of ["idle", "locked", "danger", "dangerBase"]) add(len === 1 ? "chip" : "pill", Math.max(geo.h, bucket(w)), geo.h, state);
    }
    ctx.font = FONT.target(18, 600);
    for (const label of ["spread", "pierce", "rapid", "shield", "multi", "heal"]) {
      const w = Math.ceil(ctx.measureText(label).width + CAPSULE_PAD);
      add("capsule", bucket(w), CAPSULE_H, "power");
      add("capsule", bucket(w), CAPSULE_H, "locked");
    }
    add("chip", bucket(geo.minionH), geo.minionH, "minion");
    add("chip", bucket(geo.minionH), geo.minionH, "locked");
    add("slab", SLAB.w, SLAB.h, "boss");
    this.getDimBandSprite();

    const slice = (fn) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 200 });
      else setTimeout(fn, 0);
    };
    const run = () => {
      if (this.spriteEpoch !== epoch) return; // resized meanwhile: the next sector warms again
      let n = 0;
      while (jobs.length && n < 12) {
        const [shape, wb, hh, state] = jobs.shift();
        this.getPlateSprite(shape, wb, hh, state);
        n++;
      }
      if (jobs.length) slice(run);
    };
    slice(run);
  },

  // Plate font in logical px: 22 at desktop scales, larger on small playfields (CONTRACT section 7).
  plateFontPx() {
    return clamp(Math.ceil(14 / (this.cssScale || 1)), 22, 28);
  },

  // Plate geometry for this playfield: enemy 40 x font 22, minion 36 x font 20 (both scale with plateFontPx / 22).
  plateGeometry() {
    const px = this.plateFontPx();
    const k = px / 22;
    const h = Math.round((typeof PLATE_H === "number" ? PLATE_H : 40) * k);
    const minionPx = Math.round(20 * k);
    const minionH = Math.round((typeof PLATE_H_MINION === "number" ? PLATE_H_MINION : 36) * k);
    return { px, h, font: FONT.target(px, 600), minionPx, minionH, minionFont: FONT.target(minionPx, 600) };
  },

  // Text metrics cached on the entity (keyed by font + string + spriteEpoch); publishes textW / plateW / plateH.
  // Enemies: textW + 28 (minion + 24, chip = h for single letters); powerups: labelW + 44 (capsule icon cell).
  measurePlateText(ctx, en, text, font, h) {
    if (en._textWEpoch !== this.spriteEpoch || en._textWFont !== font || en._textWStr !== text) {
      ctx.font = font;
      en._textW = ctx.measureText(text).width;
      en._textWEpoch = this.spriteEpoch;
      en._textWFont = font;
      en._textWStr = text;
    }
    en.textW = en._textW;
    if (en.kind === "powerup") en.plateW = Math.ceil(en._textW + CAPSULE_PAD);
    else en.plateW = text.length === 1 ? h : Math.ceil(en._textW + (en.kind === "bossMinion" ? PLATE_PAD_MINION : PLATE_PAD));
    en.plateH = h;
    return en._textW;
  },

  // Game-side wrapper over the module helper (same signature; static caret under reduce-motion).
  drawSplitText(ctx, done, remaining, cx, y, opts = {}) {
    return drawSplitText(ctx, done, remaining, cx, y, opts);
  },

  caretAlpha() {
    return this.reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(this.starT * Math.PI * 2 * 1.2);
  },

  // ------------------------- Starfield (PERF-06 / VIS-09) -------------------------
  makeStars(n) {
    const stars = [];
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        z,                               // parallax depth: 0 near (bright, fast) .. 1 far
        s: rand(0.8, 2.2),
        bucket: clamp(Math.floor(z * 4), 0, 3),
        tint: i % 3 === 0                // a third of the stars lean toward the sector accent
      });
    }
    return stars;
  },

  // Star speed multiplier: the warp-in (parallaxWarp 4 -> 1) and the storm pass (speedMul 1.25).
  starSpeedMul() {
    const warp = Number.isFinite(this.parallaxWarp) ? this.parallaxWarp : 1;
    const theme = this.currentTheme;
    return warp * ((theme && theme.speedMul) || 1);
  },

  // dt-driven drift; called from stepAmbient (playing + ambient screens).
  updateStars(dt) {
    const w = this.w, h = this.h;
    const mul = this.starSpeedMul();
    for (const s of this.stars) {
      const spd = lerp(30, 140, 1 - s.z) * mul;
      s.x -= spd * dt;
      if (s.x < -5) {
        s.x = w + rand(0, 80);
        s.y = rand(0, h);
        s.z = Math.random();
        s.bucket = clamp(Math.floor(s.z * 4), 0, 3);
      }
    }
  },

  // Accent-tinted star colours (20 % toward PALETTE.accent), rebuilt when the accent changes.
  starTintColors() {
    const accent = PALETTE.accent;
    if (this._starTint && this._starTint.accent === accent) return this._starTint.colors;
    const t = PALETTE.rgb.text, a = PALETTE.rgb.accent;
    const mix = [0, 1, 2].map((i) => Math.round(t[i] * (1 - STAR_TINT_MIX) + a[i] * STAR_TINT_MIX));
    const colors = STAR_ALPHAS.map((al) => `rgba(${mix[0]},${mix[1]},${mix[2]},${al})`);
    this._starTint = { accent, colors };
    return colors;
  },

  // Eight fillStyle sets per frame (4 buckets x plain/tinted); integer coordinates keep the dots crisp.
  // During the warp-in the stars become streaks (length 40 * warp, fading out as the warp settles).
  drawStars(ctx) {
    const stars = this.stars;
    const tinted = this.starTintColors();
    const warp = (!this.reduceMotion && Number.isFinite(this.parallaxWarp)) ? this.parallaxWarp : 1;
    const streak = warp > 1.02 ? 40 * warp * clamp((warp - 1) / 0.5, 0, 1) : 0;
    if (streak > 0) {
      ctx.lineCap = "round";
      for (let b = 0; b < 4; b++) {
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? tinted[b] : STAR_COLORS[b];
          ctx.beginPath();
          for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            if (s.bucket !== b || (!!s.tint) !== (pass === 1)) continue;
            const len = streak * lerp(0.35, 1, 1 - s.z);
            const y = Math.round(s.y) + 0.5;
            ctx.moveTo(Math.round(s.x), y);
            ctx.lineTo(Math.round(s.x) + len, y);
          }
          ctx.lineWidth = b === 0 ? 2 : 1;
          ctx.stroke();
        }
      }
      return;
    }
    for (let b = 0; b < 4; b++) {
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? tinted[b] : STAR_COLORS[b];
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          if (s.bucket !== b || (!!s.tint) !== (pass === 1)) continue;
          const sz = s.s >= 1.5 ? 2 : 1;
          ctx.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
        }
      }
    }
  },

  // ------------------------- Parallax (A7 / A11) -------------------------
  // Tiles `img` (a prepared bitmap or the raw image) across the shaken field: tile edges snapped to device
  // pixels, no tile that is fully outside [-SHAKE_PAD, w + SHAKE_PAD], one extra tile on the left so a negative
  // shake never shows the base fill. Returns the number of drawImage calls.
  drawTiledImage(ctx, img, tileW, tileH, y, offset) {
    if (!img || !(tileW > 0) || !(tileH > 0)) return 0;
    const s = this.renderScale || 1;
    const pad = SHAKE_PAD;
    let startX = -(((offset % tileW) + tileW) % tileW);
    if (startX > -pad) startX -= tileW;
    let count = 0;
    for (let x = startX; x < this.w + pad; x += tileW) {
      const x0 = Math.round(x * s) / s;
      const x1 = Math.round((x + tileW) * s) / s;
      ctx.drawImage(img, x0, y, x1 - x0, tileH);
      count++;
    }
    return count;
  },

  themeArt(theme) {
    return theme ? (theme.art || theme.id) : null;
  },

  drawBackground(ctx) {
    const theme = this.currentTheme;
    const art = this.themeArt(theme);
    const bg = art ? Assets.get("bg/" + art) : null;
    this.debug.tileDraws = 0;
    if (bg) {
      const tileH = this.h + 2 * SHAKE_PAD;
      const tileW = tileH * (bg.width / bg.height);
      this.debug.tileDraws += this.drawTiledImage(ctx, bg, tileW, tileH, -SHAKE_PAD, this.parallax.bgOffset);
    } else {
      // procedural nebula while the sector art is still arriving
      const g1 = ctx.createRadialGradient(this.w * 0.25, this.h * 0.2, 60, this.w * 0.25, this.h * 0.2, 520);
      g1.addColorStop(0, PALETTE.rgba("magenta", 0.12));
      g1.addColorStop(1, PALETTE.rgba("magenta", 0));
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, this.w, this.h);
      const g2 = ctx.createRadialGradient(this.w * 0.75, this.h * 0.62, 90, this.w * 0.75, this.h * 0.62, 640);
      g2.addColorStop(0, PALETTE.rgba("cyan", 0.12));
      g2.addColorStop(1, PALETTE.rgba("cyan", 0));
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  },

  // The tenth foreground cannot tile: drawn cover-width (plus drift + shake margin), anchored to the bottom.
  vistaBox(theme) {
    const art = this.themeArt(theme);
    const meta = art ? Assets.meta("fg/" + art) : null;
    const orig = (meta && meta.orig) || { w: 2816, h: 1504 };
    const w = this.w + 2 * (VISTA_DRIFT_PX + SHAKE_PAD);
    return { w, h: w * orig.h / orig.w };
  },

  drawForegroundParallax(ctx) {
    const theme = this.currentTheme;
    const art = this.themeArt(theme);
    const fg = art ? Assets.get("fg/" + art) : null;
    if (fg) {
      const fgHeight = (theme && theme.fgHeight) || 0.6;
      if (theme && theme.tileFg === false) {
        if (art === "tenth") {
          const v = this.vistaBox(theme);
          const drift = this.reduceMotion ? 0 : VISTA_DRIFT_PX * Math.sin(this.starT * Math.PI * 2 * 0.05);
          const s = this.renderScale || 1;
          const x = Math.round((-(VISTA_DRIFT_PX + SHAKE_PAD) + drift) * s) / s;
          ctx.drawImage(fg, x, this.h - v.h, v.w, v.h);
        } else {
          const targetH = this.h * fgHeight;
          const width = targetH * (fg.width / fg.height);
          ctx.drawImage(fg, Math.round((this.w - width) / 2), this.h - targetH, width, targetH);
        }
        this.debug.tileDraws += 1;
      } else {
        const tileH = Math.round(this.h * fgHeight);
        const tileW = tileH * (fg.width / fg.height);
        this.debug.tileDraws += this.drawTiledImage(ctx, fg, tileW, tileH, this.h - tileH, this.parallax.fgOffset);
      }
      return;
    }

    // fallback: neon highway
    ctx.save();
    const trackY = this.h * 0.72;
    const trackH = this.h * 0.28;
    const grad = ctx.createLinearGradient(0, trackY, 0, trackY + trackH);
    grad.addColorStop(0, PALETTE.rgba("bg2", 0.25));
    grad.addColorStop(1, PALETTE.rgba("bg0", 0.70));
    ctx.fillStyle = grad;
    ctx.fillRect(0, trackY, this.w, trackH);

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = PALETTE.rgba("cyan", 0.45);
    ctx.lineWidth = 1;
    const t = this.starT * 160;
    ctx.beginPath();
    for (let i = 0; i < 22; i++) {
      const y = trackY + i * (trackH / 22);
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const x = ((i * 90) - (t % 90));
      ctx.moveTo(x, trackY);
      ctx.lineTo(x + 220, trackY + trackH);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = PALETTE.rgba("cyan", 0.70);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, trackY + 6);
    ctx.lineTo(this.w, trackY + 6);
    ctx.stroke();
    ctx.restore();
  },

  // ------------------------- Theme FX: storm pass (VIS-09, L4) -------------------------
  // Multiply tint magenta .22 on storm sectors; lightning every 6-11 s as two additive frames (.18 then .08) with a
  // 6 px slice shift on the first. Under reduce-motion only the tint remains. The timer runs in tickPresentation.
  drawThemeFx(ctx) {
    const theme = this.currentTheme;
    if (!theme || !theme.storm) return;
    const pad = SHAKE_PAD;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = PALETTE.rgba("magenta", STORM_TINT_ALPHA);
    ctx.fillRect(-pad, -pad, this.w + 2 * pad, this.h + 2 * pad);
    const frames = this.stormBoltFrames | 0;
    if (frames > 0 && !this.reduceMotion) {
      const first = frames === 2;
      if (first) {
        // one-frame horizontal slice shift of the field (reads back the canvas itself)
        const s = this.renderScale || 1;
        const sy = clamp(this.stormSliceY || this.h * 0.4, 0, this.h - 40);
        ctx.globalCompositeOperation = "source-over";
        try { ctx.drawImage(this.canvas, 0, Math.round(sy * s), this.canvas.width, Math.round(40 * s), 6, sy, this.w, 40); } catch (e) { /* tainted or closed */ }
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = PALETTE.rgba("text", first ? 0.18 : 0.08);
      ctx.fillRect(-pad, -pad, this.w + 2 * pad, this.h + 2 * pad);
      this.stormBoltFrames = frames - 1;
      this.debug.stormBolts = (this.debug.stormBolts | 0) + (first ? 1 : 0);
    }
    ctx.restore();
  },

  // ------------------------- Lane rails (VIS-04, L5) -------------------------
  // Dashed accent hairlines from .40 w to the right edge on every lane while enemies exist (fade in/out .25 s),
  // with a brighter entry tick at the spawn edge. The dash offset flows toward the ship (static under reduce-motion).
  drawLaneRails(ctx) {
    const alive = this.enemies.length > 0;
    const a = this.railAlpha || 0;
    this.debug.railsDrawn = alive;
    if (!alive && a <= 0.02) return;
    const ys = this.laneYs();
    const x0 = Math.round(this.w * RAIL_FROM);
    const k = alive ? Math.max(a, 0.35) : a;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = PALETTE.rgba("accent", 0.12);
    ctx.globalAlpha = k;
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = this.reduceMotion ? 0 : -((this.starT * 40) % 20);
    ctx.beginPath();
    for (const y of ys) {
      const yy = Math.round(y) + 0.5;
      ctx.moveTo(x0, yy);
      ctx.lineTo(this.w, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = PALETTE.rgba("accent", 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const y of ys) {
      const yy = Math.round(y);
      ctx.moveTo(this.w - 28, yy);
      ctx.lineTo(this.w - 8, yy);
    }
    ctx.stroke();
    ctx.restore();
  },

  // ------------------------- Presentation clocks (called from update) -------------------------
  // Rail fade, dying plates, storm lightning timer and the warp-in multiplier. Frozen with update() on pause.
  tickPresentation(dt) {
    const alive = this.enemies.length > 0;
    const target = alive ? 1 : 0;
    const a = this.railAlpha || 0;
    this.railAlpha = a + clamp(target - a, -dt * 4, dt * 4);

    if (this.dyingPlates && this.dyingPlates.length) {
      compactInPlace(this.dyingPlates, (d) => { d.t += dt; return d.t < d.life; });
    }

    const li = this.levelIntro;
    if (li && !this.reduceMotion) {
      const k = clamp(li.t / Math.max(0.01, li.dur), 0, 1);
      this.parallaxWarp = 1 + 3 * (1 - easeOutCubic(k));
    } else {
      this.parallaxWarp = 1;
    }

    const theme = this.currentTheme;
    if (theme && theme.storm && !this.reduceMotion) {
      if (!(this.stormNextBolt > 0)) this.stormNextBolt = rand(STORM_BOLT_MIN_S, STORM_BOLT_MAX_S);
      this.stormNextBolt -= dt;
      if (this.stormNextBolt <= 0) {
        this.stormNextBolt = rand(STORM_BOLT_MIN_S, STORM_BOLT_MAX_S);
        this.stormBoltFrames = 2;
        this.stormSliceY = rand(this.h * 0.15, this.h * 0.75);
      }
    } else {
      this.stormBoltFrames = 0;
    }
  },

  // ------------------------- Plates -------------------------
  enemyState(en) {
    if (en.locked) return "locked";
    if (en.kind === "bossMinion") return "minion";
    const dangerX = (typeof DANGER_X === "number" ? DANGER_X : 0.35) * this.w;
    return en.x < dangerX ? "danger" : "idle";
  },

  // Cyan warp streak trailing a freshly spawned plate (additive, fades over SPAWN_STRETCH_S).
  drawWarpStreak(ctx, x, y, w, h, age) {
    const k = clamp(age / SPAWN_STRETCH_S, 0, 1);
    if (k >= 1) return;
    const len = 140 * (1 - k * 0.6);
    const sx = x + w / 2 + 8;
    const prevComp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.globalAlpha = prevAlpha * 0.7 * (1 - k);
    ctx.strokeStyle = PALETTE.rgba("cyan", 0.70);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + len, y); ctx.stroke();
    ctx.globalAlpha = prevAlpha * 0.5 * (1 - k);
    ctx.strokeStyle = PALETTE.rgba("text", 0.92);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + len * 0.6, y); ctx.stroke();
    ctx.globalCompositeOperation = prevComp;
    ctx.globalAlpha = prevAlpha;
  },

  drawEnemy(ctx, en) {
    const minion = en.kind === "bossMinion";
    const geo = this.plateGeometry();
    const font = minion ? geo.minionFont : geo.font;
    const h = minion ? geo.minionH : geo.h;
    this.measurePlateText(ctx, en, en.text, font, h);
    const state = this.enemyState(en);
    const w = en.plateW;
    const rm = !!this.reduceMotion;
    const shape = en.text.length === 1 ? "chip" : "pill";

    // spawn pop: easeOutBack scale-in over .16 s plus a horizontal warp stretch that settles with the streak
    // (alpha fade only under reduce-motion)
    const k = clamp(en.age / SPAWN_POP_S, 0, 1);
    let sx = 1, sy = 1, alpha = 1;
    if (en.age < SPAWN_STRETCH_S) {
      if (rm) alpha = Math.max(k, 0.05);
      else {
        const s = easeOutBack(k);
        sy = s;
        sx = s * (1 + SPAWN_STRETCH * (1 - easeOutCubic(clamp(en.age / SPAWN_STRETCH_S, 0, 1))));
      }
    }
    en.popScale = sx;

    let x = en.x;
    const y = en.y;
    if (en.typoT > 0 && !rm) x += Math.sin(en.typoT * 157) * 3;   // +-3 px jitter for the 120 ms typo window

    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    if (!rm && en.age < SPAWN_STRETCH_S) this.drawWarpStreak(ctx, x, y, w, h, en.age);
    if (sx !== 1 || sy !== 1) { ctx.translate(x, y); ctx.scale(sx, sy); ctx.translate(-x, -y); }
    this.drawDimBand(ctx, x, y, w, h);
    this.drawGlyphPlate(ctx, x, y, w, h, { state, shape, flash: en.flash, typo: en.typoT });

    const done = en.text.slice(0, en.progress);
    const remaining = en.text.slice(en.progress);
    const locked = state === "locked";
    this.drawSplitText(ctx, done, remaining, x, y, {
      font,
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: locked ? PALETTE.rgba("lime", 0.92) : PALETTE.rgba("text", 0.92),
      leadColor: locked ? null : PALETTE.rgba("lime", 1),
      caret: locked,
      caretAlpha: this.caretAlpha()
    });
    ctx.restore();
    this.lastPlateDrawn = en;
  },

  // Powerup capsule (VIS-05): chamfered violet cartridge, 26 px icon cell with a procedural icon in the type
  // accent and a dashed ring rotating 60 deg/s, mono label (lime lead glyph / lock grammar as plates).
  drawPowerup(ctx, p) {
    const font = FONT.target(18, 600);
    const h = CAPSULE_H;
    this.measurePlateText(ctx, p, p.label, font, h);
    p.labelW = p.textW;
    const w = p.plateW;
    const rm = !!this.reduceMotion;
    const accentName = (typeof POWER_ACCENT === "object" && POWER_ACCENT[p.type]) || "violet";
    const accent = PALETTE.has(accentName) ? accentName : "violet";

    const k = clamp(p.age / SPAWN_POP_S, 0, 1);
    const scale = rm ? 1 : easeOutBack(k);
    let alpha = rm ? Math.max(k, 0.05) : 1;
    const left = p.ttl - p.age;
    if (left < 0.3) alpha *= clamp(left / 0.3, 0, 1);
    p.popScale = scale;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    if (scale !== 1) { ctx.translate(p.x, p.y); ctx.scale(scale, scale); ctx.translate(-p.x, -p.y); }
    this.drawDimBand(ctx, p.x, p.y, w, h);
    this.drawGlyphPlate(ctx, p.x, p.y, w, h, { state: p.locked ? "locked" : "power", shape: "capsule", flash: p.flash });

    const ix = p.x - w / 2 + CAPSULE_ICON_X;
    const iy = p.y;
    // dashed ring around the icon cell
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(rm ? 0 : this.starT * (Math.PI / 3));
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE.rgba(p.locked ? "lime" : "violet", 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // icon
    const icon = POWER_ICON[p.type] || POWER_ICON.SHIELD;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = PALETTE.rgba(accent, 0.92);
    ctx.fillStyle = PALETTE.rgba(accent, 0.92);
    icon(ctx);
    ctx.restore();

    // label, centred in the cell right of the divider
    const lx = p.x - w / 2 + CAPSULE_DIVIDER_X + 4 + p.textW / 2;
    const done = p.label.slice(0, p.progress);
    const remaining = p.label.slice(p.progress);
    this.drawSplitText(ctx, done, remaining, lx, p.y, {
      font,
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: p.locked ? PALETTE.rgba("lime", 0.92) : PALETTE.rgba("text", 0.92),
      leadColor: p.locked ? null : PALETTE.rgba("lime", 1),
      caret: !!p.locked,
      caretAlpha: this.caretAlpha()
    });
    ctx.restore();
  },

  drawEnemies(ctx) {
    const list = this.enemies;
    if (!list.length) return;
    const sorted = list.slice().sort((a, b) => b.x - a.x);
    let lockedEn = null;
    for (const en of sorted) {
      if (en.locked && !lockedEn) { lockedEn = en; continue; }
      this.drawEnemy(ctx, en);
    }
    if (lockedEn) this.drawEnemy(ctx, lockedEn);
  },

  // ------------------------- Dying plates (lifecycle ceremony, L12) -------------------------
  // Records a plate's last frame so it can leave with a ceremony after the entity is compacted away:
  // kill: white impact plate 1.25 -> 1 over 90 ms, then a .2 s fade; slam (contact leak): danger plate 90 ms with
  // the text struck through, then the fade; detonate: fade only; collect (capsule): scale 1 -> 1.3 + fade over .18 s.
  notePlateDeath(en, mode = "kill", at = null) {
    if (!en) return null;
    const list = this.dyingPlates || (this.dyingPlates = []);
    if (list.length >= DYING_PLATES_CAP) list.shift();
    const capsule = en.kind === "powerup";
    const h = en.plateH || (capsule ? CAPSULE_H : (typeof PLATE_H === "number" ? PLATE_H : 40));
    const text = capsule ? en.label : en.text;
    const rec = {
      mode,
      kind: en.kind,
      type: en.type || null,
      x: at && Number.isFinite(at.x) ? at.x : en.x,
      y: at && Number.isFinite(at.y) ? at.y : en.y,
      w: en.plateW || (text.length * 12 + 28),
      h,
      shape: capsule ? "capsule" : (text.length === 1 ? "chip" : "pill"),
      text,
      progress: en.progress | 0,
      font: capsule ? FONT.target(18, 600) : (en.kind === "bossMinion" ? this.plateGeometry().minionFont : this.plateGeometry().font),
      t: 0,
      life: mode === "collect" ? 0.18 : (mode === "detonate" ? DYING_FADE_S : IMPACT_FRAME_S + DYING_FADE_S)
    };
    list.push(rec);
    return rec;
  },

  drawDyingPlates(ctx) {
    const list = this.dyingPlates;
    if (!list || !list.length) return;
    const rm = !!this.reduceMotion;
    for (const d of list) {
      ctx.save();
      let scale = 1, alpha = 1;
      if (d.mode === "collect") {
        const k = clamp(d.t / d.life, 0, 1);
        scale = rm ? 1 : 1 + 0.3 * easeOutCubic(k);
        alpha = 1 - k;
        ctx.globalAlpha *= alpha;
        if (scale !== 1) { ctx.translate(d.x, d.y); ctx.scale(scale, scale); ctx.translate(-d.x, -d.y); }
        this.drawGlyphPlate(ctx, d.x, d.y, d.w, d.h, { state: "power", shape: "capsule" });
      } else if (d.mode === "detonate") {
        const k = clamp(d.t / d.life, 0, 1);
        alpha = 1 - k;
        scale = rm ? 1 : 1 - 0.15 * k;
        ctx.globalAlpha *= alpha;
        if (scale !== 1) { ctx.translate(d.x, d.y); ctx.scale(scale, scale); ctx.translate(-d.x, -d.y); }
        this.drawGlyphPlate(ctx, d.x, d.y, d.w, d.h, { state: d.kind === "bossMinion" ? "minion" : "idle", shape: d.shape });
      } else if (d.t < IMPACT_FRAME_S) {
        // impact frame: a solid plate (white for a kill, danger for a contact slam), 1.25 -> 1 over 90 ms
        const k = clamp(d.t / IMPACT_FRAME_S, 0, 1);
        scale = rm ? 1 : 1.25 - 0.25 * easeOutCubic(k);
        const slam = d.mode === "slam";
        if (scale !== 1) { ctx.translate(d.x, d.y); ctx.scale(scale, scale); ctx.translate(-d.x, -d.y); }
        const wb = Math.max(d.h, Math.ceil(d.w / PLATE_BUCKET) * PLATE_BUCKET);
        ctx.fillStyle = PALETTE.rgba(slam ? "danger" : "text", 0.92);
        ctx.strokeStyle = PALETTE.rgba(slam ? "danger" : "text", 1);
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        this.plateShapePath(ctx, d.shape, wb, d.h, d.x, d.y);
        ctx.fill();
        ctx.stroke();
        ctx.font = d.font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = PALETTE.rgba("bg0", 0.92);
        ctx.fillText(d.text, d.x, d.y);
        if (slam) {
          const tw = ctx.measureText(d.text).width;
          ctx.fillRect(d.x - tw / 2 - 2, d.y - 1.5, tw + 4, 3);
        }
      } else {
        const k = clamp((d.t - IMPACT_FRAME_S) / DYING_FADE_S, 0, 1);
        alpha = 1 - k;
        ctx.globalAlpha *= alpha;
        const state = d.mode === "slam" ? "danger" : (d.kind === "bossMinion" ? "minion" : "idle");
        this.drawGlyphPlate(ctx, d.x, d.y, d.w, d.h, { state, shape: d.shape });
      }
      ctx.restore();
    }
  },

  // ------------------------- Powerup label flight (VIS-05) -------------------------
  // A .flyLabel span rides from the capsule to its HUD chip (320 ms), inline-styled so it works before the shell's
  // CSS lands. Removed on transitionend / 420 ms, cancelled when the mode changes. None under reduce-motion.
  flyLabelToChip(text, x, y, type) {
    if (this.reduceMotion) return null;
    const main = document.getElementById("main");
    if (!main || !this.canvas) return null;
    const def = (typeof POWERUP_TYPES === "object" && POWERUP_TYPES[type]) || null;
    const label = def ? def.label : String(type || text).toLowerCase();
    const el = document.createElement("span");
    el.className = "flyLabel";
    el.dataset.type = label;
    el.textContent = String(text || label).toUpperCase();
    const st = el.style;
    st.position = "absolute";
    st.zIndex = "15";
    st.font = "600 12px " + (FONT.mono || "monospace");
    st.letterSpacing = ".1em";
    st.color = PALETTE.text;
    st.padding = "2px 8px";
    st.border = `1px solid ${PALETTE.violet}`;
    st.borderRadius = "999px";
    st.background = PALETTE.rgba("bg0", 0.92);
    st.pointerEvents = "none";
    st.whiteSpace = "nowrap";
    st.willChange = "transform, opacity";
    st.transform = "translate(-50%, -50%)";
    st.transition = "transform 320ms cubic-bezier(.16,1,.3,1), opacity 320ms linear";
    const cr = this.canvas.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const css = this.cssScale || (cr.width / this.w) || 1;
    const sx = cr.left - mr.left + x * css;
    const sy = cr.top - mr.top + y * css;
    st.left = `${sx}px`;
    st.top = `${sy}px`;
    main.appendChild(el);
    void el.offsetWidth;   // commit the start position before the transition
    const set = this._flyLabels || (this._flyLabels = new Set());
    set.add(el);
    const remove = () => { set.delete(el); if (el.parentNode) el.remove(); };
    el.addEventListener("transitionend", remove, { once: true });
    const timer = setTimeout(remove, 420);
    el._flyTimer = timer;
    requestAnimationFrame(() => {
      if (!el.parentNode) return;
      const chip = document.querySelector(`#hudChips .chip[data-type="${label}"]`) || document.getElementById("hudChips");
      let tx = sx, ty = sy - 80;
      if (chip) {
        const r = chip.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { tx = r.left - mr.left + r.width / 2; ty = r.top - mr.top + r.height / 2; }
      }
      st.transform = `translate(-50%, -50%) translate(${Math.round(tx - sx)}px, ${Math.round(ty - sy)}px) scale(.6)`;
      st.opacity = ".2";
    });
    this.watchModeForFlyLabels();
    return el;
  },

  cancelFlyLabels() {
    const set = this._flyLabels;
    if (!set) return;
    for (const el of set) { clearTimeout(el._flyTimer); if (el.parentNode) el.remove(); }
    set.clear();
  },

  // body[data-mode] is written by setMode (shell): any mode change cancels flights in progress.
  watchModeForFlyLabels() {
    if (this._flyModeObserver || typeof MutationObserver !== "function" || !document.body) return;
    const obs = new MutationObserver(() => this.cancelFlyLabels());
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });
    this._flyModeObserver = obs;
  },

  // ------------------------- Boss composition (VIS-07) -------------------------
  // Art box: x 688..w-16, y hudSafeTop+8(+float)..h-24. Fit by the manifest content box x .98, the trimmed sprite
  // anchored flush top-right so the sprite never leaves the box; the float moves the art down from that anchor.
  bossArtBox(level) {
    const key = "bosses/" + level;
    const meta = Assets.meta(key);
    const orig = (meta && meta.orig) || { w: 2816, h: 1536 };
    const content = (meta && (meta.content || meta.crop)) || { x: 0, y: 0, w: orig.w, h: orig.h };
    const top = (this.hudSafeTop || 112) + 8 + BOSS_FLOAT_PX;
    const box = { x: BOSS_BOX_LEFT, y: top, w: this.w - BOSS_BOX_RIGHT_PAD - BOSS_BOX_LEFT, h: Math.max(120, this.h - BOSS_BOX_BOTTOM_PAD - top) };
    const scale = Math.min(box.w / content.w, box.h / content.h) * 0.98;
    return { key, scale, artW: orig.w * scale, artH: orig.h * scale, box, content, orig };
  },

  // Everything the art needs this frame: untrimmed origin (ox, oy), sprite, artRect (trimmed sprite), contentRect
  // (opaque box), alpha. Includes the intro slide (x+320 over .9 s easeOutExpo; fade .4 s under reduce-motion), the
  // float sin(.8 t) * 12 and the +4 px hit kick.
  bossPlacement(boss) {
    const b = this.bossArtBox(boss.artLevel);
    const sp = Assets.sprite(b.key, b.artW);
    const rm = !!this.reduceMotion;
    const right = b.box.x + b.box.w;
    let ox = right - (sp.x + sp.w);
    let oy = b.box.y - sp.y;
    const floatY = rm ? 0 : Math.sin((boss.phaseT || 0) * 0.8) * BOSS_FLOAT_PX;
    let slide = 0, alpha = 1;
    const intro = this.bossIntro;
    if (intro && intro.locked) {
      const k = clamp(intro.t / BOSS_SLIDE_S, 0, 1);
      if (rm) alpha = clamp(intro.t / 0.4, 0, 1);
      else slide = BOSS_SLIDE_PX * (1 - easeOutExpo(k));
    }
    const kick = (!rm && boss.flash > 0.18) ? 4 : 0;
    ox += slide + kick;
    oy += floatY;
    const artRect = { x: ox + sp.x, y: oy + sp.y, w: sp.w, h: sp.h };
    const c = b.content;
    const contentRect = { x: ox + c.x * b.scale, y: oy + c.y * b.scale, w: c.w * b.scale, h: c.h * b.scale };
    return { box: b, sp, ox, oy, artRect, contentRect, alpha, slide };
  },

  // The trimmed sprite's rect in world space (Boss.artRect delegates here).
  bossArtRect(boss) {
    if (!boss) return null;
    return this.bossPlacement(boss).artRect;
  },

  getBossSprite(level) {
    const box = this.bossArtBox(level);
    return Assets.sprite(box.key, box.artW);
  },

  getBossArtForLevel(level) {
    if (!level) return null;
    return Assets.get("bosses/" + level);
  },

  // L6: boss art under the plates so minions never vanish behind it. Nothing else is drawn inside the art box but
  // the hit flash (additive copy at alpha flash * .5). Publishes boss.x/y (content centre) and boss.contentRect.
  drawBossArt(ctx, boss) {
    const p = this.bossPlacement(boss);
    boss.contentRect = p.contentRect;
    boss.x = p.contentRect.x + p.contentRect.w / 2;
    boss.y = p.contentRect.y + p.contentRect.h / 2;
    if (!p.sp.img) return;
    const r = p.artRect;
    ctx.save();
    if (p.alpha < 1) ctx.globalAlpha *= p.alpha;
    ctx.drawImage(p.sp.img, r.x, r.y, r.w, r.h);
    if (boss.flash > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = p.alpha * clamp(boss.flash * 0.5, 0, 0.5);
      ctx.drawImage(p.sp.img, r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  },

  // L10: console slab (cached glow) bottom-left: name + SEG/PHASE (left cell), current segment with the next one
  // dimmed beneath (centre cell); the right cell is the hazard meter's (drawBossHazardMeter at bossHazardRect()).
  // During the intro it scales .6 -> 1 (easeOutBack) over the last .5 s; before that it is not drawn.
  drawBossSlab(ctx, boss) {
    const s = boss.slabRect;
    const rm = !!this.reduceMotion;
    const intro = this.bossIntro;
    let scale = 1, alpha = 1;
    if (intro && intro.locked) {
      if (intro.t < BOSS_SLAB_IN_AT) return;
      const k = clamp((intro.t - BOSS_SLAB_IN_AT) / (intro.dur - BOSS_SLAB_IN_AT), 0, 1);
      if (rm) alpha = k; else scale = 0.6 + 0.4 * easeOutBack(k);
    }
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
    this.drawGlowSprite(ctx, this.getPlateSprite("slab", s.w, s.h, "boss"), cx, cy);
    if (boss.flash > 0) {
      ctx.strokeStyle = PALETTE.rgba("text", clamp(boss.flash * 2, 0, 0.70));
      ctx.lineWidth = 2;
      roundRect(ctx, s.x, s.y, s.w, s.h, SLAB.r);
      ctx.stroke();
    }

    // left cell: name (Orbitron 13, tracked .2em, fit 184) + SEG k/N + PHASE p/n
    const lx = s.x + SLAB.pad;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = FONT.display(13, 600);
    fitTracked(ctx, boss.name, SLAB.leftW - 16, 0.2, 9, 1, (px) => FONT.display(px, 600));
    ctx.fillStyle = PALETTE.rgba("magenta", 0.92);
    drawTracked(ctx, boss.name, lx, s.y + 14, 0.2);
    const n = boss.segments.length;
    const phases = boss.phaseStarts.length;
    ctx.font = FONT.target(12, 600);
    ctx.fillStyle = PALETTE.rgba("text", 0.45);
    ctx.fillText(`SEG ${Math.min(boss.segmentIndex + 1, n)}/${n}`, lx, s.y + 44);
    ctx.fillText(`PHASE ${Math.min(boss.phase + 1, phases)}/${phases}`, lx, s.y + 64);

    // centre cell: current segment (mono 40/700, fit 300) + next segment dimmed beneath
    const ccx = s.x + SLAB.pad + SLAB.leftW + SLAB.centreW / 2;
    const seg = boss.segment || "";
    const done = seg.slice(0, boss.progress);
    const rem = seg.slice(boss.progress);
    ctx.font = FONT.target(40, 700);
    fitText(ctx, seg, SLAB.centreW - 24, 26, 2, (px) => FONT.target(px, 700));
    const segFont = ctx.font;
    this.drawSplitText(ctx, done, rem, ccx, s.y + 38, {
      font: segFont,
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: PALETTE.rgba("lime", 0.92),
      caret: true,
      caretAlpha: this.caretAlpha()
    });
    const next = boss.nextSegment;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT.target(14, 600);
    ctx.fillStyle = PALETTE.rgba("text", next ? 0.45 : 0.25);
    ctx.fillText(next ? `NEXT  ${next}` : "FINAL SEGMENT", ccx, s.y + 78);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  },

  drawBoss(ctx, boss) {
    this.drawBossArt(ctx, boss);
    this.drawBossSlab(ctx, boss);
  },

  // Finale (VIS-07 / JUICE-10): the art stays in its fight slot, jitters +-4 px for the first 1.6 s, then from the
  // bossKill crack (.4 s) dissolves over 1.2 s: alpha 1 -> 0 easeInOutCubic, scale 1 -> 1.08, additive white at
  // the start of the dissolve. bossDissolve = { t, dur, start } until it is done, then null.
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
    ctx.drawImage(sp.img, -r.w / 2, -r.h / 2, r.w, r.h);
    const flashK = (t - d.start) / d.dur;
    if (flashK >= 0 && flashK < 0.15 && !rm) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.8 * (1 - flashK / 0.15);
      ctx.drawImage(sp.img, -r.w / 2, -r.h / 2, r.w, r.h);
    }
    ctx.restore();
  },

  // ------------------------- Frame -------------------------
  render(dt) {
    const ctx = this.ctx;
    const s = this.renderScale || 1;
    // Shake transform: D1 (80-fx.js) supplies shakeOffset() -> {x, y, rot}; until then the A2 integer random offset.
    const sh = (typeof this.shakeOffset === "function") ? this.shakeOffset() : null;
    const amp = 18 * this.trauma * this.trauma;
    const sx = sh ? sh.x : (amp >= 0.5 ? Math.round(rand(-amp, amp)) : 0);
    const sy = sh ? sh.y : (amp >= 0.5 ? Math.round(rand(-amp, amp)) : 0);
    const rot = sh ? (sh.rot || 0) : 0;
    this.shakeNow = { x: sx, y: sy, rot };

    // L0: opaque base fill under identity over the whole backing store (covers the shake margin), then the
    // logical-space transform. No clearRect: the context is opaque.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bg0;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.save();
    ctx.translate(sx, sy);
    if (rot) { ctx.translate(this.w / 2, this.h / 2); ctx.rotate(rot); ctx.translate(-this.w / 2, -this.h / 2); }

    this.drawBackground(ctx);                                  // L1
    this.drawStars(ctx);                                       // L2
    this.drawForegroundParallax(ctx);                          // L3
    this.drawThemeFx(ctx);                                     // L4 (storm tint / lightning)
    this.drawLaneRails(ctx);                                   // L5
    const boss = (this.inBoss && this.boss) ? this.boss : null;
    if (boss) this.drawBossArt(ctx, boss);                     // L6
    else if (this.bossClear && this.bossDissolve) this.drawBossDissolve(ctx);
    if (typeof this.drawMuzzleFlashes === "function") this.drawMuzzleFlashes(ctx); // L7 (D2, optional)
    this.drawBullets(ctx);                                     // L7
    for (const p of this.powerups) this.drawPowerup(ctx, p);   // L8
    this.drawEnemies(ctx);                                     // L9 (far to near, locked last)
    if (boss) this.drawBossSlab(ctx, boss);                    // L10
    if (boss && typeof this.drawBossHazardMeter === "function") this.drawBossHazardMeter(ctx, this.bossHazardRect()); // L10 surge cell
    this.drawShip(ctx);                                        // L11
    this.drawExplosionSprites(ctx);                            // L12
    this.drawDyingPlates(ctx);
    this.drawParticles(ctx);
    if (typeof this.drawRings === "function") this.drawRings(ctx);     // L12 additive batch (D2, optional hooks)
    if (typeof this.drawBolts === "function") this.drawBolts(ctx);
    if (typeof this.drawDebris === "function") this.drawDebris(ctx);
    if (typeof this.drawFloaters === "function") this.drawFloaters(ctx); // L13 (D5)
    this.drawWorldOverlays(ctx);                               // L14
    ctx.restore();

    // L15: banners / callouts / letterbox / sector card, unshaken (45-feedback.js)
    if (typeof this.drawBanner === "function") this.drawBanner(ctx);
    if (typeof this.redrawActiveTarget === "function") this.redrawActiveTarget(ctx); // L16 (D1): locked plate over a centre banner; uses this.shakeNow / this.bannerRect

    this.drawVignette(ctx);                                    // L17
  },
});

// Boss.artRect (B-14): defined here unless the Boss class already carries one (it does since D6; kept as a guard).
if (typeof Boss === "function" && !Object.getOwnPropertyDescriptor(Boss.prototype, "artRect")) {
  Object.defineProperty(Boss.prototype, "artRect", {
    configurable: true,
    get() {
      const g = (typeof game !== "undefined" && game) || (typeof window !== "undefined" && window.game) || null;
      if (g && typeof g.bossArtRect === "function") return g.bossArtRect(this);
      const scale = Math.min(576 / 2816, 576 / 1536);
      const artW = 2816 * scale, artH = 1536 * scale;
      return { x: 1264 - artW, y: 120, w: artW, h: artH };
    }
  });
}
