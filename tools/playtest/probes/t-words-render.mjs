// WORDS (D8) acceptance: the gap of a two-word plate renders as a dim dot of one glyph cell (idle / locked / next /
// typed states), plates size from the full text, the plate-sprite warm-up covers every phrase width, and the gap
// adds no shadowBlur, composite change or full-frame fill. With MEASURE's inline typo pair (real on this tree) the dots
// after the struck glyph start where the remaining run starts (xr). Usage: node probes/t-words-render.mjs [--dpr 2] [--reduced-motion]
import { openProbe, sleep, startFresh, jumpTo, clearField, placeEnemy, press, hold, waitFor } from "./b_lib.mjs";

const DPR = process.argv.includes("--dpr") ? Number(process.argv[process.argv.indexOf("--dpr") + 1]) : 1;
const RM = process.argv.includes("--reduced-motion");
const P = await openProbe("t-words-render", { dpr: DPR, reducedMotion: RM });
await P.installCanvasCounters();
await startFresh(P, "WORDS");
await jumpTo(P, 3);
await hold(P);
await clearField(P);
await sleep(2500);   // warm-up slices finish

// R5 warm cache covers every pill width up to cfg.maxTextLen, plain and typo-widened (MEASURE's + one glyph)
const warm = await P.g(() => {
  const g = window.game, cfg = LEVELS[g.levelIndex], geo = g.plateGeometry();
  g.ctx.font = geo.font;
  const mw = g.ctx.measureText("m").width;
  const missing = [];
  for (let len = 2; len <= cfg.maxTextLen; len++) {
    const w = Math.ceil(g.ctx.measureText("m".repeat(len)).width + PLATE_PAD);
    for (const ww of [w, w + mw]) {
      const wb = Math.max(geo.h, Math.ceil(ww / PLATE_BUCKET) * PLATE_BUCKET);
      for (const st of ["idle", "locked", "danger", "dangerBase"]) if (!g.plateCache.has(`pill:${wb}:${geo.h}:${st}:${g.spriteEpoch}`)) missing.push(`${len}${ww === w ? "" : "+typo"}:${st}`);
    }
  }
  return { maxTextLen: cfg.maxTextLen, missing, cache: g.plateCache.size };
});
P.check("R5 warmPlateCache baked every pill bucket (plain and typo-widened) up to cfg.maxTextLen (S4)", warm.maxTextLen >= 12 && warm.missing.length === 0, warm);

// R1 dots: wrap the helper, count calls and check the dot cell
await P.g(() => {
  const orig = window.lexiconDrawGapDots;
  window.__gap = { calls: 0, last: null, orig };
  window.lexiconDrawGapDots = function (ctx, done, remaining, x0, wd, wr, y, opts, xr) { window.__gap.calls++; window.__gap.last = { text: (done || "") + (remaining || ""), done, x0, wd, wr, y, xr, caret: !!(opts && opts.caret), typo: (opts && opts.typo) || null }; return orig.apply(this, arguments); };
});
await placeEnemy(P, "spark", 500, 0);
await sleep(200);
const r0 = await P.g(() => window.__gap.calls);
await placeEnemy(P, "warp core", 900, 2);
await P.g(() => { window.__gap.calls = 0; });
await sleep(300);
const r1 = await P.g(() => { const g = window.game; const en = g.enemies.find(e => e.text === "warp core"); const L = window.__gap.last; const adv = (L.wd + L.wr) / 9; const dotX = L.x0 + 4.5 * adv;
  g.ctx.font = g.plateGeometry().font; const tw = g.ctx.measureText("warp core").width;
  return { calls: window.__gap.calls, text: L.text, dotX, plateL: en.x - en.plateW / 2, plateR: en.x + en.plateW / 2, plateW: en.plateW, want: Math.ceil(tw + PLATE_PAD), adv }; });
P.check("R1 a one-word plate never calls the gap helper; a two-word plate calls it every frame", r0 === 0 && r1.calls >= 10 && r1.text === "warp core", { r0, r1 });
P.check("R4 two-word plate width = measured text (gap = one glyph advance) + PLATE_PAD; the dot sits inside the plate", r1.plateW === r1.want && r1.dotX > r1.plateL + 14 && r1.dotX < r1.plateR - 14, r1);

// R2 pixel diff: the dot is visible and confined to the gap cell. BLOOM (76-bloom.js) is a screen-space halo over
// every bright pixel, the dot included, so the pixel diffs run with the harness switch off; R1 / R4 / R6 keep it on.
await P.g(() => { window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { bloom: false, ambient: false, drones: false }); });   // AMBIENT / DRONES (2026-11) animate pixels outside the gap cell too
const diff = async (label) => P.g(async (label) => {
  const g = window.game, c = g.canvas, s = g.renderScale || 1;
  const L = window.__gap.last; const adv = (L.wd + L.wr) / 9; const cx = L.x0 + 4.5 * adv, cy = L.y;
  const grab = () => { g.render(); const x = Math.round((cx - 3 * adv) * s), y = Math.round((cy - 12) * s), w = Math.round(6 * adv * s), h = Math.round(24 * s); return { d: c.getContext("2d").getImageData(x, y, w, h).data, w, h }; };
  grab();   // warm-up: Chrome re-rasterises the canvas on the first readback (a uniform brightness shift over the whole frame; seen on fa06754 too), so both compared frames come from the same path
  const on = grab();
  const keep = window.lexiconDrawGapDots; window.lexiconDrawGapDots = () => {};
  const off = grab();
  window.lexiconDrawGapDots = keep;
  let inCell = 0, outCell = 0;
  for (let yy = 0; yy < on.h; yy++) for (let xx = 0; xx < on.w; xx++) {
    const i = (yy * on.w + xx) * 4; const dd = Math.abs(on.d[i] - off.d[i]) + Math.abs(on.d[i + 1] - off.d[i + 1]) + Math.abs(on.d[i + 2] - off.d[i + 2]);
    if (dd > 12) { const lx = xx / s - 3 * adv; if (Math.abs(lx) <= adv / 2 + 1) inCell++; else outCell++; }
  }
  return { label, inCell, outCell };
}, label);
const d1 = await diff("idle");
P.check("R2 idle gap: the dot changes pixels inside the gap cell only", d1.inCell >= 4 && d1.outCell === 0, d1);
for (const k of "warp") await press(P, k);
await sleep(1200);   // camera trauma from the key recoil settles (render() reads the shake)
const d2 = await diff("next");
const lockInfo = await P.g(() => window.__gap.last);
P.check("R3 locked at the gap: helper sees caret, the dot (lime .92) is drawn in the gap cell", lockInfo.caret && d2.inCell >= 4 && d2.outCell === 0, { d2, caret: lockInfo.caret });
await press(P, "Space");
await sleep(1200);
const d3 = await diff("done");
P.check("R3b typed gap: the dim dot (text .25) is still drawn", d3.inCell >= 2 && d3.outCell === 0, d3);
await P.g(() => { delete window.TypeRHarness.bloom; delete window.TypeRHarness.ambient; delete window.TypeRHarness.drones; });
await P.shot(`warp-core-${RM ? "rm" : "full"}-dpr${DPR}`);
await press(P, "Backspace");

// R6 MEASURE's typo pair at the gap: "warp" + "x" draws the struck x between the halves; the gap dot moves with the
// remaining run (xr = x0 + wd + typo width), still inside the plate
for (const k of "warp") await press(P, k);
await press(P, "x");
await sleep(80);
const r6 = await P.g(() => { const g = window.game, L = window.__gap.last, en = g.enemies.find(e => e.text === "warp core"); const adv = (L.wd + L.wr) / 9;
  return { typo: L.typo, shift: +(L.xr - (L.x0 + L.wd)).toFixed(2), adv: +adv.toFixed(2), dotX: +(L.xr + 0.5 * adv).toFixed(1), plateL: en.x - en.plateW / 2, plateR: en.x + en.plateW / 2 }; });
P.check("R6 typo pair at the gap: dots start at xr, one glyph right of the done run, inside the plate", r6.typo === "x" && Math.abs(r6.shift - r6.adv) < 0.6 && r6.dotX > r6.plateL && r6.dotX < r6.plateR, r6);
await sleep(500);
await press(P, "Backspace");

// R7 budget: 14 plates incl. 7 two-word, 3 s
await clearField(P);
const words = ["game over", "high score", "neon city", "zero gravity", "time warp", "solar wind", "power grid", "spark", "orbit", "laser", "nexus", "probe", "relay", "comet"];
for (let i = 0; i < words.length; i++) await placeEnemy(P, words[i], 380 + (i % 7) * 130, i % 6, 0);
await P.g(() => window.__e2Probe.mark());
await sleep(3000);
const perf = await P.g(() => window.__e2Probe.snapshot());
P.check("R7 14 plates (7 two-word) for 3 s: shadowBlur 0/frame, composite sets <= 6, maxRenderMs <= 16", perf.shadowBlurPerFrame === 0 && perf.compositeSetsPerFrame <= 6 && perf.maxRenderMs <= 16, perf);
P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, P.errors);
await P.finish();
