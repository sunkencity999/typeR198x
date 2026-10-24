// t-pace-perf (PACE, budgets at the highest pace; CONTRACT 6 PACE): sector 10 wave 3 and sector 1 wave 3 pinned at
// paceMul 2.5 (stream x2.5, +3 plates, plates x1.225 faster) under an 80 WPM typist, DPR 2 by default: fps >= 58,
// maxRenderMs <= 16, no shadowBlur, no full-frame fill above alpha .12, composite sets <= 6; the max alive count is
// reported. Run it alone (other browsers on the machine make fps noisy). ~60 s. PASS = the paced field stays in budget.
// Usage: node tools/playtest/probes/t-pace-perf.mjs [--dpr 2] [--seconds 12]
import { openProbe, sleep, waitFor, startFresh, jumpTo, paceType, installBudget, errorsCheck } from "./pace_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const DPR = Number(args.dpr || 2);
const SECONDS = Number(args.seconds || 12);
const P = await openProbe(`t-pace-perf-dpr${DPR}`, { dpr: DPR });
await installBudget(P);
await startFresh(P, "PERF");

async function scene(levelIndex, wpm = 80) {
  await jumpTo(P, levelIndex);
  await P.g(() => {
    const g = window.game;
    g.pacePin(2.5);
    g.beginWave(2);
    g.levelT = LEVELS[g.levelIndex].cap * 2;
    window.__pm = { maxAlive: 0, maxChars: 0 };
    if (!window.__pmHooked) {
      window.__pmHooked = true;
      onGameHook("tick", function () { const n = this.countAliveEnemies(); if (n > window.__pm.maxAlive) window.__pm.maxAlive = n; const c = this.liveChars(); if (c > window.__pm.maxChars) window.__pm.maxChars = c; });
    }
  });
  const keepWave = async () => P.g(() => {
    const g = window.game;
    g.invulnT = 1e9;
    if (g.waveKills >= g.waveQuota() - 3) g.waveKills = Math.floor(g.waveQuota() / 2);
    g.waveT = Math.min(g.waveT, 10);
    g.levelT = Math.min(g.levelT, LEVELS[g.levelIndex].cap * 2 + 5);
  });
  // let the field fill, then measure while the typist works it
  const work = async (s) => {
    if (wpm > 0) return paceType(P, s, { wpm, accuracy: 0.97, onTick: keepWave });
    const t0 = Date.now();
    while (Date.now() - t0 < s * 1000) { await keepWave(); await sleep(100); }
    return null;
  };
  await work(4);
  await P.g(() => window.__paceBudget.mark());
  const [fps] = await Promise.all([P.fps(SECONDS * 1000), work(SECONDS)]);
  const out = await P.g(() => {
    const g = window.game;
    const t = g.waveTuningNow();
    return { budget: window.__paceBudget.snapshot(), maxAlive: window.__pm.maxAlive, maxChars: window.__pm.maxChars, cap: waveMaxEnemies(LEVELS[g.levelIndex], 2, g.phoneProfile()) + (t ? t.maxEnemiesAdd : 0),
      valve: t ? t.pressureCap : null, spawnMul: t && t.spawnMul, level: g.levelIndex + 1, wave: g.wave, mode: g.mode };
  });
  await P.g(() => window.game.pacePin(null));
  return { fps, ...out };
}

for (const [L, wpm] of [[9, 80], [0, 80], [9, 0]]) {
  const r = await scene(L, wpm);
  const b = r.budget;
  const who = wpm ? `${wpm} WPM typist` : "idle pilot (the field fills to the valve / alive cap)";
  P.check(`S${L + 1} W3 pinned 2.5 at DPR ${DPR}, ${who} ${SECONDS} s: fps >= 58, maxRenderMs <= 16, shadowBlur 0, full-frame fills above .12: 0, composite <= 6 (max alive reported)`,
    r.level === L + 1 && r.wave === 2 && r.spawnMul === 2.5 && r.fps >= 58 && b.maxRenderMs <= 16 && b.shadowBlurPerFrame === 0 && b.fullFrameFillFramesAbove12 === 0 && b.compositeSetsPerFrame <= 6 && b.wrapped,
    { fps: r.fps, maxRenderMs: b.maxRenderMs, avgRenderMs: b.avgRenderMs, over16: b.renderFramesOver16ms, shadowBlur: b.shadowBlurPerFrame, composite: b.compositeSetsPerFrame,
      ffMaxAlpha: b.fullFrameFillMaxAlpha, ffAbove12: b.fullFrameFillFramesAbove12, frames: b.frames, maxAlive: r.maxAlive, aliveCap: r.cap, maxLiveChars: r.maxChars, valve: r.valve });
}

errorsCheck(P);
await P.finish();
