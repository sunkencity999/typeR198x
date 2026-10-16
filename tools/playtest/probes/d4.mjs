// D4 acceptance: ship presentation (trimmed sprite + baked rim shadow, typing-driven thruster, exhaust, bob,
// damage overlay / kick, hex shield with timer arc). PLAN D4 / VIS-06 / JUICE-05. Usage: node probes/d4.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 2);
const P = await openProbe("d4-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

await P.context.addInitScript(() => {
  const S = window.__d4 = { getImageData: 0, shadow: 0, frames: [], recording: false, firstKey: false };
  const proto = CanvasRenderingContext2D.prototype;
  const gid = proto.getImageData;
  proto.getImageData = function () { if (!S.firstKey) S.getImageData++; return gid.apply(this, arguments); };
  const d = Object.getOwnPropertyDescriptor(proto, "shadowBlur");
  Object.defineProperty(proto, "shadowBlur", { configurable: true, get() { return d.get.call(this); }, set(v) { if (v > 0) S.shadow++; return d.set.call(this, v); } });
  const tick = () => { if (S.recording) S.frames.push(S.shadow); S.shadow = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.addEventListener("keydown", () => { S.firstKey = true; }, true);
});

await P.goto("fresh");
const boot = await P.g(() => ({ gid: window.__d4.getImageData, ships: Object.keys(THRUSTER_OFFSET), drawW: SHIP_DRAW_W }));
P.check("no getImageData during boot; THRUSTER_OFFSET covers the four ships; SHIP_DRAW_W 168", boot.gid === 0 && ["coconut", "little-dark-one", "sofrito", "honeybee"].every((id) => boot.ships.includes(id)) && boot.drawW === 168, boot);

await P.startRun("D4");
await page.waitForFunction(() => window.game.isLevelGateOpen && window.game.isLevelGateOpen() && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await sleep(2500);
await P.shot("gameplay-early");

// ---- source rules ----
const src = await P.g(() => {
  const s = Game.prototype.drawShip.toString();
  return { noAlpha95: !/globalAlpha = 0\.95/.test(s), noCockpit: !/ellipse\(x \+ 18/.test(s), additive: typeof Game.prototype.drawShipAdditive, shield: typeof Game.prototype.drawShield, exhaust: typeof Game.prototype.emitExhaust, sprite: typeof Game.prototype.getShipSprite };
});
P.check("drawShip has no `globalAlpha = 0.95` and no `ellipse(x + 18`; drawShipAdditive / drawShield / emitExhaust / getShipSprite exist", src.noAlpha95 && src.noCockpit && src.additive === "function" && src.shield === "function" && src.exhaust === "function" && src.sprite === "function", src);

// ---- 04-gameplay-early pixels: opaque hull, no magenta cockpit blob at (178,360), saturated plume left of the hull ----
const pix = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  await new Promise(r => requestAnimationFrame(r));
  const pose = g._shipPose; const geo = pose.geo;
  const px = (x, y) => [...ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data];
  const hullC = px(geo.left + geo.w * 0.55, geo.top + geo.h * 0.5);
  const cock = [];
  for (let dx = -3; dx <= 3; dx += 3) for (let dy = -3; dy <= 3; dy += 3) cock.push(px(178 + dx, 360 + dy));
  const magentaBlob = cock.filter((c) => c[0] > 200 && c[2] > 150 && c[1] < 120).length;
  // the plume body: 24x14 just left of the left-most nozzle (the idle plume is 26 px long, half-height 7)
  const noz = pose.nozzles.reduce((a, b) => (b.x < a.x ? b : a));
  const x0 = Math.round((noz.x + pose.dx - 28) * s), y0 = Math.round((noz.y + pose.bob - 7) * s);
  const d = ctx.getImageData(x0, y0, Math.round(24 * s), Math.round(14 * s)).data;
  let satSum = 0, lumSum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2]; const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    satSum += max ? (max - min) / max : 0; lumSum += 0.2126 * r + 0.7152 * gg + 0.0722 * b; n++;
  }
  return { hullC, magentaBlob, meanSat: satSum / n, meanLum: lumSum / n, nozzle: [Math.round(noz.x), Math.round(noz.y)], ship: geo.shipId, spriteBaked: !!pose.sprite, geo: { left: Math.round(geo.left), top: Math.round(geo.top), w: Math.round(geo.w), h: Math.round(geo.h) } };
});
P.check("hull pixel opaque (alpha 255) and drawn from the baked sprite; no magenta cockpit blob at (178,360)", pix.hullC[3] === 255 && pix.spriteBaked && pix.magentaBlob === 0, pix);
P.check("plume pixels left of the hull (24x14 at the nozzle): mean saturation > .5", pix.meanSat > 0.5, { meanSat: pix.meanSat.toFixed(3), meanLum: pix.meanLum.toFixed(1), nozzle: pix.nozzle });

// ---- heat: 6 keys in 1 s -> > .6; < .1 after 2 s idle ----
const heat = await P.g(async () => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null; g.spawnEnemy = () => null;
  const en = new Enemy({ text: "heatwave", x: 760, y: 360, speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  for (const ch of "heatwa") { g.handleTyped(ch); await new Promise(r => setTimeout(r, 150)); }
  const hot = g.player.heat;
  await new Promise(r => setTimeout(r, 2000));
  const cold = g.player.heat;
  return { hot, cold, progress: en.progress };
});
P.check("6 correct keys in ~1 s -> player.heat > .6; < .1 after 2 s idle", heat.hot > 0.6 && heat.cold < 0.1 && heat.progress === 6, heat);

// ---- exhaust emitter ~90/s at idle, kick/hitT on damage ----
const ex = await P.g(async () => {
  const g = window.game;
  let n = 0; const orig = g.pushParticle; g.pushParticle = function (p) { n++; return orig.call(this, p); };
  await new Promise(r => setTimeout(r, 1000));
  delete g.pushParticle;
  g.invulnT = 0;
  const lost = g.takeDamage(1);
  const kick = g.player.kick, hitT = g.player.hitT;
  await new Promise(r => setTimeout(r, 600));
  return { perSecond: n, lost, kick, hitT, kickLater: g.player.kick, hitTLater: g.player.hitT };
});
P.check("exhaust emitter ~90 particles/s at idle (60..140)", ex.perSecond >= 60 && ex.perSecond <= 140, ex);
P.check("takeDamage(1) -> kick === 14 && hitT > 0; both settle within .6 s", ex.lost > 0 && ex.kick === 14 && ex.hitT > 0 && ex.kickLater < 1 && ex.hitTLater === 0, ex);

// ---- shield = 9: a six-edged ring (stroke radius alternates ~66 at vertices / ~57 at edge midpoints) ----
const hexa = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  g.stepAmbient = () => {}; g.drawStars = () => {}; g.emitExhaust = () => {}; g.particles.length = 0;
  g.save.settings.crt = false; g.applySettings();
  g.player.shield = 9; g.player.shieldCap = 9;
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  const pose = g._shipPose; const cx = pose.cx + pose.dx, cy = pose.cy + pose.bob;
  // one readback of the 160x160 shield square; the hexagon rotates 30 deg/s so per-pixel calls would smear it
  const R = 80, X0 = Math.round((cx - R) * s), Y0 = Math.round((cy - R) * s), W = Math.round(2 * R * s);
  const img = ctx.getImageData(X0, Y0, W, W).data;
  const at = (x, y) => { const px = Math.round(x * s) - X0, py = Math.round(y * s) - Y0; const k = (py * W + px) * 4; return [img[k], img[k + 1], img[k + 2]]; };
  const violet = (d) => d[2] > 150 && d[0] > 110 && d[1] < d[2] - 40 && d[0] < d[2];
  const radii = [];
  for (let i = 0; i < 144; i++) {
    const a = (i / 144) * Math.PI * 2; let found = null;
    for (let r = 50; r <= 70; r += 0.5) { if (violet(at(cx + Math.cos(a) * r, cy + Math.sin(a) * r))) { found = r; break; } }
    if (found !== null) radii.push(found);
  }
  radii.sort((a, b) => a - b);
  const min = radii[Math.floor(radii.length * 0.05)], max = radii[Math.floor(radii.length * 0.95)];
  // timer arc at r 72: a violet pixel exists on the arc for frac 1
  let arcHit = false;
  for (let i = 0; i < 36 && !arcHit; i++) { const a = -Math.PI / 2 + (i / 36) * Math.PI * 2 * 0.9; if (violet(at(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72))) arcHit = true; }
  return { hits: radii.length, min, max, ratio: min && max ? min / max : null, arcHit, centre: [Math.round(cx), Math.round(cy)] };
});
P.check("shield = 9: violet stroke radius spans ~57 (edge midpoints) to ~66 (vertices): a hexagon, not a circle; timer arc present", hexa.hits >= 30 && hexa.max >= 63 && hexa.max <= 69 && hexa.min <= 60 && hexa.min >= 53 && hexa.arcHit, hexa);
await P.shot("shield-hex");

// ---- shield last 2 s: blink under full motion ----
const blink = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  g.player.shield = 1.5; g.tickPowerTimers = () => {};
  const pose = g._shipPose; const cx = pose.cx + pose.dx, cy = pose.cy + pose.bob;
  // violet energy of the ring band (r 58..76) in the top / bottom quadrants only (the hull's magenta stripes sit
  // inside r 50 vertically), one readback per sample
  const R = 80, X0 = Math.round((cx - R) * s), Y0 = Math.round((cy - R) * s), W = Math.round(2 * R * s);
  const sample = () => {
    const img = ctx.getImageData(X0, Y0, W, W).data; let v = 0, n = 0;
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
      const dx = (px + X0) / s - cx, dy = (py + Y0) / s - cy; const r = Math.hypot(dx, dy);
      if (r < 58 || r > 76 || Math.abs(dy) < r * 0.7) continue;
      const k = (py * W + px) * 4; v += Math.max(0, img[k + 2] - img[k + 1]); n++;
    }
    return Math.round(v / Math.max(1, n) * 10) / 10;
  };
  const vals = [];
  for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 50)); await new Promise(r => requestAnimationFrame(r)); vals.push(Math.round(sample())); }
  delete g.tickPowerTimers;
  return { vals, spread: Math.max(...vals) - Math.min(...vals) };
});
P.check("shield 1.5 s: the ring blinks (violet energy of the shield square varies by > 35 % across 700 ms)", blink.spread > 0.35 * Math.max(...blink.vals), blink);
await P.g(() => { const g = window.game; g.player.shield = 0; delete g.stepAmbient; delete g.drawStars; delete g.emitExhaust; delete g.spawnEnemy; g.save.settings.crt = true; g.applySettings(); });

// ---- shadowBlur budget: zero per frame over 180 frames, one bake when the ship changes ----
const shadow = await P.g(async () => {
  const S = window.__d4; S.frames = []; S.recording = true;
  await new Promise(r => setTimeout(r, 3100));
  const steady = Math.max(0, ...S.frames);
  S.frames = [];
  const g = window.game; const prev = g.player.shipId; g.player.shipId = prev === "honeybee" ? "sofrito" : "honeybee";
  await new Promise(r => setTimeout(r, 400));
  const swap = S.frames.slice();
  g.player.shipId = prev;
  await new Promise(r => setTimeout(r, 400));
  S.recording = false;
  return { steadyMax: steady, steadyFrames: S.frames.length, swapBakes: swap.filter((v) => v > 0).length, swapMax: Math.max(0, ...swap) };
});
P.check("shadowBlur: 0 per frame in steady play (180 frames); a ship swap bakes once (1 frame, 1 set)", shadow.steadyMax === 0 && shadow.swapBakes === 1 && shadow.swapMax === 1, shadow);

// ---- reduced motion: no exhaust, plume static, bob off, shield 1.5 constant ----
const rmCtx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr, reducedMotion: "reduce" });
const rmPage = await rmCtx.newPage();
const rmErrors = [];
rmPage.on("pageerror", (e) => rmErrors.push(String(e)));
await rmPage.goto(P.base, { waitUntil: "load" });
await rmPage.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 120000 });
await rmPage.fill("#playerName", "RM").catch(() => {});
await rmPage.click("#btnStart");
try { const st = rmPage.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.click(); } catch {}
await rmPage.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
await rmPage.waitForFunction(() => window.game.isLevelGateOpen() && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
const rm = await rmPage.evaluate(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  g.spawnEnemy = () => null; g.enemies.length = 0; g.particles.length = 0;
  let n = 0; const orig = g.pushParticle; g.pushParticle = function (p) { n++; return orig.call(this, p); };
  const poses = [];
  for (let i = 0; i < 20; i++) { await new Promise(r => requestAnimationFrame(r)); const p = g._shipPose; poses.push([p.bob, p.roll]); }
  await new Promise(r => setTimeout(r, 600));
  delete g.pushParticle;
  const bobbed = poses.some(([b, r]) => b !== 0 || r !== 0);
  // plume static: the plume rect must be identical across two frames with ambient frozen
  g.stepAmbient = () => {}; g.drawStars = () => {}; g.save.settings.crt = false; g.applySettings();
  g.player.shield = 1.5; g.player.shieldCap = 9; g.tickPowerTimers = () => {};
  const pose = g._shipPose; const noz = pose.nozzles.reduce((a, b) => (b.x < a.x ? b : a));
  const grab = () => {
    const cx = pose.cx + pose.dx, cy = pose.cy + pose.bob;
    const ring = ctx.getImageData(Math.round((cx - 76) * s), Math.round((cy - 76) * s), Math.round(152 * s), Math.round(152 * s)).data;
    const plume = ctx.getImageData(Math.round((noz.x - 44) * s), Math.round((noz.y - 12) * s), Math.round(40 * s), Math.round(24 * s)).data;
    return { ring, plume };
  };
  await new Promise(r => requestAnimationFrame(r));
  const A = grab();
  await new Promise(r => setTimeout(r, 100));
  await new Promise(r => requestAnimationFrame(r));
  const B = grab();
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
  return { exhaust: n, bobbed, ringDiff: diff(A.ring, B.ring), plumeDiff: diff(A.plume, B.plume), motion: g.fxMotion(), mq: matchMedia("(prefers-reduced-motion: reduce)").matches };
});
P.check("reduced motion: zero exhaust particles, no bob/roll, plume static and shield 1.5 constant across two frames 100 ms apart", rm.mq && rm.motion.anim === 0 && rm.exhaust === 0 && !rm.bobbed && rm.plumeDiff === 0 && rm.ringDiff === 0, rm);
P.check("reduced-motion page: no page errors", rmErrors.length === 0, rmErrors);
await rmCtx.close();
await P.finish();
