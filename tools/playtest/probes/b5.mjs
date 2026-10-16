// B5 acceptance: scoring table, combo tiers, addScore sink, perfect-wave / accuracy bonuses, floaters.
import { openProbe, sleep, state, startFresh, jumpTo, clearField, placeEnemy, press, hold } from "./b_lib.mjs";

const P = await openProbe("b5");
await startFresh(P, "B5");
await hold(P);
await clearField(P);

// combo 10/25/50/100 -> mult 2/3/4/5; with power.multiplier=9 at combo 10 -> 4, at 100 -> 7
const tiers = await P.g(() => {
  const g = window.game;
  const at = (combo, multi) => { g.power.multiplier = multi; g.stats.combo = combo; g._baseTier = 1; g.bumpMultiplier(); return g.stats.mult; };
  const out = { c0: at(0, 0), c10: at(10, 0), c25: at(25, 0), c50: at(50, 0), c100: at(100, 0), m10: at(10, 9), m100: at(100, 9), pure: [comboTier(9), comboTier(10), comboTier(25), comboTier(50), comboTier(100)] };
  g.power.multiplier = 0; g.stats.combo = 0; g.bumpMultiplier();
  return out;
});
P.check("combo 10/25/50/100 -> mult 2/3/4/5; power.multiplier=9 at combo 10 -> 4, at 100 -> 7 (cap)", tiers.c0 === 1 && tiers.c10 === 2 && tiers.c25 === 3 && tiers.c50 === 4 && tiers.c100 === 5 && tiers.m10 === 4 && tiers.m100 === 7, tiers);

// clean 5-letter word at mult 1 adds 144
await placeEnemy(P, "pixel", 900, 2);
const s0 = await state(P);
for (const k of "pixel") { await press(P, k); await sleep(20); }
const s1 = await state(P);
P.check("clean 5-letter word at mult 1 adds 144", s1.score - s0.score === 144, { before: s0.score, after: s1.score });

// after one miss while locked: 120
await clearField(P);
await placeEnemy(P, "pixel", 900, 2);
const s2 = await state(P);
await press(P, "p"); await press(P, "z");
for (const k of "ixel") { await press(P, k); await sleep(20); }
const s3 = await state(P);
P.check("5-letter word with one miss while locked adds 120 (not clean), the miss itself changed nothing", s3.score - s2.score === 120, { before: s2.score, after: s3.score });

// hard miss sets combo 0 and leaves stats.score unchanged
await clearField(P);
await placeEnemy(P, "arcade", 900, 2);
await press(P, "a");
const m0 = await state(P);
await press(P, "q");
const m1 = await state(P);
P.check("a hard miss sets combo 0 and leaves stats.score unchanged", m0.combo >= 1 && m1.combo === 0 && m1.score === m0.score && m1.total === m0.total + 1, { m0: { combo: m0.combo, score: m0.score }, m1: { combo: m1.combo, score: m1.score } });

// floaters: after a kill there is a /^\+\d/ entry, gone after 1 s
await clearField(P);
await placeEnemy(P, "neon", 900, 2);
for (const k of "neon") { await press(P, k); await sleep(20); }
const f0 = await P.g(() => (window.game.floaters || []).map(f => f.text));
await sleep(1000);
const f1 = await P.g(() => (window.game.floaters || []).map(f => f.text));
P.check("after a kill floaters has a /^\\+\\d/ entry that is gone after 1 s", f0.some(t => /^\+\d/.test(t)) && !f1.some(t => /^\+\d/.test(t)), { f0, f1 });

// multiplier callout at a base tier rise
await clearField(P);
const tierCall = await P.g(() => { const g = window.game; g.clearBanners(); g.stats.combo = 9; g._baseTier = 1; g.bumpMultiplier(); g.stats.combo = 10; g.bumpMultiplier(); return { mult: g.stats.mult, callout: g.callout && g.callout.title, cue: g.sfx.lastCue }; });
P.check("base tier rise -> 'x2 MULTIPLIER' callout + comboTier cue", tierCall.mult === 2 && tierCall.callout === "x2 MULTIPLIER" && /^comboTier/.test(tierCall.cue), tierCall);

// perfect wave at L2 -> +500 and a PERFECT WAVE callout
await jumpTo(P, 1);
const pw = await P.g(() => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null;
  g.beginWave(0);
  g.waveKills = LEVELS[1].quota[0];
  g.waveDmg = 0;
  const before = g.stats.score;
  g.endWave();
  return { gained: g.stats.score - before, callout: g.callout && g.callout.title, queued: (g.calloutQueue || []).map(c => c.title), phase: g.wavePhase, perfectWaves: g.levelStats.perfectWaves };
});
P.check("wave with waveDamage === 0 at L2 -> +500 and a 'PERFECT WAVE' callout", pw.gained === 500 && (pw.callout === "PERFECT WAVE" || pw.queued.includes("PERFECT WAVE")) && pw.perfectWaves === 1, pw);

// level accuracy 96 % at L3 -> tally.accuracy === 1200
await jumpTo(P, 2);
const tally = await P.g(() => {
  const g = window.game;
  g.levelStats.correct = 96; g.levelStats.total = 100; g.levelStats.retries = 0; g.levelStats.bossDamage = 0;
  return g.computeClearTally({ level: 3, levelIndex: 2, elapsed: 10, totalChars: 60, phasesCleared: 2 });
});
P.check("level accuracy 96 % at L3 -> tally.accuracy === 1200 (and flawless 1500, clear 2550)", tally.accuracy === 1200 && tally.flawless === 1500 && tally.clear === 2550, tally);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
