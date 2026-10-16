// Type-R 198X — design tokens mirrored into JS (CONTRACT section 3 / amendments B-2, B-3; PLAN A5).
// Classic script; loads right after 00-util.js so every later file can read PALETTE / FONT / MOTION / SHAKE_PAD
// at its own top level. Colours come from the CSS custom properties in assets/style/tokens.css, read once; the
// fallback hex table keeps the same values when the stylesheet is unavailable (file:// shells, probe pages).

// ----------------------------- Palette -----------------------------
// Keys (B-2): cyan magenta lime amber violet danger text white bg0 bg1 bg2 accent. `white === text`; `accent`
// is set per sector by PALETTE.setAccent(). Every canvas colour goes through PALETTE.rgba(name, alpha) so the
// alpha ladder (.06 .12 .25 .45 .70 .92) and the colour grammar stay in one place.
const PALETTE_FALLBACK = {
  cyan: "#39F5FF",
  magenta: "#FF39D1",
  lime: "#A8FF3A",
  amber: "#FFC14A",
  violet: "#B86BFF",
  danger: "#FF4D6D",
  text: "#F6F7FF",
  bg0: "#05060B",
  bg1: "#070A14",
  bg2: "#0B1030"
};
const PALETTE_VARS = {
  cyan: "--neon-cyan",
  magenta: "--neon-magenta",
  lime: "--neon-lime",
  amber: "--neon-amber",
  violet: "--neon-violet",
  danger: "--danger",
  text: "--c-text",
  bg0: "--bg0",
  bg1: "--bg1",
  bg2: "--bg2"
};

// "#RGB" / "#RRGGBB" / "rgb(a)(r,g,b[,a])" -> [r,g,b] or null.
function parseColorToRgb(str) {
  if (typeof str !== "string") return null;
  const s = str.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return null;
}

const rgbToHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("").toUpperCase();

function readPalette() {
  const rgb = {};
  const hex = {};
  let computed = null;
  try {
    if (typeof document !== "undefined" && document.documentElement && typeof getComputedStyle === "function") {
      computed = getComputedStyle(document.documentElement);
    }
  } catch (e) { computed = null; }
  for (const name of Object.keys(PALETTE_FALLBACK)) {
    let value = null;
    if (computed) {
      try { value = parseColorToRgb(computed.getPropertyValue(PALETTE_VARS[name])); } catch (e) { value = null; }
    }
    rgb[name] = value || parseColorToRgb(PALETTE_FALLBACK[name]);
    hex[name] = rgbToHex(rgb[name]);
  }
  rgb.white = rgb.text;
  hex.white = hex.text;
  rgb.accent = rgb.cyan.slice();
  hex.accent = hex.cyan;

  const memo = new Map();
  // Unknown names are loud on local/dev origins (caught by the A2 loop guard) and degrade to magenta elsewhere.
  const strict = (() => {
    try {
      const host = (typeof location !== "undefined" && location.hostname) || "";
      return host === "localhost" || host === "127.0.0.1" || host === "" || (typeof location !== "undefined" && location.protocol === "file:");
    } catch (e) { return false; }
  })();
  const warned = new Set();

  const palette = {
    rgb,
    hex,
    strict,
    names: Object.keys(rgb),
    rgba(name, alpha = 1) {
      const key = name + "|" + alpha;
      let out = memo.get(key);
      if (out) return out;
      const c = rgb[name];
      if (!c) {
        if (strict) throw new Error(`PALETTE: unknown colour "${name}"`);
        if (!warned.has(name)) { warned.add(name); if (typeof console !== "undefined") console.warn("PALETTE: unknown colour", name); }
        return palette.rgba("magenta", alpha);
      }
      const a = Math.max(0, Math.min(1, Number(alpha)));
      out = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      memo.set(key, out);
      return out;
    },
    // Accepts a token name ("violet") or a CSS colour ("#B86BFF"). Returns the resolved hex.
    setAccent(value) {
      let c = rgb[value] && value !== "accent" ? rgb[value] : parseColorToRgb(value);
      if (!c) c = rgb.cyan;
      rgb.accent = c.slice();
      hex.accent = rgbToHex(c);
      for (const key of [...memo.keys()]) if (key.startsWith("accent|")) memo.delete(key);
      return hex.accent;
    },
    has(name) { return !!rgb[name]; }
  };
  // PALETTE.bg0 / PALETTE.cyan ... read as hex strings (render() uses PALETTE.bg0 for the base fill).
  for (const name of Object.keys(hex)) {
    Object.defineProperty(palette, name, { get: () => hex[name], enumerable: true });
  }
  return palette;
}

const PALETTE = readPalette();

// ----------------------------- Fonts -----------------------------
// FONT.target is the MONOSPACE stack for everything the player reads to type (plates, boss segments, capsule
// labels, floaters): stable advance widths and l/I/1 discrimination. FONT.display is Orbitron for titles and
// banners only (B-3).
const FONT = (() => {
  const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  let mono = FALLBACK_MONO;
  try {
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
      if (v) mono = v;
    }
  } catch (e) { mono = FALLBACK_MONO; }
  const display = `"Orbitron", ${mono}`;
  return {
    mono,
    displayFamily: display,
    target: (px, weight = 600) => `${weight} ${Math.round(px)}px ${mono}`,
    display: (px, weight = 800) => `${weight} ${Math.round(px)}px ${display}`
  };
})();

// ----------------------------- Motion -----------------------------
const MOTION = Object.freeze({ tap: 0.09, state: 0.16, screen: 0.28, hero: 0.48, cine: 0.9, stagger: 0.04 });

const easeOutCubic = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const easeOutExpo = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : 1 - Math.pow(2, -10 * t));
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  const u = Math.max(0, Math.min(1, t)) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};
const easeInOutCubic = (t) => {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

// Shake margin (logical px): the base fill and the background bitmaps extend this far past the playfield so
// the trauma camera never reveals the page behind the canvas (CONTRACT section 0).
const SHAKE_PAD = 20;

// ----------------------------- Effects clock -----------------------------
// Numbers behind the trauma camera, hit-stop, flash channels, weapon staging and the ship's thruster (CONTRACT
// section 11; PLAN D1, D2, D4). 80-fx.js and 75-fx-draw.js read them through FX_MOTION so every tuning value
// lives in one table.
const FX_MOTION = Object.freeze({
  traumaDecay: 1.4, traumaPx: 14, shakeMaxPx: 18, shakeRotRad: 0.02, shakeHz: Object.freeze([23, 37]),
  hitStopScale: 0.15, hitStopCap: 0.18, hitStopCapReduced: 0.06,
  hitStop: Object.freeze({ word: 0.045, letter: 0.03, pickup: 0.03, segment: 0.09, bossDeath: 0.16 }),
  finaleSlowMo: Object.freeze({ scale: 0.35, hold: 0.6, ease: 0.4 }),
  recoilPerKey: 0.35, recoilPerKill: 0.8, recoilDecay: 6, recoilPx: 10,
  heatPerKey: 0.25, heatDecay: 1.2,
  kickPx: 14, kickEase: 8, hitT: 0.12,
  typoGlyphS: 0.4, typoEdgeS: 0.1, typoFlashDecay: 3, damageFlashDecay: 1.8, whiteFlashDecay: 2, introPulseDecay: 1.2,
  vignetteMax: 0.35, introPulseMax: 0.25, whiteFlashMax: 0.12, whiteFlashMaxReduced: 0.08,
  lowHp: Object.freeze({ base: 0.10, amp: 0.08, hz: 1.2, reduced: 0.12 }),
  ringLife: 0.28, ring: Object.freeze({ impact: 12, kill: 20, letter: 12, segment: 60, bossDeath: 180, bossDeathLife: 0.6 }),
  bulletLife: 0.15, bulletHeadS: 0.035, bulletTailS: 0.07, muzzleLife: 0.06, boltLife: 0.12,
  debris: Object.freeze({ gravity: 520, life: 0.7 }),
  plume: Object.freeze({ base: 26, heat: 30, flicker: 6, flickerHz: 23, recoil: 0.6, staticLen: 36 }),
  exhaustRate: 90, bobPx: 3, bobHz: 1.6, rollRad: 0.02,
  shield: Object.freeze({ r: 66, dash: Object.freeze([8, 6]), spinDegS: 30, blinkS: 2, blinkHz: 3, cap: 9, capStacked: 15 })
});
