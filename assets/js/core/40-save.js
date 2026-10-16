// Type-R 198X — save/resume helpers and localStorage persistence. Classic script; load order is defined in index.html.
// Note: clampPlayerHp is an (unused) player-HP helper kept beside the run/resume helpers it was defined next to.

function getResumeLevelIndex(save) {
  if (save.run) {
    return clamp(save.run.levelIndex ?? 0, 0, 9);
  }
  const unlocked = clamp((save.lastUnlockedLevel || 1) - 1, 0, 9);
  return unlocked > 0 ? unlocked : null;
}

function buildResumeRun(levelIndex, maxHp, shipId) {
  return {
    levelIndex: clamp(levelIndex, 0, 9),
    levelT: 0,
    inBoss: false,
    hp: maxHp,
    shield: 0,
    power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
    stats: { score: 0, combo: 0, mult: 1, correct: 0, total: 0 },
    spawnAcc: 0,
    powerAcc: 0,
    minionAcc: 0,
    hazardAcc: 0,
    shipId,
    maxHp
  };
}

// Full stats / levelStats shapes (CONTRACT §9). Later tracks increment these fields; they always exist.
function defaultStats() {
  return { score: 0, combo: 0, mult: 1, correct: 0, total: 0, maxCombo: 0, kills: 0, words: 0, letters: 0, chars: 0, misses: 0, timeMs: 0, bossTimeMs: 0, retries: 0 };
}

function defaultLevelStats() {
  return { kills: 0, words: 0, chars: 0, correct: 0, total: 0, maxCombo: 0, timeMs: 0, bossTimeMs: 0, damageTaken: 0, waveDamage: 0, bossDamage: 0, surgesCancelled: 0, perfectWaves: 0, retries: 0, levelScore: 0 };
}

function clampPlayerHp(player) {
  player.hp = clamp(player.hp, 0, player.maxHp);
}

// ----------------------------- Storage -----------------------------
const LS_KEY = "typesmup198x.save.v1";

const defaultSave = () => ({
  playerName: "",
  selectedShip: "coconut",
  highScore: 0,
  lastUnlockedLevel: 1, // 1..10
  storySeen: false,
  keyboardHintSeen: false,
  settings: { muted: false, crt: true },
  run: null // { levelIndex, score, hp, seed, shipId, powerups, stats, time, ... }
});

function loadSave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSave();
    const obj = JSON.parse(raw);
    const base = defaultSave();
    return {
      ...base,
      ...obj,
      settings: { ...base.settings, ...(obj.settings || {}) }
    };
  } catch {
    return defaultSave();
  }
}

function storeSave(save) {
  localStorage.setItem(LS_KEY, JSON.stringify(save));
}
