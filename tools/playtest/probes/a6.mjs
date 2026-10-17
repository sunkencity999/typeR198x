// A6 acceptance: HiDPI backing store, renderScale formula (C-1), opaque corners under shake, sharpness, hudSafeTop.
// Usage: node probes/a6.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 2);
const P = await openProbe("a6-dpr" + argDpr, { dpr: argDpr });
await P.goto("fresh");
await P.startRun("A6");
await sleep(400);

// --- backing store + formula (C-1) ---
const dims = await P.g(() => {
  const g = window.game; const c = g.canvas;
  const dpr = window.devicePixelRatio;
  const cap = g.save.settings.renderScaleCap;
  return { width: c.width, height: c.height, clientWidth: c.clientWidth, dpr, cap, renderScale: g.renderScale, w: g.w, h: g.h,
    expectedScale: Math.min(cap, c.clientWidth * dpr / 1280), transformA: g.ctx.getTransform().a, alphaFalse: g.ctx.getContextAttributes().alpha === false, cssScale: g.cssScale };
});
P.check(`dpr ${argDpr}: canvas.width === round(1280*renderScale), height === round(720*renderScale), game.w 1280`, dims.width === Math.round(1280 * dims.renderScale) && dims.height === Math.round(720 * dims.renderScale) && dims.w === 1280 && dims.h === 720, dims);
P.check("renderScale === min(renderScaleCap, clientWidth*dpr/1280) ±.01", Math.abs(dims.renderScale - dims.expectedScale) <= 0.01, { renderScale: dims.renderScale, expected: dims.expectedScale });
P.check("ctx.getTransform().a === renderScale after a frame; context is opaque (alpha:false)", Math.abs(dims.transformA - dims.renderScale) < 1e-6 && dims.alphaFalse, { a: dims.transformA, renderScale: dims.renderScale, alphaFalse: dims.alphaFalse });

// --- shake: four corners opaque and not the page background, across 12 shaken frames ---
const corners = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const W = g.canvas.width, H = g.canvas.height;
  const pageBg = [11, 16, 48];
  let bad = [], frames = 0, maxOffsetSeen = 0;
  for (let i = 0; i < 12; i++) {
    g.screenShake(14);
    await new Promise(r => requestAnimationFrame(r));
    frames++;
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [Math.floor(W / 2), 0], [0, Math.floor(H / 2)]]) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const isPage = Math.abs(d[0] - pageBg[0]) <= 2 && Math.abs(d[1] - pageBg[1]) <= 2 && Math.abs(d[2] - pageBg[2]) <= 2;
      if (d[3] !== 255 || isPage) bad.push({ x, y, rgba: [...d] });
    }
  }
  return { frames, bad: bad.slice(0, 5), badCount: bad.length, trauma: g.trauma };
});
P.check("screenShake(14) frames: all canvas corners/edges opaque and never the page background", corners.badCount === 0 && corners.frames === 12, corners);
await P.shot("shaken");

// --- sharpness: Laplacian variance of a plate at renderScaleCap 2 vs 1 (the pre-A6 look), same DPR ---
async function plateVariance() {
  const clip = await P.g(() => {
    const g = window.game; const r = g.canvas.getBoundingClientRect(); const k = g.cssScale;
    return { x: r.left + (640 - 110) * k, y: r.top + (360 - 26) * k, width: 220 * k, height: 52 * k };
  });
  const png = await P.page.screenshot({ clip, type: "png" });
  return P.g(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; const w = c.width, h = c.height;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += lap; sum2 += lap * lap; n++;
    }
    const mean = sum / n;
    return { variance: sum2 / n - mean * mean, px: [w, h] };
  }, png.toString("base64"));
}
await P.g(() => { const g = window.game; g.save.settings.crt = false; g.applySettings(); g.timeScale = 0; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.enemies.push(new Enemy({ text: "sharpness", x: 640, y: 360, speed: 0 })); g.trauma = 0; });
await sleep(200);
await P.g(() => { window.game.save.settings.renderScaleCap = 1; window.game.resizeCanvas(); });
await sleep(250);
const low = await plateVariance();
const lowDims = await P.g(() => ({ width: window.game.canvas.width, renderScale: window.game.renderScale }));
await P.shot("plate-cap1");
await P.g(() => { window.game.save.settings.renderScaleCap = 2; window.game.resizeCanvas(); });
await sleep(250);
const high = await plateVariance();
const highDims = await P.g(() => ({ width: window.game.canvas.width, renderScale: window.game.renderScale, epoch: window.game.spriteEpoch }));
await P.shot("plate-cap2");
if (argDpr >= 2) {
  P.check("plate text Laplacian variance at renderScale 2 >= 2x the renderScale-1 (upscaled) baseline", high.variance >= 2 * low.variance && highDims.renderScale === 2 && lowDims.renderScale === 1, { low, high, lowDims, highDims, ratio: high.variance / low.variance });
} else {
  P.note("sharpness ratio", `dpr 1 run: cap 1 and cap 2 both give renderScale 1 (ratio ${(high.variance / low.variance).toFixed(2)}); measured in the dpr 2 run`);
}
P.check("settings.renderScaleCap is honoured by resizeCanvas (cap 1 -> 1280 px backing store)", lowDims.width === 1280 && lowDims.renderScale === 1, lowDims);
await P.g(() => { window.game.timeScale = 1; window.game.save.settings.crt = true; window.game.applySettings(); });

// --- hudSafeTop ---
const hst = await P.g(async () => {
  const g = window.game;
  g.pauseGame("user"); // updateHUD() re-hides #bossBar every frame while !inBoss; pause freezes the HUD
  const before = g.hudSafeTop;
  document.getElementById("bossBar").classList.remove("hidden");
  await new Promise(r => setTimeout(r, 400));
  const withBoss = g.hudSafeTop;
  document.getElementById("bossBar").classList.add("hidden");
  await new Promise(r => setTimeout(r, 400));
  const after = g.hudSafeTop;
  g.setMode("playing");
  return { before, withBoss, after };
});
P.check("game.hudSafeTop within 72..140 and changes when #bossBar shows", hst.before >= 72 && hst.before <= 140 && hst.withBoss >= 72 && hst.withBoss <= 140 && hst.withBoss > hst.before && hst.after === hst.before, hst);

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
