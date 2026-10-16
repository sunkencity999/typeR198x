// E2 / PLAN A11: forced-layout count of the DOM HUD. Reads Performance.getMetrics LayoutCount deltas (CDP) over
// 5 s of idle play (no typing), 5 s of idle play with three chips active, and 5 s of typing, on a fresh save
// (tutorial toasts included, as in the harness). Targets: idle <= 10 per 5 s, typing <= 40 per 5 s.
// A typing window above the gate is measured once more and the lower value is gated (the figure is only meaningful
// with no other Chrome probe running on the machine). Usage: node probes/e2-layout.mjs [--dpr 2]
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
let typing2 = null;
if (typing.layoutPer5s > 40) {
  // review R32: the window is wave- and load-sensitive (another Chrome probe on the machine adds 10-20 layouts).
  // One re-measure, gated on the lower of the two, separates a busy machine from a regression.
  await sleep(400);
  typing2 = await window5("typing (re-measure)", () => P.autoType(5, { accuracy: 0.93 }));
}
const typingBest = typing2 && typing2.layoutPer5s < typing.layoutPer5s ? typing2 : typing;
const typed = await P.g(() => window.game.stats.total);
const st = await P.state();
await P.shot("after");

P.check("idle play: layoutCountPer5s <= 10", idle.layoutPer5s <= 10, idle);
// Typing target (review R32): the designed cadence, not a measured median. The continuous counters commit together at
// most every HUD_TEXT_COMMIT_S = 0.2 s (60-hud.js), so <= 25 layout passes per 5 s come from commit frames (17-18 measured:
// the score tween settles between keystrokes). On top of that the window carries event-driven writes that each dirty
// layout once and land or not depending on the wave: a tutorial tip / toast insert and its removal, the announcer slot,
// a powerup pickup (flyLabel start state + chip insert), multiplier-tier and combo-break text, the sector prefetch bar.
// Allow ~15 of those: 25 + 15 = 40 (see the breakdown below). Measured on this branch, DPR 2, run alone: 25.6-36.8 depending on which events hit.
// Typing target 40 on a FRESH save at DPR 2 (measured with out/review/e2-layout-verify.mjs after the review fixes):
// ~26 from the 5 Hz HUD text commits plus chip/combo writes, ~9 for one onboarding tip toast lifecycle (insert,
// toastIn, removal) that a fresh save shows in this window, ~2 for the lock-lost / pickup announcements (R48),
// ~3 headroom for a wave boundary. The harness's own typing window (no tips, steady wave) reads 16-22.
P.check("typing: layoutCountPer5s <= 40 (lower of up to two windows)", typingBest.layoutPer5s <= 40,
  { ...typingBest, firstWindow: typing.layoutPer5s, secondWindow: typing2 ? typing2.layoutPer5s : null, keysTyped: typed, state: st });
P.note("idle play with three chips (reported, chip time text is a 5 Hz counter by contract B-16)", JSON.stringify(chips));
await P.finish();
