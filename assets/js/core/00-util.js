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

// In-place array compaction: keepFn runs for EVERY element (callers update inside it), survivors keep
// their order and identity (so a lock reference stays valid), and the same array object is returned.
function compactInPlace(arr, keepFn) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (keepFn(item)) arr[w++] = item;
  }
  arr.length = w;
  return arr;
}

function formatInt(n) {
  return Math.floor(n).toLocaleString();
}

// Latin fold for typed characters: strip combining marks (á -> a, İ -> i), map dotless ı, lower-case.
const foldLatin = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").toLowerCase();

// Map a keydown event to the single letter it means for the game, or null (SYS-02 / F042, G001, G004, G006):
//  - composing / Process / Dead keys never type
//  - Ctrl/Meta/Alt chords are the browser's (AltGr and Ctrl+Alt layers excepted)
//  - a one-character key folds to a-z when it can (accents, Turkish i)
//  - otherwise a non-Latin single character falls back to the physical QWERTY position (e.code KeyA..KeyZ)
// Space is no longer a typed character (B1 makes it the lock-release key); digits are not needed anywhere.
function normalizeKey(e) {
  if (!e) return null;
  const k = e.key;
  if (e.isComposing || k === "Process" || k === "Dead") return null;
  const altGraph = typeof e.getModifierState === "function" ? !!e.getModifierState("AltGraph") : false;
  if ((e.ctrlKey || e.metaKey || e.altKey) && !altGraph && !(e.ctrlKey && e.altKey)) return null;
  const single = typeof k === "string" && k.length === 1;
  if (single) {
    const f = foldLatin(k);
    if (/^[a-z]$/.test(f)) return f;
  }
  const m = /^Key([A-Z])$/.exec(e.code || "");
  if (m && single) return m[1].toLowerCase();
  return null;
}

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
