// Regression checks for the review-fix runtime track (review R1 R12 R13 R27 R30 R31), ~25 s at DPR 1.
// Run from tools/playtest:  node probes/review-runtime.mjs
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("review-runtime", { dpr: 1 });
const page = P.page;
const g = (fn, arg) => P.g(fn, arg);

await P.installCanvasCounters();   // R30: per-frame shadowBlur counters (must precede goto)
// R27: when .is-dismissed / .hidden land on the loading overlay and which transitionend fired in between.
await P.context.addInitScript(() => {
  const F = window.__fade = { dismissedAt: null, hiddenAt: null, events: [] };
  document.addEventListener("DOMContentLoaded", () => {
    const ov = document.getElementById("loadingOverlay");
    if (!ov) return;
    new MutationObserver(() => {
      const t = performance.now();
      if (ov.classList.contains("is-dismissed") && F.dismissedAt === null) F.dismissedAt = t;
      if (ov.classList.contains("hidden") && F.hiddenAt === null) F.hiddenAt = t;
    }).observe(ov, { attributes: true, attributeFilter: ["class"] });
    ov.addEventListener("transitionend", (e) => F.events.push({ t: Math.round(performance.now()), target: e.target.id || e.target.className, prop: e.propertyName, hiddenAlready: ov.classList.contains("hidden") }));
  });
});
// R1: record drawImage calls whose source is the live fx sheet (9-arg form).
await P.context.addInitScript(() => {
  window.__di = [];
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.drawImage;
  proto.drawImage = function (img) {
    try {
      const A = window.TypeRAssets;
      const sheet = A && A.get ? A.get("fx/explosions") : null;
      if (sheet && img === sheet && arguments.length === 9) window.__di.push({ sheetW: img.width, sx: arguments[1], sy: arguments[2], sw: arguments[3], sh: arguments[4] });
    } catch (_) {}
    return orig.apply(this, arguments);
  };
});
await P.goto(null);
await sleep(700);

// ---- R27: the overlay's own 450 ms opacity fade ends the dismissal, not the bubbled .loadingBarFill width transition.
const fade = await g(() => ({ ...window.__fade, gap: Math.round(window.__fade.hiddenAt - window.__fade.dismissedAt) }));
const cutByChild = fade.events.some((e) => !e.hiddenAlready && e.target === "loadingBarFill");
P.check("R27 loading overlay: .hidden lands >= 440 ms after .is-dismissed", fade.gap >= 440, { gap: fade.gap, events: fade.events });
P.check("R27 the child .loadingBarFill width transitionend fired before .hidden but no longer ends the fade", !cutByChild || fade.gap >= 440, { cutByChild, gap: fade.gap });

// ---- R12: the PALETTE.rgba memo key is the clamped, 1/100-quantised alpha.
const memo = await g(() => {
  const PAL = window.TypeRDebug.PALETTE;
  return { a: PAL.rgba("magenta", 0.4512345), b: PAL.rgba("magenta", 0.4487), hi: PAL.rgba("text", 2), lo: PAL.rgba("text", -1) };
});
P.check("R12 PALETTE.rgba quantises alpha to 1/100 and clamps to [0,1]", memo.a === memo.b && memo.a.endsWith(",0.45)") && memo.hi.endsWith(",1)") && memo.lo.endsWith(",0)"), memo);

// ---- R1: the source rect follows the resident drawable (drawable px / original px), through a DPR 1 -> 2 flip and back.
const drawOnce = () => g(() => {
  window.__di.length = 0;
  const ex = new ExplosionSprite({ x: 200, y: 200, type: "large" });
  const c = document.createElement("canvas"); c.width = 400; c.height = 400;
  ex.drawFrame(c.getContext("2d"));
  const frame = EXPLOSION_FRAMES[ex.frames[0]];
  const sheet = TypeRAssets.get("fx/explosions");
  const meta = TypeRAssets.meta("fx/explosions");
  const k = sheet && meta ? sheet.width / ((meta.orig && meta.orig.w) || meta.w) : null;
  const call = window.__di[0] || null;
  return { sheetW: sheet && sheet.width, k, field: ExplosionSprite.sheetScale, loader: TypeRAssets.sheetScale("fx/explosions"), frame, call,
    ok: !!call && k !== null && Math.abs(call.sx - frame.x * k) < 0.01 && Math.abs(call.sy - frame.y * k) < 0.01 && Math.abs(call.sw - frame.w * k) < 0.01 && Math.abs(call.sh - frame.h * k) < 0.01 };
});
const d1 = await drawOnce();
P.check("R1 at boot (DPR 1): drawFrame source rect == frame * (sheet px / original px); sheetScale tracks the loader", d1.ok && d1.field === d1.loader, d1);
const cdp = await P.cdp();
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await g(() => game.resizeCanvas());
const flipped = await page.waitForFunction(() => TypeRAssets.sheetScale("fx/explosions") === 1, null, { timeout: 10000 }).then(() => true).catch(() => false);
await sleep(200);
const d2 = await drawOnce();
P.check("R1 after a DPR 1 -> 2 flip: the re-prepared full sheet draws with the new factor; sheetScale tracks the loader", flipped && d2.ok && d2.k === 1 && d2.field === d2.loader, d2);
await cdp.send("Emulation.clearDeviceMetricsOverride");
await sleep(300);
await g(() => game.resizeCanvas());
await page.waitForFunction(() => TypeRAssets.sheetScale("fx/explosions") === 0.5, null, { timeout: 10000 }).catch(() => {});
await sleep(200);
const d3 = await drawOnce();
P.check("R1 after flipping back to DPR 1: the half sheet draws with factor 0.5 again", d3.ok && d3.k === 0.5 && d3.field === d3.loader, d3);

// ---- R31 (pure): the telemetry helpers trim at the push site and debugStats() only reads.
const logs = await g(() => {
  const gm = window.game;
  const t0 = nowMs();
  gm._spawnLog.length = 0; gm._leakLog.length = 0;
  for (let i = 0; i < 300; i++) gm._spawnLog.push({ t: t0 - 20000 - i, n: 3 });
  gm._noteSpawn(5);
  const afterSpawn = gm._spawnLog.length;
  for (let i = 0; i < 300; i++) gm._leakLog.push(t0 - 90000 - i);
  gm._noteLeak();
  const afterLeak = gm._leakLog.length;
  gm._spawnLog.push({ t: t0 - 30000, n: 9 });   // a stale entry a pure reader must ignore, not shift
  const before = { s: gm._spawnLog.length, l: gm._leakLog.length };
  const stats = window.TypeRDebug.stats();
  const after = { s: gm._spawnLog.length, l: gm._leakLog.length };
  gm._spawnLog.length = 0; gm._leakLog.length = 0;
  return { afterSpawn, afterLeak, before, after, stats };
});
P.check("R31 _noteSpawn / _noteLeak drop entries outside their windows; debugStats() ignores stale entries without mutating",
  logs.afterSpawn === 1 && logs.afterLeak === 1 && logs.before.s === logs.after.s && logs.before.l === logs.after.l && logs.stats.incomingCps === 0.5 && logs.stats.leaksPerMin === 1, logs);

// ---- into a run
await P.startRun("REVIEW");
await page.waitForFunction(() => { const gm = window.game; return gm.mode === "playing" && !gm.levelIntro && gm.enemies.length >= 2; }, null, { timeout: 20000 });
await sleep(1200);   // let the sector's idle warm settle

// ---- R30: a mid-sector resize re-warms the plate cache in idle slices; typing afterwards bakes nothing per frame.
const cacheBefore = await g(() => window.game.plateCache.size);
await page.setViewportSize({ width: 1100, height: 700 });
await sleep(900);   // 120 ms debounce + the idle slices
const cacheAfter = await g(() => ({ size: window.game.plateCache.size, scale: window.game.renderScale }));
await g(() => window.__e2Probe.mark());
await P.autoType(3, { accuracy: 0.97 });
const steady = await g(() => window.__e2Probe.snapshot());
P.check("R30 after a mid-sector resize the plate cache is re-warmed and 3 s of typing sets shadowBlur in no frame", cacheAfter.size >= Math.min(30, cacheBefore) && steady.shadowBlurSetsPerFrame === 0, { cacheBefore, cacheAfter, steady });

// ---- R13: kill / slam plates draw under source-over (before the L12 additive batch opens).
await g(() => {
  const gm = window.game;
  window.__gco = {};
  const orig = gm.drawDyingPlates;
  gm.drawDyingPlates = function (ctx) { if (this.dyingPlates && this.dyingPlates.length) { const k = ctx.globalCompositeOperation; window.__gco[k] = (window.__gco[k] || 0) + 1; } return orig.call(this, ctx); };
  gm.enemies.length = 0; gm.lock = null;
  gm.enemies.push(new Enemy({ text: "sparkle", x: 640, y: 320, speed: 0, lane: 2 }));
  gm.spawnAcc = -1e9; gm.hungryT = -1e9;
});
await sleep(250);
for (const ch of "sparkle") { await page.keyboard.press(ch); await sleep(25); }
await sleep(400);
const gco = await g(() => window.__gco);
P.check("R13 dying plates (impact + fade frames) are drawn under source-over, never inside the additive batch", (gco["source-over"] || 0) > 0 && !gco.lighter, gco);

// ---- R31: a new run starts with empty telemetry logs.
const reset = await g(() => { const gm = window.game; gm._spawnLog.push({ t: nowMs(), n: 1 }); gm._leakLog.push(nowMs()); gm.startSector(0); return { s: gm._spawnLog.length, l: gm._leakLog.length, mode: gm.mode }; });
P.check("R31 beginRunAt empties _spawnLog / _leakLog", reset.s === 0 && reset.l === 0, reset);

await P.finish();
