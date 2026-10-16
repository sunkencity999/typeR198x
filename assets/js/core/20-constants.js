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
