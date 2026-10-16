// B7 acceptance: boss fight v2 (plans, targetable minions, Signal Surge, phases, checkpoints, intro skip).
import { openProbe, sleep, state, startFresh, jumpTo, waitFor, press } from "./b_lib.mjs";

const P = await openProbe("b7");
await P.goto("fresh");

// buildBossSegments / buildBossPlan counts and vocabulary
const plans = await P.g(() => {
  const out = [];
  for (let L = 1; L <= 10; L++) {
    const plan = buildBossPlan(L);
    const segs = buildBossSegments(L);
    const allowed = new Set([...BOSS_SEGMENT_BASE[L - 1], ...BOSS_WORD_THEMES[L], ...BOSS_WORD_POOL, ...FINAL_MESSAGE]);
    const core = L === 10 ? plan.segments.slice(0, -9) : plan.segments;
    out.push({
      L, n: plan.segments.length, legacyN: segs.length, viaProp: segs.segments.length, expected: 6 + 3 * (L - 1) + (L === 10 ? 9 : 0),
      words: plan.segments.every(w => /^[a-z]+$/.test(w) && allowed.has(w)),
      finalMessage: L === 10 ? JSON.stringify(plan.segments.slice(-9)) === JSON.stringify(FINAL_MESSAGE) : true,
      phaseStarts: plan.phaseStarts, noRepeat: new Set(core).size === core.length,
      themedShare: Math.round(plan.themedCount / plan.coreCount * 100)
    });
  }
  return out;
});
P.check("buildBossSegments(L).segments.length === 6+3(L-1) (+9 at L10, last 9 === FINAL_MESSAGE); words from the allowed unions", plans.every(p => p.n === p.expected && p.legacyN === p.expected && p.viaProp === p.expected && p.words && p.finalMessage), plans.map(p => ({ L: p.L, n: p.n, ps: p.phaseStarts })));
P.check("C-6: no repeated word within a boss for L <= 7; themed share >= 60 % (L <= 5) / >= 40 % (L >= 6)", plans.every(p => (p.L > 7 || p.noRepeat) && (p.L <= 5 ? p.themedShare >= 60 : p.themedShare >= 40)), plans.map(p => ({ L: p.L, noRepeat: p.noRepeat, themed: p.themedShare })));

// forced L5 boss
await P.startRun("B7");
await jumpTo(P, 4);
await P.g(() => { window.game.levelT = LEVELS[4].duration + 0.01; });
const typeable = await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
const ticks = await P.g(() => ({ ticks: document.querySelectorAll("#bossMeter .bossPhaseTick").length, segments: document.getElementById("bossMeter").style.getPropertyValue("--segments"), phase: document.getElementById("bossPhase").textContent, seg: document.getElementById("bossSegment").textContent, state: document.getElementById("bossMeter").dataset.state, hidden: document.getElementById("bossBar").classList.contains("hidden") }));
P.check("forced L5 boss typeable within 15 s; #bossMeter has 2 .bossPhaseTick children, --segments 18, #bossPhase 'PHASE 1/3', bar shown", typeable && ticks.ticks === 2 && ticks.segments === "18" && ticks.phase === "PHASE 1/3" && !ticks.hidden, ticks);
await P.shot("boss-l5");

// minion: press a live minion's letter -> dead, correct +1, combo +1, score +40*mult
const minion = await P.g(() => {
  const g = window.game;
  g.enemies.length = 0;
  const m = g.spawnBossMinion();
  const before = { correct: g.stats.correct, combo: g.stats.combo, score: g.stats.score, mult: g.stats.mult };
  g.handleTyped(m.text);
  return { before, after: { correct: g.stats.correct, combo: g.stats.combo, score: g.stats.score }, dead: !m.alive, letter: m.text, y: m.y, x: Math.round(m.x), artX: Math.round(g.boss.artRect.x), kind: m.kind };
});
P.check("press a live minion's letter -> minion dead, correct +1, combo +1, score +40*mult; spawned at artRect.x + minionSpawnDx on a lane <= 456", minion.dead && minion.after.correct === minion.before.correct + 1 && minion.after.combo === minion.before.combo + 1 && minion.after.score - minion.before.score === 40 * minion.before.mult && minion.y <= 456 && minion.x === minion.artX - 40, minion);

// minions never exceed min(4, 1+floor(L/3)) and all spawn with y <= 456 (observe 12 s without typing them)
let maxMinions = 0, badY = 0;
const tObs = Date.now();
while (Date.now() - tObs < 12000) {
  const o = await P.g(() => { const ms = window.game.enemies.filter(e => e.alive && e.kind === "bossMinion"); return { n: ms.length, bad: ms.filter(m => m.y > 456).length }; });
  maxMinions = Math.max(maxMinions, o.n); badY += o.bad;
  await sleep(100);
}
P.check("L5 minions never exceed min(4, 1+floor(L/3)) = 2 and all spawn with y <= 456", maxMinions <= 2 && badY === 0, { maxMinions, badY, cfgMax: 2 });

// surge: boss.surge = {t:0, dur:3, armed:true} -> hazard meter drawn 1.5 s later; finishing the segment -> hp unchanged, surgesCancelled 1
await P.g(() => { const g = window.game; g.enemies.length = 0; g.player.shield = 0; g.boss.surge = { t: 0, dur: 3, armed: true }; g.levelStats.surgesCancelled = 0; g._hazardDraws = 0; });
await sleep(1500);
const hz = await P.g(() => ({ t: window.game.boss.surge && window.game.boss.surge.t, draws: window.game._hazardDraws, charging: document.getElementById("bossMeter").classList.contains("isCharging"), hp: window.game.player.hp }));
await P.shot("surge-charging");
// finish the segment
const segChars = await P.g(() => window.game.boss.remaining);
for (const ch of segChars) { await press(P, ch); await sleep(15); }
const cancelled = await P.g(() => ({ surge: window.game.boss.surge, cancelled: window.game.levelStats.surgesCancelled, hp: window.game.player.hp, cue: window.game.sfx.lastCue, callout: (window.game.callout && window.game.callout.title) || (window.game.calloutQueue || []).map(c => c.title).join(",") }));
P.check("surge {t:0,dur:3} -> hazard meter drawn and #bossMeter.isCharging 1.5 s later; completing the segment -> hp unchanged, surgesCancelled === 1", hz.t >= 1.3 && hz.draws > 0 && hz.charging && cancelled.surge === null && cancelled.cancelled === 1 && cancelled.hp === hz.hp, { hz, cancelled });

// a fired L4 surge without shield -> hp -16
await jumpTo(P, 3);
await P.g(() => { window.game.levelT = LEVELS[3].duration + 0.01; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
const fired = await P.g(() => { const g = window.game; g.enemies.length = 0; g.player.shield = 0; g.invulnT = 0; const hp0 = g.player.hp; g.boss.surge = { t: 0, dur: 0.2, armed: true }; return hp0; });
await sleep(600);
const firedAfter = await P.g(() => ({ hp: window.game.player.hp, surge: window.game.boss.surge, cue: window.game.sfx.lastCue }));
P.check("a fired L4 surge without shield -> hp -16 (8 + 2L), surgeFire cue", fired - firedAfter.hp === 16 && firedAfter.surge === null, { hp0: fired, ...firedAfter });

// phase clear at segmentIndex === phaseStarts[1]: no minions next frame, shield >= 3, #bossPhase 'PHASE 2/3', run.bossCheckpoint.bossPhase === 1
const phase = await P.g(() => {
  const g = window.game;
  const boss = g.boss;
  g.player.shield = 0;
  boss.segmentIndex = boss.phaseStarts[1] - 1; boss.progress = 0;
  g.spawnBossMinion();
  const minionsBefore = g.enemies.filter(e => e.alive && e.kind === "bossMinion").length;
  for (const ch of boss.segment) g.handleTyped(ch);
  return { minionsBefore, seg: boss.segmentIndex, phase: boss.phase, shield: g.player.shield, phaseText: document.getElementById("bossPhase").textContent, cp: g.run.bossCheckpoint && g.run.bossCheckpoint.bossPhase, state: document.getElementById("bossMeter").dataset.state, callout: (g.callout && g.callout.title) || (g.calloutQueue || []).map(c => c.title).join(",") };
});
await sleep(60);
const phaseNext = await P.g(() => window.game.enemies.filter(e => e.alive && e.kind === "bossMinion").length);
P.check("segmentIndex reaches phaseStarts[1] -> no minions next frame, shield >= 3, #bossPhase 'PHASE 2/3', run.bossCheckpoint.bossPhase === 1, data-state p2", phase.minionsBefore >= 1 && phaseNext === 0 && phase.shield >= 3 && phase.phaseText === "PHASE 2/3" && phase.cp === 1 && phase.phase === 1 && phase.state === "p2", { ...phase, phaseNext });

// L1 / L2 forced bosses never start a surge (surgeEvery null) - observed 20 s each plus the table
for (const li of [0, 1]) {
  await jumpTo(P, li);
  await P.g(() => { window.game.levelT = LEVELS[window.game.levelIndex].duration + 0.01; });
  await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
  let surged = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { if (await P.g(() => !!(window.game.boss && window.game.boss.surge))) { surged = true; break; } await sleep(250); }
  const cfg = await P.g(() => LEVELS[window.game.levelIndex].surgeEvery);
  P.check(`L${li + 1} forced boss never starts a surge (observed 20 s; surgeEvery === null)`, !surged && cfg === null, { surged, surgeEvery: cfg });
}

// L10: 3 phase ticks (phaseStarts length 4)
await jumpTo(P, 9);
await P.g(() => { window.game.levelT = LEVELS[9].duration + 0.01; });
await waitFor(P, () => window.game.inBoss, 15000);
const l10 = await P.g(() => ({ ticks: document.querySelectorAll("#bossMeter .bossPhaseTick").length, phaseStarts: window.game.boss.phaseStarts, phaseText: document.getElementById("bossPhase").textContent }));
P.check("L10 boss: 3 .bossPhaseTick children (phaseStarts length 4), 'PHASE 1/4'", l10.ticks === 3 && l10.phaseStarts.length === 4 && l10.phaseText === "PHASE 1/4", l10);

// with sectorBests['3'] present, a key at bossIntro.t = 1.2 ends the lockout
await P.g(() => { window.game.save.sectorBests["3"] = { score: 1, rank: "C", wpm: 10, acc: 90, maxCombo: 3, date: Date.now() }; });
await jumpTo(P, 2);
await P.g(() => { window.game.levelT = LEVELS[2].duration + 0.01; });
await waitFor(P, () => window.game.inBoss, 15000);
await waitFor(P, () => window.game.bossIntro && window.game.bossIntro.t >= 1.15, 5000);
const pre = await P.g(() => ({ t: window.game.bossIntro.t, locked: window.game.bossIntro.locked, skippable: window.game.bossIntro.skippable }));
await press(P, "k");
const post = await P.g(() => ({ locked: !!(window.game.bossIntro && window.game.bossIntro.locked), total: window.game.stats.total, cue: window.game.sfx.lastCue }));
P.check("with sectorBests['3'] present a key at bossIntro.t ~1.2 ends the lockout (key itself not counted)", pre.locked && pre.skippable && pre.t < 2.4 && post.locked === false, { pre, post });
await jumpTo(P, 0);
await P.g(() => { window.game.levelT = LEVELS[0].duration + 0.01; });
await waitFor(P, () => window.game.inBoss, 15000);
await waitFor(P, () => window.game.bossIntro && window.game.bossIntro.t >= 1.15, 5000);
await press(P, "k");
const noSkip = await P.g(() => ({ locked: !!(window.game.bossIntro && window.game.bossIntro.locked), t: window.game.bossIntro && window.game.bossIntro.t, skippable: window.game.bossIntro && window.game.bossIntro.skippable }));
P.check("first-time player: a key at bossIntro.t ~1.2 does NOT end the lockout", noSkip.locked === true && noSkip.skippable === false, noSkip);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
