// E2 nit (d): first-frame hitch on a direct startSector(i) jump at DPR 2 (GPU upload of the freshly prepared sector
// bitmaps). Measures max render() ms over the 3 s that follow each jump; the sector card covers that window, so the
// upload must land there (warmSector from loadLevelAssets) instead of on the first gameplay frame.
// Usage: node probes/e2-hitch.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const dpr = process.argv.includes("--dpr") ? Number(process.argv[process.argv.indexOf("--dpr") + 1]) : 2;
const P = await openProbe("e2-hitch", { dpr });
await P.installCanvasCounters();
await P.goto({ playerName: "HITCH", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 10, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true } });
await P.g(() => window.game.startSector(0));
await P.page.waitForFunction(() => window.game.mode === "playing" && window.game.levelReady, null, { timeout: 20000 });
await sleep(1500);

const jumps = [];
for (const i of [4, 9, 6, 2]) {
  await P.g(() => window.__e2Probe.mark());
  await P.g((i) => window.game.startSector(i), i);
  await sleep(3000);
  const s = await P.g(() => window.__e2Probe.snapshot());
  const ready = await P.g(() => ({ levelReady: window.game.levelReady, levelIndex: window.game.levelIndex, renderScale: window.game.renderScale }));
  jumps.push({ sector: i + 1, maxRenderMs: s.maxRenderMs, over16: s.renderFramesOver16ms, avg: s.avgRenderMs, frames: s.frames, ...ready });
  console.log(`[e2-hitch] startSector(${i}) -> S${i + 1}: maxRenderMs ${s.maxRenderMs}, frames > 16 ms ${s.renderFramesOver16ms}, avg ${s.avgRenderMs} (${s.frames} frames, renderScale ${ready.renderScale})`);
}
const worst = Math.max(...jumps.map((j) => j.maxRenderMs));
P.check(`direct sector jumps at DPR ${dpr}: maxRenderMs <= 16 over the 3 s after startSector`, worst <= 16, jumps);
await P.finish();
