// Type-R 198X — timing/balance constants and the LEVELS table. Classic script; load order is defined in index.html.
// Note: buildBossSegments reads BOSS_SEGMENT_BASE / BOSS_WORD_POOL (defined in 30-content.js) only at call time, never at load.

function getHpBonusForLevel(levelNumber) {
  return BASE_PLAYER_HP + Math.max(0, (levelNumber - 1)) * LEVEL_HP_BONUS;
}

const BASE_PLAYER_HP = 200;
const LEVEL_HP_BONUS = 100;
const GAME_SPEED_FACTOR = 0.75;
const GAME_DURATION_FACTOR = 1 / GAME_SPEED_FACTOR;

function buildBossSegments(level) {
  const base = (BOSS_SEGMENT_BASE[level - 1] || ["neon", "boss"]).map(w => w.toLowerCase());
  const needed = (base.length * 2) + Math.max(0, (level - 1) * 5);
  const extraNeeded = Math.max(0, needed - base.length);
  const pool = shuffle([...BOSS_WORD_POOL]);
  const extras = [];
  while (extras.length < extraNeeded) {
    if (pool.length === 0) shuffle(pool);
    extras.push((pool.shift() || "nova").toLowerCase());
  }
  return [...base, ...extras];
}

// ----------------------------- Level Config -----------------------------
const LEVELS = Array.from({ length: 10 }, (_, i) => {
  const level = i + 1;
  const baseSpeed = lerp(95, 210, i / 9) * GAME_SPEED_FACTOR;              // px/s
  const spawnRate = lerp(0.75, 1.8, i / 9) * GAME_SPEED_FACTOR;            // enemies/second
  const maxEnemies = Math.round(lerp(6, 14, i / 9));
  const wordMin = Math.round(lerp(3, 7, i / 9));
  const wordMax = Math.round(lerp(5, 12, i / 9));
  const letterRatio = lerp(0.78, 0.25, i / 9);         // early more letters
  const duration = Math.round(lerp(26, 38, i / 9) * GAME_DURATION_FACTOR) * 3;    // three waves before boss
  const bossName = ["SIGNAL WRAITH","VECTOR OGRE","PLASMA SHOGUN","HOLO TITAN","CHROME MONOLITH","SYNC LEVIATHAN","STATIC EMPRESS","LOGIC DRAGON","NIGHT ENGINE","FINAL ELECTROMANCER"][i];

  return {
    level,
    baseSpeed,
    spawnRate,
    maxEnemies,
    wordMin,
    wordMax,
    letterRatio,
    duration,
    boss: {
      name: bossName,
      minionRate: lerp(0.35, 0.75, i / 9) * GAME_SPEED_FACTOR,
      hazardRate: lerp(0.0, 0.55, i / 9) * GAME_SPEED_FACTOR // starting from level 1 no hazards
    }
  };
});
