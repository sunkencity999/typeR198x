// Type-R 198X — utilities and environment flags. Classic script; top-level const/function declarations are shared with later scripts via the global scope. Load order is defined in index.html.

const SFX = (typeof window !== "undefined" && window.SFX) ? window.SFX : null;
if (!SFX) {
  throw new Error("SFX module not available; ensure assets/audio/sfx.js is loaded before game.js");
}

// ----------------------------- Utilities -----------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[randi(0, arr.length - 1)];

const IS_FILE_ORIGIN = typeof window !== "undefined" && window.location && window.location.protocol === "file:";
const IS_NATIVE_SHELL = typeof navigator !== "undefined" && /TypeR198X-(macOS|iOS)/i.test(navigator.userAgent || "");
const SKIP_CORS_IMAGES = IS_FILE_ORIGIN || IS_NATIVE_SHELL;

const nowMs = () => performance.now();

function formatInt(n) {
  return Math.floor(n).toLocaleString();
}

function normalizeKey(e) {
  // Only accept printable single-character keys & space.
  const k = e.key;
  if (k === " ") return " ";
  if (k.length === 1) return k.toLowerCase();
  return null;
}

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
