// B1 acceptance: lock rules v2 (enemies first, lanes, unique first letters, release, deterministic loss, dry fire).
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, clearField, placeEnemy, placePowerup, press, hold } from "./b_lib.mjs";

const P = await openProbe("b1");
await startFresh(P, "B1");
await hold(P);
await clearField(P);

// 1. enemy 'shield' at x 900 and powerup 'shield' at x 700: 's' locks the enemy
await placeEnemy(P, "shield", 900, 1);
await placePowerup(P, "SHIELD", 700, 3);
await press(P, "s");
const r1 = await state(P);
P.check("enemy 'shield'@900 + powerup 'shield'@700, press 's' -> lock.kind 'enemy'", r1.lock === "enemy", r1);

// 4. Space with a lock: lock null, stats.total / combo unchanged, lastCue lockRelease
const before4 = await state(P);
await press(P, "Space");
const r4 = await state(P);
P.check("Space with a lock -> lock null, stats.total/combo unchanged, lastCue 'lockRelease'", r4.lock === null && r4.total === before4.total && r4.combo === before4.combo && r4.lastCue === "lockRelease", { before4, r4 });

// 7. wrong key never changes stats.score (while locked)
await clearField(P);
await placeEnemy(P, "apple", 900, 2);
await press(P, "a");
const s7a = await state(P);
await press(P, "z");
const s7b = await state(P);
P.check("wrong key while locked: score unchanged, total +1, combo 0", s7b.score === s7a.score && s7b.total === s7a.total + 1 && s7b.combo === 0, { s7a, s7b });

// 6. three wrong keys while locked -> lock null after the third + LOCK LOST floater
await press(P, "z");
const mid6 = await state(P);
await press(P, "z");
const r6 = await P.g(() => ({ lock: window.game.lock, floaters: (window.game.floaters || []).map(f => f.text), cue: window.game.sfx.lastCue, progress: window.game.enemies[0] && window.game.enemies[0].progress }));
P.check("three wrong keys while locked -> lock null after the third, 'LOCK LOST' floater, progress reset", mid6.lock === "enemy" && r6.lock === null && r6.floaters.includes("LOCK LOST") && r6.cue === "lockLost" && r6.progress === 0, { mid6, r6 });

// 5. empty field + 'q': dry fire changes nothing
await clearField(P);
const before5 = await state(P);
const flash5 = await P.g(() => { window.game.typoFlash = 0; window.game.flash = 0; return true; });
await press(P, "q");
const r5 = await P.g(() => { const g = window.game; return { total: g.stats.total, combo: g.stats.combo, typoFlash: g.typoFlash, cue: g.sfx.lastCue }; });
P.check("empty field + 'q' -> stats.total unchanged, combo unchanged, typoFlash 0 (dry fire)", r5.total === before5.total && r5.combo === before5.combo && r5.typoFlash === 0 && r5.cue === "error", { before5, r5 });

// 8. plate left edge just inside the canvas is lockable (CONTRACT §4: en.x - plateW/2 <= w - 4; the PLAN's
//    "2 px inside" line conflicts with that formula, the contract margin wins)
await clearField(P);
const r8 = await P.g(() => {
  const g = window.game;
  const en = new Enemy({ text: "zoom", x: 0, y: LANE_YS[2], speed: 0, lane: 2 });
  en.x = g.w - TARGETABLE_MARGIN + en.plateW / 2;   // left edge exactly at the contract margin
  g.enemies.push(en);
  return { targetable: g.isTargetable(en), x: en.x, plateW: en.plateW, margin: TARGETABLE_MARGIN };
});
await press(P, "z");
const r8b = await state(P);
P.check("enemy whose plate left edge is TARGETABLE_MARGIN (4) px inside the canvas is targetable and locks on 'z'", r8.targetable && r8b.lock === "enemy", { r8, r8b });
const r8c = await P.g(() => { const g = window.game; g.enemies.length = 0; g.lock = null; const en = new Enemy({ text: "zoom", x: 0, y: LANE_YS[2], speed: 0, lane: 2 }); en.x = g.w + 6 + en.plateW / 2; g.enemies.push(en); return g.isTargetable(en); });
P.check("plate left edge 6 px outside the canvas is NOT targetable", r8c === false, { targetable: r8c });

// 3. 200 spawns all land on LANE_YS
await clearField(P);
const lanes = await P.g(() => {
  const g = window.game;
  const ys = [];
  for (let i = 0; i < 200; i++) {
    g.enemies.length = 0;
    const en = g.spawnEnemy();
    if (en) ys.push(en.y);
  }
  g.enemies.length = 0;
  return { n: ys.length, allOnLanes: ys.every(y => LANE_YS.includes(y)), distinct: [...new Set(ys)].sort((a, b) => a - b) };
});
P.check("200 spawnEnemy() calls: every y in LANE_YS", lanes.n === 200 && lanes.allOnLanes, lanes);

// 2. duplicate next chars among live enemies in < 5 % of 250 ms samples at L3 and L8 (30 s each, typing along)
async function dupeRun(levelIndex, seconds) {
  await jumpTo(P, levelIndex);
  let samples = 0, dupes = 0, lastSample = 0;
  await typeFor(P, seconds, { wpm: 70, accuracy: 0.96, onTick: async (st, elapsed) => {
    if (elapsed - lastSample < 250) return;
    lastSample = elapsed;
    const d = await P.g(() => {
      const g = window.game;
      const chars = g.enemies.filter(e => e.alive && !e.dying && g.isTargetable(e)).map(e => e.nextChar());
      return chars.length !== new Set(chars).size;
    });
    samples++; if (d) dupes++;
  } });
  return { levelIndex, samples, dupes, pct: samples ? Math.round(dupes / samples * 1000) / 10 : 0 };
}
const d3 = await dupeRun(2, 30);
const d8 = await dupeRun(7, 30);
P.check("duplicate nextChar() among targetable enemies in < 5 % of 250 ms samples (L3, 30 s)", d3.pct < 5, d3);
P.check("duplicate nextChar() among targetable enemies in < 5 % of 250 ms samples (L8, 30 s)", d8.pct < 5, d8);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
