// Unit checks for the data tables in assets/js/core/20-constants.js and 30-content.js (tasks B2-B7 data side,
// F012 explosion table, F020 theme mapping, rank constants). No browser: the three core scripts run in a vm
// context with a minimal window stub.
// Usage: node content-tables.mjs [--root ../..]
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argRoot = process.argv.indexOf("--root");
const ROOT = path.resolve(argRoot > -1 ? process.argv[argRoot + 1] : path.join(here, "../../.."));

const ctx = vm.createContext({
  window: { SFX: function SFX() {}, location: { protocol: "http:" } },
  navigator: { userAgent: "node" },
  performance: { now: () => Date.now() },
  console,
  Math, Number, Array, Object, Set, Map, JSON, RegExp, String, Boolean, Error, Symbol
});
for (const rel of ["assets/js/core/00-util.js", "assets/js/core/20-constants.js", "assets/js/core/30-content.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
}
const G = (expr) => vm.runInContext(expr, ctx);

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail !== undefined ? ` :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const AZ = /^[a-z]+$/;

// ---- timing constants ----
const timing = { LEVEL_INTRO_S: 1.6, LEVEL_INTRO_MAX_S: 2.5, WAVE_BANNER_S: 1.2, DRAIN_MAX_S: 6, BOSS_APPROACH_S: 3.0, BOSS_INTRO_S: 2.4,
  BOSS_FINALE_S: 5.0, BOSS_FINALE_SKIP_S: 2.0, IFRAMES_S: 0.8, HUNGRY_SPAWN_S: 0.5, HUNGRY_MIN_ALIVE: 1, GAME_SPEED_FACTOR: 1, PLATE_H: 40, DANGER_X: 0.35 };
for (const [k, v] of Object.entries(timing)) check(`const ${k} === ${v}`, G(k) === v, G(k));
check("LANE_YS", eq(G("LANE_YS"), [184, 252, 320, 388, 456, 524]), G("LANE_YS"));
check("phone lane profile", eq(G("LANE_PROFILE_PHONE.laneYs"), [200, 300, 400, 500]) && G("LANE_PROFILE_PHONE.maxEnemiesDelta") === -2 && G("LANE_PROFILE_PHONE.cssScaleBelow") === 0.55);
check("wave modifiers", eq(G("WAVE_SPAWN_MUL"), [0.9, 1.0, 1.1]) && eq(G("WAVE_SPEED_MUL"), [0.92, 1.0, 1.10]) && eq(G("WAVE_LETTER_MUL"), [1.15, 1.0, 0.75]) && eq(G("WAVE_MAX_ENEMIES_DELTA"), [-1, 0, 1]));

// ---- LEVELS master table (CONTRACT section 7) ----
const TABLE = [
  [1, [8, 10, 12], 22, 1.2, 72, 0.70, 3, 5, 6, 6, null, 0.20, 1],
  [2, [10, 12, 14], 24, 1.7, 82, 0.60, 3, 6, 7, 9, null, 0.24, 1],
  [3, [12, 14, 16], 26, 2.3, 92, 0.50, 4, 7, 8, 12, 16, 0.28, 2],
  [4, [14, 16, 18], 28, 3.0, 102, 0.42, 4, 8, 9, 15, 15, 0.32, 2],
  [5, [15, 18, 21], 30, 3.7, 112, 0.36, 5, 9, 10, 18, 14, 0.36, 2],
  [6, [16, 19, 22], 32, 4.3, 122, 0.30, 5, 9, 10, 21, 13, 0.39, 3],
  [7, [17, 20, 23], 34, 4.9, 132, 0.26, 6, 10, 11, 24, 12, 0.43, 3],
  [8, [18, 21, 24], 36, 5.5, 142, 0.22, 6, 11, 12, 27, 11, 0.47, 3],
  [9, [19, 22, 25], 38, 6.0, 152, 0.18, 7, 12, 13, 30, 10, 0.51, 4],
  [10, [20, 24, 28], 40, 6.5, 162, 0.15, 7, 13, 14, 42, 9, 0.55, 4]
];
const LEVELS = G("LEVELS");
check("LEVELS.length === 10", LEVELS.length === 10, LEVELS.length);
for (const [L, quota, cap, targetCps, speed, letterRatio, wordMin, wordMax, maxEnemies, bossSegments, surgeEvery, minionRate, minionMax] of TABLE) {
  const c = LEVELS[L - 1];
  const want = { level: L, quota, cap, duration: 3 * cap, targetCps, speed, baseSpeed: speed, letterRatio, wordMin, wordMax, maxEnemies, bossSegments, surgeEvery, minionRate, minionMax };
  for (const [k, v] of Object.entries(want)) check(`L${L}.${k}`, eq(c[k], v), c[k]);
  check(`L${L} legacy boss fields`, c.boss && c.boss.name === c.bossName && c.boss.minionRate === minionRate && c.boss.hazardRate === 0 && typeof c.boss.name === "string" && c.boss.name.length > 0, c.boss);
  check(`L${L}.minionMax === min(4,1+floor(L/3))`, c.minionMax === Math.min(4, 1 + Math.floor(L / 3)));
  const expectedSpawn = targetCps / (letterRatio + (1 - letterRatio) * c.avgWordLen);
  check(`L${L}.spawnRate derived`, near(c.spawnRate, expectedSpawn, 1e-9), c.spawnRate);
  check(`L${L}.spawnRate in 0.6..0.9`, c.spawnRate >= 0.6 && c.spawnRate <= 0.9, c.spawnRate);
  check(`L${L}.words >= 90`, c.words.length >= 90, c.words.length);
  check(`L${L}.words fit and are a-z`, c.words.every((w) => w.length >= wordMin && w.length <= wordMax && AZ.test(w)), c.words.filter((w) => !(w.length >= wordMin && w.length <= wordMax && AZ.test(w))).slice(0, 5));
  check(`L${L}.words unique`, new Set(c.words).size === c.words.length);
  check(`L${L}.waveWords shape`, Array.isArray(c.waveWords) && c.waveWords.length === 3 && c.waveWords.every((a) => a.length >= 24 && a.every((w) => c.words.includes(w))));
  const w0max = Math.max(...c.waveWords[0].map((w) => w.length)), w2min = Math.min(...c.waveWords[2].map((w) => w.length));
  check(`L${L} wave windows graded`, w0max <= wordMax && w2min >= wordMin && (wordMax - wordMin < 1 || (w0max < wordMax || w2min > wordMin)), { w0max, w2min });
  check(`L${L}.letterSet`, c.letterSet === (L <= 3 ? G("LETTER_SETS.basic") : G("LETTER_SETS.full")), c.letterSet);
}
check("durations", eq(LEVELS.map((c) => c.duration), [66, 72, 78, 84, 90, 96, 102, 108, 114, 120]), LEVELS.map((c) => c.duration));
check("L1 wave 1-2 letters = tutorial, wave 3 = basic", eq(LEVELS[0].waveLetterSets, [G("LETTER_SETS.tutorial"), G("LETTER_SETS.tutorial"), G("LETTER_SETS.basic")]));
check("letter sets", G("LETTER_SETS.tutorial") === "asdfjkleiortn" && G("LETTER_SETS.basic") === "asdfghjkleiortnucmpwy" && G("LETTER_SETS.full") === "abcdefghijklmnopqrstuvwxyz");
check("letterSetForWave(L1,0) tutorial", G("letterSetForWave(LEVELS[0], 0)") === "asdfjkleiortn");
check("letterSetForWave(L4,2) full", G("letterSetForWave(LEVELS[3], 2)") === "abcdefghijklmnopqrstuvwxyz");
check("getHpBonusForLevel(7) === 800", G("getHpBonusForLevel(7)") === 800);
check("WORDS_EASY/MED/HARD still defined", G("Array.isArray(WORDS_EASY) && Array.isArray(WORDS_MED) && Array.isArray(WORDS_HARD)"));
check("ALL_WORDS unique a-z", G("ALL_WORDS.every(w => /^[a-z]+$/.test(w)) && new Set(ALL_WORDS).size === ALL_WORDS.length"));
check("ALL_WORDS >= 320", G("ALL_WORDS.length") >= 320, G("ALL_WORDS.length"));

// buildLevelWordPool widening (C-7): a window with no words must widen max first, then min, within 3..13
check("buildLevelWordPool(5,5) >= 24 no widening", G("buildLevelWordPool(5,5).length") >= 24);
check("buildLevelWordPool(13,13) widens down to >= 24", G("buildLevelWordPool(13,13).length") >= 24 && G("buildLevelWordPool(13,13).every(w => w.length <= 13 && w.length >= 3)"));
check("buildLevelWordPool clamps to 3..13", G("buildLevelWordPool(1,2).every(w => w.length >= 3)") && G("buildLevelWordPool(14,20).every(w => w.length <= 13)"));
check("waveLengthWindow L10", eq(G("waveLengthWindow(LEVELS[9],0)"), { min: 7, max: 11 }) && eq(G("waveLengthWindow(LEVELS[9],2)"), { min: 9, max: 13 }) && eq(G("waveLengthWindow(LEVELS[9],1)"), { min: 7, max: 13 }));

// ---- B4 DAMAGE ----
// Leak = 12 + min(leakCap, 2*len) with leakCap 24 (PLAN B4 acceptance "-36 for 12 letters", probes/b4.mjs; B10 kept it).
check("DAMAGE.leak(12) === 36 (leakCap 24)", G("DAMAGE.leak(12)") === 36 && G("DAMAGE.leak(8)") === 28 && G("DAMAGE.leakCap") === 24);
check("DAMAGE.leak(5) === 22", G("DAMAGE.leak(5)") === 22);
check("DAMAGE.leak(1) === 14", G("DAMAGE.leak(1)") === 14);
check("DAMAGE.minion/surge/shieldCap/repair", G("DAMAGE.minion") === 10 && G("DAMAGE.surge(4)") === 16 && G("DAMAGE.shieldCap") === 15 && G("DAMAGE.repair") === 0.15 && G("DAMAGE.shieldHitCost") === 3);

// ---- B5 scoring ----
check("COMBO_TIERS", eq(G("COMBO_TIERS"), [[0, 1], [10, 2], [25, 3], [50, 4], [100, 5]]));
for (const [combo, tier] of [[0, 1], [9, 1], [10, 2], [25, 3], [50, 4], [100, 5], [400, 5]]) check(`comboTier(${combo}) === ${tier}`, G(`comboTier(${combo})`) === tier);
check("SCORE word/clean", G("SCORE.letter") === 50 && G("SCORE.word(5)") === 120 && near(G("SCORE.word(5) * SCORE.cleanMul"), 144, 1e-9) && G("SCORE.word(10)") === 180);
check("SCORE boss values", G("SCORE.bossChar") === 10 && G("SCORE.segment(6)") === 180 && G("SCORE.phase(3)") === 900 && G("SCORE.bossClear(10)") === 5000 && G("SCORE.flawless(2)") === 1000 && G("SCORE.surgeCountered(4)") === 600 && G("SCORE.perfectWave(2)") === 500);
check("SCORE.accuracy(96,3) === 1200", G("SCORE.accuracy(96,3)") === 1200 && G("SCORE.accuracy(98,1)") === 800 && G("SCORE.accuracy(89,1)") === 0);
check("SCORE.retryMul", G("SCORE.retryMul(0)") === 1 && G("SCORE.retryMul(1)") === 0.75 && G("SCORE.retryMul(9)") === 0.25);
check("SCORE.timeBonus", G("SCORE.timeBonus(20, 12, 2)") === 400 && G("SCORE.timeBonus(10, 12, 2)") === 0);

// ---- B6 powerups ----
check("POWERUP labels", eq(G("POWERUP_ORDER.map(k => POWERUP_TYPES[k].label)"), ["spread", "pierce", "rapid", "shield", "multi", "heal"]));
check("POWERUP durations", G("POWERUP_TYPES.SPREAD.duration") === 9 && G("POWERUP_TYPES.MULTI.duration") === 12 && G("POWERUP_TYPES.REPAIR.instant") === true);
check("POWER_ACCENT", eq(G("POWER_ACCENT"), { SPREAD: "magenta", PIERCE: "violet", RAPID: "cyan", SHIELD: "violet", MULTI: "amber", REPAIR: "text" }));
check("drop formula", near(G("POWERUP_DROP.pWord(1)"), 0.12, 1e-9) && near(G("POWERUP_DROP.pWord(10)"), 0.22, 1e-9) && G("POWERUP_DROP.pLetter") === 0.04 && G("POWERUP_DROP.floorEveryS") === 14 && G("POWERUP_DROP.bossFloorEveryS") === 18 && G("POWERUP_DROP.maxAlive") === 2 && G("POWERUP_DROP.lifetimeS") === 14);
const share = (row, k) => row[k] / Object.values(row).reduce((a, b) => a + b, 0);
check("weights base", eq(G("POWERUP_WEIGHTS.base"), { SPREAD: 18, PIERCE: 14, RAPID: 14, SHIELD: 18, MULTI: 22, REPAIR: 14 }));
check("weights hp<.4 SHIELD 28 REPAIR 34", G("POWERUP_WEIGHTS.lowHp.SHIELD") === 28 && G("POWERUP_WEIGHTS.lowHp.REPAIR") === 34);
check("weights hp<.25 REPAIR 45 and share >= 40%", G("POWERUP_WEIGHTS.critHp.REPAIR") === 45 && share(G("powerupWeightsFor(0.2,false)"), "REPAIR") >= 0.4);
check("boss weights SPREAD/PIERCE 0 RAPID 10", eq([G("powerupWeightsFor(1,true).SPREAD"), G("powerupWeightsFor(1,true).PIERCE"), G("powerupWeightsFor(1,true).RAPID")], [0, 0, 10]));
check("powerupWeightsFor thresholds", G("powerupWeightsFor(0.39,false).REPAIR") === 34 && G("powerupWeightsFor(0.4,false).REPAIR") === 14 && G("powerupWeightsFor(0.24,false).REPAIR") === 45);

// ---- B7 boss plan ----
const FINAL = ["my", "syntax", "is", "law", "fill", "every", "screen", "with", "me"];
check("FINAL_MESSAGE", eq(G("FINAL_MESSAGE"), FINAL));
check("BOSS_WORD_POOL deduped, one omega", G("BOSS_WORD_POOL.filter(w => w === 'omega').length") === 1 && G("new Set(BOSS_WORD_POOL).size === BOSS_WORD_POOL.length"));
check("BOSS_WORD_THEMES 10 lists of 16 a-z", G("[1,2,3,4,5,6,7,8,9,10].every(L => BOSS_WORD_THEMES[L].length === 16 && BOSS_WORD_THEMES[L].every(w => /^[a-z]+$/.test(w)))"));
check("BOSS_WORD_THEMES[1] starts signal static ghost", eq(G("BOSS_WORD_THEMES[1].slice(0,3)"), ["signal", "static", "ghost"]));
check("BOSS_WORD_THEMES[10] ends kilovolt headline", eq(G("BOSS_WORD_THEMES[10].slice(-2)"), ["kilovolt", "headline"]));
for (let L = 1; L <= 10; L++) {
  const core = 6 + 3 * (L - 1);
  const expected = core + (L === 10 ? 9 : 0);
  const allowed = new Set(G(`[...BOSS_SEGMENT_BASE[${L - 1}], ...BOSS_WORD_THEMES[${L}], ...BOSS_WORD_POOL, ...FINAL_MESSAGE]`));
  const themed = new Set(G(`[...BOSS_SEGMENT_BASE[${L - 1}], ...BOSS_WORD_THEMES[${L}]]`));
  for (let trial = 0; trial < 20; trial++) {
    const plan = G(`buildBossPlan(${L})`);
    const segs = plan.segments;
    const ok = segs.length === expected;
    check(`L${L} plan length ${expected}`, ok, segs.length);
    if (!ok) break;
    check(`L${L} plan a-z and from allowed unions`, segs.every((w) => AZ.test(w) && allowed.has(w)), segs.filter((w) => !allowed.has(w)));
    check(`L${L} plan starts with the 3 base words`, eq(segs.slice(0, 3), G(`BOSS_SEGMENT_BASE[${L - 1}]`)));
    const coreSegs = segs.slice(0, core);
    if (L <= 7) check(`L${L} no repeats`, new Set(coreSegs).size === coreSegs.length, coreSegs.filter((w, i) => coreSegs.indexOf(w) !== i));
    const themedShare = coreSegs.filter((w) => themed.has(w)).length / core;
    check(`L${L} themed share >= ${L <= 5 ? 60 : 40}%`, themedShare >= (L <= 5 ? 0.6 : 0.4), themedShare.toFixed(2));
    const wordMax = LEVELS[L - 1].wordMax;
    check(`L${L} non-base pool words within 3..wordMax+1`, coreSegs.slice(3).every((w) => w.length >= 3 && w.length <= wordMax + 1), coreSegs.slice(3).filter((w) => w.length > wordMax + 1));
    const ps = [0, Math.ceil(core / 3), Math.ceil((2 * core) / 3)];
    if (L === 10) ps.push(core);
    check(`L${L} phaseStarts`, eq(plan.phaseStarts, ps), plan.phaseStarts);
    if (L === 10) check("L10 last 9 === FINAL_MESSAGE", eq(segs.slice(-9), FINAL));
    if (trial === 0) {
      const legacy = G(`buildBossSegments(${L})`);
      check(`L${L} buildBossSegments returns array of ${expected} with .segments/.phaseStarts`, Array.isArray(legacy) && legacy.length === expected && legacy.segments === legacy && eq(legacy.phaseStarts, ps) && eq(JSON.parse(JSON.stringify(legacy)), legacy.slice()));
    }
  }
}
check("bossSegmentCount(10) === 33", G("bossSegmentCount(10)") === 33);
check("surgeDuration(6) === 3", G("surgeDuration(6)") === 3);

// ---- F020 themes ----
check("LEVEL_THEMES", eq(G("LEVEL_THEMES.map(t => t.art)"), ["first", "sixth", "third", "fourth", "fifth", "third", "second", "fourth", "fifth", "tenth"]));
check("THEME_ACCENT", eq(G("THEME_ACCENT"), { first: "cyan", sixth: "amber", third: "magenta", fourth: "violet", fifth: "cyan", second: "amber", tenth: "violet" }));
const arts = [], storms = [];
for (let i = 0; i < 10; i++) {
  const t = G(`getThemeForLevel(${i})`);
  arts.push(t.art); storms.push(!!t.storm);
  check(`theme ${i} keeps renderer fields`, typeof t.bg === "string" && typeof t.fg === "string" && t.id === t.art && typeof t.bgSpeed === "number" && typeof t.fgSpeed === "number" && typeof t.fgHeight === "number" && typeof t.accent === "string", t);
  check(`theme ${i} bg/fg paths exist`, fs.existsSync(path.join(ROOT, t.bg)) && fs.existsSync(path.join(ROOT, t.fg)), [t.bg, t.fg]);
}
check("theme art sequence", eq(arts, ["first", "sixth", "third", "fourth", "fifth", "third", "second", "fourth", "fifth", "tenth"]), arts);
check("storm only 5,7,8", eq(storms, [false, false, false, false, false, true, false, true, true, false]), storms);
check("tenth tileFg false + violet", G("getThemeForLevel(9).tileFg") === false && G("getThemeForLevel(9).accent") === "violet");
check("storm speedMul 1.25", G("getThemeForLevel(5).speedMul") === 1.25 && G("getThemeForLevel(0).speedMul") === 1);
check("getThemeForLevel clamps", G("getThemeForLevel(42).art") === "tenth" && G("getThemeForLevel(-1).art") === "first");

// ---- F012 explosions ----
check("EXPLOSION_SETS small", eq(G("EXPLOSION_SETS.small.frames"), [2, 1, 0]) && G("EXPLOSION_SETS.small.frameTime") === 0.055 && eq(G("EXPLOSION_SETS.small.flashFrames"), [2]));
check("EXPLOSION_SETS medium", eq(G("EXPLOSION_SETS.medium.frames"), [9, 7, 6, 5, 4, 3, 8]) && G("EXPLOSION_SETS.medium.frameTime") === 0.06 && eq(G("EXPLOSION_SETS.medium.flashFrames"), [9, 7]));
check("EXPLOSION_SETS large", eq(G("EXPLOSION_SETS.large.frames"), [15, 14, 12, 11, 13, 19, 17]) && G("EXPLOSION_SETS.large.frameTime") === 0.07 && eq(G("EXPLOSION_SETS.large.flashFrames"), [15, 14]));
check("EXPLOSION_SETS keep legacy shape (frames/scale/frameTime)", G("['small','medium','large'].every(k => Array.isArray(EXPLOSION_SETS[k].frames) && typeof EXPLOSION_SETS[k].scale === 'number' && typeof EXPLOSION_SETS[k].frameTime === 'number')"));
check("EXPLOSION_FRAMES indices intact (21)", G("EXPLOSION_FRAMES.length") === 21 && G("['small','medium','large'].every(k => EXPLOSION_SETS[k].frames.every(i => EXPLOSION_FRAMES[i] && ![10,18,20].includes(i)))"));
check("FX_CAPS", eq(G("FX_CAPS"), { explosionsLarge: 4, explosionsTotal: 10, particles: 600, bullets: 24 }));

// ---- rank ----
check("rankFor(99,60,1) === 'S'", G("rankFor(99,60,1)") === "S", G("rankFor(99,60,1)"));
check("rankFor(95,35,.5) === 'B'", G("rankFor(95,35,.5)") === "B", G("rankFor(95,35,.5)"));
check("rankFor(80,20,0) === 'D'", G("rankFor(80,20,0)") === "D");
check("RANK thresholds/colours", eq(G("RANK.thresholds"), [["S", 0.9], ["A", 0.75], ["B", 0.55], ["C", 0.35]]) && eq(G("RANK.colors"), { S: "amber", A: "cyan", B: "violet", C: "text", D: "danger" }));

// ---- untouched content still present ----
check("getVictoryScript 23 lines", G("getVictoryScript().length") === 23);
check("SHIP_CONFIGS 4 ships", G("Object.keys(SHIP_CONFIGS).length") === 4);
check("BOSS_ARTS 10", G("BOSS_ARTS.length") === 10);
check("PARALLAX_THEMES 10", G("PARALLAX_THEMES.length") === 10);

console.log(`content-tables: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log("  FAIL " + f); process.exit(1); }
