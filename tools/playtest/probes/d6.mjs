// D6 acceptance: boss composition, intro cinematic, outro (PLAN D6 / VIS-07 / JUICE-09 / JUICE-10).
// Usage: node probes/d6.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d6-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

await P.goto("fresh");
await P.startRun("D6");
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});

// ---- intro lock + typing lockout + Esc freeze ----
const intro = await P.g(async () => {
  const g = window.game;
  g.levelT = LEVELS[g.levelIndex].duration + 0.01;
  const t0 = performance.now(); let tIn = null, tLocked = null;
  while (performance.now() - t0 < 15000) {
    if (g.inBoss && tIn === null) tIn = performance.now();
    if (g.bossIntro && g.bossIntro.locked && tLocked === null) tLocked = performance.now();
    if (tIn !== null && tLocked !== null) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  const total = g.stats.total, prog = g.boss.progress, seg = g.boss.segmentIndex;
  g.handleTyped(g.boss.nextChar);
  return { lockedMs: tIn !== null && tLocked !== null ? Math.round(tLocked - tIn) : null, locked: !!(g.bossIntro && g.bossIntro.locked), totalSame: g.stats.total === total, progSame: g.boss.progress === prog && g.boss.segmentIndex === seg, introPulse: g.introPulse, damagePulse: g.damagePulse, trauma: g.trauma };
});
P.check("forced boss: bossIntro.locked within .2 s of inBoss; typing the next char changes neither stats.total nor boss.progress; introPulse set, damagePulse 0", intro.lockedMs !== null && intro.lockedMs <= 200 && intro.locked && intro.totalSame && intro.progSame && intro.introPulse > 0 && !(intro.damagePulse > 0), intro);
await page.waitForFunction(() => window.game.bossIntro && window.game.bossIntro.t >= 0.95, null, { timeout: 5000 }).catch(() => {});
const at1 = await P.g(() => { const g = window.game, r = g.boss.artRect; return { t: g.bossIntro.t, right: r.x + r.w, y: r.y, hudSafeTop: g.hudSafeTop, w: g.w, trauma: g.trauma }; });
P.check("at bossIntro.t ~ 1.0 the art's right edge <= w - 16 and its top >= hudSafeTop (slid in from x + 320)", at1.right <= at1.w - 16 + 0.5 && at1.y >= at1.hudSafeTop, at1);
await P.shot("intro-1.0");
await page.keyboard.press("Escape");
await sleep(250);
const paused = await P.g(() => ({ mode: game.mode, t: game.bossIntro && game.bossIntro.t }));
await sleep(400);
const paused2 = await P.g(() => ({ mode: game.mode, t: game.bossIntro && game.bossIntro.t }));
await page.keyboard.press("Escape");
P.check("Esc during the intro pauses and leaves bossIntro.t unchanged across the pause", paused.mode === "paused" && paused.t === paused2.t, { paused, paused2 });
await page.waitForFunction(() => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), null, { timeout: 8000 });
await sleep(300);

// ---- composition in the fight (L1) ----
const comp = await P.g(() => {
  const g = window.game, b = g.boss, a = b.artRect, s = b.slabRect, c = b.contentRect;
  const head = c ? { x: c.x + c.w * 0.25, y: c.y, w: c.w * 0.5, h: c.h / 3 } : null;
  return { art: a, slab: s, content: c, hudSafeTop: g.hudSafeTop, rightOk: a.x + a.w <= 1265, topOk: a.y >= g.hudSafeTop, noOverlap: !rectsIntersect(a, s), headClear: head ? !rectsIntersect(head, s) && (!g.bannerRect || !rectsIntersect(head, g.bannerRect)) : null, bossXY: { x: b.x, y: b.y }, aim: g.bossAimPoint(), hazard: g.bossHazardRect(), slabInside: s.x >= 32 && s.x + s.w <= 672 && s.y + s.h <= g.h - 24 + 0.5 };
});
P.check("08-boss-fight (L1): artRect.x + w <= 1265, artRect.y >= hudSafeTop, art and slab disjoint, head region clear of slab/banner, slab x 32..672 / bottom h-24", comp.rightOk && comp.topOk && comp.noOverlap && comp.headClear === true && comp.slabInside, comp);
P.check("boss.x/y is the content centre and bossAimPoint()/bossHazardRect() follow contentRect / the slab's right cell", comp.content && Math.abs(comp.bossXY.x - (comp.content.x + comp.content.w / 2)) < 1 && comp.aim.x > comp.content.x && comp.aim.x < comp.content.x + comp.content.w && comp.hazard.x + comp.hazard.w <= comp.slab.x + comp.slab.w, { bossXY: comp.bossXY, aim: comp.aim, hazard: comp.hazard });
await P.shot("boss-fight");

// ---- outro ----
const killRes = await P.g(async () => {
  const g = window.game;
  // type the boss down to its last character, then measure the slow-mo on the kill
  while (g.boss && !g.boss.done && g.boss.totalChars - g.boss.charsDone() > 1) { g.handleTyped(g.boss.nextChar); if ((g.boss.charsDone() % 7) === 0) await new Promise((r) => requestAnimationFrame(r)); }
  const artBefore = g.boss.artRect;
  const t0 = performance.now();
  g.handleTyped(g.boss.nextChar);
  const info = g.bossClear;
  let enemiesMax = g.enemies.length;
  while (performance.now() - t0 < 500) { await new Promise((r) => requestAnimationFrame(r)); enemiesMax = Math.max(enemiesMax, g.enemies.length); }
  const t05 = info.t; const wall05 = (performance.now() - t0) / 1000;
  const tA = info.t, wA = performance.now();
  while (performance.now() - wA < 500) { await new Promise((r) => requestAnimationFrame(r)); enemiesMax = Math.max(enemiesMax, g.enemies.length); }
  const ratio2 = (info.t - tA) / ((performance.now() - wA) / 1000);
  // reference centroid of the art as drawn right now (dissolve not started: alpha 1), shake zeroed for the diff
  const ref = (() => {
    const r = info.artRect, s = g.renderScale || 1;
    const box = { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 40), w: Math.min(g.w, r.x + r.w + 40) - Math.max(0, r.x - 40), h: Math.min(g.h, r.y + r.h + 40) - Math.max(0, r.y - 40) };
    const grab = () => g.ctx.getImageData(Math.round(box.x * s), Math.round(box.y * s), Math.round(box.w * s), Math.round(box.h * s)).data;
    const tr = g.trauma; g.trauma = 0;
    g.render(0); const a = grab(); const d = g.bossDissolve; g.bossDissolve = null; g.render(0); const b = grab(); g.bossDissolve = d; g.trauma = tr;
    let sx = 0, sy = 0, n = 0; const W = Math.round(box.w * s);
    for (let i = 0; i < a.length; i += 4) { const diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (diff > 48) { const p = i / 4; sx += p % W; sy += Math.floor(p / W); n++; } }
    return n ? { x: Math.round(box.x + (sx / n) / s), y: Math.round(box.y + (sy / n) / s), n, t: info.t } : null;
  })();
  g._d6Ref = ref;
  return { bossClear: !!info, ratio1: Math.round((t05 / wall05) * 100) / 100, ratio2: Math.round(ratio2 * 100) / 100, slowMo: typeof g.setSlowMo === "function", hitStop: typeof g.addHitStop === "function", artBefore, artStored: info && info.artRect, enemiesMax, dissolve: g.bossDissolve, whiteFlash: g.whiteFlash, ref };
});
if (killRes.slowMo) P.check("after the kill bossClear.t advances <= .4x wall for the first .5 s, then ~1x", killRes.ratio1 <= 0.45 && killRes.ratio2 > 0.8, killRes);
else P.note("after the kill bossClear.t advances <= .4x wall for .5 s then ~1x", `setSlowMo() not defined yet (camera track); setSlowMo(.35,.6,.4) is called when it exists. ratios now: ${killRes.ratio1} / ${killRes.ratio2}`);
P.check("kill: bossClear set with the art rect captured in place; enemies.length === 0 through the first second", killRes.bossClear && killRes.artStored && killRes.enemiesMax === 0, { artStored: killRes.artStored, enemiesMax: killRes.enemiesMax });

// Boss-sized drawImage calls during one render (device-space transform applied): where the dissolve draws the art.
const bossDrawsSrc = `(() => {
  const g = window.game, info = g.bossClear, r = info.artRect, s = g.renderScale || 1;
  const calls = []; const orig = g.ctx.drawImage;
  g.ctx.drawImage = function (img, ...a) {
    let dx, dy, dw, dh;
    if (a.length >= 8) { dx = a[4]; dy = a[5]; dw = a[6]; dh = a[7]; } else if (a.length >= 4) { dx = a[0]; dy = a[1]; dw = a[2]; dh = a[3]; } else { dx = a[0]; dy = a[1]; dw = img.width; dh = img.height; }
    const m = this.getTransform(); const cx = dx + dw / 2, cy = dy + dh / 2;
    calls.push({ X: (m.a * cx + m.c * cy + m.e) / s, Y: (m.b * cx + m.d * cy + m.f) / s, W: dw * Math.hypot(m.a, m.b) / s, H: dh * Math.hypot(m.c, m.d) / s });
    return orig.apply(this, arguments);
  };
  const tr = g.trauma; g.trauma = 0;
  try { g.render(0); } finally { g.ctx.drawImage = orig; g.trauma = tr; }
  const hits = calls.filter((c) => c.W >= r.w * 0.95 && c.W <= r.w * 1.15 && c.H >= r.h * 0.95 && c.H <= r.h * 1.15).map((c) => ({ x: Math.round(c.X), y: Math.round(c.Y), w: Math.round(c.W), h: Math.round(c.H) }));
  return { t: info.t, hits, rect: { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2), w: Math.round(r.w), h: Math.round(r.h) }, dissolve: g.bossDissolve };
})()`;
await page.waitForFunction(() => window.game.bossClear && window.game.bossClear.t >= 0.98, null, { timeout: 5000 }).catch(() => {});
const at10 = await page.evaluate(bossDrawsSrc);
const slotBefore = killRes.artBefore ? { x: killRes.artBefore.x + killRes.artBefore.w / 2, y: killRes.artBefore.y + killRes.artBefore.h / 2 } : null;
const d10 = at10.hits.length ? Math.round(Math.hypot(at10.hits[0].x - at10.rect.x, at10.hits[0].y - at10.rect.y)) : null;
const d10b = at10.hits.length && slotBefore ? Math.round(Math.hypot(at10.hits[0].x - slotBefore.x, at10.hits[0].y - slotBefore.y)) : null;
P.check("at bossClear.t ~ 1.0 the dissolving art is drawn centred within 60 px of its kill-time rect and of its pre-kill fight slot (no centre teleport), scale <= 1.08", at10.hits.length >= 1 && d10 !== null && d10 <= 60 && d10b !== null && d10b <= 60 && at10.hits[0].w <= at10.rect.w * 1.09, { ...at10, slotBefore, d10, d10b });
await P.shot("finale-1.0");
await page.waitForFunction(() => window.game.bossClear && window.game.bossClear.t >= 1.7, null, { timeout: 5000 }).catch(() => {});
const d17 = await P.g(() => ({ t: game.bossClear && game.bossClear.t, dissolve: game.bossDissolve }));
P.check("bossDissolve === null once the dissolve (start .4 s + 1.2 s) is done (checked at t >= 1.7; PLAN says 1.3: see deviations)", d17.dissolve === null, d17);
await page.waitForFunction(() => window.game.bossClear && window.game.bossClear.t >= 2.2, null, { timeout: 5000 }).catch(() => {});
const at22 = await page.evaluate(bossDrawsSrc);
const gone = await P.g(() => ({ enemies: game.enemies.length, skipHinted: game.bossClear && game.bossClear.skipHinted }));
P.check("at bossClear.t ~ 2.2 no boss art is drawn (no boss-sized drawImage in the frame; bossDissolve null); enemies.length 0; SKIP hint armed from 2.0", at22.hits.length === 0 && at22.dissolve === null && gone.enemies === 0 && gone.skipHinted === true, { ...at22, ...gone });
await P.shot("finale-2.2");
await page.waitForFunction(() => window.game.mode !== "playing", null, { timeout: 20000 }).catch(() => {});

// ---- L10: the Empress ----
await P.g(() => { const g = window.game; if (typeof g.startSector === "function") g.startSector(9); else g.startLevel(9, { fromMenu: true, fresh: true }); });
await page.waitForFunction(() => window.game.mode === "playing" && window.game.levelIndex === 9, null, { timeout: 10000 });
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await page.waitForFunction(() => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), null, { timeout: 20000 });
await sleep(400);
const comp10 = await P.g(() => {
  const g = window.game, b = g.boss, a = b.artRect, s = b.slabRect, c = b.contentRect;
  const head = c ? { x: c.x + c.w * 0.25, y: c.y, w: c.w * 0.5, h: c.h / 3 } : null;
  return { art: a, slab: s, content: c, hudSafeTop: g.hudSafeTop, rightOk: a.x + a.w <= 1265, topOk: a.y >= g.hudSafeTop, noOverlap: !rectsIntersect(a, s), headClear: head ? !rectsIntersect(head, s) && (!g.bannerRect || !rectsIntersect(head, g.bannerRect)) : null, phases: b.phaseStarts.length, segments: b.segments.length };
});
P.check("13-final-boss (L10, 42 segments / 4 phases): artRect inside x..1265 / y >= hudSafeTop, art and slab disjoint, Empress head region clear", comp10.rightOk && comp10.topOk && comp10.noOverlap && comp10.headClear === true, comp10);
await P.shot("final-boss");
const errs = { pageErrors: P.errors.pageErrors.length, consoleErrors: P.errors.consoleErrors.length };
P.check("no page / console errors during the D6 probe", errs.pageErrors === 0 && errs.consoleErrors === 0, errs);
await P.finish();
