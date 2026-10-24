// Type-R 198X — WORDS track (D7 / D8): COMMON_WORDS and PHRASES, the wave-pool mix, two-word plates (Space types the gap),
// the weak-key bias and the THREAT INTEL sector-card line. Classic script: loads after 20-constants.js, before 30-content.js.
// Game does not exist yet when this file runs: runtime behaviour is GAME_HOOKS listeners (this = game) on enemyTextWillPick,
// enemySpawned, waveWillStart, sectorCardWillShow and spaceKey, plus plain lexicon*() functions that 30-content.js (load
// time), 70-canvas.js (per plate) and 75-fx-draw.js call when they exist. Top-level names: COMMON_WORDS, PHRASES, LEXICON*,
// lexicon*. Nothing here allocates per frame or writes the save per key.
//
// D8 content: COMMON_WORDS (500, frequency order; [0..97] = the English top 100 minus "a", "i"), PHRASES (126 two-word
// targets), LEXICON_INVENTIONS (taken out of the wave pools; bosses, callouts, capsules and attract keep ALL_WORDS) and
// LEXICON_NEON_EXTRA (real neon words for the long windows). Shares are of word spawns: S1-5 common .5, S6-10 .3; two-word
// .15 from S4, .2 from S7. D7: once MEASURE's typistWeakKeys() is non-empty, 35 % of letter draws come from the weak keys
// inside the wave's alphabet and 35 % of word picks from words holding a weak key or typistWeakBigram().
// Quiet (no pick, no card line, no tip, Space unhandled) while the Flight Check runs (CONTRACT 8.y W4); endless / drill
// text belongs to MODES (R35). Every gameplay draw goes through game.rand() (seeded in a Daily Sortie).

const COMMON_WORDS = Object.freeze([
  "the", "be", "to", "of", "and", "in", "that", "have", "it", "for", "not", "on", "with", "he", "as", "you", "do",
  "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one",
  "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know", "take", "people", "into", "year", "your",
  "good", "some", "could", "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over",
  "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new",
  "want", "because", "any", "these", "give", "day", "most", "us", "is", "are", "more", "was", "home", "has", "free",
  "here", "business", "help", "been", "were", "service", "find", "had", "name", "state", "world", "next", "last",
  "music", "system", "city", "number", "such", "best", "where", "high", "school", "through", "each", "years",
  "order", "very", "book", "company", "read", "group", "need", "many", "said", "does", "under", "general",
  "research", "university", "full", "program", "life", "days", "part", "great", "real", "made", "used", "called",
  "asked", "looked", "wanted", "turned", "started", "played", "moved", "opened", "off", "line", "before", "did",
  "right", "those", "education", "community", "within", "area", "phone", "between", "family", "long", "show",
  "black", "special", "much", "open", "today", "technology", "south", "case", "project", "same", "own", "found",
  "house", "both", "game", "power", "while", "down", "computer", "three", "place", "end", "following", "without",
  "north", "current", "big", "water", "history", "personal", "since", "change", "white", "small", "government",
  "children", "during", "return", "students", "times", "level", "love", "old", "call", "another", "why", "still",
  "money", "quality", "every", "country", "private", "little", "save", "include", "man", "food", "different",
  "learn", "around", "job", "process", "room", "point", "west", "left", "team", "week", "live", "large", "table",
  "however", "start", "air", "yes", "second", "movie", "better", "friend", "study", "again", "play", "never",
  "complete", "things", "against", "person", "below", "got", "let", "above", "side", "problem", "language", "story",
  "experience", "create", "body", "young", "important", "few", "east", "paper", "example", "something", "road",
  "question", "night", "hard", "building", "always", "result", "light", "write", "easy", "picture", "possible",
  "month", "star", "future", "space", "hand", "sun", "interest", "child", "keep", "baby", "learning", "run",
  "popular", "try", "president", "head", "until", "color", "away", "once", "others", "society", "sure", "tell",
  "able", "already", "close", "drive", "several", "short", "ask", "past", "natural", "done", "window", "ever",
  "early", "sound", "present", "word", "talk", "thing", "true", "together", "fast", "meet", "far", "often", "watch",
  "feel", "though", "everything", "words", "town", "heart", "knowledge", "girl", "clear", "simple", "quick", "whole",
  "later", "fire", "enough", "along", "among", "face", "remember", "thought", "stay", "turn", "mean", "although",
  "force", "river", "seen", "stop", "build", "soon", "continue", "across", "someone", "anything", "believe", "mind",
  "hope", "inside", "came", "nothing", "certain", "fine", "hour", "leave", "woman", "kind", "move", "actually",
  "follow", "lead", "went", "outside", "allow", "almost", "took", "song", "late", "fall", "idea", "win", "reason",
  "answer", "voice", "everyone", "hold", "happy", "ready", "understand", "probably", "strong", "distance", "boy",
  "beautiful", "forward", "bring", "mother", "told", "door", "develop", "mountain", "consider", "behind", "require",
  "morning", "eye", "character", "maybe", "yourself", "break", "dark", "finally", "father", "teacher", "hear",
  "sometimes", "stand", "heard", "begin", "attention", "jump", "listen", "wind", "situation", "perhaps", "minute",
  "walk", "wait", "freedom", "seem", "suggest", "gave", "reach", "moment", "adventure", "expect", "yesterday",
  "brother", "direction", "powerful", "dream", "felt", "carry", "ocean", "whatever", "explore", "knew", "speak",
  "finish", "sleep", "drink", "eat", "wonderful", "moon", "kept", "sky", "happen", "slow", "grow", "rain", "planet",
  "discover", "explain", "happened", "lose", "universe", "tomorrow", "decide", "tonight", "journey", "afternoon",
  "thousand", "impossible", "surprise", "everybody", "smile", "midnight", "everywhere"
]);

const PHRASES = Object.freeze([
  "of course", "at last", "in time", "on time", "right now", "next time", "last night", "good night", "good luck",
  "thank you", "each other", "at home", "go home", "come back", "look back", "find out", "keep going", "every day",
  "one more", "no way", "so far", "as well", "at least", "in fact", "for now", "for sure", "too late", "not yet",
  "long ago", "first time", "real life", "old friend", "best friend", "big city", "full moon", "open door",
  "fresh start", "hard work", "free time", "wake up", "move on", "run away", "slow down", "speed up", "make sure",
  "take care", "let go", "get ready", "good morning", "well done", "fast lane", "red light", "blue sky",
  "black hole", "white noise", "green light", "deep space", "me too", "join us", "be brave", "it works", "by night",
  "we rise", "or else", "an echo", "my turn", "if only", "he knows", "do more", "to infinity", "warp core",
  "neon city", "night train", "data stream", "city lights", "spark plug", "laser beam", "star map", "solar wind",
  "moon base", "space dock", "radio wave", "signal lost", "power grid", "turbo boost", "night sky", "neon sign",
  "pixel art", "sound wave", "light speed", "time warp", "chrome heart", "static noise", "dark matter",
  "zero gravity", "ion engine", "fuel cell", "flight deck", "control room", "boss fight", "final boss",
  "bonus round", "extra life", "save point", "game over", "high score", "next level", "power up", "press start",
  "insert coin", "player one", "top speed", "full power", "lock on", "level up", "plasma core", "photon beam",
  "echo chamber", "ghost signal", "error code", "system crash", "access granted", "storm front", "arcade cabinet",
  "type fast", "type clean"
]);

const LEXICON_INVENTIONS = Object.freeze([
  "tokyo", "saturn", "digi", "retrobit", "chrono", "lazer", "sparkplug", "polystar", "afterburn", "cyberline",
  "turbowave", "nighttrain", "skybridge", "hyperjump", "nanoforge", "phasegate", "neonforge", "datastream",
  "holomatrix", "retroshock", "geostorm", "ionlanes", "spectralink", "quantaflux", "metadrift", "laserbank",
  "dreamline", "citylight", "hyperlane", "dataglide", "omnivoid", "nanoloom", "stormrail", "polyverse", "synthwave",
  "neutrify", "skyforge", "holopunk", "bytecycle", "parallaxing", "electromancer", "metachronistic",
  "ultrachromatic", "polyharmonics", "chronoelastic", "retrotransmission", "hypervectorial", "telekinetics",
  "chronostatic", "vibrosensing", "quantumspliced", "aerolithics", "transnebulous", "astrocartography",
  "tachyometric", "lightyear"
]);

const LEXICON_NEON_EXTRA = Object.freeze([
  "pinball", "jukebox", "highway", "skyline", "neutron", "voltage", "freeway", "spectrum", "infrared", "electron",
  "particle", "velocity", "momentum", "luminous", "blackout", "receiver", "kilobyte", "megabyte", "frequency",
  "broadcast", "amplifier", "generator", "radiation", "magnetism", "moonlight", "billboard", "blueprint",
  "countdown", "hurricane", "megahertz", "spaceship", "nightlife", "transistor", "oscillator", "wavelength",
  "lighthouse", "skyscraper", "headlights", "checkpoint", "navigation", "propulsion", "turbulence", "atmosphere",
  "laboratory", "microphone", "television", "cyberspace", "ultraviolet", "searchlight", "streetlight", "coordinates",
  "observatory", "electricity", "synthesizer", "thunderbolt", "transmitter", "interceptor", "radioactive",
  "fluorescent", "stratosphere", "acceleration", "incandescent", "kaleidoscope", "constellation"
]);

// Copy (D7 / D8). The sector-card line is built in lexiconThreatIntelLine().
const LEXICON_COPY = Object.freeze({
  phraseTip: "TWO-WORD TARGET — SPACE TYPES THE GAP",
  intelPrefix: "THREAT INTEL · HOSTILES PROBING ",
  intelSpeechPrefix: "Threat intel: hostiles probing "
});

// Numbers (D7 / D8 plus the refinements in spec-words.md).
const LEXICON = Object.freeze({
  commonShareEarly: 0.5,      // D8: share of word spawns from COMMON_WORDS, sectors 1-5
  commonShareLate: 0.3,       //     sectors 6-10
  commonLateFromLevel: 6,
  phraseFromLevel: 4,         // D8: two-word plates from sector 4 ...
  phraseShare: 0.15,          //     ... 15 % of word spawns
  phraseLateFromLevel: 7,
  phraseShareLate: 0.2,       //     20 % from sector 7
  weakShare: 0.35,            // D7: letter draws and word picks that prefer the pilot's weak keys / bigram
  topCount: 98,               // COMMON_WORDS[0..97] = the English top 100 (minus "a", "i"), in rank order ...
  topWeight: 2,               // ... drawn twice as often as the rest of the common pool (th / he / ou / nd)
  minCommonPool: 12,          // a wave window holding fewer common words / phrases than this skips that source
  minPhrasePool: 8,
  phraseWinMinAdd: 2,         // phrase window = [win.min + 2, win.max + 5] clamped to [5, 15]
  phraseWinMaxAdd: 5,
  phraseLenMin: 5,
  phraseLenMax: 15,
  repeatRing: 12,             // same anti-repeat ring as pickWord (12 entries, 6 rerolls)
  rerolls: 6,
  avoidAttempts: 9,           // same first-letter retry budget as makeEnemyText
  dotR: 0.09,                 // gap dot radius = max(dotRMin, font px x dotR)
  dotRMin: 1.75,
  dotDoneA: 0.25,             // typed gap
  dotIdleA: 0.45,             // untyped gap on an unlocked plate (text) or a locked plate (lime)
  dotNextA: 0.92,             // the gap is the locked plate's next key (lime, with the caret under it)
  tipMs: 4000
});
const LEXICON_EMPTY = Object.freeze([]);
const lexiconInventionSet = new Set(LEXICON_INVENTIONS);
const lexiconPoolCache = new Map();
const lexiconDotFill = { done: "", idle: "", lockedIdle: "", next: "" };   // PALETTE strings, filled on the first draw

// ------------------------- Registration -------------------------
// onGameHook (00-util.js, scaffold) when present; the bare GAME_HOOKS push otherwise (CONTRACT 1.1, both work).
function lexiconOn(name, fn) {
  if (typeof onGameHook === "function") return onGameHook(name, fn);
  if (typeof GAME_HOOKS !== "object" || !GAME_HOOKS) return false;
  (GAME_HOOKS[name] || (GAME_HOOKS[name] = [])).push(fn);
  return true;
}

function lexiconRand(game) {
  return (game && typeof game.rand === "function") ? game.rand() : Math.random();
}

// ------------------------- Content (load time; called by 30-content.js) -------------------------
// The themed wave pool: ALL_WORDS without the non-dictionary inventions, plus real neon words for the long windows.
function lexiconThemedPool(allWords) {
  const out = [];
  const seen = new Set();
  for (const list of [allWords || LEXICON_EMPTY, LEXICON_NEON_EXTRA]) {
    for (const w of list) {
      if (seen.has(w) || lexiconInventionSet.has(w) || !/^[a-z]+$/.test(w)) continue;
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

function lexiconShares(level) {
  const L = level | 0;
  return {
    common: L >= LEXICON.commonLateFromLevel ? LEXICON.commonShareLate : LEXICON.commonShareEarly,
    phrase: L >= LEXICON.phraseLateFromLevel ? LEXICON.phraseShareLate : (L >= LEXICON.phraseFromLevel ? LEXICON.phraseShare : 0)
  };
}

function lexiconPhraseWindow(win) {
  const min = clamp((win.min | 0) + LEXICON.phraseWinMinAdd, LEXICON.phraseLenMin, LEXICON.phraseLenMax);
  const max = clamp((win.max | 0) + LEXICON.phraseWinMaxAdd, min, LEXICON.phraseLenMax);
  return { min, max };
}

function lexiconMeanLen(list) {
  if (!list || !list.length) return 0;
  let s = 0;
  for (const x of list) s += x.length;
  return s / list.length;
}

// The common pool as drawn: the top-100 entries appear topWeight times (unique list -> draw list).
function lexiconCommonDraw(common) {
  const out = [];
  for (const x of common) {
    out.push(x);
    if (COMMON_WORDS.indexOf(x) < LEXICON.topCount) for (let k = 1; k < LEXICON.topWeight; k++) out.push(x);
  }
  return out;
}

// Per-sector pools, called once per LEVELS row at the end of attachLevelContent (after cfg.words / waveWords exist):
// cfg.waveCommon[w] (unique), cfg.waveCommonDraw[w] (weighted draw list), cfg.wavePhrases[w],
// cfg.waveShares[w] {common, phrase} (0 when the pool is too thin),
// cfg.waveTextLen[w] (expected characters of one word spawn, read by waveCharsPerEnemy) and cfg.maxTextLen
// (longest text the sector can spawn, read by warmPlateCache).
function lexiconAttachLevel(cfg) {
  const sh = lexiconShares(cfg.level);
  cfg.waveCommon = [];
  cfg.waveCommonDraw = [];
  cfg.wavePhrases = [];
  cfg.waveShares = [];
  cfg.waveTextLen = [];
  let maxLen = 1;
  for (let w = 0; w < 3; w++) {
    const win = waveLengthWindow(cfg, w);
    const common = COMMON_WORDS.filter((x) => x.length >= win.min && x.length <= win.max);
    const pw = lexiconPhraseWindow(win);
    const phrases = sh.phrase > 0 ? PHRASES.filter((p) => p.length >= pw.min && p.length <= pw.max) : [];
    const themed = wordsForWave(cfg, w);
    const pc = common.length >= LEXICON.minCommonPool ? sh.common : 0;
    const pp = phrases.length >= LEXICON.minPhrasePool ? sh.phrase : 0;
    const draw = lexiconCommonDraw(common);
    cfg.waveCommon.push(common);
    cfg.waveCommonDraw.push(draw);
    cfg.wavePhrases.push(pp > 0 ? phrases : []);
    cfg.waveShares.push({ common: pc, phrase: pp });
    cfg.waveTextLen.push(pp * lexiconMeanLen(phrases) + pc * lexiconMeanLen(draw) + (1 - pp - pc) * lexiconMeanLen(themed));
    for (const list of [common, pp > 0 ? phrases : LEXICON_EMPTY, themed]) for (const x of list) if (x.length > maxLen) maxLen = x.length;
  }
  cfg.maxTextLen = maxLen;
  return cfg;
}

// Pools for an arbitrary single-word window (MODES: Endless / Drill). Cached; at most 14 x 14 entries.
function lexiconPoolsFor(min, max) {
  const lo = clamp(min | 0, 2, LEXICON.phraseLenMax);
  const hi = clamp(max | 0, lo, LEXICON.phraseLenMax);
  const key = lo * 100 + hi;
  let p = lexiconPoolCache.get(key);
  if (p) return p;
  const src = (typeof WAVE_WORDS !== "undefined") ? WAVE_WORDS : ((typeof ALL_WORDS !== "undefined") ? lexiconThemedPool(ALL_WORDS) : LEXICON_EMPTY);
  const pw = lexiconPhraseWindow({ min: lo, max: hi });
  const common = COMMON_WORDS.filter((x) => x.length >= lo && x.length <= hi);
  p = {
    min: lo,
    max: hi,
    common,
    commonDraw: lexiconCommonDraw(common),
    themed: src.filter((x) => x.length >= lo && x.length <= hi),
    phrases: PHRASES.filter((x) => x.length >= pw.min && x.length <= pw.max)
  };
  lexiconPoolCache.set(key, p);
  return p;
}

function lexiconIsPhrase(text) {
  return typeof text === "string" && text.indexOf(" ") > 0;
}

// ------------------------- Weak keys (D7; MEASURE's profile is the source) -------------------------
// Adapter over MEASURE's API (32-typist.js). Absent API, a throw or an empty profile -> no weak keys, bias off.
function lexiconWeakTargets(game) {
  let keys = [];
  let bigram = null;
  try {
    if (game && typeof game.typistWeakKeys === "function") keys = game.typistWeakKeys() || [];
    if (game && typeof game.typistWeakBigram === "function") bigram = game.typistWeakBigram() || null;
  } catch (_) { keys = []; bigram = null; }
  const out = [];
  for (const k of Array.isArray(keys) ? keys : LEXICON_EMPTY) {
    const c = typeof k === "string" ? k : (k && typeof k.key === "string" ? k.key : "");
    if (/^[a-z]$/.test(c) && out.indexOf(c) === -1 && out.length < 3) out.push(c);
  }
  if (bigram && typeof bigram === "object") bigram = bigram.bigram || bigram.key || null;
  return { keys: out, bigram: (typeof bigram === "string" && /^[a-z]{2}$/.test(bigram)) ? bigram : null };
}

function lexiconHasWeakChars(word, keys, bigram) {
  if (bigram && word.indexOf(bigram) !== -1) return true;
  for (let i = 0; i < keys.length; i++) if (word.indexOf(keys[i]) !== -1) return true;
  return false;
}

// One snapshot per sector (taken on the sector card, or lazily on the first wave of a run without a card), so the
// bias and the card line agree for the whole sector even while the live profile moves.
function lexiconWeakSnapshot(game, force = false) {
  const li = game.levelIndex | 0;
  let s = game._lexWeak;
  if (s && !force && s.levelIndex === li && s.runRef === (game.run || null)) return s;
  const t = lexiconWeakTargets(game);
  const cfg = (typeof LEVELS !== "undefined") ? LEVELS[li] : null;
  s = { levelIndex: li, runRef: game.run || null, keys: t.keys, bigram: t.bigram, active: t.keys.length > 0, weakLetters: ["", "", ""], cache: new Map() };
  if (s.active && cfg) {
    for (let w = 0; w < 3; w++) {
      const set = letterSetForWave(cfg, w);
      let str = "";
      for (const k of s.keys) if (set.indexOf(k) !== -1) str += k;
      s.weakLetters[w] = str;
    }
  }
  game._lexWeak = s;
  return s;
}

function lexiconHasWeak(game) {
  return lexiconWeakTargets(game).keys.length > 0;
}

function lexiconWeakPool(snap, key, pool) {
  let p = snap.cache.get(key);
  if (!p) {
    p = pool.filter((x) => lexiconHasWeakChars(x, snap.keys, snap.bigram));
    snap.cache.set(key, p);
  }
  return p;
}

function lexiconRingPick(game, pool) {
  const ring = game.recentWords || (game.recentWords = []);
  let x = pool[(lexiconRand(game) * pool.length) | 0];
  for (let i = 0; i < LEXICON.rerolls && ring.indexOf(x) !== -1; i++) x = pool[(lexiconRand(game) * pool.length) | 0];
  ring.push(x);
  if (ring.length > LEXICON.repeatRing) ring.shift();
  return x;
}

// ------------------------- The spawn decision -------------------------
// Endless and Drill pick their own text (MODES, C7); the campaign and the Daily Sortie use this picker.
function lexiconModeOwnsText(game) {
  const mode = (game && typeof game.runMode === "function") ? game.runMode() : ((game && game.run && game.run.mode) || "campaign");
  return mode === "endless" || mode === "drill";
}

// The Flight Check (ONBOARD, 17-onboarding.js) plays with run === null and runMode() "campaign": WORDS must not alter it
// (CONTRACT 8.y W4). Its scripted plates never pass through the spawner; this guard keeps every listener inert anyway.
function lexiconQuiet(game) {
  return !!(game && typeof game.isFlightCheckActive === "function" && game.isFlightCheckActive()) || lexiconModeOwnsText(game);
}

// One attempt of makeEnemyText: letter (graded set, 35 % from the weak keys inside it) or word (phrase / common /
// themed by the wave's shares, 35 % of word picks from the weak-filtered pool, anti-repeat ring). The first-letter
// retry stays in makeEnemyText. tuning (optional, explicit callers only): { window:{min,max}, commonShare, phraseShare,
// weakShare, letterSet, letterRatio }; any field left out keeps the campaign value.
function lexiconPickOnce(game, cfg, wave = 0, tuning = null) {
  const w = clamp(wave | 0, 0, 2);
  const t = tuning || null;
  let common, commonDraw, themed, phrases, poolKey;   // poolKey: weak-pool cache key base (numeric: no string per pick)
  if (t && t.window) {
    const P = lexiconPoolsFor(t.window.min, t.window.max);
    common = P.common; commonDraw = P.commonDraw; themed = P.themed; phrases = P.phrases; poolKey = 30 + (P.min * 100 + P.max) * 3;
  } else {
    common = (cfg.waveCommon && cfg.waveCommon[w]) || LEXICON_EMPTY;
    commonDraw = (cfg.waveCommonDraw && cfg.waveCommonDraw[w]) || common;
    themed = wordsForWave(cfg, w);
    phrases = (cfg.wavePhrases && cfg.wavePhrases[w]) || LEXICON_EMPTY;
    poolKey = w * 3;
  }
  if (!themed.length) themed = cfg.words && cfg.words.length ? cfg.words : (common.length ? common : COMMON_WORDS);
  const base = (cfg.waveShares && cfg.waveShares[w]) || lexiconShares(cfg.level);
  const pc = common.length >= LEXICON.minCommonPool ? (t && Number.isFinite(t.commonShare) ? t.commonShare : base.common) : 0;
  const pp = phrases.length >= LEXICON.minPhrasePool ? (t && Number.isFinite(t.phraseShare) ? t.phraseShare : base.phrase) : 0;
  const weakShare = t && Number.isFinite(t.weakShare) ? t.weakShare : LEXICON.weakShare;
  const letters = (t && typeof t.letterSet === "string" && t.letterSet.length) ? t.letterSet : letterSetForWave(cfg, w);
  const letterRatio = (t && Number.isFinite(t.letterRatio)) ? t.letterRatio : waveLetterRatio(cfg, w);
  const snap = weakShare > 0 ? lexiconWeakSnapshot(game) : null;
  const weakOn = !!(snap && snap.active);
  let weakLetters = "";
  if (weakOn) {
    // the snapshot's per-wave strings are for LEVELS[levelIndex]; any other alphabet (MODES) is intersected here
    if (letters === letterSetForWave(LEVELS[snap.levelIndex] || cfg, w)) weakLetters = snap.weakLetters[w];
    else for (const k of snap.keys) if (letters.indexOf(k) !== -1) weakLetters += k;
  }
  const st = game._lexStats || (game._lexStats = { letters: 0, weakLetters: 0, themed: 0, common: 0, phrase: 0, weakWords: 0 });
  let text;
  if (lexiconRand(game) < letterRatio) {
    if (weakLetters.length && lexiconRand(game) < weakShare) { st.weakLetters++; text = weakLetters[(lexiconRand(game) * weakLetters.length) | 0]; }
    else text = letters[(lexiconRand(game) * letters.length) | 0];
    st.letters++;
    return text;
  }
  const r = lexiconRand(game);
  let pool = themed, src = 0;
  if (r < pp) { src = 2; pool = phrases; } else if (r < pp + pc) { src = 1; pool = commonDraw; }
  if (weakOn && weakShare > 0 && lexiconRand(game) < weakShare) {
    const wp = lexiconWeakPool(snap, poolKey + src, pool);   // src 0 themed / 1 common / 2 phrase
    if (wp.length) { pool = wp; st.weakWords++; }
  }
  if (src === 2) st.phrase++; else if (src === 1) st.common++; else st.themed++;
  return lexiconRingPick(game, pool);
}

// The whole decision with makeEnemyText's first-letter retry (9 attempts, then accept): for callers outside the hook
// (probes, MODES if it wants the campaign picker with a tuning).
function lexiconPickText(game, cfg, wave = 0, avoidSet = null, tuning = null) {
  let text = null;
  for (let attempt = 0; attempt < LEXICON.avoidAttempts; attempt++) {
    text = lexiconPickOnce(game, cfg, wave, tuning);
    if (!avoidSet || !avoidSet.has(text[0])) break;
  }
  return text;
}

// ------------------------- Space types the gap (D8) -------------------------
function lexiconSpaceTypable(game) {
  if (!game || game.mode !== "playing" || game.inBoss || game.bossClear) return false;
  if (typeof game.inputLockedOut === "function" && game.inputLockedOut()) return false;
  const lock = game.lock;
  const ref = lock && lock.ref;
  return !!(ref && lock.kind === "enemy" && ref.alive && !ref.dying && typeof ref.nextChar === "function" && ref.nextChar() === " ");
}

// ------------------------- Render (called by drawSplitText for a run that contains a space) -------------------------
// Monospace (FONT.target): every glyph, the space included, advances (wd + wr) / chars, so the gap keeps one glyph
// cell and gets a dim centred dot. xr = where the remaining run starts (x0 + wd, or later when MEASURE's typo glyph sits
// between the halves). No allocation, no shadowBlur, no composite change.
function lexiconDrawGapDots(ctx, done, remaining, x0, wd, wr, y, opts, xr) {
  const nd = done ? done.length : 0;
  const nr = remaining ? remaining.length : 0;
  const n = nd + nr;
  if (n < 3) return;
  const adv = (wd + wr) / n;
  const r = Math.max(LEXICON.dotRMin, fontPx(opts && opts.font ? opts.font : ctx.font) * LEXICON.dotR);
  const locked = !!(opts && opts.caret);
  const xs = Number.isFinite(xr) ? xr : x0 + wd;
  const f = lexiconDotFill;
  if (!f.done) {
    f.done = PALETTE.rgba("text", LEXICON.dotDoneA);
    f.idle = PALETTE.rgba("text", LEXICON.dotIdleA);
    f.lockedIdle = PALETTE.rgba("lime", LEXICON.dotIdleA);
    f.next = PALETTE.rgba("lime", LEXICON.dotNextA);
  }
  for (let i = 0; i < n; i++) {
    const isDone = i < nd;
    if ((isDone ? done.charCodeAt(i) : remaining.charCodeAt(i - nd)) !== 32) continue;
    ctx.fillStyle = isDone ? f.done : (locked ? (i === nd ? f.next : f.lockedIdle) : f.idle);
    ctx.beginPath();
    ctx.arc((isDone ? x0 + (i + 0.5) * adv : xs + (i - nd + 0.5) * adv), y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// What an error cue shows for an expected character: the space is drawn as a middle dot (every font has U+00B7).
function lexiconGlyphFor(ch) {
  return ch === " " ? "·" : ch;
}

// ------------------------- THREAT INTEL (D7) -------------------------
function lexiconThreatIntelLine(game) {
  const s = game && game._lexWeak;
  if (!s || !s.active) return null;
  const parts = s.keys.map((k) => k.toUpperCase());
  if (s.bigram) parts.push(s.bigram.toUpperCase());
  const spoken = s.keys.map((k) => k.toUpperCase());
  if (s.bigram) spoken.push(s.bigram.toUpperCase().split("").join(" "));
  return { key: "threatIntel", order: 20, color: "magenta", text: LEXICON_COPY.intelPrefix + parts.join(" · "), say: `${LEXICON_COPY.intelSpeechPrefix}${spoken.join(", ")}.` };
}

// ------------------------- Listeners -------------------------
// E19 enemyTextWillPick: makeEnemyText, once per attempt (reused evt, text reset to null each attempt; MODES runs after).
lexiconOn("enemyTextWillPick", function (evt) {
  if (!evt || evt.text != null || !evt.cfg || lexiconQuiet(this)) return;
  evt.text = lexiconPickOnce(this, evt.cfg, evt.wave, null);
});

// E37 sectorCardWillShow (showBanner): snapshot the weak keys for the sector, add the THREAT INTEL line (order 20).
lexiconOn("sectorCardWillShow", function (card) {
  if (!card || lexiconQuiet(this)) return;
  this._lexStats = null;
  lexiconWeakSnapshot(this, true);
  const line = lexiconThreatIntelLine(this);
  if (line && Array.isArray(card.lines)) card.lines.push(line);
});

// E16 waveWillStart: a run that never showed a sector card still gets its snapshot.
lexiconOn("waveWillStart", function () {
  if (!lexiconQuiet(this)) lexiconWeakSnapshot(this);
});

// E20 enemySpawned: the first two-word plate of a save gets one tip (announced by showToast), one storeSave per save.
lexiconOn("enemySpawned", function (evt) {
  const en = evt && evt.en;
  if (!en || en.kind !== "enemy" || !lexiconIsPhrase(en.text) || this._lexTipShown || !this.save || lexiconQuiet(this)) return;
  this._lexTipShown = true;
  const seen = this.save.tutorialSeen && typeof this.save.tutorialSeen === "object" ? this.save.tutorialSeen : (this.save.tutorialSeen = {});
  if (seen.phrase) return;
  seen.phrase = true;
  if (typeof storeSave === "function") storeSave(this.save);
  if (typeof this.showToast === "function") this.showToast(LEXICON_COPY.phraseTip, { kind: "tip", key: "phrase", ms: LEXICON.tipMs });
});

// E07 / E08 spaceKey: Space types the gap when it is the locked plate's next character (keyboard step 9, touch text); else
// the emit site releases as before. Before the first audio unlock it chains on ensureAudio() like a letter key.
lexiconOn("spaceKey", function (evt) {
  if (!evt || evt.handled || !lexiconSpaceTypable(this)) return;
  if (typeof this.isFlightCheckActive === "function" && this.isFlightCheckActive()) return;   // W4: Space releases there
  evt.handled = true;
  if (typeof this.pokeAudio === "function") this.pokeAudio();
  if (!this.audioReady && !this.audioUnavailable && typeof this.ensureAudio === "function") {
    this.ensureAudio().then(() => {
      if (lexiconSpaceTypable(this)) this.handleTyped(" ");
      else if (this.lock && !this.inBoss) this.releaseLock("manual");
    });
    return;
  }
  this.handleTyped(" ");
});
