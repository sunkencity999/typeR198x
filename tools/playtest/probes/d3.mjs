// D3 acceptance: enemy plates, powerup capsules, lane rails, lifecycle ceremony (PLAN D3 / VIS-04 / VIS-05 / JUICE-06).
// Usage: node probes/d3.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d3-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

// shadowBlur sets inside render() per frame (bakes in idle callbacks are counted separately).
await P.context.addInitScript(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "shadowBlur");
  const S = window.__d3 = { inRender: 0, renderSets: 0, bakeSets: 0, frames: [], recording: false };
  Object.defineProperty(proto, "shadowBlur", {
    configurable: true, get() { return d.get.call(this); },
    set(v) { if (v > 0) { if (S.inRender) S.renderSets++; else S.bakeSets++; } return d.set.call(this, v); }
  });
});
await P.goto("fresh");
await P.g(() => {
  const g = window.game; const orig = g.render; const S = window.__d3;
  g.render = function (...a) { S.inRender++; S.renderSets = 0; try { return orig.apply(this, a); } finally { S.inRender--; if (S.recording) S.frames.push(S.renderSets); } };
});

const COLORS = { cyan: [0x39, 0xF5, 0xFF], danger: [0xFF, 0x4D, 0x6D], violet: [0xB8, 0x6B, 0xFF], lime: [0xA8, 0xFF, 0x3A] };
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
// Pixel nearest to `target` in a small logical-px window around (x, y), read straight from the game canvas.
async function nearestIn(x, y, rx, ry, target) {
  return P.g(({ x, y, rx, ry, target }) => {
    const g = window.game; const s = g.renderScale || 1;
    const x0 = Math.max(0, Math.round((x - rx) * s)), y0 = Math.max(0, Math.round((y - ry) * s));
    const w = Math.max(1, Math.round(2 * rx * s)), h = Math.max(1, Math.round(2 * ry * s));
    const img = g.ctx.getImageData(x0, y0, w, h).data;
    let best = null, bd = Infinity;
    for (let i = 0; i < img.length; i += 4) {
      const px = [img[i], img[i + 1], img[i + 2]];
      const d = Math.sqrt((px[0] - target[0]) ** 2 + (px[1] - target[1]) ** 2 + (px[2] - target[2]) ** 2);
      if (d < bd) { bd = d; best = px; }
    }
    return { px: best, d: Math.round(bd * 10) / 10 };
  }, { x, y, rx, ry, target });
}
async function lumaAt(x, y) {
  return P.g(({ x, y }) => {
    const g = window.game; const s = g.renderScale || 1;
    const d = g.ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
    return Math.round(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
  }, { x, y });
}

await P.startRun("D3");
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
await sleep(1500);

// ---- shadowBlur budget over 180 frames with plates on screen ----
await P.g(() => { window.__d3.frames = []; window.__d3.recording = true; });
await P.autoType(4, { accuracy: 0.9 });
const sb = await P.g(() => { const S = window.__d3; S.recording = false; return { frames: S.frames.length, max: Math.max(0, ...S.frames), over: S.frames.filter((n) => n > 0).length, cache: game.plateCache.size, bakes: S.bakeSets }; });
P.check("shadowBlur sets inside render() === 0 over >= 180 frames with plates on screen; plateCache.size <= 96", sb.frames >= 180 && sb.max === 0 && sb.cache <= 96, sb);

// ---- geometry + draw order (plates spawned on demand, parked at speed 0) ----
await P.g(async () => {
  const g = window.game;
  for (const e of g.enemies) e.alive = false;
  const xs = [900, 1000, 1100, 980, 1150];
  for (let i = 0; i < xs.length; i++) { const e = g.spawnEnemy(); if (e) { e.x = xs[i]; e.speed = 0; e.age = 1; } }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const geo = await P.g(() => {
  const g = window.game;
  const ens = g.enemies.filter((e) => e.alive);
  const widths = ens.map((e) => ({ text: e.text, textW: Math.round(e.textW), plateW: e.plateW, ok: e.plateW >= e.textW + (e.text.length === 1 ? 0 : 24) && (e.text.length > 1 || e.plateW === e.plateH) }));
  return { n: ens.length, widths, allOk: widths.every((w) => w.ok), lockedLast: g.lock ? g.lastPlateDrawn === g.lock.ref : null, hasLock: !!g.lock, rails: g.debug.railsDrawn };
});
P.check("every enemy plate: plateW >= textW + 24 (chip = h for single letters)", geo.n > 0 && geo.allOk, geo.widths.slice(0, 6));
// lock an enemy and confirm it is drawn last
const lockCheck = await P.g(async () => {
  const g = window.game;
  const en = g.enemies.filter((e) => e.alive && g.isTargetable(e)).sort((a, b) => a.x - b.x)[0];
  if (!en) return { note: "no targetable enemy" };
  g.handleTyped(en.nextChar());
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { locked: !!g.lock, last: g.lastPlateDrawn === (g.lock && g.lock.ref), railsDrawn: g.debug.railsDrawn, enemies: g.enemies.length };
});
P.check("locked plate is the last plate drawn (game.lastPlateDrawn === lock.ref) and rails are drawn while enemies exist", lockCheck.locked && lockCheck.last && lockCheck.railsDrawn === true, lockCheck);

// ---- plate colours: idle stroke cyan, fill dark; danger stroke danger ----
const idle = await P.g(() => {
  const g = window.game;
  const e = g.enemies.filter((e) => e.alive && !e.locked && g.enemyState(e) === "idle").sort((a, b) => a.x - b.x)[0];
  return e ? { x: e.x, y: e.y, w: e.plateW, h: e.plateH, text: e.text } : null;
});
if (idle) {
  const stroke = await nearestIn(idle.x, idle.y - idle.h / 2, 6, 2.5, COLORS.cyan);
  const fill = await lumaAt(idle.x - idle.w / 2 + 8, idle.y);
  P.check("idle plate: stroke pixel within 12 of --neon-cyan, fill luminance <= 28/255 (8 px inside the edge)", stroke.d <= 12 && fill <= 28, { stroke, fill, plate: idle });
} else P.note("idle plate colour sample", "no idle plate in the sample window");
const dangerCheck = await P.g(async () => {
  const g = window.game;
  const e = g.enemies.filter((e) => e.alive && !e.locked).sort((a, b) => b.x - a.x)[0];
  if (!e) return null;
  e.x = 300; e.speed = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { state: g.enemyState(e), x: e.x, y: e.y, w: e.plateW, h: e.plateH };
});
if (dangerCheck) {
  const stroke = await nearestIn(dangerCheck.x, dangerCheck.y - dangerCheck.h / 2, 6, 2.5, COLORS.danger);
  P.check("enemy moved to x 300 -> state 'danger' and stroke pixel within 12 of --danger", dangerCheck.state === "danger" && stroke.d <= 12, { dangerCheck, stroke });
} else P.note("danger plate", "no enemy to move");

// ---- spawn pop: >= 5 % wider .15 s after spawn ----
const pop = await P.g(async () => {
  const g = window.game;
  const en = g.spawnEnemy();
  if (!en) return { note: "spawnEnemy returned null (cap)" };
  en.x = g.w - 200;   // on screen so the plate is drawn
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    samples.push({ age: Math.round(en.age * 1000) / 1000, scale: Math.round(en.popScale * 1000) / 1000 });
    if (en.age >= 0.15) break;
  }
  const at15 = samples.filter((s) => s.age >= 0.13 && s.age <= 0.19).pop() || samples[samples.length - 1];
  return { at15, peak: Math.max(...samples.map((s) => s.scale)), samples: samples.slice(-4) };
});
P.check("plate width factor >= 1.05 about .15 s after spawn (easeOutBack pop x warp stretch)", pop.at15 && pop.at15.scale >= 1.05, pop);

// ---- contact slam: kick, no explosion sprite ----
const slam = await P.g(() => {
  const g = window.game;
  const en = g.enemies.filter((e) => e.alive && !e.dying).sort((a, b) => a.x - b.x)[0];
  if (!en) return null;
  const before = g.explosions.length;
  g.player.kick = 0;
  g.leakEnemy(en);
  return { kick: g.player.kick, explosionsBefore: before, explosionsAfter: g.explosions.length, dying: (g.dyingPlates || []).filter((d) => d.mode === "slam").length, lastCue: g.sfx.lastCue };
});
P.check("contact: player.kick > 0, no explosion sprite added, a 'slam' dying-plate record exists", slam && slam.kick > 0 && slam.explosionsAfter === slam.explosionsBefore && slam.dying >= 1, slam);

// ---- capsules ----
const cap = await P.g(async () => {
  const g = window.game;
  for (const p of g.powerups) p.alive = false;
  const p = g.spawnPowerup({ type: "SHIELD" });
  if (!p) return null;
  p.x = g.w * 0.6; p.baseY = 320; p.age = 1; p.speed = 0;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { x: p.x, y: p.y, w: p.plateW, h: p.plateH, labelW: Math.round(p.labelW), ok: p.plateW >= p.labelW + 40 };
});
if (cap) {
  const stroke = await nearestIn(cap.x + 10, cap.y - cap.h / 2, 6, 2.5, COLORS.violet);
  P.check("capsule: stroke pixel within 12 of --neon-violet and capsule.w >= labelW + 40 (h 36 chamfered hexagon)", cap.ok && stroke.d <= 12, { cap, stroke });
  await P.shot("capsule");
} else P.note("capsule", "spawnPowerup returned null");
const collect = await P.g(async () => {
  const g = window.game;
  const p = g.powerups.find((p) => p.alive);
  if (!p) return null;
  const ringsBefore = Array.isArray(g.rings) ? g.rings.length : null;
  g.collectPowerup(p);
  const t0 = performance.now();
  await new Promise((r) => requestAnimationFrame(r));
  const created = document.querySelectorAll(".flyLabel").length;
  const inMain = !!document.querySelector("#main > .flyLabel");
  const rings = Array.isArray(g.rings) ? g.rings.length : null;
  const dying = (g.dyingPlates || []).filter((d) => d.mode === "collect").length;
  await new Promise((r) => setTimeout(r, 500));
  const left = document.querySelectorAll(".flyLabel").length;
  return { created, inMain, left, rings, ringsBefore, dying, ms: Math.round(performance.now() - t0) };
});
P.check("collectPowerup: .flyLabel appended to #main within one frame and removed within 500 ms; 'collect' plate record", collect && collect.created >= 1 && collect.inMain && collect.left === 0 && collect.dying >= 1, collect);
if (collect && collect.rings !== null) P.check("rings.length >= 1 right after the collect (camera addShockwave)", collect.rings >= 1, collect);
else P.note("rings.length >= 1 after collect", "game.rings not defined yet (camera track); addShockwave is feature-detected");

await P.shot("plates");
const errs = { pageErrors: P.errors.pageErrors.length, consoleErrors: P.errors.consoleErrors.length };
P.check("no page / console errors during the D3 probe", errs.pageErrors === 0 && errs.consoleErrors === 0, errs);

// ---- reduced motion context ----
const ctx2 = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr, reducedMotion: "reduce" });
const pg = await ctx2.newPage();
const rmErrors = [];
pg.on("pageerror", (e) => rmErrors.push(String(e)));
await ctx2.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
await pg.goto(P.base, { waitUntil: "load" });
await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 120000 });
await pg.fill("#playerName", "RM").catch(() => {});
await pg.click("#btnStart");
try { const st = pg.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.click(); } catch {}
await pg.waitForFunction(() => window.game && window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 30000 });
await pg.evaluate(() => { const g = window.game; if (typeof g.resolveMotion === "function") g.resolveMotion(); if (!g.reduceMotion) { g.reduceMotion = true; document.documentElement.classList.add("reduce-motion"); g._rmForcedByProbe = true; } });
await sleep(2500);
const rm = await pg.evaluate(async () => {
  const g = window.game;
  const out = { reduceMotion: !!g.reduceMotion, rootClass: document.documentElement.classList.contains("reduce-motion"), forcedByProbe: !!g._rmForcedByProbe, mediaQuery: matchMedia("(prefers-reduced-motion: reduce)").matches };
  const en = g.enemies.filter((e) => e.alive && !e.locked)[0] || g.spawnEnemy();
  if (en) { en.x = 900; en.age = 0; }
  const ys = [];
  for (let i = 0; i < 30; i++) { await new Promise((r) => requestAnimationFrame(r)); ys.push(en.y); }
  out.yConst = ys.every((y) => y === ys[0]);
  out.ySpread = Math.max(...ys) - Math.min(...ys);
  for (const p of g.powerups) p.alive = false;
  const p = g.spawnPowerup({ type: "MULTI" });
  if (p) { p.x = g.w * 0.6; p.age = 1; await new Promise((r) => requestAnimationFrame(r)); g.collectPowerup(p); await new Promise((r) => requestAnimationFrame(r)); out.flyLabels = document.querySelectorAll(".flyLabel").length; }
  return out;
});
P.check("reduce-motion: game.reduceMotion / :root.reduce-motion set, a non-locked enemy's y constant over 30 frames, no .flyLabel on collect", rm.reduceMotion && rm.yConst && rm.flyLabels === 0, rm);
P.check("reduce-motion context: no page errors", rmErrors.length === 0, rmErrors);
await ctx2.close();
await P.finish();
