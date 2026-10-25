// t-arcade-budget (ARCADE frame budget, ~45 s, DPR 2, CRT on; run alone: fps and layout counts are noisy when other
// Chrome instances share the machine): a forced sector-10 boss with 4 minions on screen, a Counter-Signal charging (art
// glow, slab outline pulse, DOM charge bar) and Overdrive active (white-hot beams, plume x2, the arc; threshold pinned at
// 25 with a stubbed run speed, keys at 100 WPM through game.handleTyped on a setTimeout chain). Over a 4 s window:
// fps >= 58, maxRenderMs <= 16, compositeSetsPerFrame <= 6, shadowBlurPerFrame 0, translucent full-frame fills <= .12,
// layoutCountPer5s <= 40; then JS heap growth < 2 MB over 10 s (forced GC). Exits 1 on any fail or page / console error.
import { openProbe, sleep, waitFor, startFresh, jumpTo } from "./b_lib.mjs";

const P = await openProbe("t-arcade-budget", { dpr: 2 });
await P.installCanvasCounters();
await P.context.addInitScript(() => {
  const F = window.__ff = { max: 0, on: false };
  const parseAlpha = (s) => { if (typeof s !== "string") return null; const m = s.trim().toLowerCase().match(/^(?:rgba?|hsla?)\(([^)]+)\)$/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length >= 4 ? (p[3].endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1; } return 1; };
  const proto = CanvasRenderingContext2D.prototype, orig = proto.fillRect;
  proto.fillRect = function (x, y, w, h) {
    try {
      const c = this.canvas;
      if (F.on && c && c.id === "game" && w > 0 && h > 0) {
        const m = this.getTransform();
        const xs = [m.a * x + m.c * y + m.e, m.a * (x + w) + m.c * (y + h) + m.e], ys = [m.b * x + m.d * y + m.f, m.b * (x + w) + m.d * (y + h) + m.f];
        const cov = Math.max(0, Math.min(c.width, Math.max(...xs)) - Math.max(0, Math.min(...xs))) * Math.max(0, Math.min(c.height, Math.max(...ys)) - Math.max(0, Math.min(...ys))) / (c.width * c.height);
        if (cov >= 0.9) { const a0 = parseAlpha(this.fillStyle); const a = a0 == null ? 0 : Math.min(1, a0 * this.globalAlpha); if (a < 0.999 && a > F.max) F.max = a; }
      }
    } catch {}
    return orig.apply(this, arguments);
  };
});
await startFresh(P, "BUDGET");
await jumpTo(P, 9);
await P.g(() => { window.game.levelT = LEVELS[9].duration + 0.01; });
const inBoss = await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);

// Scene: 4 static minions, a 150-letter segment with a surge charging over it, the threshold pinned at 25
const SEG = "counterconvolutedsignalinterferencefromthefinalelectromancerwhosemessagekeepsrewritingitselfacrossthegridwhileyoutypefasterthaneverbeforeinthisneonsky".slice(0, 150);
const scene = await P.g((seg) => {
  const g = window.game, b = g.boss;
  const orig = Game.prototype.typistSpeed;
  g.typistSpeed = function (scope, w) { if (scope === "run") return { wpm: 20, n: 50 }; return orig.call(this, scope, w); };
  g._od.threshold = g.odThreshold();
  g.minionAcc = -1e9; g.enemies.length = 0; g.player.shield = 0;
  const ms = [];
  for (let i = 0; i < 4; i++) { const m = g.spawnBossMinion(); if (m) { m.speed = 0; m.x = 560 + i * 90; ms.push(m.text); } }
  b.segments[b.segmentIndex] = seg; b.progress = 0;
  b.surgeTimer = 99;
  return { threshold: g._od.threshold, minions: ms, level: LEVELS[g.levelIndex].level, crt: !!g.save.settings.crt };
}, SEG);
await waitFor(P, () => !!window.game.boss.surge, 3000);
// keys: the segment at 120 ms (100 WPM), scheduled on performance.now()
await P.g((seg) => {
  const g = window.game;
  const t0 = performance.now();
  let i = 0;
  const next = () => {
    while (i < seg.length && performance.now() >= t0 + 40 + i * 120) { try { if (g.mode === "playing" && g.boss) g.handleTyped(seg[i]); } catch (e) { console.error(e); } i++; }
    if (i < seg.length) setTimeout(next, Math.max(0, t0 + 40 + i * 120 - performance.now()));
  };
  next();
}, SEG);
const onOk = await waitFor(P, () => window.game.overdriveOn === true, 6000);
await P.g(() => { window.__e2Probe.mark(); window.__ff.max = 0; window.__ff.on = true; });
const m0 = await P.metrics();
const fps = await P.fps(4000);
const m1 = await P.metrics();
const snap = await P.g(() => { window.__ff.on = false; const g = window.game; return { ...window.__e2Probe.snapshot(), ffMax: Math.round(window.__ff.max * 1000) / 1000, on: g.overdriveOn === true, surge: !!(g.boss && g.boss.surge), minions: g.enemies.filter((e) => e.alive && e.kind === "bossMinion").length, glow: g._csGlowDraws | 0, arc: g._od.arcDraws }; });
const lay = P.per5s(m0, m1);
await P.shot("budget-s10");
P.check("scene: sector 10 boss, 4 minions, a surge charging, Overdrive active (T 25), CRT on", inBoss && scene.level === 10 && scene.minions.length === 4 && onOk && snap.on && snap.surge && snap.minions === 4 && scene.crt && snap.glow > 0 && snap.arc > 0, { scene, onOk, on: snap.on, surge: snap.surge, minions: snap.minions });
P.check("4 s window at DPR 2: fps >= 58, maxRenderMs <= 16, compositeSetsPerFrame <= 6, shadowBlurPerFrame 0, translucent full-frame fills <= .12, layoutCountPer5s <= 40",
  fps >= 58 && snap.maxRenderMs <= 16 && snap.compositeSetsPerFrame <= 6 && snap.shadowBlurPerFrame === 0 && snap.ffMax <= 0.12 && lay.layoutPer5s <= 40,
  { fps, maxRenderMs: snap.maxRenderMs, avgRenderMs: snap.avgRenderMs, compositeSetsPerFrame: snap.compositeSetsPerFrame, shadowBlurPerFrame: snap.shadowBlurPerFrame, ffMax: snap.ffMax, layoutPer5s: lay.layoutPer5s, recalcPer5s: lay.recalcPer5s, frames: snap.frames });

// Heap: 10 s more of the same scene, forced GC before and after
const cdp = await P.cdp();
const heap = async () => { try { await cdp.send("HeapProfiler.collectGarbage"); } catch {} const { metrics } = await cdp.send("Performance.getMetrics"); return metrics.find((m) => m.name === "JSHeapUsedSize").value; };
const h0 = await heap();
await sleep(10000);
const h1 = await heap();
const end = await P.g(() => ({ on: window.game.overdriveOn === true, surge: !!(window.game.boss && window.game.boss.surge), progress: window.game.boss && window.game.boss.progress }));
P.check("JS heap growth < 2 MB over 10 s of the scene (Overdrive and the surge still running)", h1 - h0 < 2 * 1024 * 1024 && end.on && end.surge, { heapDeltaKB: Math.round((h1 - h0) / 1024), ...end });

P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
await P.finish();
