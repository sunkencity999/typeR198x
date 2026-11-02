// Type-R 198X — WALLPAPER (Career pass): the commendation wallpaper. Every campaign clear earns a downloadable PNG
// composed from the game's own art and the pilot's run: the sector-10 vista (bg/tenth + the untiled fg/tenth, graded
// darker toward the bottom third, vignette, a few seeded stars), the pilot's ship large in the lower left with the plume
// glow at its nozzles (THRUSTER_OFFSET, 75-fx-draw.js), two or three drone silhouettes from fx/drones far behind it,
// the Final Electromancer (bosses/10) as a faint accent-graded hologram on the right, the wordmark in Orbitron, the
// COMMENDATION line, the pilot name, the rank badge (coloured like the CSS .rankBadge: RANK.colors), a stats row, the
// twenty-slot badge strip (one hexagon per commendation, the twentieth a star) and the footer (date · ship · site).
//
// Loads after 54-leaderboard.js (reads Assets, PALETTE, FONT, RANK, LEVELS, SHIP_CONFIGS / getShipConfig,
// getThemeForLevel, THRUSTER_OFFSET, DRONES / droneCell, IS_FILE_ORIGIN / IS_NATIVE_SHELL, onGameHook) and before
// 60-hud.js. Hooks consumed: modeChange (to === "victory" mounts the buttons). Wraps Game.prototype.openRecords (the
// Hall tab's "Wallpaper" button, created at runtime, hidden with no clears). Top-level names WALLPAPER* / wp*.
//
// Career contract (56-career.js, may be absent): save.career = { clears, loop, pure, boons[], picks, commendations:
// [{ n, date, rank, ship, loop, score, wpm, acc, boons, pure }] }; the career module's victory markup carries
// <section id="careerPanel"> ... <div id="careerWallpaperSlot" class="careerWallpaper"></div>. Without it the wallpaper
// renders from save alone: clears = save.victories, the newest highScores row (or the live run results) for the
// numbers, save.selectedShip for the ship.
//
// Cost: nothing here runs per frame. renderCareerWallpaper draws on demand into its own offscreen canvas (blend modes,
// gradients, shadowBlur are all fine there; the game canvas is never touched). The vista, boss and ship are drawn from
// the @2x files (Assets.url(key, "x2"): 2816 px backdrops, the 700 px ship crops) fetched into this module's own
// Image objects (same origin, no crossOrigin: the canvas stays clean) and released WALLPAPER.cacheMs after the last
// render; the loader's resident drawable (Assets.loadMany / Assets.get) is the fallback when a direct load fails.
// Pixel art (ship, drones, boss when upscaled) draws with imageSmoothingEnabled false; the vista scales smoothly.
//
// API (Game.prototype):
//   renderCareerWallpaper({ size: "desktop" | "phone", commendation?, career? }) -> Promise<HTMLCanvasElement>
//                                        desktop 2560x1440, phone 1080x1920. Never rejects: a missing asset skips its
//                                        element, a failed font load uses the system stack.
//   downloadCareerWallpaper(size, { button?, commendation?, career? }) -> Promise<{ ok, name, mode }>
//                                        renders, toBlob("image/png"), <a download="TypeR-198X-commendation-<n>-<size>.png">;
//                                        a browser without `download` opens the image in a new tab; a tainted canvas
//                                        (toBlob throws) hides the buttons and says so in the hint.
//   careerWallpaperMount()               fills #careerWallpaperSlot with the two .btn-arcade buttons + hint (idempotent).
//   careerWallpaperRecordsMount()        the Hall tab's single "Wallpaper" button (size by orientation).
//   careerWallpaperData(opts)            the normalised { commendation, career, list, clears, name, shipId, shipName }.
//   careerWallpaperFilename(size, data)

const WALLPAPER = Object.freeze({
  sizes: Object.freeze({ desktop: Object.freeze({ w: 2560, h: 1440 }), phone: Object.freeze({ w: 1080, h: 1920 }) }),
  keys: Object.freeze({ bg: "bg/tenth", fg: "fg/tenth", boss: "bosses/10", drones: "fx/drones" }),
  levelIndex: 9,
  wordmark: "TYPE-R 198X",
  site: "typer198x.com",
  badgeSlots: 20,
  cacheMs: 20000,          // decoded @2x images live this long after the last render (desktop then phone share them)
  fontTimeoutMs: 1500,     // document.fonts.load race; past it the system stack draws the text
  retryMs: 300,            // careerWallpaperMount retries until #careerWallpaperSlot exists ...
  retryMaxMs: 10000,       // ... for at most this long after a victory
  revokeMs: 15000,
  stars: 160
});
const WALLPAPER_RANK_COLORS = Object.freeze({ S: "amber", A: "cyan", B: "violet", C: "text", D: "danger" });
const WALLPAPER_LABELS = Object.freeze({
  desktop: "Wallpaper · desktop", phone: "Wallpaper · phone", auto: "Wallpaper",
  hint: "PNG · 2560 × 1440 or 1080 × 1920 · your ship, rank and commendations",
  hintRecords: "Latest commendation · PNG sized for this screen",
  unavailable: "Wallpaper download is not available in this shell.",
  saved: "Wallpaper saved"
});
const WALLPAPER_IMG_CACHE = new Map();   // url -> { img, t }
let WALLPAPER_IMG_TIMER = 0;

// --- Pure helpers (window globals; t-wallpaper) ---
function wpMulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wpRankLetter(r) {
  const s = String(r || "").trim().toUpperCase().charAt(0);
  return /^[SABCD]$/.test(s) ? s : "C";
}

function wpRankColor(rank) {
  const table = (typeof RANK !== "undefined" && RANK && RANK.colors) ? RANK.colors : WALLPAPER_RANK_COLORS;
  const name = table[wpRankLetter(rank)] || "text";
  return (typeof PALETTE !== "undefined" && PALETTE.has && PALETTE.has(name)) ? name : "text";
}

// PALETTE.rgba without the strict-mode throw: an unknown name draws as the text colour.
function wpRgba(name, a) {
  try {
    if (typeof PALETTE !== "undefined" && PALETTE.has && PALETTE.has(name)) return PALETTE.rgba(name, a);
  } catch (_) { /* fall through */ }
  const c = { text: [246, 247, 255], bg0: [5, 6, 11], cyan: [57, 245, 255], magenta: [255, 57, 209], violet: [184, 107, 255], amber: [255, 193, 74], lime: [168, 255, 58], danger: [255, 77, 109] }[name] || [246, 247, 255];
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, Number(a) || 0))})`;
}

function wpFormatDate(d) {
  let t = d;
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let date = (t instanceof Date) ? t : new Date(typeof t === "number" ? t : (t ? String(t) : Date.now()));
  if (!Number.isFinite(date.getTime())) date = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function wpFormatInt(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return typeof formatInt === "function" ? formatInt(v) : String(v);
}

function wpAccText(acc) {
  let a = Number(acc);
  if (!Number.isFinite(a)) return "—";
  if (a > 0 && a <= 1) a *= 100;
  a = Math.max(0, Math.min(100, a));
  return (Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, "") + " %";
}

function wpAutoSize() {
  try {
    if (typeof matchMedia === "function" && matchMedia("(orientation: portrait)").matches) return "phone";
    if (typeof innerWidth === "number" && innerWidth < 700) return "phone";
  } catch (_) { /* desktop */ }
  return "desktop";
}

function wpFontFamily(ready) {
  if (typeof FONT === "undefined" || !FONT) return ready ? '"Orbitron", sans-serif' : "sans-serif";
  return ready ? FONT.displayFamily : FONT.mono;
}

function wpDisplayFont(S, px, weight = 800) { return `${weight} ${Math.round(px)}px ${S.display}`; }
function wpMonoFont(S, px, weight = 600) { return `${weight} ${Math.round(px)}px ${S.mono}`; }

// Shrink a font until `text` fits maxW (never below minPx).
function wpFitFont(g, text, maxW, px, minPx, makeFont) {
  let size = px;
  g.font = makeFont(size);
  while (size > minPx && g.measureText(text).width > maxW) { size -= Math.max(1, Math.round(size * 0.04)); g.font = makeFont(size); }
  return size;
}

// The px size of the context's current font ("600 24px ui-monospace, ..." -> 24).
function wpFontPx(g) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(g.font || ""));
  return m ? Number(m[1]) : 16;
}

// Letter-spaced text (canvas letterSpacing is not everywhere yet): returns the drawn width.
function wpTracked(g, text, x, y, em, align = "left") {
  const s = String(text);
  const px = wpFontPx(g);
  const gap = px * em;
  let w = 0;
  for (const ch of s) w += g.measureText(ch).width + gap;
  w -= gap;
  let cx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  const prevAlign = g.textAlign;
  g.textAlign = "left";
  for (const ch of s) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + gap; }
  g.textAlign = prevAlign;
  return w;
}

function wpMeasureTracked(g, text, em) {
  const px = wpFontPx(g);
  const gap = px * em;
  let w = 0;
  for (const ch of String(text)) w += g.measureText(ch).width + gap;
  return Math.max(0, w - gap);
}

function wpRoundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

function wpHexPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;   // flat-top like the shield ring
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function wpStarPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.46;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function wpBrackets(g, x, y, w, h, len, color, lw) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y);
  g.moveTo(x + w - len, y); g.lineTo(x + w, y); g.lineTo(x + w, y + len);
  g.moveTo(x + w, y + h - len); g.lineTo(x + w, y + h); g.lineTo(x + w - len, y + h);
  g.moveTo(x + len, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - len);
  g.stroke();
  g.restore();
}

// --- Images ---
// The loader's URL for a key at the wanted variant (bare under file:// / the native UA, like every other request).
function wpAssetUrl(key, variant) {
  try {
    if (typeof Assets === "undefined" || !Assets || typeof Assets.url !== "function") return null;
    return Assets.url(key, variant);
  } catch (_) { return null; }
}

function wpLoadImage(url) {
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  const hit = WALLPAPER_IMG_CACHE.get(url);
  if (hit && hit.img) { hit.t = Date.now(); return Promise.resolve(hit.img); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (img) => { if (done) return; done = true; if (img) WALLPAPER_IMG_CACHE.set(url, { img, t: Date.now() }); resolve(img); };
    try {
      const img = new Image();
      img.onload = () => {
        const settle = () => finish(img.naturalWidth > 0 ? img : null);
        if (typeof img.decode === "function") img.decode().then(settle, settle); else settle();
      };
      img.onerror = () => finish(null);
      img.src = url;
    } catch (_) { finish(null); }
  });
}

function wpScheduleImageRelease() {
  if (WALLPAPER_IMG_TIMER) clearTimeout(WALLPAPER_IMG_TIMER);
  WALLPAPER_IMG_TIMER = setTimeout(() => {
    WALLPAPER_IMG_TIMER = 0;
    const cut = Date.now() - WALLPAPER.cacheMs + 50;
    for (const [url, e] of [...WALLPAPER_IMG_CACHE]) if (e.t <= cut) WALLPAPER_IMG_CACHE.delete(url);
    if (WALLPAPER_IMG_CACHE.size) wpScheduleImageRelease();
  }, WALLPAPER.cacheMs);
}

// The best drawable for a key: the @2x file (x1 / the master when the manifest has no x2), else the loader's drawable
// (resident, or fetched now through Assets.loadMany: the lazy fallback, so a normal render never downloads a key
// twice), else the PNG master. Returns { img, w, h, source } or null.
async function wpAcquire(key) {
  let img = await wpLoadImage(wpAssetUrl(key, "x2"));
  let source = "x2";
  if (!img) {
    try {
      if (typeof Assets !== "undefined" && Assets && typeof Assets.get === "function") {
        img = Assets.get(key);
        if (!img && typeof Assets.loadMany === "function") { await Assets.loadMany([key], null, { priority: "high" }); img = Assets.get(key); }
      }
    } catch (_) { img = null; }
    source = "loader";
  }
  if (!img) { img = await wpLoadImage(wpAssetUrl(key, "fallback")); source = "fallback"; }
  if (!img) return null;
  const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) return null;
  return { img, w, h, source };
}

function wpFontReady() {
  try {
    if (typeof document === "undefined" || !document.fonts || typeof document.fonts.load !== "function") return Promise.resolve(false);
    const loads = Promise.all([document.fonts.load("900 120px Orbitron"), document.fonts.load("700 60px Orbitron")])
      .then((sets) => sets.some((s) => s && s.length > 0), () => false);
    const timeout = new Promise((r) => setTimeout(() => r(false), WALLPAPER.fontTimeoutMs));
    return Promise.race([loads, timeout]);
  } catch (_) { return Promise.resolve(false); }
}

function wpToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("toBlob returned null")); }, "image/png");
        return;
      }
      const dataUrl = canvas.toDataURL("image/png");   // throws SecurityError on a tainted canvas, like toBlob
      const bin = atob(dataUrl.split(",")[1] || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/png" }));
    } catch (err) { reject(err); }
  });
}

// --- Layout -----------------------------------------------------------------------------------------------------
// Every size in canvas px, derived from the canvas: u is the short side / 1440 (desktop 1, phone .75), so the type
// stays proportional. Phone stacks: vista top, ship middle, text block bottom.
function wpLayout(size) {
  const { w: W, h: H } = WALLPAPER.sizes[size] || WALLPAPER.sizes.desktop;
  const phone = size === "phone";
  const u = phone ? W / 1440 : H / 1440;
  const m = Math.round(W * (phone ? 0.074 : 0.07));   // side margin
  if (!phone) {
    return {
      W, H, u, phone, m,
      bgFocus: 0.5, fgSpan: 1.0, fgDrop: 0.11,
      gradeFrom: 0.50, gradeTo: 1.0, gradeA: 0.90,
      boss: { cx: 0.785 * W, cy: 0.50 * H, h: 0.92 * H, alpha: 0.42, silhouette: 0.5, glow: 0.5 * H },
      ship: { left: m + 20 * u, cy: 0.505 * H, w: 0.33 * W },
      drones: [{ cls: "hauler", v: 0, x: 0.535 * W, y: 0.40 * H, s: 1.8 * u, a: 0.78 }, { cls: "interceptor", v: 1, x: 0.59 * W, y: 0.31 * H, s: 1.6 * u, a: 0.66 }, { cls: "scout", v: 2, x: 0.565 * W, y: 0.52 * H, s: 1.45 * u, a: 0.55 }],
      eyebrow: { x: m, y: 0.10 * H, px: 24 * u },
      wordmark: { x: m - 6 * u, y: 0.205 * H, px: 140 * u, maxW: 0.6 * W },
      sub: { x: m, y: 0.25 * H, px: 24 * u },
      badge: { x: m, y: 0.735 * H, s: 150 * u },
      commendation: { px: 50 * u, dy: 46 * u },
      name: { px: 104 * u, dy: 144 * u, maxW: 0.42 * W },
      loopLine: null,
      stats: { right: W - m, labelY: 0.745 * H, valueY: 0.783 * H, labelPx: 22 * u, valuePx: 44 * u, gap: 60 * u, maxW: 0.50 * W, rows: 1 },
      strip: { right: W - m, cy: 0.858 * H, r: 27 * u, gap: 14 * u, perRow: 20 },
      rule: { y: 0.915 * H },
      footer: { y: 0.955 * H, px: 26 * u },
      brackets: { inset: 34 * u, len: 60 * u, lw: 3 * u }
    };
  }
  return {
    W, H, u, phone, m,
    bgFocus: 0.60, fgSpan: 1.0, fgDrop: 0.0, fgBottom: 0.64 * H,
    gradeFrom: 0.52, gradeTo: 1.0, gradeA: 0.92,
    boss: { cx: 0.5 * W, cy: 0.40 * H, h: 0.58 * H, alpha: 0.42, silhouette: 0.3, glow: 0.30 * H },
    ship: { left: 0.10 * W, cy: 0.49 * H, w: 0.80 * W },
    drones: [{ cls: "hauler", v: 0, x: 0.27 * W, y: 0.305 * H, s: 1.9 * u, a: 0.75 }, { cls: "interceptor", v: 1, x: 0.74 * W, y: 0.335 * H, s: 1.6 * u, a: 0.62 }, { cls: "scout", v: 2, x: 0.55 * W, y: 0.285 * H, s: 1.4 * u, a: 0.5 }],
    eyebrow: { x: W / 2, y: 0.082 * H, px: 24 * u, center: true },
    wordmark: { x: W / 2, y: 0.138 * H, px: 118 * u, maxW: W - 2 * m, center: true },
    sub: { x: W / 2, y: 0.164 * H, px: 23 * u, center: true },
    badge: { x: m, y: 0.69 * H, s: 150 * u },
    commendation: { px: 44 * u, dy: 44 * u },
    name: { px: 92 * u, dy: 132 * u, maxW: W - m - 150 * u - 36 * u - m },
    loopLine: { x: m, y: 0.69 * H + 150 * u + 54 * u, px: 30 * u },
    stats: { left: m, right: W - m, labelY: 0.805 * H, valueY: 0.838 * H, labelPx: 22 * u, valuePx: 46 * u, gap: 40 * u, maxW: W - 2 * m, rows: 1, spread: true },
    strip: { cx: W / 2, cy: 0.895 * H, r: 24 * u, gap: 16 * u, perRow: 10, rowGap: 16 * u },
    rule: { y: 0.94 * H },
    footer: { y: 0.966 * H, px: 24 * u },
    brackets: { inset: 30 * u, len: 54 * u, lw: 3 * u }
  };
}

// cover-fit box for an image of (iw, ih) in (W, H); focusX picks which part survives the horizontal crop.
function wpCover(iw, ih, W, H, focusX = 0.5) {
  const s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s;
  const ox = Math.max(W - dw, Math.min(0, W / 2 - focusX * dw));
  const oy = (H - dh) / 2;
  return { x: ox, y: oy, w: dw, h: dh, s };
}

// --- Composition steps (each wrapped in try/catch by the renderer; S is the scene) ----------------------------------
function wpDrawVista(S) {
  const { g, L, img } = S;
  const { W, H } = L;
  const v = document.createElement("canvas");
  v.width = W; v.height = H;
  const c = v.getContext("2d");
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.fillStyle = wpRgba("bg0", 1);
  c.fillRect(0, 0, W, H);
  if (img.bg) {
    const b = wpCover(img.bg.w, img.bg.h, W, H, L.bgFocus);
    c.drawImage(img.bg.img, b.x, b.y, b.w, b.h);
  } else {
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, wpRgba("bg2", 1));
    grad.addColorStop(1, wpRgba("bg0", 1));
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
  }
  // Seeded stars over the sky: a few bright twinkles with a four-point sparkle, the rest pin pricks.
  const rng = wpMulberry32(0x198C + (S.data.commendation.n | 0) * 7919);
  for (let i = 0; i < WALLPAPER.stars; i++) {
    const x = rng() * W, y = rng() * H * 0.62, r = 0.6 + rng() * 1.6;
    const a = 0.25 + rng() * 0.6;
    c.fillStyle = wpRgba(rng() < 0.2 ? S.accent : "text", a);
    c.beginPath(); c.arc(x, y, r * L.u, 0, Math.PI * 2); c.fill();
    if (rng() < 0.07) {
      c.strokeStyle = wpRgba("text", a * 0.6);
      c.lineWidth = 1 * L.u;
      const len = (4 + rng() * 8) * L.u;
      c.beginPath(); c.moveTo(x - len, y); c.lineTo(x + len, y); c.moveTo(x, y - len); c.lineTo(x, y + len); c.stroke();
    }
  }
  if (img.fg) {
    const fw = W * L.fgSpan, fh = fw * img.fg.h / img.fg.w;
    const bottom = L.phone ? L.fgBottom : H + fh * L.fgDrop;
    c.drawImage(img.fg.img, (W - fw) / 2, bottom - fh, fw, fh);
  }
  // Grade: the atmos S10 pull (saturation, multiply tint), then the bottom-third darkening the text sits on.
  const grade = (typeof ATMOS_GRADES !== "undefined" && ATMOS_GRADES && ATMOS_GRADES[WALLPAPER.levelIndex]) || { tint: "#1A1040", tintA: 0.26, sat: 0.08 };
  c.globalCompositeOperation = "saturation";
  c.fillStyle = `rgba(128,128,128,${grade.sat || 0.08})`;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = typeof atmosRgba === "function" ? atmosRgba(grade.tint, grade.tintA) : `rgba(26,16,64,${grade.tintA || 0.26})`;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = "source-over";
  const gy0 = H * L.gradeFrom, gy1 = H * L.gradeTo;
  const dark = c.createLinearGradient(0, gy0, 0, gy1);
  dark.addColorStop(0, wpRgba("bg0", 0));
  dark.addColorStop(0.45, wpRgba("bg0", L.gradeA * 0.62));
  dark.addColorStop(1, wpRgba("bg0", L.gradeA));
  c.fillStyle = dark;
  c.fillRect(0, gy0, W, gy1 - gy0);
  // Vignette.
  const vr = Math.hypot(W, H) * 0.5;
  const vig = c.createRadialGradient(W / 2, H * 0.45, vr * 0.35, W / 2, H * 0.45, vr);
  vig.addColorStop(0, wpRgba("bg0", 0));
  vig.addColorStop(1, wpRgba("bg0", 0.62));
  c.fillStyle = vig;
  c.fillRect(0, 0, W, H);
  g.drawImage(v, 0, 0);
  v.width = 0;
}

function wpDrawBoss(S) {
  const { g, L, img } = S;
  if (!img.boss) return;
  const B = L.boss;
  const bh = B.h, bw = bh * img.boss.w / img.boss.h;
  const x = B.cx - bw / 2, y = B.cy - bh / 2;
  // Accent glow behind the hologram so it lifts off the sky.
  const glow = g.createRadialGradient(B.cx, B.cy, 0, B.cx, B.cy, B.glow);
  glow.addColorStop(0, wpRgba(S.accent, 0.22));
  glow.addColorStop(0.6, wpRgba(S.accent, 0.06));
  glow.addColorStop(1, wpRgba(S.accent, 0));
  g.save();
  g.globalCompositeOperation = "lighter";
  g.fillStyle = glow;
  g.fillRect(B.cx - B.glow, B.cy - B.glow, B.glow * 2, B.glow * 2);
  g.restore();
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.ceil(bw)); t.height = Math.max(1, Math.ceil(bh));
  const c = t.getContext("2d");
  const fade = (ctx, h) => {   // the hologram's lower edge dissolves into the grade
    const f = ctx.createLinearGradient(0, 0, 0, h);
    f.addColorStop(0, "rgba(0,0,0,1)");
    f.addColorStop(0.6, "rgba(0,0,0,1)");
    f.addColorStop(1, "rgba(0,0,0,0.04)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = f;
    ctx.fillRect(0, 0, ctx.canvas.width, h);
    ctx.globalCompositeOperation = "source-over";
  };
  // Pass 1: a dark silhouette (the boss's own alpha filled with bg0) so the hologram reads against the bright vortex.
  c.imageSmoothingEnabled = bw <= img.boss.w;     // nearest only when the pixel art is enlarged
  c.drawImage(img.boss.img, 0, 0, bw, bh);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = wpRgba("bg0", 1);
  c.fillRect(0, 0, t.width, t.height);
  fade(c, t.height);
  g.save();
  g.globalAlpha = B.silhouette;
  g.drawImage(t, x, y);
  g.restore();
  // Pass 2: the art desaturated, pulled to the accent, brightened once, with scan bands, screened over the silhouette.
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, t.width, t.height);
  c.drawImage(img.boss.img, 0, 0, bw, bh);
  c.globalCompositeOperation = "saturation";
  c.fillStyle = "rgba(128,128,128,0.7)";
  c.fillRect(0, 0, t.width, t.height);
  // The blend fill also painted the clear pixels (blend modes composite source-over where the backdrop is empty):
  // multiply the alpha back by the art's own (the same step 72-atmos.js takes for a foreground).
  c.globalCompositeOperation = "destination-in";
  c.drawImage(img.boss.img, 0, 0, bw, bh);
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = wpRgba(S.accent, 0.6);
  c.fillRect(0, 0, t.width, t.height);
  c.globalCompositeOperation = "lighter";
  c.drawImage(t, 0, 0);
  c.globalCompositeOperation = "source-atop";
  const band = Math.max(4, Math.round(6 * L.u));
  c.fillStyle = "rgba(255,255,255,0.12)";
  for (let yy = 0; yy < t.height; yy += band * 2) c.fillRect(0, yy, t.width, band);
  fade(c, t.height);
  g.save();
  g.globalAlpha = B.alpha;
  g.globalCompositeOperation = "screen";
  g.drawImage(t, x, y);
  g.restore();
  t.width = 0;
}

// A drone cell (hull band + accent band tinted) as its own small canvas at the sheet's native pixels.
function wpDroneCell(sheet, cls, v, tint) {
  if (typeof droneCell !== "function" || typeof DRONES === "undefined") return null;
  const cell = droneCell(cls, v, 0);
  const k = sheet.w / DRONES.sheet.w;
  const bandH = Math.round(DRONES.sheet.bandH * k);
  const cw = Math.max(1, Math.round(cell.w * k)), ch = Math.max(1, Math.round(cell.h * k));
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  const g = out.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(sheet.img, cell.x * k, cell.y * k, cw, ch, 0, 0, cw, ch);
  const tmp = document.createElement("canvas");
  tmp.width = cw; tmp.height = ch;
  const t = tmp.getContext("2d");
  t.imageSmoothingEnabled = false;
  t.drawImage(sheet.img, cell.x * k, cell.y * k + bandH, cw, ch, 0, 0, cw, ch);
  t.globalCompositeOperation = "source-in";
  t.fillStyle = tint;
  t.fillRect(0, 0, cw, ch);
  g.drawImage(tmp, 0, 0);
  tmp.width = 0;
  return out;
}

function wpDrawDrones(S) {
  const { g, L, img } = S;
  if (!img.drones) return;
  const tint = wpRgba(S.accent, 1);
  for (const d of L.drones) {
    const cell = wpDroneCell(img.drones, d.cls, d.v, tint);
    if (!cell) continue;
    const dw = cell.width * d.s, dh = cell.height * d.s;
    g.save();
    g.globalAlpha = d.a;
    // engine streak trailing right (the stream comes from the right; these fly the pilot's way)
    const streak = g.createLinearGradient(d.x + dw * 0.4, 0, d.x + dw * 0.4 + dw * 1.6, 0);
    streak.addColorStop(0, wpRgba(S.accent, 0.35));
    streak.addColorStop(1, wpRgba(S.accent, 0));
    g.fillStyle = streak;
    g.fillRect(d.x + dw * 0.4, d.y - Math.max(1, 1.5 * L.u), dw * 1.6, Math.max(2, 3 * L.u));
    g.imageSmoothingEnabled = false;
    g.drawImage(cell, Math.round(d.x - dw / 2), Math.round(d.y - dh / 2), Math.round(dw), Math.round(dh));
    g.restore();
    cell.width = 0;
  }
}

function wpDrawShip(S) {
  const { g, L, img, data } = S;
  if (!img.ship) return;
  const P = L.ship;
  const w = P.w, h = w * img.ship.h / img.ship.w;
  const left = P.left, top = P.cy - h / 2;
  // Scrim: a soft dark ellipse so the hull separates from the busy vista (the lane scrim's cousin).
  g.save();
  g.translate(left + w * 0.5, P.cy);
  g.scale(1, h / w * 0.9);
  const scrim = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.68);
  scrim.addColorStop(0, wpRgba("bg0", 0.55));
  scrim.addColorStop(1, wpRgba("bg0", 0));
  g.fillStyle = scrim;
  g.fillRect(-w, -w, 2 * w, 2 * w);
  g.restore();
  // Plume: outer magenta ellipse + white -> cyan core per nozzle, additive, trailing left.
  const offsets = (typeof THRUSTER_OFFSET !== "undefined" && THRUSTER_OFFSET && (THRUSTER_OFFSET[data.shipId] || THRUSTER_OFFSET.default)) || { nozzles: [{ fx: 0.04, fy: 0.5 }] };
  const len = w * 0.34, hh = h * 0.085;
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const n of offsets.nozzles) {
    const nx = left + n.fx * w, ny = top + n.fy * h;
    g.save();
    g.translate(nx + len * 0.06, ny);
    g.scale(len / hh, 1);
    const outer = g.createRadialGradient(0, 0, 0, 0, 0, hh);
    outer.addColorStop(0, wpRgba("magenta", 0.75));
    outer.addColorStop(0.5, wpRgba("magenta", 0.3));
    outer.addColorStop(1, wpRgba("magenta", 0));
    g.fillStyle = outer;
    g.fillRect(-hh * 1.1, -hh, hh * 1.2, hh * 2);     // only the trailing half (x <= 0) plus a sliver at the nozzle
    const core = g.createRadialGradient(0, 0, 0, 0, 0, hh * 0.55);
    core.addColorStop(0, wpRgba("text", 0.95));
    core.addColorStop(0.35, wpRgba("cyan", 0.7));
    core.addColorStop(1, wpRgba("cyan", 0));
    g.fillStyle = core;
    g.fillRect(-hh * 0.6, -hh * 0.55, hh * 0.7, hh * 1.1);
    g.restore();
    // long faint exhaust line
    const line = g.createLinearGradient(nx - len * 1.9, 0, nx, 0);
    line.addColorStop(0, wpRgba("cyan", 0));
    line.addColorStop(1, wpRgba("cyan", 0.42));
    g.fillStyle = line;
    g.fillRect(nx - len * 1.9, ny - Math.max(1, 2 * L.u), len * 1.9, Math.max(2, 4 * L.u));
  }
  g.restore();
  // Hull: a baked-style rim shadow, then the crisp sprite.
  g.save();
  g.imageSmoothingEnabled = w <= img.ship.w;
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = 26 * L.u;
  g.shadowOffsetY = 12 * L.u;
  g.drawImage(img.ship.img, Math.round(left), Math.round(top), Math.round(w), Math.round(h));
  g.shadowColor = "rgba(0,0,0,0)";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.drawImage(img.ship.img, Math.round(left), Math.round(top), Math.round(w), Math.round(h));
  g.restore();
}

function wpDrawWordmark(S) {
  const { g, L, data } = S;
  const E = L.eyebrow, Wm = L.wordmark, Sub = L.sub;
  const align = Wm.center ? "center" : "left";
  g.save();
  g.textBaseline = "alphabetic";
  // eyebrow
  g.font = wpMonoFont(S, E.px, 600);
  g.fillStyle = wpRgba(S.accent, 0.95);
  wpTracked(g, "CAMPAIGN CLEAR · COMMENDATION OF MERIT", E.x, E.y, 0.28, align);
  // wordmark: neon glow pass, then the solid fill
  const px = wpFitFont(g, WALLPAPER.wordmark, Wm.maxW, Wm.px, Wm.px * 0.5, (p) => wpDisplayFont(S, p, 900));
  g.font = wpDisplayFont(S, px, 900);
  g.textAlign = align;
  g.shadowColor = wpRgba("cyan", 0.75);
  g.shadowBlur = 34 * L.u;
  g.fillStyle = wpRgba("cyan", 0.55);
  g.fillText(WALLPAPER.wordmark, Wm.x, Wm.y);
  g.shadowColor = wpRgba("magenta", 0.55);
  g.shadowBlur = 18 * L.u;
  g.shadowOffsetX = 4 * L.u; g.shadowOffsetY = 4 * L.u;
  g.fillStyle = wpRgba("text", 1);
  g.fillText(WALLPAPER.wordmark, Wm.x, Wm.y);
  g.shadowColor = "rgba(0,0,0,0)"; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  // accent rule under the wordmark
  const tw = g.measureText(WALLPAPER.wordmark).width;
  const rx = align === "center" ? Wm.x - tw / 2 : Wm.x + 6 * L.u;
  const ry = Wm.y + 14 * L.u;
  const rule = g.createLinearGradient(rx, 0, rx + tw, 0);
  rule.addColorStop(0, wpRgba("cyan", 0.9));
  rule.addColorStop(1, wpRgba("magenta", 0.9));
  g.fillStyle = rule;
  g.fillRect(rx, ry, tw, Math.max(2, 3 * L.u));
  // sub line: sector, boss, date
  const bossName = (typeof LEVELS !== "undefined" && LEVELS && LEVELS[WALLPAPER.levelIndex] && LEVELS[WALLPAPER.levelIndex].bossName) || "FINAL ELECTROMANCER";
  g.font = wpMonoFont(S, Sub.px, 600);
  g.fillStyle = wpRgba("text", 0.78);
  wpTracked(g, `SECTOR 10 · ${String(bossName).toUpperCase()} · ALL TEN SECTORS CLEARED`, Sub.x, Sub.y, 0.22, align);
  g.restore();
}

function wpDrawRankBadge(S, x, y, s, rank, opts = {}) {
  const { g, L } = S;
  const name = wpRankColor(rank);
  const r = s * 0.16;
  g.save();
  g.shadowColor = wpRgba(name, 0.55);
  g.shadowBlur = (opts.glow == null ? 22 : opts.glow) * L.u;
  wpRoundRectPath(g, x, y, s, s, r);
  g.fillStyle = wpRgba("bg0", 0.72);
  g.fill();
  g.shadowBlur = 0;
  wpRoundRectPath(g, x, y, s, s, r);
  g.fillStyle = wpRgba(name, 0.14);
  g.fill();
  g.lineWidth = Math.max(2, s * 0.045);
  g.strokeStyle = wpRgba(name, 1);
  g.stroke();
  g.font = wpDisplayFont(S, s * 0.62, 900);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = wpRgba(name, 0.8);
  g.shadowBlur = 14 * L.u;
  g.fillStyle = wpRgba(name, 1);
  g.fillText(wpRankLetter(rank), x + s / 2, y + s * 0.54);
  g.restore();
}

function wpDrawIdentity(S) {
  const { g, L, data } = S;
  const c = data.commendation;
  const B = L.badge;
  wpDrawRankBadge(S, B.x, B.y, B.s, c.rank);
  const tx = B.x + B.s + 36 * L.u;
  g.save();
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  // COMMENDATION Nº n
  g.font = wpDisplayFont(S, L.commendation.px, 700);
  g.fillStyle = wpRgba("amber", 1);
  g.shadowColor = wpRgba("amber", 0.45);
  g.shadowBlur = 16 * L.u;
  wpTracked(g, `COMMENDATION Nº ${c.n}`, tx, B.y + L.commendation.dy, 0.16);
  g.shadowBlur = 0;
  // pilot name
  const maxW = L.name.maxW;
  const px = wpFitFont(g, data.name, maxW, L.name.px, L.name.px * 0.45, (p) => wpDisplayFont(S, p, 900));
  g.font = wpDisplayFont(S, px, 900);
  g.shadowColor = wpRgba("cyan", 0.5);
  g.shadowBlur = 22 * L.u;
  g.fillStyle = wpRgba("text", 1);
  g.fillText(data.name, tx, B.y + L.name.dy);
  g.shadowBlur = 0;
  // phone: the loop / pure / boons line under the name (desktop carries it in the stats row)
  if (L.loopLine) {
    g.font = wpMonoFont(S, L.loopLine.px, 600);
    g.fillStyle = wpRgba(S.accent, 0.95);
    wpTracked(g, data.loopText, L.loopLine.x, L.loopLine.y, 0.22);
  }
  g.restore();
}

function wpDrawStats(S) {
  const { g, L, data } = S;
  const c = data.commendation;
  const T = L.stats;
  const segs = [
    { label: "SCORE", value: wpFormatInt(c.score), color: "amber" },
    { label: "WPM", value: c.wpm > 0 ? String(Math.round(c.wpm)) : "—", color: "text" },
    { label: "ACCURACY", value: wpAccText(c.acc), color: "text" }
  ];
  if (!L.phone) {
    segs.push({ label: "LOOP", value: String(c.loop | 0), color: S.accent });
    segs.push(c.pure ? { label: "RUN", value: "PURE", color: "lime" } : { label: "BOONS", value: String(c.boons.length), color: S.accent });
  }
  g.save();
  g.textBaseline = "alphabetic";
  // measure
  let valuePx = T.valuePx;
  const widths = () => segs.map((s) => {
    g.font = wpMonoFont(S, T.labelPx, 600);
    const lw = wpMeasureTracked(g, s.label, 0.24);
    g.font = wpMonoFont(S, valuePx, 700);
    const vw = g.measureText(s.value).width;
    return Math.max(lw, vw);
  });
  let ws = widths();
  let total = ws.reduce((a, b) => a + b, 0) + T.gap * (segs.length - 1);
  while (total > T.maxW && valuePx > T.valuePx * 0.55) { valuePx -= 2 * L.u; ws = widths(); total = ws.reduce((a, b) => a + b, 0) + T.gap * (segs.length - 1); }
  // place: desktop right-aligned, phone spread across the width
  let x;
  let gap = T.gap;
  if (T.spread) { gap = Math.max(T.gap, (T.right - T.left - ws.reduce((a, b) => a + b, 0)) / (segs.length - 1)); x = T.left; }
  else x = T.right - total;
  segs.forEach((s, i) => {
    g.textAlign = "left";
    g.font = wpMonoFont(S, T.labelPx, 600);
    g.fillStyle = wpRgba("text", 0.55);
    wpTracked(g, s.label, x, T.labelY, 0.24);
    g.font = wpMonoFont(S, valuePx, 700);
    g.fillStyle = wpRgba(s.color, 1);
    if (s.color !== "text") { g.shadowColor = wpRgba(s.color, 0.45); g.shadowBlur = 12 * L.u; }
    g.fillText(s.value, x, T.valueY);
    g.shadowBlur = 0;
    if (i < segs.length - 1) {
      const dx = x + ws[i] + gap / 2;
      g.fillStyle = wpRgba(S.accent, 0.3);
      g.fillRect(Math.round(dx), T.labelY - T.labelPx, Math.max(1, Math.round(2 * L.u)), (T.valueY - T.labelY) + T.labelPx * 1.1);
    }
    x += ws[i] + gap;
  });
  g.restore();
}

function wpDrawBadgeStrip(S) {
  const { g, L, data } = S;
  const T = L.strip;
  const total = WALLPAPER.badgeSlots;
  const perRow = Math.max(1, T.perRow | 0);
  const rows = Math.ceil(total / perRow);
  const pitch = T.r * 2 + T.gap;
  const rowW = perRow * pitch - T.gap;
  const clears = data.clears;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < total; i++) {
    const row = (i / perRow) | 0, col = i % perRow;
    const x0 = T.cx != null ? T.cx - rowW / 2 : T.right - rowW;
    const cx = x0 + col * pitch + T.r;
    const cy = T.cy + (row - (rows - 1) / 2) * (T.r * 2 + (T.rowGap || T.gap));
    const earned = i < clears;
    const entry = data.list[i] || null;
    const rank = entry ? wpRankLetter(entry.rank) : (earned && i === clears - 1 ? data.commendation.rank : null);
    const color = earned ? (rank ? wpRankColor(rank) : S.accent) : "text";
    const star = i === total - 1;
    const latest = earned && i === clears - 1;
    const age = earned ? (clears > 1 ? i / (clears - 1) : 1) : 0;
    const alpha = earned ? (latest ? 1 : 0.42 + 0.46 * age) : 0.16;
    g.globalAlpha = alpha;
    if (star) wpStarPath(g, cx, cy, T.r * 1.18); else wpHexPath(g, cx, cy, T.r);
    g.fillStyle = earned ? wpRgba(color, 0.18) : wpRgba("bg0", 0.35);
    g.fill();
    g.lineWidth = Math.max(1.5, (earned ? 3 : 2) * L.u);
    g.strokeStyle = wpRgba(color, 1);
    if (earned && latest) { g.shadowColor = wpRgba(color, 0.8); g.shadowBlur = 16 * L.u; }
    g.stroke();
    g.shadowBlur = 0;
    if (earned && rank && !star) {
      g.font = wpDisplayFont(S, T.r * 1.05, 900);
      g.fillStyle = wpRgba(color, 1);
      g.fillText(rank, cx, cy + T.r * 0.06);
    } else if (!earned && star) {
      // the unearned twentieth: a dim star only
    }
  }
  g.globalAlpha = 1;
  // caption under the strip
  const capY = T.cy + ((rows - 1) / 2) * (T.r * 2 + (T.rowGap || T.gap)) + T.r + 30 * L.u;
  g.font = wpMonoFont(S, 20 * L.u, 600);
  g.fillStyle = wpRgba("text", 0.5);
  const cap = `${clears} OF ${total} COMMENDATIONS`;
  wpTracked(g, cap, T.cx != null ? T.cx : T.right, capY, 0.24, T.cx != null ? "center" : "right");
  g.restore();
}

function wpDrawFooter(S) {
  const { g, L, data } = S;
  const F = L.footer;
  g.save();
  // rule
  g.fillStyle = wpRgba(S.accent, 0.22);
  g.fillRect(L.m, L.rule.y, L.W - 2 * L.m, Math.max(1, Math.round(1.5 * L.u)));
  g.textBaseline = "alphabetic";
  g.font = wpMonoFont(S, F.px, 600);
  g.fillStyle = wpRgba("text", 0.7);
  const left = `${wpFormatDate(data.commendation.date)} · ${data.shipName.toUpperCase()}`;
  wpTracked(g, left, L.m, F.y, 0.2, "left");
  g.fillStyle = wpRgba("cyan", 0.85);
  wpTracked(g, WALLPAPER.site.toUpperCase(), L.W - L.m, F.y, 0.2, "right");
  // corner brackets: the game's framing language
  const b = L.brackets;
  wpBrackets(g, b.inset, b.inset, L.W - 2 * b.inset, L.H - 2 * b.inset, b.len, wpRgba(S.accent, 0.4), b.lw);
  g.restore();
}

Object.assign(Game.prototype, {
  // ------------------------- Data -------------------------
  careerWallpaperClears(career) {
    const save = this.save || {};
    const c = career || (save.career && typeof save.career === "object" ? save.career : null);
    const list = c && Array.isArray(c.commendations) ? c.commendations.length : 0;
    if (c && Number.isFinite(c.clears)) return Math.max(c.clears | 0, list);
    return Math.max(save.victories | 0, list);
  },

  careerWallpaperData(opts = {}) {
    const save = this.save || {};
    const career = (opts.career && typeof opts.career === "object") ? opts.career : (save.career && typeof save.career === "object" ? save.career : null);
    const list = career && Array.isArray(career.commendations) ? career.commendations.filter((c) => c && typeof c === "object") : [];
    const clears = this.careerWallpaperClears(career);
    let c = (opts.commendation && typeof opts.commendation === "object") ? opts.commendation : (list.length ? list[list.length - 1] : null);
    if (!c) {
      // No career module: the live run results when a victory just happened, else the newest high-score row.
      const live = (this.lastResults && this.lastResults.scope === "run") ? this.lastResults : null;
      const rows = Array.isArray(save.highScores) ? save.highScores.filter((r) => r && typeof r === "object") : [];
      const newest = rows.slice().sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0))[0] || null;
      const sb = save.sectorBests && save.sectorBests["10"];
      const acc = live ? live.acc : (newest ? newest.acc : 0);
      const wpm = live ? live.wpm : (newest ? newest.wpm : 0);
      let rank = (live && live.rank) || (sb && sb.rank) || null;
      if (!rank) { try { rank = typeof rankFor === "function" ? rankFor(Number(acc) || 0, Number(wpm) || 0, 1, 10) : "C"; } catch (_) { rank = "C"; } }
      c = {
        n: Math.max(1, clears), date: (newest && newest.date) || Date.now(), rank,
        ship: (newest && newest.ship) || save.selectedShip || "coconut",
        loop: 0, score: live ? (this.stats && this.stats.score) || live.score || 0 : (newest ? newest.score : 0), wpm, acc, boons: [], pure: false
      };
    }
    const ships = (typeof SHIP_CONFIGS !== "undefined" && SHIP_CONFIGS) ? SHIP_CONFIGS : {};
    const shipId = (typeof c.ship === "string" && ships[c.ship]) ? c.ship : ((typeof save.selectedShip === "string" && ships[save.selectedShip]) ? save.selectedShip : "coconut");
    const cfg = ships[shipId] || null;
    const shipName = (cfg && cfg.name) || "The S.S. Coconut";
    const n = Number.isFinite(Number(c.n)) && Number(c.n) > 0 ? Math.round(Number(c.n)) : Math.max(1, clears);
    const boons = Array.isArray(c.boons) ? c.boons.filter((b) => typeof b === "string") : [];
    const pure = c.pure === true;
    const loop = Number.isFinite(Number(c.loop)) ? Math.max(0, Math.round(Number(c.loop))) : 0;
    const commendation = {
      n, date: c.date, rank: wpRankLetter(c.rank), ship: shipId, loop,
      score: Math.max(0, Math.round(Number(c.score) || 0)), wpm: Math.max(0, Math.round(Number(c.wpm) || 0)), acc: Number(c.acc) || 0,
      boons, pure
    };
    const rawName = String(save.playerName || "").replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim();
    const name = (Array.from(rawName).slice(0, 16).join("").trim() || "PILOT").toUpperCase();
    const loopText = `LOOP ${loop} · ${pure ? "PURE RUN" : `${boons.length} BOON${boons.length === 1 ? "" : "S"}`}`;
    return { commendation, career, list, clears: Math.max(clears, n), name, shipId, shipName, loopText };
  },

  careerWallpaperFilename(size, data) {
    const d = data || this.careerWallpaperData();
    const s = size === "phone" ? "phone" : "desktop";
    return `TypeR-198X-commendation-${d.commendation.n}-${s}.png`;
  },

  // ------------------------- Render -------------------------
  async renderCareerWallpaper(opts = {}) {
    const size = opts.size === "phone" ? "phone" : "desktop";
    const L = wpLayout(size);
    const canvas = document.createElement("canvas");
    canvas.width = L.W; canvas.height = L.H;
    const g = canvas.getContext("2d");
    g.fillStyle = wpRgba("bg0", 1);
    g.fillRect(0, 0, L.W, L.H);
    let data;
    try { data = this.careerWallpaperData(opts); } catch (_) { data = { commendation: { n: 1, date: Date.now(), rank: "C", ship: "coconut", loop: 0, score: 0, wpm: 0, acc: 0, boons: [], pure: false }, list: [], clears: 1, name: "PILOT", shipId: "coconut", shipName: "The S.S. Coconut", loopText: "LOOP 0 · 0 BOONS" }; }
    const K = WALLPAPER.keys;
    const shipKey = "ships/" + data.shipId;
    const keys = [K.bg, K.fg, K.boss, shipKey, K.drones];
    // The @2x files are what we draw; the loader (resident drawable, else Assets.loadMany) is each key's fallback.
    const fontP = wpFontReady();
    const [bg, fg, boss, ship, drones] = await Promise.all(keys.map((k) => wpAcquire(k).catch(() => null)));
    const fontReady = await fontP;
    let accent = "violet";
    try { const th = typeof getThemeForLevel === "function" ? getThemeForLevel(WALLPAPER.levelIndex) : null; if (th && th.accent && PALETTE.has(th.accent)) accent = th.accent; } catch (_) { accent = "violet"; }
    const S = { g, L, data, img: { bg, fg, boss, ship, drones }, accent, display: wpFontFamily(fontReady), mono: wpFontFamily(false), fontReady };
    const steps = [wpDrawVista, wpDrawBoss, wpDrawDrones, wpDrawShip, wpDrawWordmark, wpDrawIdentity, wpDrawStats, wpDrawBadgeStrip, wpDrawFooter];
    for (const step of steps) {
      g.save();
      try { step(S); } catch (err) { if (typeof console !== "undefined") console.warn("[TypeR] wallpaper step skipped:", step.name, err); }
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.shadowBlur = 0;
    }
    this._wallpaperLast = { size, at: Date.now(), sources: { bg: bg && bg.source, fg: fg && fg.source, boss: boss && boss.source, ship: ship && ship.source, drones: drones && drones.source }, fontReady };
    wpScheduleImageRelease();
    return canvas;
  },

  // ------------------------- Download -------------------------
  async downloadCareerWallpaper(size, opts = {}) {
    const s = size === "phone" ? "phone" : size === "desktop" ? "desktop" : wpAutoSize();
    const btn = opts.button || null;
    if (btn) { btn.classList.add("is-busy"); btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    let name = null;
    try {
      const data = this.careerWallpaperData(opts);
      name = this.careerWallpaperFilename(s, data);
      const canvas = await this.renderCareerWallpaper({ size: s, commendation: data.commendation, career: data.career });
      const blob = await wpToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const canDownload = "download" in a;
      let mode = "download";
      if (canDownload) {
        a.href = url;
        a.download = name;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        mode = "tab";
        const win = window.open(url, "_blank", "noopener");
        if (!win) { location.href = url; mode = "navigate"; }
      }
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* already gone */ } }, WALLPAPER.revokeMs);
      canvas.width = 0;
      if (typeof this.announce === "function") this.announce(`${WALLPAPER_LABELS.saved}: ${name}`);
      if (typeof this.uiTick === "function") { try { this.uiTick("confirm"); } catch (_) { /* audio optional */ } }
      return { ok: true, name, mode };
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[TypeR] wallpaper download unavailable:", err);
      this.careerWallpaperUnavailable();
      return { ok: false, name, mode: "none", error: String((err && err.message) || err) };
    } finally {
      if (btn) { btn.classList.remove("is-busy"); btn.removeAttribute("aria-busy"); btn.disabled = false; }
    }
  },

  // A tainted canvas (file:// shells where images taint) or no blob support: hide every wallpaper button, say so.
  careerWallpaperUnavailable() {
    this._wallpaperUnavailable = true;
    for (const box of document.querySelectorAll(".careerWallpaper")) {
      for (const b of box.querySelectorAll("[data-wallpaper]")) b.classList.add("hidden");
      const hint = box.querySelector(".careerWallpaper__hint");
      if (hint) hint.textContent = WALLPAPER_LABELS.unavailable;
    }
  },

  // ------------------------- UI -------------------------
  careerWallpaperBind(box) {
    if (!box || box._wallpaperBound) return;
    box._wallpaperBound = true;
    box.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-wallpaper]") : null;
      if (!b || !box.contains(b)) return;
      e.preventDefault();
      if (b.classList.contains("is-busy")) return;
      this.downloadCareerWallpaper(b.dataset.wallpaper, { button: b });
    });
  },

  // Fills #careerWallpaperSlot (the career module's victory markup) with the two buttons and the hint. Idempotent;
  // returns true once the slot is filled. Called on modeChange -> victory and from a 300 ms retry (max 10 s) for a
  // slot that appears later.
  careerWallpaperMount() {
    const slot = document.getElementById("careerWallpaperSlot");
    if (!slot) return false;
    if (slot.dataset.wallpaperMounted !== "1" || !slot.querySelector("[data-wallpaper]")) {   // a slot the career module re-filled gets its buttons back
      slot.dataset.wallpaperMounted = "1";
      slot.classList.add("careerWallpaper");
      const row = document.createElement("div");
      row.className = "careerWallpaper__row";
      for (const size of ["desktop", "phone"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn-arcade";
        b.dataset.wallpaper = size;
        b.textContent = WALLPAPER_LABELS[size];
        row.appendChild(b);
      }
      const hint = document.createElement("p");
      hint.className = "careerWallpaper__hint small";
      hint.textContent = WALLPAPER_LABELS.hint;
      slot.replaceChildren(row, hint);
      this.careerWallpaperBind(slot);
    }
    if (this._wallpaperUnavailable) this.careerWallpaperUnavailable();
    return true;
  },

  careerWallpaperMountRetry() {
    if (this._wallpaperRetry) clearTimeout(this._wallpaperRetry);
    const t0 = Date.now();
    const tick = () => {
      this._wallpaperRetry = 0;
      if (this.mode !== "victory") return;
      if (this.careerWallpaperMount()) return;
      if (Date.now() - t0 >= WALLPAPER.retryMaxMs) return;
      this._wallpaperRetry = setTimeout(tick, WALLPAPER.retryMs);
    };
    tick();
  },

  // The records modal's Hall tab: one "Wallpaper" button after the table (hidden with no clears).
  careerWallpaperRecordsMount() {
    const panel = document.getElementById("panelHall");
    if (!panel) return null;
    let box = panel.querySelector("#careerWallpaperRecords");
    if (!box) {
      box = document.createElement("div");
      box.id = "careerWallpaperRecords";
      box.className = "careerWallpaper careerWallpaper--records";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-arcade";
      b.dataset.wallpaper = "auto";
      b.textContent = WALLPAPER_LABELS.auto;
      const hint = document.createElement("p");
      hint.className = "careerWallpaper__hint small";
      hint.textContent = WALLPAPER_LABELS.hintRecords;
      box.append(b, hint);
      panel.appendChild(box);
      this.careerWallpaperBind(box);
    }
    box.classList.toggle("hidden", this.careerWallpaperClears() <= 0);
    if (this._wallpaperUnavailable) this.careerWallpaperUnavailable();
    return box;
  }
});

// Records: the Hall tab's Wallpaper button rides every open (the table is re-rendered there too).
(function wrapWallpaperRecords() {
  const openRecords = Game.prototype.openRecords;
  if (typeof openRecords !== "function") return;
  Game.prototype.openRecords = function () {
    const out = openRecords.apply(this, arguments);
    try { this.careerWallpaperRecordsMount(); } catch (_) { /* presentation only */ }
    return out;
  };
})();

onGameHook("modeChange", function (evt) {
  if (!evt || evt.to !== "victory" || typeof this.careerWallpaperMountRetry !== "function") return;
  this.careerWallpaperMountRetry();
});
