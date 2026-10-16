// E2 combined budget run (PLAN E2): DPR 2, CRT on, 14 enemies on screen, three chips active, a toast visible and a
// banner up, measured over 2 s of play: fps >= 58, maxRenderMs <= 16, shadowBlurPerFrame 0, compositeSetsPerFrame <= 6.
// Sector 10 is used because its wave cap (maxEnemies 14 + 1) admits 14 plates through the real spawner; the plates
// are then spread across the field so every one is on screen, and one of them is locked (typed) during the window.
// Usage: node probes/e2-budget.mjs [--dpr 2] [--sector 10]
import { openProbe, sleep } from "./_lib.mjs";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const dpr = Number(arg("--dpr", 2));
const sector = Number(arg("--sector", 10));
const P = await openProbe("e2-budget", { dpr });
await P.installCanvasCounters();
await P.goto({ playerName: "BUDGET", selectedShip: "honeybee", highScore: 0, lastUnlockedLevel: 10, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true, crtIntensity: 1 } });
await P.g((i) => window.game.startSector(i), sector - 1);
await P.page.waitForFunction(() => { const g = window.game; return g.mode === "playing" && g.levelReady && !g.levelIntro && g.wavePhase === "spawn"; }, null, { timeout: 25000 });
await sleep(300);

const setup = await P.g(() => {
  const g = window.game;
  g.wave = 2;                                   // wave 3 of the sector: the widest cap (+1 enemy)
  g.waveKills = 0;
  let spawned = 0;
  while (g.enemies.filter((e) => e.alive && !e.dying).length < 14 && spawned < 40) { if (!g.spawnEnemy()) break; spawned++; }
  const live = g.enemies.filter((e) => e.alive && !e.dying);
  // spread the plates across the visible field (x 0.42 w .. 0.97 w), lanes as assigned
  live.forEach((e, k) => { e.x = g.w * (0.42 + 0.55 * (k / Math.max(1, live.length - 1))); });
  // three chips, a toast, a banner
  g.power.spread = 9; g.power.rapid = 9; g.player.shield = 9; g.syncChips();
  g.showToast("BUDGET RUN: 14 PLATES, 3 CHIPS, CRT ON", { kind: "tip", key: "e2", ms: 6000 });
  g.showBanner({ kind: "wave", eyebrow: "WAVE 3 / 3", sub: "BUDGET", dur: 4 });
  // lock the nearest plate by typing its first letter (a wrong-key-free lock)
  const nearest = live.slice().sort((a, b) => a.x - b.x)[0];
  if (nearest) g.handleTyped(nearest.nextChar());
  return { enemies: live.length, locked: !!g.lock, crt: document.documentElement.dataset.crt, renderScale: g.renderScale, chips: document.querySelectorAll("#hudChips .chip").length,
    toast: !!document.querySelector("#toastStack .toast"), banner: !!g.banner };
});
console.log("[e2-budget] setup", JSON.stringify(setup));

await P.g(() => window.__e2Probe.mark());
const fps = await P.fps(2000);
const snap = await P.g(() => window.__e2Probe.snapshot());
const after = await P.g(() => { const g = window.game; return { enemies: g.enemies.filter((e) => e.alive && !e.dying).length, chips: document.querySelectorAll("#hudChips .chip").length, toast: !!document.querySelector("#toastStack .toast"), banner: !!g.banner, locked: !!g.lock }; });
await P.shot("budget-scene");
const result = { dpr, sector, fps, ...snap, before: setup, after };
console.log("[e2-budget]", JSON.stringify(result));

P.check("scene held: >= 14 enemies, 3 chips, toast and banner up at the start, CRT on, renderScale 2", setup.enemies >= 14 && setup.chips === 3 && setup.toast && setup.banner && setup.crt === "on" && setup.renderScale >= 1.9, setup);
P.check("fps >= 58", fps >= 58, fps);
P.check("maxRenderMs <= 16 in the measured window", snap.maxRenderMs <= 16, { maxRenderMs: snap.maxRenderMs, avg: snap.avgRenderMs, over16: snap.renderFramesOver16ms });
P.check("shadowBlurPerFrame === 0", snap.shadowBlurPerFrame === 0 && snap.shadowBlurSetsPerFrame === 0, { shadowBlur: snap.shadowBlurPerFrame, sets: snap.shadowBlurSetsPerFrame });
P.check("compositeSetsPerFrame <= 6", snap.compositeSetsPerFrame <= 6, snap.compositeSetsPerFrame);
await P.finish();
