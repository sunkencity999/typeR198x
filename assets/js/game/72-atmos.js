// Type-R 198X — ATMOS (presentation): the world art's integration layer. Methods are mixed into Game.prototype; load
// order is defined in index.html (after 70-render.js, which calls atmosTile from drawBackground / drawForegroundParallax).
//
// 1. Seam dissolve. No backdrop master wraps (left/right edge mismatch 17-62 of 255 across the ten PNGs), so edge-to-
//    edge tiling showed a hard vertical cut scrolling across the field every tile width. Each parallax tile is now
//    baked once into an offscreen canvas whose first ATMOS.overlapFrac of width fades in (destination-in ramp), and
//    drawTiledImage lays tiles with that overlap: the wrap is a soft dissolve of the two edges instead of a cut. The
//    untiled vistas (tileFg === false) fade both side edges instead, so their rocks no longer end in a vertical line.
// 2. Sector grade. The same bake applies a per-sector multiply tint, a saturation pull and a lane haze band to the
//    background (and a lighter tint to the foreground), so the painted world sits behind the play layer: plates,
//    beams and the ship read first. A grade may carry a hue shift (hue / hueA, fgHue / fgHueA) for a sector that
//    shares another sector's art; since the generated vistas (tools/art/gen_vista.py) every sector has its own.
// 3. Cost. Nothing per frame beyond the tile draws 70-render.js already made (one more tile at most, for the overlap).
//    The bake (one drawImage + four full fills per tile) runs at sectorStart when the drawables are resident, else from
//    an idle callback the first time a tile is asked for; until then the raw bitmap draws as before. Cache: four tiles,
//    keyed by drawable identity (the loader re-prepares on a >10 % resize) and sector.
//
// Canvas blend modes used at bake time only: "multiply", "saturation", "hue", "destination-in" (all browsers since 2015).

const ATMOS = {
  overlapFrac: 0.16,       // share of a background tile's width that dissolves over the previous tile
  fgOverlapFrac: 0.18,     // foreground tiles are narrower, so a slightly wider share
  hazeTop: 140,            // lane haze band, logical y (LANE_YS run 184..524 on the 720 canvas)
  hazeMid: 354,
  hazeBottom: 580,
  cacheMax: 4
};

// Per sector (levelIndex 0..9). tint/tintA: multiply tint; sat: saturation pull (0..1); hue/hueA: hue shift toward a
// colour (storm variants); haze: lane band alpha (bg0); fgTintA/fgSat: the foreground's lighter grade.
const ATMOS_GRADES = [
  { tint: "#2A1E5A", tintA: 0.40, sat: 0.30, haze: 0.22, fgTintA: 0.18, fgSat: 0.14 },                          // S1 station 404: cream -> cool neon
  { tint: "#1A1A44", tintA: 0.30, sat: 0.18, haze: 0.18, fgTintA: 0.14, fgSat: 0.10 },                          // S2 belt
  { tint: "#160F3A", tintA: 0.34, sat: 0.18, haze: 0.20, fgTintA: 0.14, fgSat: 0.10 },                          // S3 nebula
  { tint: "#15123A", tintA: 0.30, sat: 0.14, haze: 0.18, fgTintA: 0.14, fgSat: 0.08 },                          // S4 grid
  { tint: "#101A3A", tintA: 0.30, sat: 0.12, haze: 0.18, fgTintA: 0.12, fgSat: 0.08 },                          // S5 field
  { tint: "#0B2030", tintA: 0.22, sat: 0.06, haze: 0.16, fgTintA: 0.10, fgSat: 0.04 },                          // S6 Abyssal Relay (generated vista)
  { tint: "#20163F", tintA: 0.40, sat: 0.28, haze: 0.20, fgTintA: 0.18, fgSat: 0.14 },                          // S7 refinery: cream -> cool
  { tint: "#1E1210", tintA: 0.20, sat: 0.04, haze: 0.14, fgTintA: 0.08, fgSat: 0.04 },                          // S8 Logic Foundry (generated vista)
  { tint: "#1A0A18", tintA: 0.22, sat: 0.06, haze: 0.16, fgTintA: 0.10, fgSat: 0.04 },                          // S9 Night Engine (generated vista)
  { tint: "#1A1040", tintA: 0.26, sat: 0.08, haze: 0.16, fgTintA: 0.10, fgSat: 0.06 }                           // S10 rune city
];

function atmosRgba(hex, a) {
  const h = String(hex || "#000000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

Object.assign(Game.prototype, {
  atmosGrade(levelIndex = this.levelIndex) {
    const i = clamp(levelIndex | 0, 0, ATMOS_GRADES.length - 1);
    return ATMOS_GRADES[i];
  },

  atmosCache() {
    return this._atmos || (this._atmos = { tiles: new Map(), pending: new Set() });
  },

  // The baked tile for kind ("bg" | "fg") / art when ready: { canvas, w, h, overlapFrac }. Null while the drawable is
  // not resident or the bake is still scheduled (callers draw the raw drawable). opts.edges: "left" (tiled, default)
  // or "both" (an untiled vista), "none" (no fade).
  atmosTile(kind, art, src, opts = {}) {
    if (!src || !art) return null;
    const w = src.width || src.naturalWidth || 0, h = src.height || src.naturalHeight || 0;
    if (!(w > 0 && h > 0)) return null;
    if (typeof src.complete === "boolean" && !src.complete) return null;
    const cache = this.atmosCache();
    const key = kind + "/" + art;
    const grade = this.atmosGrade();
    const hit = cache.tiles.get(key);
    if (hit && hit.src === src && hit.grade === grade && hit.edges === (opts.edges || "left")) { hit.used = nowMs(); return hit; }
    if (opts.sync) return this.atmosBake(kind, art, src, grade, opts);
    if (!cache.pending.has(key)) {
      cache.pending.add(key);
      const run = () => { cache.pending.delete(key); try { this.atmosBake(kind, art, src, grade, opts); } catch (_) { /* a tainted or closed drawable: raw draws continue */ } };
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 120 }); else setTimeout(run, 0);
    }
    return null;
  },

  atmosBake(kind, art, src, grade, opts = {}) {
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const edges = opts.edges || "left";
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    g.drawImage(src, 0, 0, w, h);
    const isBg = kind === "bg";
    const sat = isBg ? grade.sat : grade.fgSat;
    const hue = isBg ? grade.hue : grade.fgHue;
    const hueA = isBg ? grade.hueA : grade.fgHueA;
    const tintA = isBg ? grade.tintA : grade.fgTintA;
    // Grade (bake-time blend fills; the alpha is restored below for layers with transparency).
    if (sat > 0) {
      g.globalCompositeOperation = "saturation";
      g.fillStyle = `rgba(128,128,128,${sat})`;
      g.fillRect(0, 0, w, h);
    }
    if (hue && hueA > 0) {
      g.globalCompositeOperation = "hue";
      g.fillStyle = atmosRgba(hue, hueA);
      g.fillRect(0, 0, w, h);
    }
    if (tintA > 0) {
      g.globalCompositeOperation = "multiply";
      g.fillStyle = atmosRgba(grade.tint, tintA);
      g.fillRect(0, 0, w, h);
    }
    if (isBg && grade.haze > 0) {
      // Lane haze: a soft bg0 band where the plates fly. The tile spans logical [-SHAKE_PAD, h + SHAKE_PAD].
      const r = h / (720 + 2 * SHAKE_PAD);
      const y0 = (ATMOS.hazeTop + SHAKE_PAD) * r, y1 = (ATMOS.hazeMid + SHAKE_PAD) * r, y2 = (ATMOS.hazeBottom + SHAKE_PAD) * r;
      const grad = g.createLinearGradient(0, y0, 0, y2);
      grad.addColorStop(0, PALETTE.rgba("bg0", 0));
      grad.addColorStop(clamp((y1 - y0) / Math.max(1, y2 - y0), 0.01, 0.99), PALETTE.rgba("bg0", grade.haze));
      grad.addColorStop(1, PALETTE.rgba("bg0", 0));
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = grad;
      g.fillRect(0, y0, w, y2 - y0);
    }
    // The blend fills above also paint into a layer's transparent pixels (canvas blend modes composite source-over
    // where the backdrop is clear), so a foreground's empty sky would carry a faint tint band: multiply the alpha back by
    // the source's own alpha. A no-op for the opaque backgrounds.
    if (!isBg) {
      g.globalCompositeOperation = "destination-in";
      g.drawImage(src, 0, 0, w, h);
    }
    const frac = isBg ? ATMOS.overlapFrac : ATMOS.fgOverlapFrac;
    if (edges !== "none") {
      const ov = Math.max(2, Math.round(w * frac));
      const ramp = g.createLinearGradient(0, 0, edges === "both" ? w : ov, 0);
      const stops = 8;
      if (edges === "both") {
        const f = ov / w;
        for (let i = 0; i <= stops; i++) { const t = i / stops; const a = t * t * (3 - 2 * t); ramp.addColorStop(t * f, `rgba(0,0,0,${a})`); }
        for (let i = stops; i >= 0; i--) { const t = i / stops; const a = t * t * (3 - 2 * t); ramp.addColorStop(1 - t * f, `rgba(0,0,0,${a})`); }
      } else {
        for (let i = 0; i <= stops; i++) { const t = i / stops; const a = t * t * (3 - 2 * t); ramp.addColorStop(t, `rgba(0,0,0,${a})`); }
      }
      g.globalCompositeOperation = "destination-in";
      g.fillStyle = ramp;
      g.fillRect(0, 0, w, h);          // the gradient's end colour (alpha 1) pads past ov, so the rest of the tile stays
    }
    g.globalCompositeOperation = "source-over";
    const tile = { canvas, w, h, overlapFrac: edges === "left" ? frac : 0, src, grade, edges, used: nowMs() };
    const cache = this.atmosCache();
    cache.tiles.set(kind + "/" + art, tile);
    if (cache.tiles.size > ATMOS.cacheMax) {
      let oldest = null;
      for (const [k, t] of cache.tiles) if (!oldest || t.used < oldest[1].used) oldest = [k, t];
      if (oldest && oldest[1] !== tile) { cache.tiles.delete(oldest[0]); oldest[1].canvas.width = 0; }
    }
    return tile;
  },

  // sectorStart: bake the sector's resident tiles now, outside render (a direct sector jump must not pay for it in its
  // first frame). Not-yet-resident drawables take the idle path from atmosTile.
  atmosWarm() {
    try {
      const theme = this.currentTheme;
      const art = theme ? this.themeArt(theme) : null;
      if (!art || typeof Assets === "undefined") return;
      const bg = Assets.get("bg/" + art);
      if (bg) this.atmosTile("bg", art, bg, { sync: true });
      const fg = Assets.get("fg/" + art);
      if (fg) this.atmosTile("fg", art, fg, { sync: true, edges: theme.tileFg === false ? (art === "tenth" ? "none" : "both") : "left" });
    } catch (_) { /* presentation only */ }
  }
});

onGameHook("sectorStart", function () { if (typeof this.atmosWarm === "function") this.atmosWarm(); });
