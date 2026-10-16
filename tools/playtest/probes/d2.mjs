// D2 acceptance: staged laser, three-pass beams, additive particles, shockwaves, bolts, debris, caps.
// PLAN D2 + CONTRACT section 7. Usage: node probes/d2.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d2-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

// Per-frame counters: globalCompositeOperation and shadowBlur setter calls (same rule as play.mjs).
await P.context.addInitScript(() => {
  const S = window.__d2 = { comp: 0, shadow: 0, frames: [], recording: false, maxComp: 0, maxShadow: 0 };
  const proto = CanvasRenderingContext2D.prototype;
  for (const [prop, key] of [["globalCompositeOperation", "comp"], ["shadowBlur", "shadow"]]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { if (key === "shadow" ? v > 0 : true) S[key]++; return d.set.call(this, v); } });
  }
  const tick = () => { if (S.recording) { S.frames.push([S.comp, S.shadow]); S.maxComp = Math.max(S.maxComp, S.comp); S.maxShadow = Math.max(S.maxShadow, S.shadow); } S.comp = 0; S.shadow = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

await P.goto("fresh");
await P.startRun("D2");
await page.waitForFunction(() => window.game.isLevelGateOpen && window.game.isLevelGateOpen() && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await sleep(200);

// ---- static sources ----
const srcs = await P.g(() => ({
  bulletsNoShadow: !/shadowBlur/.test(Game.prototype.drawBullets.toString()),
  particlesNoShadow: !/shadowBlur/.test(Game.prototype.drawParticles.toString()),
  api: ["addShockwave", "addBolt", "addDebris", "addMuzzleFlash", "drawRings", "drawBolts", "drawDebris", "onKeyFx", "onKillFx"].filter((n) => typeof window.game[n] !== "function"),
  classes: [typeof Bullet, typeof Ring, typeof Bolt, typeof Debris, typeof Particle],
  caps: typeof FX_CAPS === "object" ? FX_CAPS : null
}));
P.check("drawBullets / drawParticles contain no shadowBlur; D2 API + Ring/Bolt/Debris classes exist; FX_CAPS 24/600/4/10", srcs.bulletsNoShadow && srcs.particlesNoShadow && srcs.api.length === 0 && srcs.classes.every((t) => t === "function") && srcs.caps && srcs.caps.bullets === 24 && srcs.caps.particles === 600, srcs);

// ---- freeze ambient layers for pixel checks ----
await P.g(() => {
  const g = window.game;
  g.stepAmbient = () => {}; g.emitExhaust = () => {};
  g.save.settings.crt = false; g.applySettings();
  g.enemies.length = 0; g.powerups.length = 0; g.particles.length = 0; g.bullets.length = 0; g.explosions.length = 0; g.rings.length = 0; g.lock = null; g.trauma = 0;
  g.spawnEnemy = () => null; g.spawnPowerup = () => null; g.banner = null; g.callout = null; g.floaters.length = 0;
});
await sleep(100);

// ---- one correct key: bright cyan run from (player.x+22, player.y) toward the lock on the next frame ----
const beam = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  const en = new Enemy({ text: "beam", x: 760, y: 360, speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  g.handleTyped("b");
  const bullets = g.bullets.map((b) => ({ x: b.x, y: b.y, tx: b.tx, ty: b.ty, color: b.color, life: b.life, impact: b.impact }));
  const muzzles = g.muzzles.length;
  await new Promise(r => requestAnimationFrame(r));
  const x0 = g.player.x + 22, y0 = g.player.y, x1 = en.x, y1 = en.y;
  const samples = [];
  for (let u = 0.2; u <= 0.42; u += 0.02) {
    const x = Math.round((x0 + (x1 - x0) * u) * s), y = Math.round((y0 + (y1 - y0) * u) * s);
    let best = null;
    for (let dy = -3; dy <= 3; dy++) {
      const d = ctx.getImageData(x, y + dy, 1, 1).data;
      const lum = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
      if (!best || lum > best.lum) best = { lum, r: d[0], g: d[1], b: d[2] };
    }
    samples.push({ u: +u.toFixed(2), ...best, lit: best.lum > 200 && best.b > best.r && best.g > best.r });
  }
  const headT = g.bullets[0] ? g.bullets[0].headT() : null;
  return { bullets, muzzles, samples, lit: samples.filter((p) => p.lit).length, n: samples.length, headT, origin: [x0, y0] };
});
P.check("one correct key: beam from (player.x+22, player.y), muzzle flash queued, next frame shows a bright cyan run toward the lock (>= 70 % of samples at u .2-.42 lit)", beam.bullets.length >= 1 && beam.bullets[0].x === beam.origin[0] && beam.bullets[0].y === beam.origin[1] && beam.bullets[0].color === "cyan" && beam.muzzles >= 1 && beam.lit >= Math.ceil(beam.n * 0.7), { bullets: beam.bullets, muzzles: beam.muzzles, lit: beam.lit + "/" + beam.n, headT: beam.headT, samples: beam.samples.slice(0, 4) });
await P.shot("beam-frame");
await sleep(400);

// ---- staging numbers: life .15, head .035, tail .07; impact ring when the head arrives ----
const staging = await P.g(async () => {
  const g = window.game;
  g.bullets.length = 0; g.rings.length = 0;
  g.fireLaserTo(900, 300, "cyan");
  const b = g.bullets[0];
  const life = b.life;
  b.t = 0.017; const h1 = b.headT(), t1 = b.tailT();
  b.t = 0.035; const h2 = b.headT();
  b.t = 0.07; const t2 = b.tailT();
  b.t = 0.15; const t3 = b.tailT(), alive = b.alive();
  b.t = 0;
  for (let i = 0; i < 5; i++) await new Promise(r => requestAnimationFrame(r));   // head passes .035 after 3 updates; the clock sees it the frame after
  const ring = g.rings.find((r) => Math.abs(r.x - 900) < 1 && Math.abs(r.y - 300) < 1);
  return { life, h1, t1, h2, t2, t3, alive, arrived: b.arrived, ring: ring && { size: ring.size, r0: ring.r0, r1: ring.r1, life: ring.life, color: ring.color } };
});
P.check("Bullet: life .15, head at t/.035 (0.49 @17 ms, 1 @35 ms), tail 0 until 70 ms then detaches to 1 at .15; impact ring size 12 at the target when the head arrives", Math.abs(staging.life - 0.15) < 1e-9 && Math.abs(staging.h1 - 0.017 / 0.035) < 0.01 && staging.t1 === 0 && staging.h2 === 1 && staging.t2 === 0 && staging.t3 === 1 && !staging.alive && staging.arrived && staging.ring && staging.ring.size === 12 && Math.abs(staging.ring.life - 0.28) < 1e-9, staging);

// ---- beam colours follow the weapon; MULTI never recolours; lime never used ----
const tints = await P.g(() => {
  const g = window.game; const out = {};
  const fire = (label) => { g.bullets.length = 0; g.fireLaserTo(900, 300, g.power.multiplier > 0 ? "lime" : (g.power.spread > 0 ? "magenta" : "cyan")); out[label] = g.bullets.map((b) => b.color + (b.impact === false ? "*" : "")); };
  g.power = { spread: 0, pierce: 0, rapid: 0, multiplier: 0 }; fire("plain");
  g.power.multiplier = 5; fire("multi"); g.power.multiplier = 0;
  g.power.spread = 5; fire("spread"); g.power.spread = 0;
  g.power.pierce = 5; fire("pierce"); g.power.pierce = 0;
  g.power.rapid = 5; fire("rapid"); g.power.rapid = 0;
  g.bullets.length = 0;
  return out;
});
P.check("beam tints: plain cyan, MULTI cyan (no lime), SPREAD magenta + 2 side beams (no impact), PIERCE violet, RAPID cyan", tints.plain[0] === "cyan" && tints.multi[0] === "cyan" && tints.spread[0] === "magenta" && tints.spread.length === 3 && tints.spread[1] === "magenta*" && tints.pierce[0] === "violet" && tints.rapid[0] === "cyan" && !JSON.stringify(tints).includes("lime"), tints);

// ---- caps: bullets <= 24 under a burst, particles <= 600 ----
const caps = await P.g(() => {
  const g = window.game;
  g.bullets.length = 0; g.particles.length = 0;
  for (let i = 0; i < 40; i++) g.fireLaserTo(900 + i, 300, "cyan");
  const bullets = g.bullets.length;
  for (let i = 0; i < 12; i++) g.addExplosion(600, 300, 140);
  const particles = g.particles.length;
  g.bullets.length = 0; g.particles.length = 0;
  return { bullets, particles };
});
P.check("caps: 40 beams in one frame -> bullets.length <= 24; 12 x addExplosion(140) -> particles <= 600", caps.bullets <= 24 && caps.bullets >= 20 && caps.particles <= 600 && caps.particles >= 500, caps);

// ---- kill: rings[0].life .28, ring visible at r ~ 40 .1 s later, debris on medium ----
const kill = await P.g(async () => {
  const g = window.game; const ctx = g.ctx; const s = g.renderScale;
  g.enemies.length = 0; g.lock = null; g.rings.length = 0; g.particles.length = 0; g.explosions.length = 0; g.debris.length = 0; g.bullets.length = 0;
  const KX = 420, KY = 250;   // dark starfield: the "brighter than background by > 60" rule needs headroom
  const en = new Enemy({ text: "ringer", x: KX, y: KY, speed: 0 });
  g.enemies.push(en);
  await new Promise(r => requestAnimationFrame(r));
  // background luminance around the plate before the kill (ring radius band 30..50 px)
  const probeRing = () => {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2; let best = 0;
      for (let r = 30; r <= 50; r += 1) {
        const d = ctx.getImageData(Math.round((KX + Math.cos(a) * r) * s), Math.round((KY + Math.sin(a) * r) * s), 1, 1).data;
        best = Math.max(best, 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
      }
      out.push(best);
    }
    return out;
  };
  g.killEnemy(en);
  const ring0 = g.rings[0] && { life: g.rings[0].life, size: g.rings[0].size, color: g.rings[0].color };
  const debris = g.debris.length;
  const explosionType = g.explosions[0] && g.explosions[0].type;
  // isolate the ring: drop the sprite + particles so the band reads the ring alone
  g.explosions.length = 0; g.particles.length = 0; g.debris.length = 0;
  await new Promise(r => requestAnimationFrame(r));
  const bg = probeRing();   // white impact plate frame: ring still tiny; the band reads background (plate is inside r 30)
  await new Promise(r => setTimeout(r, 105));
  await new Promise(r => requestAnimationFrame(r));
  const ringR = g.rings[0] ? g.rings[0].radius() : null;
  const lit = probeRing();
  const brighter = lit.filter((v, i) => v - bg[i] > 60).length;
  return { ring0, debris, explosionType, ringR, brighter, bgMean: bg.reduce((a, b) => a + b, 0) / 16, litMean: lit.reduce((a, b) => a + b, 0) / 16 };
});
P.check("killEnemy: rings[0].life === .28 (size 20 cyan); ~.12 s later the ring (r ~ 36-42) is > 60 brighter than background on >= 10/16 angles", kill.ring0 && Math.abs(kill.ring0.life - 0.28) < 1e-9 && kill.ring0.size === 20 && kill.brighter >= 10, kill);
P.check("medium explosion spawns 2-4 debris shards (frame 16, gravity 520, .7 s)", kill.explosionType === "medium" && kill.debris >= 2 && kill.debris <= 4, { type: kill.explosionType, debris: kill.debris });
await P.shot("ring-frame");

// ---- RAPID chain: bolts.length >= 1 the frame of the key; SPREAD ring 160 magenta ----
const chain = await P.g(async () => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null; g.bolts.length = 0; g.rings.length = 0; g.bullets.length = 0;
  g.power = { spread: 0, pierce: 0, rapid: 9, multiplier: 0 };
  const a = new Enemy({ text: "alpha", x: 520, y: 320, speed: 0 });
  const b = new Enemy({ text: "arrow", x: 820, y: 456, speed: 0 });
  g.enemies.push(a, b);
  await new Promise(r => requestAnimationFrame(r));
  g.handleTyped("a");
  const bolts = g.bolts.length;
  const bolt = g.bolts[0] && { color: g.bolts[0].color, life: g.bolts[0].life, from: [g.bolts[0].x1, g.bolts[0].y1], to: [g.bolts[0].x2, g.bolts[0].y2], pts: g.bolts[0].pts.length };
  const bProgress = b.progress;
  await new Promise(r => requestAnimationFrame(r));
  g.power.rapid = 0;
  // SPREAD: completing a word rings 160 px magenta (the combat code calls addShockwave when it exists)
  g.enemies.length = 0; g.lock = null; g.rings.length = 0;
  g.power.spread = 9;
  const c = new Enemy({ text: "go", x: 700, y: 388, speed: 0 });
  const d = new Enemy({ text: "near", x: 760, y: 456, speed: 0 });
  g.enemies.push(c, d);
  await new Promise(r => requestAnimationFrame(r));
  g.handleTyped("g"); g.handleTyped("o");
  const spreadRing = g.rings.find((r) => r.size === 160);
  const secondary = !d.alive;
  g.power.spread = 0;
  await new Promise(r => requestAnimationFrame(r));
  return { bolts, bolt, bProgress, spreadRing: spreadRing && { size: spreadRing.size, color: spreadRing.color, r1: spreadRing.r1 }, secondary };
});
P.check("RAPID chain: correct key -> bolts.length >= 1 that frame (cyan, .12 s, target -> chained plate), chained plate advanced", chain.bolts >= 1 && chain.bolt && chain.bolt.color === "cyan" && Math.abs(chain.bolt.life - 0.12) < 1e-9 && chain.bProgress === 1, chain);
P.check("SPREAD kill: 160 px magenta shockwave and the neighbour destroyed as a secondary kill", !!chain.spreadRing && chain.spreadRing.color === "magenta" && chain.secondary, { spreadRing: chain.spreadRing, secondary: chain.secondary });

// ---- surge arc: danger bolt widens 2 -> 4 and flickers at 20 Hz ----
const surge = await P.g(async () => {
  const g = window.game;
  g.bolts.length = 0;
  const b = g.addBolt(900, 200, g.player.x + 20, g.player.y, "danger", 0.2);
  const w0 = b.width(); const pts0 = [...b.pts];
  b.t = 0.2; const w1 = b.width(); b.t = 0;
  await new Promise(r => setTimeout(r, 120));
  const changed = [...b.pts].some((v, i) => Math.abs(v - pts0[i]) > 0.01);
  return { color: b.color, w0, w1, changed, jitter: b.jitter, life: b.life };
});
P.check("surge bolt: danger, width 2 -> 4 over its life, points re-rolled (20 Hz flicker)", surge.color === "danger" && surge.w0 === 2 && surge.w1 === 4 && surge.changed && surge.jitter, surge);

// ---- composite / shadow budget over a 6 s typing burst ----
await P.g(() => { const g = window.game; delete g.stepAmbient; delete g.emitExhaust; delete g.spawnEnemy; delete g.spawnPowerup; g.spawnAcc = 0; g.powerAcc = 0; g.hungryT = 0; g.save.settings.crt = true; g.applySettings(); window.__d2.recording = true; });
await P.autoType(6, { accuracy: 0.95 });
const budget = await P.g(() => { const S = window.__d2; S.recording = false; return { frames: S.frames.length, maxComp: S.maxComp, maxShadow: S.maxShadow, kills: window.game.stats.kills }; });
P.check("6 s typing: globalCompositeOperation sets <= 6 per frame, shadowBlur 0 per frame", budget.maxComp <= 6 && budget.maxShadow === 0 && budget.frames > 200, budget);
await P.shot("typing");

// ---- finale: large sprites <= 4 / 10 total at every poll; no white-out ----
await P.forceBoss();
await sleep(400);
await P.g(() => { window.__d2.polls = []; window.__d2.recording = true; window.__d2.maxComp = 0; window.__d2.maxShadow = 0; window.__d2.poll = setInterval(() => { const g = window.game; if (g.bossClear) window.__d2.polls.push([g.explosions.filter((e) => e.type === "large").length, g.explosions.length, g.particles.length, g.debris.length, g.rings.length]); }, 30); });
await P.autoType(90, { until: (s) => s.bossClear || s.mode !== "playing" });
await sleep(900);
const fin = await P.g(() => {
  const g = window.game; const ctx = g.ctx; const W = g.canvas.width, H = g.canvas.height;
  const d = ctx.getImageData(0, 0, W, H).data; let white = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
  return { bossClear: !!g.bossClear, t: g.bossClear && +g.bossClear.t.toFixed(2), whiteFrac: white / (n / 4), timeScale: g.timeScale, slowMo: !!g.slowMo };
});
await P.shot("finale");
await page.waitForFunction(() => window.game.mode !== "playing", null, { timeout: 25000 }).catch(() => {});
const polls = await P.g(() => { clearInterval(window.__d2.poll); const S = window.__d2; S.recording = false; const p = S.polls; return { n: p.length, maxLarge: Math.max(0, ...p.map((r) => r[0])), maxTotal: Math.max(0, ...p.map((r) => r[1])), maxParticles: Math.max(0, ...p.map((r) => r[2])), maxDebris: Math.max(0, ...p.map((r) => r[3])), maxRings: Math.max(0, ...p.map((r) => r[4])), maxComp: S.maxComp, maxShadow: S.maxShadow }; });
P.check("finale: large explosion sprites <= 4 and <= 10 total at every poll; particles <= 600; composite sets <= 6; shadowBlur 0", polls.n > 10 && polls.maxLarge <= 4 && polls.maxTotal <= 10 && polls.maxParticles <= 600 && polls.maxComp <= 6 && polls.maxShadow === 0, polls);
P.check("finale frame: near-white pixel fraction < 8 % (no white-out)", fin.bossClear && fin.whiteFrac < 0.08, fin);
P.note("fps.finale >= 55 at DPR 2", "harness: node play.mjs --dpr 2 --scenario all (report.fps.finale)");
await P.finish();
