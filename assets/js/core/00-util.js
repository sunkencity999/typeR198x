// Type-R 198X — utilities and environment flags, GAME_HOOKS registry. Classic script; top-level const/function declarations are shared with later scripts via the global scope. Load order is defined in index.html.

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

// ----------------------------- Hook registry (training scaffold) -----------------------------
// Feature files register listeners at load with onGameHook(name, fn) (or push onto GAME_HOOKS[name]); shared code emits
// with game.hook(name, evt) (Game.prototype, game.js) or, where no game instance exists (migrateSave / storeSave),
// runGameHooks(name, evt, self). Listeners run in registration order (= index.html script order) with this = self, each
// inside try/catch (a throw is logged once per event per 5 s and never stops the emit). Payloads may be mutated: the emit
// site reads its documented fields (hold / claimed / cancel / handled / text / mul / lines / hp / perfect ...) after the
// call. Per-frame / per-key / per-spawn payloads are reused objects: listeners read them synchronously, never retain them.
// Re-entrant: a listener may emit (even the same event); each dispatch iterates the length it saw at entry.
const GAME_HOOK_EVENTS = Object.freeze([
  // run / level / mode
  "runWillStart", "levelWillStart", "sectorStart", "modeChange", "storyWillShow", "restartWillRun", "restartWillAsk",
  // input
  "keyEscape", "spaceKey", "keyCorrect", "keyMiss", "lockRelease", "scoreWillAdd", "comboTierWillShow",
  // frame, waves, spawns, damage
  "frameWillUpdate", "tick", "waveWillStart", "waveWillEnd", "waveDrained", "enemyTextWillPick", "enemySpawned",
  "powerupWillSpawn", "damageWillApply", "hullDamage", "leak", "bossWillApproach",
  // checkpoints, clears, results, records
  "checkpoint", "checkpointRestored", "clearWillRepair", "results", "sectorEnd", "recordWillSave",
  "levelCompleteWillShow", "gameOverWillStart", "gameOverWillShow",
  // presentation
  "sectorCardWillShow", "pauseScreenFilled", "menuRender", "recordsOpen", "resultsRender", "renderOverlay",
  // save (static: runGameHooks with no game instance)
  "saveMigrate", "saveStore",
  // emitted by feature files (registered here so listeners can subscribe before the emitter loads)
  "typistInterval", "flightCheckStart", "flightCheckStep", "flightCheckEnd", "modesRunStart", "modesRunEnd",
  "counterSignal", "bossSegmentReset", "bossKill", "overdrive"
]);
const GAME_HOOKS = Object.create(null);
for (const hookName of GAME_HOOK_EVENTS) GAME_HOOKS[hookName] = [];
const GAME_HOOK_ERR_AT = Object.create(null);   // event name -> nowMs() of the last logged listener error

function onGameHook(name, fn) {
  if (typeof fn !== "function") return false;
  if (!GAME_HOOKS[name]) { console.warn(`[TypeR] onGameHook: unknown event "${name}"`); GAME_HOOKS[name] = []; }
  GAME_HOOKS[name].push(fn);
  return true;
}

function runGameHooks(name, evt, self = null) {
  const list = GAME_HOOKS[name];
  if (!list || !list.length) return evt;
  for (let i = 0, n = list.length; i < n; i++) {
    try {
      list[i].call(self, evt);
    } catch (err) {
      const t = nowMs();
      if (!(t - (GAME_HOOK_ERR_AT[name] || -Infinity) < 5000)) {
        GAME_HOOK_ERR_AT[name] = t;
        console.error(`[TypeR] hook listener failed: ${name}`, err);
      }
    }
  }
  return evt;
}

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
