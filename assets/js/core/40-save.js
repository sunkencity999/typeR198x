// Type-R 198X — save schema v2, migration, checkpoint snapshots and resume helpers. Classic script; load order is defined in index.html.
// Key stays typesmup198x.save.v1; every change is additive (CONTRACT §9). Legacy v1 blobs are migrated on load.

function getResumeLevelIndex(save) {
  if (save.run) {
    return clamp(save.run.levelIndex ?? 0, 0, 9);
  }
  const unlocked = clamp((save.lastUnlockedLevel || 1) - 1, 0, 9);
  return unlocked > 0 ? unlocked : null;
}

// Full stats / levelStats shapes (CONTRACT §9). Later tracks increment these fields; they always exist.
function defaultStats() {
  return { score: 0, combo: 0, mult: 1, correct: 0, total: 0, maxCombo: 0, kills: 0, words: 0, letters: 0, chars: 0, misses: 0, timeMs: 0, bossTimeMs: 0, retries: 0 };
}

function defaultLevelStats() {
  return { kills: 0, words: 0, chars: 0, correct: 0, total: 0, maxCombo: 0, timeMs: 0, bossTimeMs: 0, damageTaken: 0, waveDamage: 0, bossDamage: 0, surgesCancelled: 0, perfectWaves: 0, retries: 0, levelScore: 0 };
}

// Every stats field a checkpoint carries (all of them except the live combo/mult).
const STAT_SNAPSHOT_FIELDS = ["score", "correct", "total", "kills", "words", "letters", "chars", "misses", "maxCombo", "timeMs", "bossTimeMs", "retries"];

function makeRunId() {
  let id = "";
  while (id.length < 8) id += Math.random().toString(36).slice(2);
  return id.slice(0, 8);
}

// A checkpoint is the stats snapshot the Retry buttons and Continue converge on.
function snapshotCheckpoint(kind, levelIndex, stats, maxHp, retries, extra) {
  const cp = { kind, levelIndex };
  const src = stats || {};
  const base = defaultStats();
  for (const f of STAT_SNAPSHOT_FIELDS) cp[f] = Number.isFinite(src[f]) ? src[f] : base[f];
  cp.maxHp = maxHp;
  cp.retries = retries | 0;
  return extra ? Object.assign(cp, extra) : cp;
}

// Fresh run record for "Continue" from an unlocked sector with no saved run. HP always comes from the
// level curve (F004), never from whatever the menu-time player object holds.
function buildResumeRun(levelIndex, maxHp, shipId) {
  const i = clamp(levelIndex, 0, 9);
  const hp = getHpBonusForLevel(i + 1);
  const stats = defaultStats();
  return {
    id: makeRunId(),
    startLevel: i + 1,
    levelIndex: i,
    levelT: 0,
    wave: 0,
    waveKills: 0,
    wavePhase: "spawn",
    inBoss: false,
    hp,
    maxHp: hp,
    shield: 0,
    power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
    stats,
    levelStats: defaultLevelStats(),
    shipId,
    difficulty: "standard",
    retries: 0,
    checkpoint: snapshotCheckpoint("level", i, stats, hp, 0),
    bossCheckpoint: null,
    boss: null,
    spawnAcc: 0,
    powerAcc: 0,
    minionAcc: 0
  };
}

function clampPlayerHp(player) {
  player.hp = clamp(player.hp, 0, player.maxHp);
}

// Records order: score first, newest first on a tie. Dates are ms timestamps (above 2^31), so they are compared
// as numbers, never `| 0` (review R52). Shared by migrateSave, upsertHighScore and the Records table.
function byScoreThenNewest(a, b) {
  return ((b.score | 0) - (a.score | 0)) || ((Number(b.date) || 0) - (Number(a.date) || 0));
}

// ----------------------------- Storage -----------------------------
const LS_KEY = "typesmup198x.save.v1";
const SAVE_SCHEMA = 2;
// Set when localStorage cannot be read or written; the game keeps playing from memory (F044).
const SAVE_STATE = { unavailable: false };

const defaultSave = () => ({
  schema: SAVE_SCHEMA,
  playerName: "",
  selectedShip: "coconut",
  highScore: 0,
  lastUnlockedLevel: 1, // 1..10
  storySeen: false,
  keyboardHintSeen: false,
  settings: { muted: false, crt: true, musicVolume: 0.7, sfxVolume: 0.8, crtIntensity: 0.75, reduceMotion: null, renderScaleCap: 2 },
  highScores: [],      // top 10: { runId, name, score, levelReached, startLevel, wpm, acc, maxCombo, ship, difficulty, date }
  sectorBests: {},     // "1".."10" -> { score, rank, wpm, acc, maxCombo, date }
  bestWpm: 0,
  victories: 0,
  legacySeeded: false,
  tutorialSeen: { lock: false, finish: false, powerup: false, boss: false, release: false, accuracy: false },
  run: null
});

// Bring a run record (v1 or v2) up to the v2 shape. Pure: returns a new object.
function migrateRun(run) {
  if (!run || typeof run !== "object") return null;
  const i = clamp(Number.isFinite(run.levelIndex) ? run.levelIndex : 0, 0, 9);
  const cfg = LEVELS[i];
  const r = { ...run };
  const legacy = !r.id;
  r.levelIndex = i;
  r.id = r.id || makeRunId();
  r.startLevel = Number.isFinite(r.startLevel) ? clamp(r.startLevel, 1, 10) : i + 1;
  // E-3: a run migrated from v1 keeps feeding the headline high score even if it was saved mid-game.
  if (legacy) r.legacy = true;
  r.difficulty = r.difficulty || "standard";
  r.retries = Number.isFinite(r.retries) ? r.retries : 0;
  r.stats = { ...defaultStats(), ...((r.stats && typeof r.stats === "object") ? r.stats : {}) };
  r.levelStats = { ...defaultLevelStats(), ...((r.levelStats && typeof r.levelStats === "object") ? r.levelStats : {}) };
  r.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0, ...((r.power && typeof r.power === "object") ? r.power : {}) };
  r.shield = Number.isFinite(r.shield) ? r.shield : 0;
  const curve = getHpBonusForLevel(i + 1);
  r.maxHp = Math.max(curve, Number.isFinite(r.maxHp) ? r.maxHp : 0);
  r.hp = Number.isFinite(r.hp) ? clamp(r.hp, 0, r.maxHp) : r.maxHp;
  r.wave = clamp(Number.isFinite(r.wave) ? r.wave : 0, 0, 2);
  r.waveKills = Number.isFinite(r.waveKills) ? r.waveKills : 0;
  r.wavePhase = typeof r.wavePhase === "string" ? r.wavePhase : "spawn";
  r.spawnAcc = Number.isFinite(r.spawnAcc) ? r.spawnAcc : 0;
  r.powerAcc = Number.isFinite(r.powerAcc) ? r.powerAcc : 0;
  r.minionAcc = Number.isFinite(r.minionAcc) ? r.minionAcc : 0;
  // hazardAcc (v1) is tolerated and carried as-is.
  r.shipId = r.shipId || "coconut";
  const hasBoss = r.boss && Array.isArray(r.boss.segments) && r.boss.segments.length > 0;
  r.boss = hasBoss ? {
    segments: r.boss.segments.map(s => String(s).toLowerCase()),
    segmentIndex: clamp(r.boss.segmentIndex | 0, 0, r.boss.segments.length - 1),
    progress: 0,
    phase: r.boss.phase | 0,
    phaseStarts: Array.isArray(r.boss.phaseStarts) ? r.boss.phaseStarts.slice() : [0]
  } : null;
  // review R21: a checkpoint is usable only as a non-array object with a finite levelIndex (Continue on a saved
  // death restores it and starts that level); anything else is dropped here and rebuilt below.
  const validCp = (cp) => !!cp && typeof cp === "object" && !Array.isArray(cp) && Number.isFinite(cp.levelIndex);
  r.bossCheckpoint = validCp(r.bossCheckpoint) ? { ...r.bossCheckpoint, levelIndex: clamp(r.bossCheckpoint.levelIndex, 0, 9) } : null;
  // B-10: a v1 save taken inside a boss has no boss record; resume it in the approach to a fresh boss.
  if (r.inBoss && !r.boss) {
    r.inBoss = false;
    r.wavePhase = "approach";
    r.wave = 2;
    r.waveKills = (cfg.quota && Number.isFinite(cfg.quota[2])) ? cfg.quota[2] : r.waveKills;
    r.levelT = cfg.duration - 1;
    r.bossCheckpoint = null;
  }
  r.inBoss = !!r.inBoss;
  // F003: never resume past the boss trigger.
  r.levelT = clamp(Number.isFinite(r.levelT) ? r.levelT : 0, 0, cfg.duration - 1);
  r.checkpoint = validCp(r.checkpoint)
    ? { ...r.checkpoint, levelIndex: clamp(r.checkpoint.levelIndex, 0, 9) }
    : snapshotCheckpoint("level", i, r.stats, r.maxHp, r.retries);
  if (r.inBoss && !r.bossCheckpoint) {
    r.bossCheckpoint = snapshotCheckpoint("boss", i, r.stats, r.maxHp, r.retries, { bossPhase: r.boss.phase });
  }
  return r;
}

// Settings (CONTRACT section 9): old saves carry only { muted, crt }; the rest takes the defaults, numbers are clamped
// and reduceMotion is the tri-state null | true | false.
function normaliseSettings(s) {
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? clamp(Number(v), lo, hi) : d);
  return {
    ...s,
    muted: !!s.muted,
    crt: s.crt !== false,
    musicVolume: num(s.musicVolume, 0.7, 0, 1),
    sfxVolume: num(s.sfxVolume, 0.8, 0, 1),
    crtIntensity: num(s.crtIntensity, 0.75, 0.25, 1),
    reduceMotion: s.reduceMotion === true ? true : s.reduceMotion === false ? false : null,
    renderScaleCap: num(s.renderScaleCap, 2, 0.5, 2)
  };
}

// Merge any stored blob over the defaults and normalise it to schema 2. Idempotent.
function migrateSave(obj) {
  const base = defaultSave();
  if (!obj || typeof obj !== "object") obj = {};   // review R51: non-object blobs land on the same fixed point as {}
  const save = { ...base, ...obj };
  save.settings = normaliseSettings({ ...base.settings, ...((obj.settings && typeof obj.settings === "object") ? obj.settings : {}) });
  save.tutorialSeen = { ...base.tutorialSeen, ...((obj.tutorialSeen && typeof obj.tutorialSeen === "object") ? obj.tutorialSeen : {}) };
  save.highScores = Array.isArray(obj.highScores) ? obj.highScores.filter(h => h && typeof h === "object") : [];
  save.sectorBests = (obj.sectorBests && typeof obj.sectorBests === "object") ? { ...obj.sectorBests } : {};
  save.highScore = Number.isFinite(obj.highScore) ? Math.max(0, obj.highScore) : 0;
  save.lastUnlockedLevel = clamp(Number.isFinite(obj.lastUnlockedLevel) ? obj.lastUnlockedLevel : 1, 1, 10);
  save.bestWpm = Number.isFinite(obj.bestWpm) ? obj.bestWpm : 0;
  save.victories = Number.isFinite(obj.victories) ? obj.victories : 0;
  save.playerName = typeof obj.playerName === "string" ? obj.playerName : "";
  save.selectedShip = typeof obj.selectedShip === "string" && obj.selectedShip ? obj.selectedShip : "coconut";
  save.run = migrateRun(obj.run);
  if (!save.legacySeeded) {
    if (save.highScore > 0 && !save.highScores.length) {
      save.highScores.push({
        runId: "legacy", name: save.playerName || "PILOT", score: save.highScore, levelReached: save.lastUnlockedLevel,
        startLevel: 1, wpm: 0, acc: 0, maxCombo: 0, ship: save.selectedShip, difficulty: "standard", date: Date.now()
      });
    }
    save.legacySeeded = true;
  }
  save.highScores.sort(byScoreThenNewest);
  if (save.highScores.length > 10) save.highScores.length = 10;
  save.schema = SAVE_SCHEMA;
  return save;
}

function loadSave() {
  let raw = null;
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch (_) {
    SAVE_STATE.unavailable = true;
    return defaultSave();
  }
  if (!raw) return defaultSave();
  try {
    return migrateSave(JSON.parse(raw));
  } catch (_) {
    return defaultSave();
  }
}

// Returns false (and flags the game once) when storage is blocked; the run keeps going in memory (F044).
function storeSave(save) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(save));
    return true;
  } catch (_) {
    SAVE_STATE.unavailable = true;
    const g = (typeof window !== "undefined") ? window.game : null;
    if (g && typeof g.onPersistUnavailable === "function") g.onPersistUnavailable();
    return false;
  }
}
