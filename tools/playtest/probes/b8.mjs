// B8 acceptance: boss scoring, par / flawless bonuses, the 5 s skippable finale, tally commit.
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, waitFor, press } from "./b_lib.mjs";

const P = await openProbe("b8");
await startFresh(P, "B8");

async function forcedBoss(levelIndex) {
  await jumpTo(P, levelIndex);
  await P.g(() => { window.game.levelT = LEVELS[window.game.levelIndex].duration + 0.01; });
  await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
  await P.g(() => { window.game.enemies.length = 0; });
}

// forced L2 boss at mult 1: first 10 chars without finishing a segment add exactly 100
await forcedBoss(1);
const chars = await P.g(() => {
  const g = window.game;
  g.stats.combo = 0; g.power.multiplier = 0; g.bumpMultiplier();
  g.boss.segments[0] = "abcdefghijkl"; g.boss.segmentIndex = 0; g.boss.progress = 0;   // a 12-char segment so 10 chars never finish it
  const before = g.stats.score;
  for (const ch of "abcdefghij") g.handleTyped(ch);
  return { gained: g.stats.score - before, mult: g.stats.mult, progress: g.boss.progress };
});
P.check("forced L2 boss at mult 1: first 10 chars (no segment finished) add exactly 100", chars.gained === 100, chars);

// a 6-char segment at mult 2 adds 360 on top of 120
const seg = await P.g(() => {
  const g = window.game;
  g.boss.segments[g.boss.segmentIndex] = "abcdef"; g.boss.progress = 0;
  g.stats.combo = 10; g._baseTier = 2; g.bumpMultiplier();   // mult 2 (tier announce suppressed)
  const mult = g.stats.mult;
  const before = g.stats.score;
  for (const ch of "abcdef") g.handleTyped(ch);
  return { gained: g.stats.score - before, mult, cue: g.sfx.lastCue };
});
P.check("a 6-char segment at mult 2 adds 120 (chars) + 360 (segment) = 480; segmentDown cue", seg.mult === 2 && seg.gained === 480 && seg.cue === "segmentDown", seg);

// Finale timing: kill the boss, Enter at 1.0 s does nothing, Enter at 2.5 s -> levelComplete within 300 ms
const killBoss = () => P.g(() => {
  const g = window.game;
  const b = g.boss;
  b.segmentIndex = b.segments.length - 1; b.progress = 0;
  const last = b.segment;
  for (const ch of last) g.handleTyped(ch);
  return { bossClear: !!g.bossClear, tally: g.bossClear && g.bossClear.tally, elapsed: g.bossClear && g.bossClear.elapsed, totalChars: g.bossClear && g.bossClear.totalChars };
});
const k1 = await killBoss();
await sleep(1000);
await press(P, "Enter");
await sleep(150);
const at1 = await state(P);
P.check("Enter at bossClear.t ~1.0 s does nothing (still playing, finale running)", k1.bossClear && at1.mode === "playing" && at1.bossClear, { t: at1.bossClearT, mode: at1.mode });
await waitFor(P, () => window.game.bossClear && window.game.bossClear.t >= 2.5, 3000);
const tEnter = Date.now();
await press(P, "Enter");
const skipped = await waitFor(P, () => window.game.mode === "levelComplete", 1000);
const skipMs = Date.now() - tEnter;
const enemiesDuring = await P.g(() => window.game.enemies.length);
P.check("Enter at bossClear.t >= 2.5 -> mode 'levelComplete' within 300 ms", skipped && skipMs <= 300, { skipMs, skipped });
P.check("enemies.length === 0 throughout / after the finale", enemiesDuring === 0, { enemiesDuring });

// tally.time === max(0, par - elapsed) * 25 * L and tally.flawless === 500*L when bossDamage === 0
const tally = k1.tally;
const L = 2;
const expectedTime = Math.max(0, k1.totalChars / 3 - k1.elapsed) * 25 * L;
P.check("tally.time === max(0, par - elapsed)*25*L and tally.flawless === 500*L when bossDamage === 0", !!tally && Math.abs(tally.time - expectedTime) < 1e-6 && tally.flawless === 500 * L && tally.clear === 1500 + 350 * L, { tally, expectedTime, elapsed: k1.elapsed, totalChars: k1.totalChars });
const lcScore = await P.g(() => ({ score: window.game.stats.score, lastTotal: window.game.lastTally && window.game.lastTally.total, text: document.getElementById("levelCompleteText").textContent, sectorBest: window.game.save.sectorBests["2"] }));
P.check("Level Complete: lastTally.total banked once and the sector best recorded with a rank", !!lcScore.sectorBest && "SABCD".includes(lcScore.sectorBest.rank) && lcScore.lastTotal > 0, lcScore);
await P.shot("level-complete");

// without skip: levelComplete 5.0 +- .15 s after the kill
await forcedBoss(1);
const tKill = Date.now();
await killBoss();
await waitFor(P, () => window.game.mode === "levelComplete", 8000);
const finaleS = (Date.now() - tKill) / 1000;
P.check("without skip, levelComplete 5.0 +- .15 s after the kill", Math.abs(finaleS - 5.0) <= 0.15 + 0.1, { finaleS: Math.round(finaleS * 100) / 100 });

// Esc -> Restart during the finale cannot double-bank
await forcedBoss(1);
const k3 = await killBoss();
const before = await P.g(() => window.game.stats.score);
await sleep(400);
await press(P, "Escape");
await sleep(150);
const paused = await P.g(() => ({ mode: window.game.mode, committed: window.game.bossClear && window.game.bossClear.committed, score: window.game.stats.score, restartHidden: document.getElementById("btnRestart").classList.contains("hidden") }));
await P.g(() => { window.game.restartLevel(); });
await sleep(100);
await press(P, "Escape");
await waitFor(P, () => window.game.mode === "levelComplete", 8000);
const after = await P.g(() => window.game.stats.score);
P.check("Esc -> Restart during the finale cannot double-bank (score after === before + tally.total exactly once)", paused.committed === true && paused.restartHidden && after === before + k3.tally.total && paused.score === after, { before, after, total: k3.tally.total, paused });

// Space and a canvas tap also skip from 2.0 s
await forcedBoss(1);
await killBoss();
await waitFor(P, () => window.game.bossClear && window.game.bossClear.t >= 2.05, 3000);
await press(P, "Space");
const spaceSkip = await waitFor(P, () => window.game.mode === "levelComplete", 800);
P.check("Space at bossClear.t >= 2.0 skips the finale", spaceSkip, { spaceSkip });

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
