// D5 acceptance: banner system + floaters (PLAN D5 / VIS-14 / JUICE-08).
// Usage: node probes/d5.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d5-dpr" + argDpr, { dpr: argDpr });
const page = P.page;
const AMBER = [0xFF, 0xC1, 0x4A], DANGER = [0xFF, 0x4D, 0x6D];
// Samples read a frame rendered without the camera's L17 vignette and without the random shake offset, so the
// plate / banner layers are measured on their own (the vignette darkens edges by up to 35 %).
async function nearestIn(x, y, rx, ry, target) {
  return P.g(({ x, y, rx, ry, target }) => {
    const g = window.game; const s = g.renderScale || 1;
    const dv = g.drawVignette, tr = g.trauma; g.drawVignette = function () {}; g.trauma = 0;
    try { g.render(0); } finally { g.drawVignette = dv; g.trauma = tr; }
    const x0 = Math.max(0, Math.round((x - rx) * s)), y0 = Math.max(0, Math.round((y - ry) * s));
    const img = g.ctx.getImageData(x0, y0, Math.max(1, Math.round(2 * rx * s)), Math.max(1, Math.round(2 * ry * s))).data;
    let best = null, bd = Infinity;
    for (let i = 0; i < img.length; i += 4) {
      const px = [img[i], img[i + 1], img[i + 2]];
      const d = Math.sqrt((px[0] - target[0]) ** 2 + (px[1] - target[1]) ** 2 + (px[2] - target[2]) ** 2);
      if (d < bd) { bd = d; best = px; }
    }
    return { px: best, d: Math.round(bd * 10) / 10 };
  }, { x, y, rx, ry, target });
}
async function meanLuma(x, y, w, h) {
  return P.g(({ x, y, w, h }) => {
    const g = window.game; const s = g.renderScale || 1;
    const img = g.ctx.getImageData(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s)).data;
    let sum = 0, n = 0;
    for (let i = 0; i < img.length; i += 16) { sum += 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]; n++; }
    return Math.round(sum / n);
  }, { x, y, w, h });
}

await P.goto("fresh");
await page.fill("#playerName", "D5").catch(() => {});
await page.click("#btnStart");
try { const st = page.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.click(); } catch {}
await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });

// ---- sector banner lifecycle ----
const sector0 = await P.g(() => { const b = game.banner; return b && { kind: b.kind, title: b.title, eyebrow: b.eyebrow, sub: b.sub, dur: b.dur, t: b.t, anchor: b.anchor }; });
P.check("level start: banner.kind 'sector', title 'SECTOR 01', eyebrow ENTERING, sub BOSS: SIGNAL WRAITH, dur 1.6", !!sector0 && sector0.kind === "sector" && sector0.title === "SECTOR 01" && sector0.eyebrow === "ENTERING" && /^BOSS: /.test(sector0.sub) && Math.abs(sector0.dur - 1.6) < 0.01, sector0);
const life = await P.g(async () => {
  const g = window.game; let lastT = 0, lateGate = false; const t0 = performance.now();
  while (g.banner && g.banner.kind === "sector" && performance.now() - t0 < 4000) {
    lastT = g.banner.t; if (!g.isLevelGateOpen()) lateGate = true;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { lastT: Math.round(lastT * 1000) / 1000, lateGate, gone: !(g.banner && g.banner.kind === "sector"), wallMs: Math.round(performance.now() - t0), levelIntro: !!g.levelIntro };
});
P.check("sector banner null by t >= 1.7 s (<= 2.6 s when levelReady was late)", life.gone && (life.lastT <= 1.72 || (life.lateGate && life.lastT <= 2.6)), life);
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 5000 }).catch(() => {});
await sleep(300);

// ---- callout on the x2 tier + floater placement ----
const combo = await P.g(async () => {
  const g = window.game;
  for (const e of g.enemies) e.alive = false;
  const en = g.spawnEnemy(); en.x = 900; en.speed = 0; en.age = 1; en.text = "zzzzzz"; en.progress = 0;
  g.stats.combo = 9; g._baseTier = 1; g.stats.mult = 1; g.power.multiplier = 0;
  g.callout = null; if (g.calloutQueue) g.calloutQueue.length = 0;
  await new Promise((r) => requestAnimationFrame(r));
  g.handleTyped("z");
  const c = g.callout;
  const immediate = c && { title: c.title, kind: c.kind, color: c.color };
  await new Promise((r) => requestAnimationFrame(r));
  // floater aimed at the locked plate centre must land outside its rect
  const f = g.addFloater(en.x, en.y, "+TEST", "cyan", 20);
  const rect = { x: en.x - en.plateW / 2 - 8, y: en.y - en.plateH / 2 - 8, w: en.plateW + 16, h: en.plateH + 16 };
  const inside = f.x > rect.x && f.x < rect.x + rect.w && f.y > rect.y && f.y < rect.y + rect.h;
  return { combo: g.stats.combo, mult: g.stats.mult, immediate, locked: !!(g.lock && g.lock.ref === en), floaterY: f.y, plateTop: rect.y, inside };
});
P.check("combo 10 -> callout 'x2 MULTIPLIER' within the same tick", combo.immediate && combo.immediate.title === "x2 MULTIPLIER" && combo.mult === 2, combo);
P.check("a floater spawned at the locked plate is pushed outside the plate rect (y offset >= h/2 + 8)", combo.locked && !combo.inside, combo);
await P.shot("callout");

// ---- boss intro banner ----
const introT = await P.g(async () => {
  const g = window.game;
  g.levelT = LEVELS[g.levelIndex].duration + 0.01;
  const t0 = performance.now(); let tIn = null, tBanner = null;
  while (performance.now() - t0 < 15000) {
    if (g.inBoss && tIn === null) tIn = performance.now();
    if (g.banner && g.banner.kind === "bossIntro" && tBanner === null) tBanner = performance.now();
    if (tIn !== null && tBanner !== null) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  const b = g.banner;
  return { ms: tIn !== null && tBanner !== null ? Math.round(tBanner - tIn) : null, kind: b && b.kind, anchor: b && b.anchor, rect: b && b.rect, art: g.boss && g.boss.artRect, intersects: b && g.boss ? rectsIntersect(b.rect, g.boss.artRect) : null, title: b && b.title, eyebrow: b && b.eyebrow };
});
P.check("forced boss: banner.kind 'bossIntro', anchor 'left', rect.x + rect.w <= 640 within 100 ms of inBoss; no intersection with boss.artRect", introT.kind === "bossIntro" && introT.anchor === "left" && introT.rect && introT.rect.x + introT.rect.w <= 640 && introT.ms !== null && introT.ms <= 100 && introT.intersects === false, introT);
await page.waitForFunction(() => window.game.bossIntro && window.game.bossIntro.t >= 1.15, null, { timeout: 5000 }).catch(() => {});
const bar = await meanLuma(0, 720 - 50, 1280, 40);
const warn1 = await nearestIn(160, 245 + 40, 110, 12, DANGER);
await sleep(130);
const warn2 = await nearestIn(160, 245 + 40, 110, 12, DANGER);
await sleep(70);
const warn3 = await nearestIn(160, 245 + 40, 110, 12, DANGER);
const warnBest = Math.min(warn1.d, warn2.d, warn3.d);   // the eyebrow blinks at 4 Hz (.35 / 1.0)
await P.shot("boss-intro-1.2");
P.check("07-style frame at intro t~1.2: bottom letterbox rows mean luminance < 24 and a WARNING eyebrow pixel within 40 of --danger", bar < 24 && warnBest <= 40, { bar, warn1, warn2 });
const artPix = await P.g(() => {
  const g = window.game, b = g.banner, r = g.boss && g.boss.artRect, br = g.bannerRect;
  return { bannerRect: br, art: r, clear: br && r ? !rectsIntersect(br, r) : null, titleFont: b && b.title };
});
P.check("banner band (game.bannerRect) stays clear of boss.artRect during the intro", artPix.clear === true, artPix);
await page.waitForFunction(() => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), null, { timeout: 6000 });

// ---- boss clear banner ----
await P.autoType(90, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
await page.waitForFunction(() => window.game.bossClear && window.game.bossClear.t >= 2.1, null, { timeout: 8000 }).catch(() => {});
const clear = await P.g(() => { const b = game.banner; return b && { kind: b.kind, title: b.title, sub: b.sub, countTo: b.count && b.count.to, rect: b.rect, t: b.t, finaleT: game.bossClear && game.bossClear.t }; });
const titleY = clear && clear.rect ? clear.rect.y + clear.rect.h * 0.5 + 4 : 360;
const amber = await nearestIn(640, titleY, 280, 22, AMBER);
await P.shot("boss-clear-2.1");
P.check("09-style frame: banner.kind 'bossClear', title 'BOSS DEFEATED', sub '+N BONUS', title pixel within 16 of --neon-amber", !!clear && clear.kind === "bossClear" && clear.title === "BOSS DEFEATED" && /^\+[\d,]+ BONUS$/.test(clear.sub) && amber.d <= 16, { clear, amber });
const errs = { pageErrors: P.errors.pageErrors.length, consoleErrors: P.errors.consoleErrors.length };
P.check("no page / console errors during the D5 probe", errs.pageErrors === 0 && errs.consoleErrors === 0, errs);

// ---- reduced motion: eyebrow alpha constant, titleScale 1 at t = .2 ----
const ctx2 = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr, reducedMotion: "reduce" });
const pg = await ctx2.newPage();
const rmErrors = [];
pg.on("pageerror", (e) => rmErrors.push(String(e)));
await ctx2.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
await pg.goto(P.base, { waitUntil: "load" });
await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 120000 });
await pg.evaluate(() => { const g = window.game; if (g.save && g.save.settings) g.save.settings.reduceMotion = true; if (typeof g.resolveMotion === "function") g.resolveMotion(); else if (typeof g.ensureMotionFlag === "function") g.ensureMotionFlag(); if (!g.reduceMotion) { g.reduceMotion = true; document.documentElement.classList.add("reduce-motion"); } g._rmForcedByProbe = typeof g.resolveMotion !== "function"; });
await pg.fill("#playerName", "RM").catch(() => {});
await pg.click("#btnStart");
try { const st = pg.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.click(); } catch {}
await pg.waitForFunction(() => window.game && window.game.mode === "playing" && window.game.banner, null, { timeout: 30000 });
const rm = await pg.evaluate(async () => {
  const g = window.game;
  if (g.save && g.save.settings) g.save.settings.reduceMotion = true;
  if (!g.reduceMotion) { g.reduceMotion = true; document.documentElement.classList.add("reduce-motion"); }
  const out = { forcedByProbe: !!g._rmForcedByProbe };
  while (g.banner && g.banner.t < 0.19) await new Promise((r) => requestAnimationFrame(r));
  out.titleScaleAt02 = g.banner ? g.banner.titleScale : null; out.tAt = g.banner ? g.banner.t : null;
  while (g.banner && g.banner.t < 0.4) await new Promise((r) => requestAnimationFrame(r));
  const a1 = g.banner ? g.banner.eyebrowAlpha : null;
  await new Promise((r) => setTimeout(r, 125));
  const a2 = g.banner ? g.banner.eyebrowAlpha : null;
  out.eyebrowAlpha = [a1, a2];
  // boss intro under reduce-motion: the WARNING eyebrow does not blink
  await new Promise((r) => setTimeout(r, 1800));
  while (g.levelIntro) await new Promise((r) => requestAnimationFrame(r));
  g.levelT = LEVELS[g.levelIndex].duration + 0.01;
  const t0 = performance.now();
  while (!(g.banner && g.banner.kind === "bossIntro" && g.banner.t > 0.6) && performance.now() - t0 < 15000) await new Promise((r) => requestAnimationFrame(r));
  const b1 = g.banner ? g.banner.eyebrowAlpha : null; const s1 = g.banner ? g.banner.titleScale : null;
  await new Promise((r) => setTimeout(r, 125));
  const b2 = g.banner ? g.banner.eyebrowAlpha : null;
  out.bossEyebrowAlpha = [b1, b2]; out.bossTitleScale = s1;
  return out;
});
P.check("reduce-motion: sector banner titleScale === 1 at t = .2 and eyebrow alpha constant across two frames 125 ms apart", rm.titleScaleAt02 === 1 && rm.eyebrowAlpha[0] !== null && rm.eyebrowAlpha[0] === rm.eyebrowAlpha[1], rm);
P.check("reduce-motion: boss-intro WARNING eyebrow does not blink (alpha constant), titleScale 1", rm.bossEyebrowAlpha[0] !== null && rm.bossEyebrowAlpha[0] === rm.bossEyebrowAlpha[1] && rm.bossTitleScale === 1, rm);
P.check("reduce-motion context: no page errors", rmErrors.length === 0, rmErrors);
await ctx2.close();
await P.finish();
