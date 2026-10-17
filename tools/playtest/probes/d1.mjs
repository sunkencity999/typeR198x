// D1 acceptance: effects clock v2 (trauma camera, hit-stop, flash channels, vignettes, active-target redraw).
// PLAN D1 + CONTRACT section 11. Usage: node probes/d1.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d1-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

// Full-frame fill instrumentation (same rule as play.mjs: a fillRect covering >= 90 % of the canvas).
await P.context.addInitScript(() => {
  const S = window.__d1 = { fullFrameMaxAlpha: 0, fullFrameFills: 0 };
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  const parseAlpha = (s) => { if (typeof s !== "string") return null; const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[\s,\/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; };
  proto.fillRect = function (x, y, w, h) {
    try {
      const c = this.canvas;
      if (c && c.id === "game" && w > 0 && h > 0) {
        const m = this.getTransform();
        const xs = [], ys = [];
        for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { xs.push(m.a * px + m.c * py + m.e); ys.push(m.b * px + m.d * py + m.f); }
        const cov = Math.max(0, Math.min(c.width, Math.max(...xs)) - Math.max(0, Math.min(...xs))) * Math.max(0, Math.min(c.height, Math.max(...ys)) - Math.max(0, Math.min(...ys))) / (c.width * c.height);
        if (cov >= 0.9) {
          const a0 = parseAlpha(this.fillStyle);
          const a = a0 == null ? 1 : Math.min(1, a0 * this.globalAlpha);
          S.fullFrameFills++;
          if (a < 0.999 && a > S.fullFrameMaxAlpha) S.fullFrameMaxAlpha = a;
        }
      }
    } catch {}
    return orig.apply(this, arguments);
  };
});

await P.goto("fresh");
await P.startRun("D1");
await page.waitForFunction(() => window.game.isLevelGateOpen && window.game.isLevelGateOpen() && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await sleep(200);

const raf = "await new Promise(r => requestAnimationFrame(r));";

// ---- API surface + reset coverage ----
const api = await P.g(() => {
  const g = window.game;
  const names = ["shakeOffset", "addHitStop", "setSlowMo", "addShockwave", "onKeyFx", "onKillFx", "redrawActiveTarget", "drawFlashChannels", "drawDyingPlates", "drawRings", "tickEffects", "resetTransientFx", "fxMotion"];
  const missing = names.filter((n) => typeof g[n] !== "function");
  g.trauma = 0.5; g.hitStop = 0.1; g.typoFlash = 0.08; g.damageFlash = 1; g.whiteFlash = 0.5; g.introPulse = 1; g.player.recoil = 1; g.player.heat = 1; g.player.kick = 14; g.player.hitT = 0.12;
  g.addShockwave(600, 300, 20, "cyan"); g.setSlowMo(0.35, 0.6, 0.4); g.dyingPlates.push({ x: 1, y: 1, w: 10, h: 10, t: 0, life: 0.09 }); g.typoGlyphs.push({ ch: "a", ref: { x: 1, y: 1, alive: true }, t: 0, life: 0.4, rise: 10 });
  g.resetTransientFx();
  const after = { trauma: g.trauma, hitStop: g.hitStop, timeScale: g.timeScale, typoFlash: g.typoFlash, damageFlash: g.damageFlash, whiteFlash: g.whiteFlash, introPulse: g.introPulse, recoil: g.player.recoil, heat: g.player.heat, kick: g.player.kick, hitT: g.player.hitT, rings: g.rings.length, slowMo: g.slowMo, dying: g.dyingPlates.length, glyphs: g.typoGlyphs.length, bossIntro: g.bossIntro };
  const zero = Object.entries(after).every(([k, v]) => k === "timeScale" ? v === 1 : (v === 0 || v === null));
  return { missing, after, zero, hooks: Game.CAMERA_HOOKS, motion: g.fxMotion() };
});
P.check("D1 API present (shakeOffset, addHitStop, setSlowMo, addShockwave, onKeyFx, onKillFx, redrawActiveTarget, ...)", api.missing.length === 0, api.missing);
P.check("resetTransientFx zeroes every new channel, list and ship timer", api.zero, api.after);
console.log("camera hook fallbacks active:", JSON.stringify(api.hooks), "motion:", JSON.stringify(api.motion));

// ---- trauma camera: offsets, rotation, opaque corners ----
const cam = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const W = g.canvas.width, H = g.canvas.height;
  const pageBg = [11, 16, 48];
  let maxAbs = 0, maxRot = 0, nonInt = 0, distinct = new Set(), bad = 0, frames = 0;
  g.trauma = 1;
  for (let i = 0; i < 60; i++) {
    g.trauma = 1;
    await new Promise(r => requestAnimationFrame(r));
    frames++;
    const s = g.shakeNow || { x: 0, y: 0, rot: 0 };
    maxAbs = Math.max(maxAbs, Math.abs(s.x), Math.abs(s.y));
    maxRot = Math.max(maxRot, Math.abs(s.rot || 0));
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) nonInt++;
    distinct.add(s.x + "," + s.y);
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const isPage = Math.abs(d[0] - pageBg[0]) <= 2 && Math.abs(d[1] - pageBg[1]) <= 2 && Math.abs(d[2] - pageBg[2]) <= 2;
      if (d[3] !== 255 || isPage) bad++;
    }
  }
  const off = g.shakeOffset();
  g.trauma = 0;
  await new Promise(r => requestAnimationFrame(r));
  const zero = g.shakeOffset();
  return { frames, maxAbs, maxRot, nonInt, distinct: distinct.size, bad, sample: off, zero };
});
P.check("trauma=1 for 60 frames: integer offsets <= 18 px, rotation <= .02 rad, smooth-noise (>= 20 distinct offsets)", cam.maxAbs <= 18 && cam.maxAbs >= 6 && cam.maxRot <= 0.0201 && cam.nonInt === 0 && cam.distinct >= 20, cam);
P.check("trauma=1 for 60 frames: all four canvas corners opaque and never the page background", cam.bad === 0 && cam.frames === 60, { bad: cam.bad, frames: cam.frames });
P.check("shakeOffset() is {0,0,0} at trauma 0", cam.zero.x === 0 && cam.zero.y === 0 && cam.zero.rot === 0, cam.zero);

// ---- freeze the ambient layers for pixel comparisons (instance overrides; removed at the end) ----
await P.g(() => {
  const g = window.game;
  g.stepAmbient = () => {};
  g.emitExhaust = () => {};
  g.drawStars = () => {};   // star twinkle is per-frame; it is not part of the typo / damage layers under test
  g.save.settings.crt = false; g.applySettings();
  g.enemies.length = 0; g.powerups.length = 0; g.particles.length = 0; g.bullets.length = 0; g.explosions.length = 0; g.lock = null; g.trauma = 0;
  g.spawnAcc = -1e9; g.powerAcc = -1e9; g.hungryT = -1e9;
  g.spawnEnemy = () => null; g.spawnPowerup = () => null;
});
await sleep(100);

// ---- hit-stop: levelT advances <= .15 x wall time for the 3 frames after a kill; white plate at the kill point ----
const hs = await P.g(async () => {
  const g = window.game;
  const en = new Enemy({ text: "ring", x: 640, y: 360, speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  const plate = { w: en.plateW, h: en.plateH };
  let t0 = g.levelT, w0 = performance.now();
  g.killEnemy(en);
  const ring0 = g.rings[g.rings.length - 1];
  const rec = [];
  let lum = null;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const t1 = g.levelT, w1 = performance.now();
    rec.push({ dLevel: +(t1 - t0).toFixed(4), dWall: +((w1 - w0) / 1000).toFixed(4), ratio: +((t1 - t0) / ((w1 - w0) / 1000)).toFixed(3), timeScale: g.timeScale, hitStop: +g.hitStop.toFixed(4) });
    if (i === 0) {
      const s = g.renderScale; const ctx = g.ctx;
      const w = Math.round(plate.w * 0.6 * s), h = Math.round(plate.h * 0.6 * s);
      const d = ctx.getImageData(Math.round(640 * s - w / 2), Math.round(360 * s - h / 2), w, h).data;
      let sum = 0; for (let k = 0; k < d.length; k += 4) sum += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      lum = sum / (d.length / 4);
    }
    t0 = t1; w0 = w1;
  }
  return { rec, lum, plate, ring: ring0 && { life: ring0.life, size: ring0.size, color: ring0.color }, dying: g.dyingPlates.length };
});
// The game clamps a frame's dt to .05 s, so a stalled frame (getImageData readback, GC) still steps levelT by at most
// .15 x .05 = .0075; a stall can also consume the .045 s hit-stop in two frames instead of three.
const hsFrames = hs.rec.slice(0, 3);
const hsOk = hsFrames[0].timeScale <= 0.15 && hsFrames[1].timeScale <= 0.15 && hsFrames.every((r, i) => r.timeScale <= 0.15 ? r.dLevel <= 0.0076 : (i === 2 && hs.rec[1].dWall > 0.03)) && hs.rec[4].timeScale === 1 && hs.rec[4].dLevel > 0.01;
P.check("after killEnemy: timeScale .15 and levelT step <= .15 x the frame (<= .0025 s at 60 Hz, <= .0075 on a clamped stall) for the next 3 frames, then normal", hsOk, hs.rec);
P.check("kill frame: white impact plate at the kill point (mean luminance > 220)", hs.lum !== null && hs.lum > 220, { lum: hs.lum && hs.lum.toFixed(1), plate: hs.plate });
await P.shot("kill-frame");

// ---- takeDamage(30): no centre wash, #hud.is-hit within one frame ----
const dmg = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  const cx = Math.round(640 * s), cy = Math.round(360 * s);
  g.particles.length = 0; g.explosions.length = 0; g.rings.length = 0;
  await new Promise(r => requestAnimationFrame(r));
  const before = [...ctx.getImageData(cx, cy, 1, 1).data];
  const cornerBefore = [...ctx.getImageData(12, 12, 1, 1).data];
  g.invulnT = 0;
  const lost = g.takeDamage(30);
  const kickNow = g.player.kick, hitTNow = g.player.hitT;
  const traumaNow = g.trauma;
  g.trauma = 0;   // sample the overlay, not the camera shake takeDamage also triggers (screenShake(12))
  await new Promise(r => requestAnimationFrame(r));
  const hit = document.getElementById("hud").classList.contains("is-hit");
  const after = [...ctx.getImageData(cx, cy, 1, 1).data];
  const corner = [...ctx.getImageData(12, 12, 1, 1).data];
  return { lost, before, after, delta: Math.abs(after[0] - before[0]), hit, kick: kickNow, hitT: hitTNow, kickNext: g.player.kick, traumaNow, damageFlash: g.damageFlash, cornerBefore, corner, cornerDelta: corner[0] - cornerBefore[0] };
});
P.check("takeDamage(30): centre pixel red delta < 15 and #hud.is-hit within one frame", dmg.lost > 0 && dmg.delta < 15 && dmg.hit, { lost: dmg.lost, delta: dmg.delta, hit: dmg.hit, before: dmg.before, after: dmg.after });
P.check("takeDamage: kick === 14 and hitT > 0 synchronously, the corner (12,12) reddens (edge vignette), kick eases next frame", dmg.cornerDelta >= 8 && dmg.kick === 14 && dmg.hitT > 0 && dmg.kickNext < 14, { cornerDelta: dmg.cornerDelta, kick: dmg.kick, hitT: dmg.hitT, kickNext: dmg.kickNext, damageFlash: dmg.damageFlash });
await P.shot("damage-frame");
await sleep(900);

// ---- wrong key with a lock: local jitter + rising glyph, no red change outside the plate neighbourhood ----
const typo = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale; const W = g.canvas.width, H = g.canvas.height;
  g.enemies.length = 0; g.lock = null; g.particles.length = 0; g.bullets.length = 0; g.rings.length = 0; g.explosions.length = 0; g.damageFlash = 0; g.player.hitT = 0; g.player.kick = 0;
  g.banner = null; g.callout = null; if (g.calloutQueue) g.calloutQueue.length = 0; g.floaters.length = 0;
  const en = new Enemy({ text: "sharpness", x: 640, y: 360, speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  g.handleTyped("s");
  // let the beam, sparks and impact ring die (bullet .15 s, sparks .26 s, ring .28 s) and recoil settle
  await new Promise(r => setTimeout(r, 700));
  await new Promise(r => requestAnimationFrame(r));
  const A = ctx.getImageData(0, 0, W, H).data;
  g.handleTyped("x");
  await new Promise(r => requestAnimationFrame(r));
  const B = ctx.getImageData(0, 0, W, H).data;
  const glyph = g.typoGlyphs.length;
  const typoT = en.typoT;
  await new Promise(r => requestAnimationFrame(r));
  const C = ctx.getImageData(0, 0, W, H).data;
  const pw = en.plateW, ph = en.plateH;
  const nb = { x0: (640 - pw / 2 - 60) * s, x1: (640 + pw / 2 + 60) * s, y0: (360 - ph / 2 - 60) * s, y1: (360 + ph / 2 + 60) * s };
  const shipX1 = 280 * s;   // the thruster plume flickers every frame (D4); it is not a wash and is excluded
  let outsideRed = 0, outsideMax = 0, insideChangedAB = 0, insideChangedBC = 0; const where = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    const inside = x >= nb.x0 && x <= nb.x1 && y >= nb.y0 && y <= nb.y1;
    if (inside) {
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) insideChangedAB++;
      if (Math.abs(B[i] - C[i]) + Math.abs(B[i + 1] - C[i + 1]) + Math.abs(B[i + 2] - C[i + 2]) > 30) insideChangedBC++;
    } else if (x > shipX1) {
      const dr = Math.abs(A[i] - B[i]);
      if (dr > outsideMax) outsideMax = dr;
      if (dr > 20) { outsideRed++; if (where.length < 8) where.push([Math.round(x / s), Math.round(y / s), A[i], B[i]]); }
    }
  }
  return { locked: !!(g.lock && g.lock.ref === en), glyph, typoT, outsideRed, outsideMax, where, insideChangedAB, insideChangedBC, misses: g.stats.misses, trauma: g.trauma, floaters: g.floaters.length, banner: !!g.banner, callout: !!g.callout };
});
P.check("wrong key with a lock: no pixel outside the plate's 60 px neighbourhood changes red by > 20 (ship/plume column excluded)", typo.locked && typo.outsideRed === 0, typo);
P.check("wrong key with a lock: the plate jitters / expected glyph rises (pixels inside the neighbourhood change on consecutive frames; typoT > 0)", typo.insideChangedAB > 0 && typo.insideChangedBC > 0 && typo.typoT > 0 && typo.glyph >= 1, { insideChangedAB: typo.insideChangedAB, insideChangedBC: typo.insideChangedBC, typoT: typo.typoT, glyph: typo.glyph });
await P.shot("typo-frame");

// ---- wrong key with nothing locked: the top-edge flicker, still no wash ----
const edge = await P.g(async () => {
  const g = window.game;
  g.lock = null; g.enemies.forEach((e) => { e.locked = false; });
  const before = window.__d1.fullFrameMaxAlpha;
  g.handleTyped("q");
  await new Promise(r => requestAnimationFrame(r));
  return { typoEdge: g.typoEdge, fullFrameMaxAlpha: window.__d1.fullFrameMaxAlpha, before, hasTargets: g.hasVisibleTargets() };
});
P.check("wrong key without a lock: typoEdge timer armed (2 px top-edge flicker), no full-frame fill above .12", edge.typoEdge > 0 && edge.fullFrameMaxAlpha <= 0.12, edge);

// ---- flash caps: whiteFlash .5 + damageFlash 1 + low HP: full-frame fill alpha <= .12; low-HP corner redder ----
const caps = await P.g(async () => {
  const g = window.game; const ctx = g.ctx;
  g.enemies.length = 0; g.lock = null; g.typoGlyphs.length = 0;
  await new Promise(r => requestAnimationFrame(r));
  const cornerFull = ctx.getImageData(12, 12, 1, 1).data[0];
  const savedHp = g.player.hp;
  g.player.hp = Math.round(g.player.maxHp * 0.2);
  g.whiteFlash = 0.5; g.damageFlash = 1;
  let fills = 0, maxA = 0;
  for (let i = 0; i < 6; i++) {
    const f0 = window.__d1.fullFrameFills; window.__d1.fullFrameMaxAlpha = 0;
    await new Promise(r => requestAnimationFrame(r));
    fills += window.__d1.fullFrameFills - f0;
    maxA = Math.max(maxA, window.__d1.fullFrameMaxAlpha);
  }
  g.whiteFlash = 0; g.damageFlash = 0;
  await new Promise(r => requestAnimationFrame(r));
  const cornerLow = ctx.getImageData(12, 12, 1, 1).data[0];
  g.player.hp = savedHp;
  return { fills, maxA, cornerFull, cornerLow, delta: cornerLow - cornerFull };
});
P.check("whiteFlash .5 + damageFlash 1: full-frame fills present but alpha <= .12 (vignettes are drawImage, never a fill)", caps.fills > 0 && caps.maxA <= 0.12, caps);
P.check("hp 20 %: corner (12,12) red channel >= 20 above the full-HP frame (low-HP edge pulse)", caps.delta >= 20, { cornerFull: caps.cornerFull, cornerLow: caps.cornerLow });
await P.shot("lowhp-frame");

// ---- banner over the locked plate: L16 redraw keeps the plate on top ----
const redraw = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  g.player.hp = g.player.maxHp;
  g.enemies.length = 0; g.lock = null;
  const en = new Enemy({ text: "redraw", x: 640, y: Math.round(g.h * 0.46), speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  g.handleTyped("r");
  await new Promise(r => setTimeout(r, 500));
  g.showBanner({ kind: "sector", title: "REDRAW TEST", sub: "banner over the locked plate" });
  let drawn = 0; const orig = g.drawEnemy;
  g.drawEnemy = function (c, e) { if (e === en) drawn++; return orig.call(this, c, e); };
  await new Promise(r => setTimeout(r, 400));
  await new Promise(r => requestAnimationFrame(r));
  const perFrame = drawn; drawn = 0;
  await new Promise(r => requestAnimationFrame(r));
  const perFrame2 = drawn;
  delete g.drawEnemy;
  // the plate's lead glyph (lime) must still be visible at the plate: sample the plate row for a lime-ish pixel
  const y = Math.round(en.y * s); const x0 = Math.round((en.x - en.plateW / 2) * s), x1 = Math.round((en.x + en.plateW / 2) * s);
  const row = ctx.getImageData(x0, y - 2, x1 - x0, 5).data;
  let lime = 0; for (let k = 0; k < row.length; k += 4) if (row[k + 1] > 200 && row[k] > 120 && row[k + 2] < 140) lime++;
  const banner = !!g.banner;
  return { perFrame, perFrame2, lime, banner, locked: !!(g.lock && g.lock.ref === en) };
});
P.check("centre banner over the locked plate: drawEnemy runs twice per frame (L9 + L16 redraw) and lime text pixels survive", redraw.banner && redraw.perFrame >= 2 && redraw.perFrame2 >= 2 && redraw.lime > 0, redraw);
await P.shot("banner-redraw");
await P.g(() => { const g = window.game; g.clearBanners && g.clearBanners(); g.banner = null; g.callout = null; });

// ---- tickEffects decays channels while paused ----
const paused = await P.g(async () => {
  const g = window.game;
  g.damageFlash = 1; g.whiteFlash = 0.5; g.player.recoil = 1; g.player.heat = 1; g.introPulse = 1;
  g.pauseGame("user");
  const t0 = { damageFlash: g.damageFlash, whiteFlash: g.whiteFlash, recoil: g.player.recoil, heat: g.player.heat, introPulse: g.introPulse, trauma: g.trauma };
  await new Promise(r => setTimeout(r, 700));
  const t1 = { damageFlash: g.damageFlash, whiteFlash: g.whiteFlash, recoil: g.player.recoil, heat: g.player.heat, introPulse: g.introPulse, mode: g.mode, trauma: g.trauma };
  g.setMode("playing");
  return { t0, t1 };
});
P.check("paused: every channel keeps decaying (damageFlash, whiteFlash, recoil, heat, introPulse) and trauma is 0", paused.t1.mode === "paused" && paused.t1.damageFlash < paused.t0.damageFlash && paused.t1.whiteFlash < paused.t0.whiteFlash && paused.t1.recoil < paused.t0.recoil && paused.t1.heat < paused.t0.heat && paused.t1.introPulse < paused.t0.introPulse && paused.t1.trauma === 0, paused);

// ---- slow-mo + hit-stop cap over a 20 s typing run ----
await P.g(() => { const g = window.game; delete g.stepAmbient; delete g.emitExhaust; delete g.drawStars; delete g.spawnEnemy; delete g.spawnPowerup; g.spawnAcc = 0; g.powerAcc = 0; g.hungryT = 0; g.save.settings.crt = true; g.applySettings(); window.__d1.maxHitStop = 0; window.__d1.maxShake = 0; window.__d1.poll = setInterval(() => { const g = window.game; if (g.hitStop > window.__d1.maxHitStop) window.__d1.maxHitStop = g.hitStop; const s = g.shakeNow || { x: 0, y: 0 }; window.__d1.maxShake = Math.max(window.__d1.maxShake, Math.abs(s.x), Math.abs(s.y)); }, 15); });
const slow = await P.g(async () => {
  const g = window.game;
  g.setSlowMo(0.35, 0.6, 0.4);
  await new Promise(r => requestAnimationFrame(r));
  const hold = g.timeScale;
  await new Promise(r => setTimeout(r, 650));
  const easing = g.timeScale;
  await new Promise(r => setTimeout(r, 500));
  return { hold, easing, after: g.timeScale, slowMo: g.slowMo };
});
P.check("setSlowMo(.35,.6,.4): timeScale .35 during the hold, between .35 and 1 while easing, 1 afterwards", Math.abs(slow.hold - 0.35) < 0.01 && slow.easing > 0.35 && slow.easing < 1 && slow.after === 1 && slow.slowMo === null, slow);
await P.autoType(20, { accuracy: 0.94 });
const run = await P.g(() => { clearInterval(window.__d1.poll); const g = window.game; return { maxHitStop: window.__d1.maxHitStop, maxShake: window.__d1.maxShake, score: g.stats.score, kills: g.stats.kills, mode: g.mode, fullFrameMaxAlpha: window.__d1.fullFrameMaxAlpha, particles: g.particles.length, rings: g.rings.length }; });
P.check("20 s typing run: hitStop never exceeds .18, shake offsets never exceed 18 px, no full-frame fill above .12", run.maxHitStop <= 0.18 && run.maxShake <= 18 && run.fullFrameMaxAlpha <= 0.12 && run.kills > 0, run);
await P.shot("after-run");

// ---- reduced motion: trauma never rises; hit-stop capped at .06; vignette static ----
const rmCtx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr, reducedMotion: "reduce" });
const rmPage = await rmCtx.newPage();
const rmErrors = [];
rmPage.on("pageerror", (e) => rmErrors.push(String(e)));
await rmPage.goto(P.base, { waitUntil: "load" });
await rmPage.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 120000 });
const rm = await rmPage.evaluate(async () => {
  const g = window.game;
  const motion = g.fxMotion();
  g.trauma = 0;
  g.screenShake(14);
  const trauma = g.trauma;
  g.addHitStop(0.18);
  const hitStop = g.hitStop;
  const mq = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { motion, trauma, hitStop, mq, reduceMotionFlag: g.reduceMotion };
});
P.check("prefers-reduced-motion: screenShake(14) leaves trauma at 0; motion().shake === 0; addHitStop capped at .06", rm.mq && rm.trauma === 0 && rm.motion.shake === 0 && rm.hitStop <= 0.06 + 1e-9, rm);
P.check("reduced-motion page: no page errors", rmErrors.length === 0, rmErrors);
await rmCtx.close();

P.note("gameOver backdrop still after 1.5 s", "covered by probes/a2.mjs (Game Over holds a still frame) and the harness 12-game-over shot");
P.note("fullFrameFillMaxAlpha <= .12 outside storm flashes", "harness report.fullFrameFillMaxAlpha (tools/playtest/out/*/report.json)");
await P.finish();
