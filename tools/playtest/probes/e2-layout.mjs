// E2 / PLAN A11: forced-layout count of the DOM HUD. Reads Performance.getMetrics LayoutCount deltas (CDP) over
// 5 s of idle play (no typing), 5 s of idle play with three chips active, and 5 s of typing, on a fresh save
// (tutorial toasts included, as in the harness). Targets: idle <= 10 per 5 s, typing <= 30 per 5 s.
// Usage: node probes/e2-layout.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const dpr = process.argv.includes("--dpr") ? Number(process.argv[process.argv.indexOf("--dpr") + 1]) : 1;
const P = await openProbe("e2-layout", { dpr });
await P.goto(null);
await P.startRun("LAYOUT");
// Past the sector card and the WAVE 1 banner, with the first plates on the field.
await P.page.waitForFunction(() => { const g = window.game; return g.mode === "playing" && !g.levelIntro && g.wavePhase === "spawn" && g.levelT > 2.2; }, null, { timeout: 20000 });

const window5 = async (label, during) => {
  const m0 = await P.metrics();
  await during();
  const m1 = await P.metrics();
  const r = P.per5s(m0, m1);
  console.log(`[e2-layout] ${label}: layout ${r.layoutPer5s}/5s, recalc ${r.recalcPer5s}/5s over ${r.spanMs} ms`);
  return r;
};

const idle = await window5("idle play", () => sleep(5000));
const chips = await window5("idle play, three chips", async () => {
  await P.g(() => { const g = window.game; g.power.spread = 9; g.power.rapid = 9; g.player.shield = 9; g.syncChips(); });
  await sleep(5000);
});
await P.g(() => { const g = window.game; g.power.spread = 0; g.power.rapid = 0; g.player.shield = 0; g.syncChips(); });
await sleep(400);
const typing = await window5("typing", () => P.autoType(5, { accuracy: 0.93 }));
const typed = await P.g(() => window.game.stats.total);
const st = await P.state();
await P.shot("after");

P.check("idle play: layoutCountPer5s <= 10", idle.layoutPer5s <= 10, idle);
P.check("typing: layoutCountPer5s <= 30", typing.layoutPer5s <= 30, { ...typing, keysTyped: typed, state: st });
P.note("idle play with three chips (reported, chip time text is a 5 Hz counter by contract B-16)", JSON.stringify(chips));
await P.finish();
