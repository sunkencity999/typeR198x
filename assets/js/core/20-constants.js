// Type-R 198X — timing/balance constants and the LEVELS master table. Classic script; load order is defined in index.html.
//
// This file loads BEFORE 30-content.js, so it never touches word lists or boss pools at its own top level:
//   - LEVELS[i].words / waveWords / letterSet / waveLetterSets are attached by attachLevelContent() at the end
//     of 30-content.js (the word lists live there);
//   - buildBossSegments() reads the boss tables only when called (at runtime, after every script has loaded).
// Numbers follow CONTRACT section 7; names follow CONTRACT section 4.

// ----------------------------- Timing (seconds) -----------------------------
const LEVEL_INTRO_S = 1.6;        // sector card; extends up to LEVEL_INTRO_MAX_S while level assets are still loading
const LEVEL_INTRO_MAX_S = 2.5;
const WAVE_BANNER_S = 1.2;
const DRAIN_MAX_S = 6.0;          // the field drain between waves gives up after this
const BOSS_APPROACH_S = 3.0;
const BOSS_INTRO_S = 2.4;
const BOSS_INTRO_SKIP_S = 1.0;    // returning players may skip the boss intro from here
const BOSS_FINALE_S = 5.0;
const BOSS_FINALE_SKIP_S = 2.0;
const IFRAMES_S = 0.8;
const HUNGRY_SPAWN_S = 1.5;       // fewer than HUNGRY_MIN_ALIVE enemies for this long -> spawn now
const HUNGRY_MIN_ALIVE = 2;
const SPAWN_ACC_PRIME = 0.85;     // spawnAcc at wave start so the first enemy arrives quickly
const GAME_SPEED_FACTOR = 1;      // the master table already carries the final numbers

// ----------------------------- Player HP -----------------------------
const BASE_PLAYER_HP = 200;
const LEVEL_HP_BONUS = 100;

function getHpBonusForLevel(levelNumber) {
  return BASE_PLAYER_HP + Math.max(0, (levelNumber - 1)) * LEVEL_HP_BONUS;
}

// DAMAGE: everything that can hurt the player, before diff().damage. Shield absorbs a hit fully at a cost in seconds.
// Leak = leakBase + min(leakCap, leakPerChar * len) per CONTRACT 7 (letter 14, 5 letters 22, 8+ letters 28).
// NOTE for the lead: PLAN B4's acceptance ("12-letter leak -> hp -36") only holds with leakCap 24; the contract
// formula is kept here and the cap is a single constant so either reading is a one-number change.
const DAMAGE = {
  leakBase: 12,
  leakPerChar: 2,
  leakCap: 16,
  leak: (len) => DAMAGE.leakBase + Math.min(DAMAGE.leakCap, DAMAGE.leakPerChar * len),
  minion: 10,                                  // boss minion leak
  surge: (level) => 8 + 2 * level,             // Signal Surge that was not countered (L3 14 ... L10 28)
  shieldHitCost: 3,                            // seconds of shield removed per absorbed hit
  shieldCap: 15,                               // seconds, when stacking pickups / phase bonuses
  phaseClearShield: 3,                         // seconds granted at a boss phase boundary
  repair: 0.15,                                // REPAIR heals this fraction of maxHp
  iframes: IFRAMES_S,
  warnHp: 0.5,                                 // #hud[data-hp] warn below this fraction
  lowHp: 0.25                                  // crit below this fraction (SFX.lowHp, danger vignette)
};

// ----------------------------- Playfield geometry -----------------------------
const LANE_YS = [184, 252, 320, 388, 456, 524];        // pitch 68
const LANE_PROFILE_PHONE = { cssScaleBelow: 0.55, laneYs: [200, 300, 400, 500], maxEnemiesDelta: -2 };
const MINION_LANES = [0, 1, 2, 3, 4];                   // boss minions never take the bottom lane
const PLATE_H = 40;
const PLATE_H_MINION = 36;
const DANGER_X = 0.35;                                   // fraction of the width where plates read as imminent
const TARGETABLE_MARGIN = 4;                             // targetable = en.x - plateW/2 <= w - TARGETABLE_MARGIN

// ----------------------------- Waves -----------------------------
// Index w = 0..2 is the wave within a sector.
const WAVE_SPAWN_MUL = [0.85, 1.0, 1.15];
const WAVE_SPEED_MUL = [0.92, 1.0, 1.10];
const WAVE_LETTER_MUL = [1.15, 1.0, 0.75];
const WAVE_MAX_ENEMIES_DELTA = [-1, 0, 1];
const WAVE_RAMP = [0.9, 1.1];                 // intra-wave spawn ramp, lerp by waveKills/quota
const LETTER_RATIO_MIN = 0.08;
const LETTER_RATIO_MAX = 0.85;
const LONG_WORD_LEN = 10;                      // words at least this long move at LONG_WORD_SPEED_MUL
const LONG_WORD_SPEED_MUL = 0.9;
const LETTER_SPEED_MUL = [1.0, 1.25];          // single letters roll a speed bonus in this range
const PRESSURE_VALVE_MIN_CHARS = 12;           // no spawn while liveChars() > max(12, round(targetCps * 10))
const PRESSURE_VALVE_CPS_WINDOW = 10;

function waveIndex(wave) {
  return clamp(wave | 0, 0, 2);
}

function waveSpawnRate(cfg, wave, waveKills = 0) {
  const w = waveIndex(wave);
  const quota = cfg.quota[w] || 1;
  const ramp = lerp(WAVE_RAMP[0], WAVE_RAMP[1], clamp(waveKills / quota, 0, 1));
  return cfg.spawnRate * WAVE_SPAWN_MUL[w] * ramp;
}

function waveSpeed(cfg, wave) {
  return cfg.speed * WAVE_SPEED_MUL[waveIndex(wave)];
}

function waveLetterRatio(cfg, wave) {
  return clamp(cfg.letterRatio * WAVE_LETTER_MUL[waveIndex(wave)], LETTER_RATIO_MIN, LETTER_RATIO_MAX);
}

function waveMaxEnemies(cfg, wave, phoneProfile = false) {
  const base = cfg.maxEnemies + WAVE_MAX_ENEMIES_DELTA[waveIndex(wave)];
  return Math.max(2, base + (phoneProfile ? LANE_PROFILE_PHONE.maxEnemiesDelta : 0));
}

function pressureCap(cfg) {
  return Math.max(PRESSURE_VALVE_MIN_CHARS, Math.round(cfg.targetCps * PRESSURE_VALVE_CPS_WINDOW));
}

// ----------------------------- Boss -----------------------------
const FINAL_MESSAGE_SEGMENTS = 9;              // FINAL_MESSAGE (30-content.js) is appended to the L10 boss as phase 4
const MINION_SPEED_MUL = 1.1;
const MINION_SPAWN_DX = -40;                   // minions appear at boss.artRect.x + cfg.minionSpawnDx
const SURGE_BASE_S = 1.5;
const SURGE_PER_CHAR_S = 0.25;

function bossSegmentCount(level) {
  return 6 + 3 * (level - 1);
}

function surgeDuration(remainingChars) {
  return SURGE_BASE_S + SURGE_PER_CHAR_S * Math.max(0, remainingChars | 0);
}

// ----------------------------- Scoring -----------------------------
const COMBO_TIERS = [[0, 1], [10, 2], [25, 3], [50, 4], [100, 5]];
const MULT_CAP = 7;
const MULTI_TIER_BONUS = 2;                    // MULTI powerup adds this many tiers

function comboTier(combo) {
  let tier = 1;
  for (const [atCombo, mult] of COMBO_TIERS) {
    if (combo >= atCombo) tier = mult;
  }
  return tier;
}

// Base values; the caller multiplies by stats.mult and then by diff().score. No negative score events exist.
const SCORE = {
  letter: 50,
  word: (len) => 60 + 12 * len,
  cleanMul: 1.2,                               // no hard miss between lock and kill
  secondaryMul: 0.5,                           // spread / pierce / rapid kills, never clean
  minion: 40,
  pickup: 100,
  bossChar: 10,
  segment: (len) => len * 30,
  phase: (level) => 300 * level,
  bossClear: (level) => 1500 + 350 * level,
  parDivisor: 3,                               // boss par seconds = totalChars / parDivisor
  timeBonus: (parS, elapsedS, level) => Math.max(0, parS - elapsedS) * 25 * level,
  flawless: (level) => 500 * level,            // bossDamage === 0
  surgeCountered: (level) => 150 * level,
  perfectWave: (level) => 250 * level,         // waveDamage === 0
  accuracy: (accPct, level) => (accPct >= 98 ? 800 : accPct >= 95 ? 400 : accPct >= 90 ? 150 : 0) * level,
  retryMul: (retries) => Math.max(0.25, 1 - 0.25 * retries)
};

// ----------------------------- Powerups -----------------------------
// powerKey is the game.power / player field the timer lives in (REPAIR is instant).
const POWERUP_TYPES = {
  SPREAD: { id: "SPREAD", label: "spread", duration: 9, powerKey: "spread", radius: 160 },
  PIERCE: { id: "PIERCE", label: "pierce", duration: 9, powerKey: "pierce" },
  RAPID:  { id: "RAPID",  label: "rapid",  duration: 9, powerKey: "rapid" },
  SHIELD: { id: "SHIELD", label: "shield", duration: 9, powerKey: "shield" },
  MULTI:  { id: "MULTI",  label: "multi",  duration: 12, powerKey: "multiplier" },
  REPAIR: { id: "REPAIR", label: "heal",   duration: 0, powerKey: null, instant: true }
};
const POWERUP_ORDER = ["SPREAD", "PIERCE", "RAPID", "SHIELD", "MULTI", "REPAIR"];
const POWERUP_CHIP_ORDER = ["SHIELD", "MULTI", "SPREAD", "PIERCE", "RAPID"];   // #hudChips order; no chip for REPAIR
const POWER_ACCENT = { SPREAD: "magenta", PIERCE: "violet", RAPID: "cyan", SHIELD: "violet", MULTI: "amber", REPAIR: "text" };

const POWERUP_DROP = {
  wordMinLen: 4,                               // words shorter than this roll the letter chance
  pWordMin: 0.12,
  pWordMax: 0.22,
  pWord: (level) => lerp(0.12, 0.22, (level - 1) / 9),
  pLetter: 0.04,
  pMinion: 0.10,
  floorEveryS: 14,                             // guaranteed spawn cadence while none is alive
  bossFloorEveryS: 18,
  maxAlive: 2,
  lifetimeS: 14,
  homingSpeedMul: 0.55
};

// Weight rows sum to 100 so a share reads directly as a percentage. Pity rows kick in below the hp fractions.
const POWERUP_WEIGHTS = {
  base:   { SPREAD: 18, PIERCE: 14, RAPID: 14, SHIELD: 18, MULTI: 22, REPAIR: 14 },
  lowHp:  { SPREAD: 10, PIERCE: 8,  RAPID: 8,  SHIELD: 28, MULTI: 12, REPAIR: 34 },   // hp < .4
  critHp: { SPREAD: 6,  PIERCE: 5,  RAPID: 5,  SHIELD: 28, MULTI: 11, REPAIR: 45 }    // hp < .25
};
const POWERUP_WEIGHT_THRESHOLDS = { lowHp: 0.4, critHp: 0.25 };
const POWERUP_BOSS_OVERRIDE = { SPREAD: 0, PIERCE: 0, RAPID: 10 };               // nothing to chain in a boss but minions
const POWERUP_BOSS_WEIGHTS = {
  base: { ...POWERUP_WEIGHTS.base, ...POWERUP_BOSS_OVERRIDE },
  lowHp: { ...POWERUP_WEIGHTS.lowHp, ...POWERUP_BOSS_OVERRIDE },
  critHp: { ...POWERUP_WEIGHTS.critHp, ...POWERUP_BOSS_OVERRIDE }
};

function powerupWeightsFor(hpFrac, inBoss = false) {
  const row = hpFrac < POWERUP_WEIGHT_THRESHOLDS.critHp ? "critHp" : hpFrac < POWERUP_WEIGHT_THRESHOLDS.lowHp ? "lowHp" : "base";
  return { ...(inBoss ? POWERUP_BOSS_WEIGHTS : POWERUP_WEIGHTS)[row] };
}

// ----------------------------- Rank -----------------------------
const RANK = {
  weights: { acc: 0.5, speed: 0.3, hp: 0.2 },
  accFloorPct: 80,
  accSpanPct: 18,
  wpmFloor: 20,
  wpmSpan: 40,
  thresholds: [["S", 0.90], ["A", 0.75], ["B", 0.55], ["C", 0.35]],   // below the last one is D
  order: ["S", "A", "B", "C", "D"],
  colors: { S: "amber", A: "cyan", B: "violet", C: "text", D: "danger" }
};

function rankPoints(accPct, wpm, hpPts) {
  const a = clamp((accPct - RANK.accFloorPct) / RANK.accSpanPct, 0, 1);
  const s = clamp((wpm - RANK.wpmFloor) / RANK.wpmSpan, 0, 1);
  const h = clamp(Number.isFinite(hpPts) ? hpPts : 1, 0, 1);
  return RANK.weights.acc * a + RANK.weights.speed * s + RANK.weights.hp * h;
}

// accPct is a percentage (0..100); hpPts is damageTaken === 0 ? 1 : clamp(1 - damageTaken / maxHp, 0, 1).
function rankFor(accPct, wpm, hpPts) {
  const r = rankPoints(accPct, wpm, hpPts);
  for (const [grade, min] of RANK.thresholds) {
    if (r >= min) return grade;
  }
  return "D";
}

// ----------------------------- Effects budgets -----------------------------
const FX_CAPS = { explosionsLarge: 4, explosionsTotal: 10, particles: 600, bullets: 24 };

// ----------------------------- Level Config -----------------------------
const BOSS_NAMES = [
  "SIGNAL WRAITH", "VECTOR OGRE", "PLASMA SHOGUN", "HOLO TITAN", "CHROME MONOLITH",
  "SYNC LEVIATHAN", "STATIC EMPRESS", "LOGIC DRAGON", "NIGHT ENGINE", "FINAL ELECTROMANCER"
];

// Master table (CONTRACT section 7). Columns:
// level | wave quotas W1/W2/W3 | cap s per wave | targetCps | speed px/s | letterRatio | wordMin | wordMax | maxEnemies | surgeEvery s | minionRate /s | minionMax
const LEVEL_TABLE = [
  [1,  [8, 10, 12],  22, 1.2, 72,  0.70, 3, 5,  6,  null, 0.20, 1],
  [2,  [10, 12, 14], 24, 1.7, 82,  0.60, 3, 6,  7,  null, 0.24, 1],
  [3,  [12, 14, 16], 26, 2.3, 92,  0.50, 4, 7,  8,  16,   0.28, 2],
  [4,  [14, 16, 18], 28, 3.0, 102, 0.42, 4, 8,  9,  15,   0.32, 2],
  [5,  [15, 18, 21], 30, 3.7, 112, 0.36, 5, 9,  10, 14,   0.36, 2],
  [6,  [16, 19, 22], 32, 4.3, 122, 0.30, 5, 9,  10, 13,   0.39, 3],
  [7,  [17, 20, 23], 34, 4.9, 132, 0.26, 6, 10, 11, 12,   0.43, 3],
  [8,  [18, 21, 24], 36, 5.5, 142, 0.22, 6, 11, 12, 11,   0.47, 3],
  [9,  [19, 22, 25], 38, 6.0, 152, 0.18, 7, 12, 13, 10,   0.51, 4],
  [10, [20, 24, 28], 40, 6.5, 162, 0.15, 7, 13, 14, 9,    0.55, 4]
];

// Enemies per second that deliver targetCps characters per second, given the letter/word mix.
// avgWordLen is the nominal mean of the length window; the pools are close to uniform across it.
function deriveSpawnRate(targetCps, letterRatio, avgWordLen) {
  return targetCps / (letterRatio + (1 - letterRatio) * avgWordLen);
}

const LEVELS = LEVEL_TABLE.map(([level, quota, cap, targetCps, speed, letterRatio, wordMin, wordMax, maxEnemies, surgeEvery, minionRate, minionMax]) => {
  const avgWordLen = (wordMin + wordMax) / 2;
  const coreSegments = bossSegmentCount(level);
  const bossName = BOSS_NAMES[level - 1];
  return {
    level,
    name: bossName,
    bossName,
    quota: quota.slice(),
    cap,
    duration: cap * 3,
    targetCps,
    speed,
    baseSpeed: speed,                 // legacy alias read by the current spawner
    letterRatio,
    wordMin,
    wordMax,
    avgWordLen,
    spawnRate: deriveSpawnRate(targetCps, letterRatio, avgWordLen),
    maxEnemies,
    bossSegments: coreSegments + (level === 10 ? FINAL_MESSAGE_SEGMENTS : 0),
    bossCoreSegments: coreSegments,   // segments before L10's final message
    surgeEvery,                       // null: this boss never surges
    minionRate,
    minionMax,
    minionSpawnDx: MINION_SPAWN_DX,
    // Attached by attachLevelContent() in 30-content.js once the word lists exist.
    words: [],
    waveWords: [[], [], []],
    letterSet: "",
    waveLetterSets: ["", "", ""],
    boss: {
      name: bossName,
      minionRate,
      minionMax,
      surgeEvery,
      hazardRate: 0                   // legacy field; the untelegraphed hazard is gone (F085)
    }
  };
});

// Legacy entry point: the current boss code expects a plain array of segment words. It is a thin wrapper over
// buildBossPlan() (30-content.js); the plan's segments/phaseStarts ride along as non-enumerable properties so
// callers that already follow the contract (`buildBossSegments(L).segments`) work too.
function buildBossSegments(level) {
  const plan = buildBossPlan(level);
  const segments = plan.segments;
  Object.defineProperties(segments, {
    segments: { value: segments, enumerable: false },
    phaseStarts: { value: plan.phaseStarts, enumerable: false }
  });
  return segments;
}
