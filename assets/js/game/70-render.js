// Type-R 198X — canvas rendering: resizeCanvas, render(dt) in the CONTRACT section 8 layer order, every draw*
// method, the glow-sprite cache and the starfield. Methods are mixed into Game.prototype; load order is defined
// in index.html.
//
// Performance rules (CONTRACT section 3 / PLAN A11): no shadowBlur or filter in the per-frame path (glows are
// baked once into sprites by makeGlowSprite/getPlateSprite), no translucent full-frame fill above alpha .12,
// parallax from the loader's pre-scaled bitmaps drawn 1:1 at integer device x, stars batched by alpha bucket,
// the vignette cached per resize. Drawables are read through Assets.get()/Assets.sprite() every frame.

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
const STAR_ALPHAS = [0.9, 0.68, 0.46, 0.25];
const STAR_COLORS = STAR_ALPHAS.map((a) => PALETTE.rgba("text", a));

// Plate signature per state (VIS-04 colours; D3 refines the geometry). Glow is baked into the cached sprite.
const PLATE_STYLES = {
  idle:   { stroke: "cyan",    strokeA: 0.92, lw: 2.5, glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  locked: { stroke: "lime",    strokeA: 1.0,  lw: 3,   glowA: 0.70, blur: 14, fill: "bg0", fillA: 0.92 },
  danger: { stroke: "danger",  strokeA: 0.92, lw: 2.5, glowA: 0.70, blur: 14, fill: "bg0", fillA: 0.92 },
  minion: { stroke: "magenta", strokeA: 0.92, lw: 2.5, glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  power:  { stroke: "violet",  strokeA: 0.92, lw: 2.5, glowA: 0.45, blur: 14, fill: "bg0", fillA: 0.92 },
  boss:   { stroke: "magenta", strokeA: 0.55, lw: 3,   glowA: 0.20, blur: 26, fill: "bg1", fillA: 0.92 }
};
const PLATE_CACHE_MAX = 96;
const PLATE_BUCKET = 8;
const GLOW_PAD = 16;
const SLAB_PAD = 32;
const SLAB_W = 520;
const SLAB_H = 190;
const SHIP_DRAW_W = 150;          // 168 in D4
const VISTA_DRIFT_PX = 20;        // tenth-sector foreground drift amplitude

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

  // LRU (cap 96) of plate sprites keyed by shape, width bucket (8 px), height, state and spriteEpoch.
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
    const r = shape === "slab" ? 24 : shape === "chip" ? 10 : 12;
    sprite = this.makeGlowSprite((g, w, hh) => {
      g.shadowBlur = style.blur;
      g.shadowColor = PALETTE.rgba(style.stroke, style.glowA);
      g.fillStyle = PALETTE.rgba(style.fill, style.fillA);
      g.strokeStyle = PALETTE.rgba(style.stroke, style.strokeA);
      g.lineWidth = style.lw;
      roundRect(g, 0, 0, w, hh, r);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      // inner top highlight
      g.strokeStyle = PALETTE.rgba("text", 0.12);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(r, 1.5);
      g.lineTo(w - r, 1.5);
      g.stroke();
      if (shape === "slab") {
        // chrome divider under the boss name
        g.globalAlpha = 0.35;
        g.strokeStyle = PALETTE.rgba("cyan", 0.35);
        g.beginPath();
        g.moveTo(20, 56);
        g.lineTo(w - 20, 56);
        g.stroke();
        g.globalAlpha = 1;
      }
    }, wBucket, h, pad);
    cache.set(key, sprite);
    while (cache.size > PLATE_CACHE_MAX) cache.delete(cache.keys().next().value);
    return sprite;
  },

  // Plate = cached glow sprite + dynamic parts (danger pulse, hit flash, lock brackets); no shadows per frame.
  drawGlyphPlate(ctx, x, y, w, h, state, flash, opts = {}) {
    const shape = opts.shape || (w <= h + 1 ? "chip" : "pill");
    const wBucket = Math.ceil(w / PLATE_BUCKET) * PLATE_BUCKET;
    if (state === "danger") {
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, "idle"), x, y);
      const pulse = this.reduceMotion ? 0.70 : 0.45 + 0.45 * Math.sin(this.starT * Math.PI * 6);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(pulse, 0, 1);
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, "danger"), x, y);
      ctx.globalAlpha = prev;
    } else {
      this.drawGlowSprite(ctx, this.getPlateSprite(shape, wBucket, h, state), x, y);
    }
    const pw = wBucket;
    const r = shape === "chip" ? 10 : 12;
    if (flash > 0) {
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * clamp(flash * 2, 0, 0.45);
      ctx.fillStyle = PALETTE.rgba("text", 0.45);
      roundRect(ctx, x - pw / 2, y - h / 2, pw, h, r);
      ctx.fill();
      ctx.globalAlpha = prev;
    }
    if (state === "locked") {
      ctx.strokeStyle = PALETTE.rgba("lime", 0.92);
      ctx.lineWidth = 2;
      bracketRect(ctx, x - pw / 2 - 6, y - h / 2 - 6, pw + 12, h + 12, 10);
    }
  },

  // Bakes every plate sprite a sector can need (word lengths, powerup labels, minion chip, boss slab) in idle
  // slices while the sector art loads, so the per-frame path never sets shadowBlur during a wave (A11).
  warmPlateCache(levelIndex) {
    const cfg = LEVELS[levelIndex];
    if (!cfg) return;
    const ctx = this.ctx;
    const epoch = this.spriteEpoch;
    const plateH = typeof PLATE_H === "number" ? PLATE_H : 40;
    const minionH = typeof PLATE_H_MINION === "number" ? PLATE_H_MINION : 36;
    const bucket = (w) => Math.ceil(w / PLATE_BUCKET) * PLATE_BUCKET;
    const jobs = [];
    const seen = new Set();
    const add = (shape, wb, h, state) => {
      const k = `${shape}:${wb}:${h}:${state}`;
      if (seen.has(k)) return;
      seen.add(k);
      jobs.push([shape, wb, h, state]);
    };
    const fontPx = this.plateFontPx();
    const font = FONT.target(fontPx, 600);
    const h = Math.round(plateH * (fontPx / 22));
    ctx.font = font;
    const maxLen = clamp((cfg.wordMax || 8) + 3, 4, 14);
    for (let len = 1; len <= maxLen; len++) {
      const tw = ctx.measureText("m".repeat(len)).width;
      const w = len === 1 ? h : Math.ceil(tw + 28);
      for (const state of ["idle", "locked", "danger"]) add(len === 1 ? "chip" : "pill", bucket(w), h, state);
    }
    ctx.font = FONT.target(18, 600);
    for (const label of ["spread", "pierce", "rapid", "shield", "multi", "heal"]) {
      const w = Math.max(Math.ceil(ctx.measureText(label).width + 28), plateH);
      add("pill", bucket(w), plateH, "power");
      add("pill", bucket(w), plateH, "locked");
    }
    const mh = Math.round(minionH * (20 / 22));
    add("chip", bucket(mh), mh, "minion");
    add("chip", bucket(mh), mh, "locked");
    add("slab", SLAB_W, SLAB_H, "boss");

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
    // 22 px on desktop scales; grows up to 28 px when the playfield is small (14 CSS px minimum on screen).
    return clamp(Math.ceil(14 / (this.cssScale || 1)), 22, 28);
  },

  // Text metrics cached on the entity (keyed by font + string + spriteEpoch); publishes textW / plateW / plateH.
  measurePlateText(ctx, en, text, font, h) {
    if (en._textWEpoch !== this.spriteEpoch || en._textWFont !== font || en._textWStr !== text) {
      ctx.font = font;
      en._textW = ctx.measureText(text).width;
      en._textWEpoch = this.spriteEpoch;
      en._textWFont = font;
      en._textWStr = text;
    }
    en.textW = en._textW;
    const chip = text.length === 1;
    en.plateW = chip ? h : Math.ceil(en._textW + (en.kind === "bossMinion" ? 24 : 28));
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
        bucket: clamp(Math.floor(z * 4), 0, 3)
      });
    }
    return stars;
  },

  // dt-driven drift; called from stepAmbient (playing + ambient screens).
  updateStars(dt) {
    const w = this.w, h = this.h;
    for (const s of this.stars) {
      const spd = lerp(30, 140, 1 - s.z);
      s.x -= spd * dt;
      if (s.x < -5) {
        s.x = w + rand(0, 80);
        s.y = rand(0, h);
        s.z = Math.random();
        s.bucket = clamp(Math.floor(s.z * 4), 0, 3);
      }
    }
  },

  // Four fillStyle sets per frame; integer coordinates keep the dots crisp at every renderScale.
  drawStars(ctx) {
    const stars = this.stars;
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = STAR_COLORS[b];
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        if (s.bucket !== b) continue;
        const sz = s.s >= 1.5 ? 2 : 1;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
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

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PALETTE.rgba("magenta", 0.45);
    const cW = 34;
    for (let x = 0; x < this.w + cW; x += 140) {
      const xx = x - (t % 140);
      ctx.beginPath();
      ctx.moveTo(xx, trackY + 18);
      ctx.lineTo(xx + 14, trackY + 10);
      ctx.lineTo(xx + 28, trackY + 18);
      ctx.lineTo(xx + 20, trackY + 20);
      ctx.lineTo(xx + 14, trackY + 16);
      ctx.lineTo(xx + 8, trackY + 20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

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

  // ------------------------- Plates -------------------------
  enemyState(en) {
    if (en.locked) return "locked";
    if (en.kind === "bossMinion") return "minion";
    const dangerX = (typeof DANGER_X === "number" ? DANGER_X : 0.35) * this.w;
    return en.x < dangerX ? "danger" : "idle";
  },

  drawEnemy(ctx, en) {
    const minion = en.kind === "bossMinion";
    const fontPx = minion ? 20 : this.plateFontPx();
    const font = FONT.target(fontPx, 600);
    const baseH = minion ? (typeof PLATE_H_MINION === "number" ? PLATE_H_MINION : 36) : (typeof PLATE_H === "number" ? PLATE_H : 40);
    const h = Math.round(baseH * (fontPx / 22));
    this.measurePlateText(ctx, en, en.text, font, h);
    const state = this.enemyState(en);
    const w = en.plateW;

    this.drawGlyphPlate(ctx, en.x, en.y, w, h, state, en.flash, { shape: en.text.length === 1 ? "chip" : "pill" });

    const done = en.text.slice(0, en.progress);
    const remaining = en.text.slice(en.progress);
    const locked = state === "locked";
    this.drawSplitText(ctx, done, remaining, en.x, en.y, {
      font,
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: locked ? PALETTE.rgba("lime", 0.92) : PALETTE.rgba("text", 0.92),
      leadColor: locked ? null : PALETTE.rgba("lime", 1),
      caret: locked,
      caretAlpha: this.caretAlpha()
    });
    this.lastPlateDrawn = en;
  },

  drawPowerup(ctx, p) {
    const font = FONT.target(18, 600);
    const h = typeof PLATE_H === "number" ? PLATE_H : 40;
    this.measurePlateText(ctx, p, p.label, font, h);
    p.labelW = p.textW;
    const w = Math.max(p.plateW, h);
    this.drawGlyphPlate(ctx, p.x, p.y, w, h, p.locked ? "locked" : "power", 0, { shape: "pill" });
    const done = p.label.slice(0, p.progress);
    const remaining = p.label.slice(p.progress);
    this.drawSplitText(ctx, done, remaining, p.x, p.y, {
      font,
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: p.locked ? PALETTE.rgba("lime", 0.92) : PALETTE.rgba("violet", 0.92),
      leadColor: p.locked ? null : PALETTE.rgba("lime", 1),
      caret: !!p.locked,
      caretAlpha: this.caretAlpha()
    });
  },

  // ------------------------- Boss -------------------------
  // Pre-D6 art box: scale = min(.65h / orig.h, .7); the art's top-left sits at (boss.x - .35 artW, boss.y - .45 artH).
  bossArtBox(level) {
    const key = "bosses/" + level;
    const meta = Assets.meta(key);
    const orig = (meta && meta.orig) || { w: 2816, h: 1536 };
    const scale = Math.min((this.h * 0.65) / orig.h, 0.7);
    return { key, scale, artW: orig.w * scale, artH: orig.h * scale };
  },

  // The trimmed sprite's rect in world space (Boss.artRect reads this until D6 recomposes the boss).
  bossArtRect(boss) {
    if (!boss) return null;
    const box = this.bossArtBox(boss.artLevel);
    const sp = Assets.sprite(box.key, box.artW);
    const ox = boss.x - box.artW * 0.35;
    const oy = boss.y - box.artH * 0.45;
    return { x: ox + sp.x, y: oy + sp.y, w: sp.w, h: sp.h };
  },

  getBossArtForLevel(level) {
    if (!level) return null;
    return Assets.get("bosses/" + level);
  },

  // L6: boss art under the plates so minions never vanish behind it.
  drawBossArt(ctx, boss) {
    const box = this.bossArtBox(boss.artLevel);
    const sp = Assets.sprite(box.key, box.artW);
    if (!sp.img) return;
    const ox = boss.x - box.artW * 0.35;
    const oy = boss.y - box.artH * 0.45;
    ctx.drawImage(sp.img, ox + sp.x, oy + sp.y, sp.w, sp.h);
  },

  // L10: console slab (cached glow), name, segment text, segment dots.
  drawBossSlab(ctx, boss) {
    const x = boss.x;
    const y = boss.y;
    const w = SLAB_W;
    const h = SLAB_H;
    this.drawGlowSprite(ctx, this.getPlateSprite("slab", w, h, "boss"), x, y);
    if (boss.flash > 0) {
      ctx.strokeStyle = PALETTE.rgba("text", 0.70);
      ctx.lineWidth = 3;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 24);
      ctx.stroke();
    }

    // name
    ctx.font = FONT.display(14, 600);
    ctx.fillStyle = PALETTE.rgba("cyan", 0.92);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    drawTracked(ctx, boss.name, x - w / 2 + 22, y - h / 2 + 16, 0.12);

    // segment prompt
    const seg = boss.segment || "";
    const done = seg.slice(0, boss.progress);
    const rem = seg.slice(boss.progress);
    this.drawSplitText(ctx, done, rem, x, y + 18, {
      font: FONT.target(40, 700),
      doneColor: PALETTE.rgba("text", 0.45),
      remColor: PALETTE.rgba("lime", 0.92),
      caret: true,
      caretAlpha: this.caretAlpha()
    });

    // segment dots (B7 / C3 replace with the scalable meter)
    const n = boss.segments.length;
    const step = Math.min(18, (w - 52) / Math.max(1, n - 1));
    for (let i = 0; i < n; i++) {
      const cx = x - w / 2 + 26 + i * step;
      const cy = y + h / 2 - 22;
      ctx.fillStyle = i < boss.segmentIndex ? PALETTE.rgba("lime", 0.92) : PALETTE.rgba("text", 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textBaseline = "alphabetic";
  },

  drawBoss(ctx, boss) {
    this.drawBossArt(ctx, boss);
    this.drawBossSlab(ctx, boss);
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

  // ------------------------- Finale / intro text (B3, B8, D5 route these through showBanner) -------------------------
  drawBossClearBackdrop(ctx) {
    ctx.save();
    const t = this.bossClear?.t || 0;
    const alpha = clamp(0.35 + t * 0.25, 0, 0.85);
    ctx.fillStyle = PALETTE.rgba("bg2", alpha * 0.5);
    ctx.fillRect(0, this.h * 0.35, this.w, this.h * 0.3);

    const level = this.bossClear?.level;
    if (level) {
      const key = "bosses/" + level;
      const meta = Assets.meta(key);
      const orig = (meta && meta.orig) || { w: 2816, h: 1536 };
      const targetH = this.h * 0.5;
      const targetW = orig.w * (targetH / orig.h);
      const sp = Assets.sprite(key, targetW);
      if (sp.img) ctx.drawImage(sp.img, (this.w - targetW) / 2 + sp.x, this.h * 0.25 + sp.y, sp.w, sp.h);
    }
    ctx.restore();
  },

  // Minimal sector card while the level gate is closed (D7 brings the warp-in ceremony).
  drawLevelIntro(ctx) {
    const cfg = LEVELS[this.levelIndex];
    if (!cfg) return;
    ctx.save();
    ctx.fillStyle = PALETTE.rgba("bg0", 0.45);
    ctx.fillRect(0, this.h * 0.38, this.w, this.h * 0.24);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.rgba("accent", 0.92);
    ctx.font = FONT.display(52, 800);
    drawTracked(ctx, `SECTOR ${String(cfg.level).padStart(2, "0")}`, this.w / 2, this.h * 0.47, 0.12);
    ctx.fillStyle = PALETTE.rgba("text", 0.70);
    ctx.font = FONT.target(18, 600);
    drawTracked(ctx, this.levelReady ? "WARP-IN" : "SPOOLING SECTOR ART…", this.w / 2, this.h * 0.56, 0.2);
    ctx.restore();
  },

  // ------------------------- Frame -------------------------
  render(dt) {
    const ctx = this.ctx;
    const s = this.renderScale || 1;
    // Shake transform: integer random offset with amplitude from trauma (D1 replaces this with smooth noise).
    const amp = 18 * this.trauma * this.trauma;
    const sx = amp >= 0.5 ? Math.round(rand(-amp, amp)) : 0;
    const sy = amp >= 0.5 ? Math.round(rand(-amp, amp)) : 0;

    // L0: opaque base fill under identity over the whole backing store (covers the shake margin), then the
    // logical-space transform. No clearRect: the context is opaque.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bg0;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.save();
    ctx.translate(sx, sy);

    this.drawBackground(ctx);                                  // L1
    this.drawStars(ctx);                                       // L2
    this.drawForegroundParallax(ctx);                          // L3
    if (typeof this.drawThemeFx === "function") this.drawThemeFx(ctx);   // L4 (D7)
    if (typeof this.drawLaneRails === "function") this.drawLaneRails(ctx); // L5 (D3)
    const boss = (this.inBoss && this.boss) ? this.boss : null;
    if (boss) this.drawBossArt(ctx, boss);                     // L6
    this.drawBullets(ctx);                                     // L7
    for (const p of this.powerups) this.drawPowerup(ctx, p);   // L8
    this.drawEnemies(ctx);                                     // L9 (far to near, locked last)
    if (boss) this.drawBossSlab(ctx, boss);                    // L10
    if (boss && typeof this.drawBossHazardMeter === "function") this.drawBossHazardMeter(ctx, this.bossHazardRect()); // L10 surge cell
    this.drawShip(ctx);                                        // L11
    if (this.bossClear) this.drawBossClearBackdrop(ctx);
    this.drawExplosionSprites(ctx);                            // L12
    this.drawParticles(ctx);
    if (typeof this.drawFloaters === "function") this.drawFloaters(ctx); // L13 (D5)
    this.drawWorldOverlays(ctx);                               // L14
    ctx.restore();

    // L15: banners / cards, unshaken (boss intro / clear copy is a banner now, see 45-feedback.js)
    if (typeof this.drawBanner === "function") this.drawBanner(ctx);
    if (this.mode === "playing" && !this.isLevelGateOpen()) this.drawLevelIntro(ctx);

    this.drawVignette(ctx);                                    // L17
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
});

// Boss.artRect (B-14): the pre-D6 art box, so minions can spawn at artRect.x - 40 before D6 recomposes the boss.
// Defined here (the render track owns the geometry) unless the Boss class already carries one.
if (typeof Boss === "function" && !Object.getOwnPropertyDescriptor(Boss.prototype, "artRect")) {
  Object.defineProperty(Boss.prototype, "artRect", {
    configurable: true,
    get() {
      const g = (typeof game !== "undefined" && game) || (typeof window !== "undefined" && window.game) || null;
      if (g && typeof g.bossArtRect === "function") return g.bossArtRect(this);
      const scale = Math.min(720 * 0.65 / 1536, 0.7);
      const artW = 2816 * scale, artH = 1536 * scale;
      return { x: this.x - artW * 0.35, y: this.y - artH * 0.45, w: artW, h: artH };
    }
  });
}
