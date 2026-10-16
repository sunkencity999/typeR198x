// B3 acceptance: waves and pacing (state machine, hungry spawner, pressure valve, stage bar, level intro gate, approach).
import { openProbe, sleep, state, typeFor, waitFor, startFresh, jumpTo, press, continueRun } from "./b_lib.mjs";

const P = await openProbe("b3");

// ---- durations table ----
await P.goto("fresh");
const durations = await P.g(() => LEVELS.map(c => c.duration));
P.check("LEVELS.map(c => c.duration) === [66,72,78,84,90,96,102,108,114,120]", JSON.stringify(durations) === JSON.stringify([66, 72, 78, 84, 90, 96, 102, 108, 114, 120]), durations);

// ---- level intro gate: levelT 0 and no enemies until ~1.6 s, then a spawn within .4 s ----
await P.page.fill("#playerName", "B3");
await P.page.click("#btnStart");
const story = P.page.locator("#btnStoryLaunch");
try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
await P.page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
const tPlay = Date.now();
const introSamples = [];
let introEndAt = null, firstSpawnAt = null;
while (Date.now() - tPlay < 4000) {
  const s = await P.g(() => ({ levelT: window.game.levelT, enemies: window.game.enemies.length, intro: !!window.game.levelIntro, phase: window.game.wavePhase }));
  const t = (Date.now() - tPlay) / 1000;
  introSamples.push({ t: Math.round(t * 100) / 100, ...s });
  if (introEndAt === null && !s.intro) introEndAt = t;
  if (firstSpawnAt === null && s.enemies > 0) firstSpawnAt = t;
  if (firstSpawnAt !== null) break;
  await sleep(40);
}
const duringIntro = introSamples.filter(s => s.intro);
P.check("levelT === 0 and enemies.length === 0 until levelIntro ends (~1.6 s), then a spawn within .4 s",
  duringIntro.length > 5 && duringIntro.every(s => s.levelT === 0 && s.enemies === 0) && introEndAt !== null && introEndAt >= 1.4 && introEndAt <= 2.7 && firstSpawnAt !== null && firstSpawnAt - introEndAt <= 0.45,
  { introEndAt, firstSpawnAt, samples: duringIntro.length, lastIntro: duringIntro[duringIntro.length - 1] });

// ---- 55 WPM / .93 typist on fresh L1: inBoss between 25 and 70 s; phase sequence; wave 0,1,2; alive-gap; stage bar ----
const phases = [];
const waves = [];
let maxGap = 0, gapStart = null, bossAt = null, stageShot = null;
await typeFor(P, 95, { wpm: 55, accuracy: 0.93, onTick: async (st, elapsed) => {
  if (!phases.length || phases[phases.length - 1] !== st.wavePhase) phases.push(st.wavePhase);
  if (!waves.length || waves[waves.length - 1] !== st.wave) waves.push(st.wave);
  if (st.wavePhase === "spawn" && !st.levelIntro) {
    if (st.alive === 0) { if (gapStart === null) gapStart = elapsed; else maxGap = Math.max(maxGap, (elapsed - gapStart) / 1000); }
    else gapStart = null;
  } else gapStart = null;
  if (st.wave === 1 && st.wavePhase === "spawn" && !stageShot) {
    stageShot = await P.g(() => ({ done: document.querySelectorAll("#stageBar .stageSeg.isDone").length, p: [...document.querySelectorAll("#stageBar .stageFill")].map(f => f.style.getPropertyValue("--p")) }));
    await P.shot("wave2-stagebar");
  }
  if (st.inBoss && bossAt === null) bossAt = elapsed / 1000;
}, until: (st) => st.inBoss || st.mode !== "playing" });
const seqWanted = ["spawn", "drain", "banner", "spawn", "drain", "banner", "spawn", "drain", "approach"];
let si = 0;
for (const p of phases) if (p === seqWanted[si]) si++;
const phaseLog = await P.g(() => window.game.phaseLog);
let li = 0;
for (const p of phaseLog) if (p === seqWanted[li]) li++;
const firstBoss = await P.g(() => ({ enemies: window.game.enemies.length, lock: window.game.lock, inBoss: window.game.inBoss, locked: !!(window.game.bossIntro && window.game.bossIntro.locked) }));
P.check("55 WPM / .93 typist on fresh L1 reaches inBoss between 25 and 70 s", bossAt !== null && bossAt >= 25 && bossAt <= 70, { bossAt, phases });
P.check("wavePhase sequence (polled) contains spawn,drain,banner,spawn,drain,banner,spawn,drain,approach in order", si === seqWanted.length, { phases, matched: si });
P.check("game.phaseLog (every transition) contains the same sequence in order", li === seqWanted.length, { phaseLog, matched: li });
P.check("wave goes 0, 1, 2", JSON.stringify(waves) === JSON.stringify([0, 1, 2]), waves);
P.check("at inBoss first true: enemies.length === 0 && lock === null", firstBoss.inBoss && firstBoss.enemies === 0 && firstBoss.lock === null, firstBoss);
P.check("screenshot during wave 2 shows #stageBar with one .isDone segment", !!stageShot && stageShot.done === 1, stageShot);
P.check("alive enemies never 0 for > 1.7 s during 'spawn' (55 WPM typist)", maxGap <= 1.7, { maxGap: Math.round(maxGap * 100) / 100 });

// ---- 10 letter keys during the first 2 s of the boss intro leave stats.total unchanged ----
const lockedNow = await P.g(() => ({ locked: !!(window.game.bossIntro && window.game.bossIntro.locked), t: window.game.bossIntro && window.game.bossIntro.t, total: window.game.stats.total }));
for (let i = 0; i < 10; i++) { await press(P, "abcdefghij"[i]); await sleep(30); }
const afterKeys = await P.g(() => ({ total: window.game.stats.total, locked: !!(window.game.bossIntro && window.game.bossIntro.locked), t: window.game.bossIntro && window.game.bossIntro.t }));
P.check("10 letter keys during the first 2 s of bossIntro leave stats.total unchanged", lockedNow.locked && lockedNow.t < 2 && afterKeys.total === lockedNow.total, { lockedNow, afterKeys });

// ---- forceBoss: levelT >= duration -> approach -> boss within 12 s ----
await jumpTo(P, 0);
await P.g(() => { window.game.levelT = LEVELS[0].duration + 0.01; });
const tForce = Date.now();
const okForce = await waitFor(P, () => window.game.inBoss, 12000);
const forceS = (Date.now() - tForce) / 1000;
const forcedPhase = await P.g(() => window.game.wavePhase);
P.check("forceBoss (levelT = duration + .01) yields inBoss within 12 s via approach", okForce && forceS <= 12, { seconds: Math.round(forceS * 10) / 10, phase: forcedPhase });

// ---- incomingCps at L5 wave 2 within +-15 % of 3.7 over 20 s (80 WPM typist keeps the field moving) ----
// B10: the hungry rule now fires on an EMPTY field (HUNGRY_MIN_ALIVE 1, HUNGRY_SPAWN_S 0.5), so the base stream paces the
// wave even for a typist faster than it; with "fewer than 2 alive for 1.0-1.5 s" this read +14 % to +22 %.
await jumpTo(P, 4);
await P.g(() => { const g = window.game; g.beginWave(1); g.levelT = LEVELS[4].cap; });
const cpsSamples = [];
await typeFor(P, 30, { wpm: 80, accuracy: 0.97, onTick: async (st, elapsed) => { if (elapsed >= 10000 && st.wavePhase === "spawn") cpsSamples.push((await P.g(() => window.TypeRDebug.stats().incomingCps))); }, until: (st) => st.wave !== 1 });
const cpsAvg = cpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, cpsSamples.length);
P.check("TypeRDebug.stats().incomingCps at L5 wave 2 (index 1) within +-15 % of 3.7 over 20 s (80 WPM typist)", cpsSamples.length > 20 && Math.abs(cpsAvg - 3.7) / 3.7 <= 0.15, { avg: Math.round(cpsAvg * 100) / 100, min: Math.min(...cpsSamples), max: Math.max(...cpsSamples), n: cpsSamples.length });

// ---- "reload" mid-wave-2 + Continue -> wave 1, waveKills 0, inBoss false ----
// (the probe's fixture init script would wipe localStorage on a real navigation, so the stored blob is re-read
//  through loadSave() in place: the same migrateSave -> continueRun -> startLevel path a reload takes)
await jumpTo(P, 0);
await P.g(() => { const g = window.game; g.beginWave(1); g.waveKills = 4; g.levelT = 30; g.saveRun(true); });
const saved = await P.g(() => { const g = window.game; const blob = localStorage.getItem(LS_KEY); g.stopToMenu(true); localStorage.setItem(LS_KEY, blob); g.save = loadSave(); g.run = null; g.refreshMenu(); return { wave: g.save.run.wave, waveKills: g.save.run.waveKills, phase: g.save.run.wavePhase }; });
await continueRun(P);
await sleep(300);
const resumed = await P.g(() => ({ wave: window.game.wave, waveKills: window.game.waveKills, inBoss: window.game.inBoss, levelT: window.game.levelT, intro: !!window.game.levelIntro, phase: window.game.wavePhase }));
P.check("reload mid-wave-2 + Continue -> wave 1, waveKills 0, inBoss false (levelT = wave * cap)", saved.wave === 1 && resumed.wave === 1 && resumed.waveKills === 0 && !resumed.inBoss && resumed.levelT === 22, { saved, resumed });

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
