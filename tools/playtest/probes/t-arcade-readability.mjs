// t-arcade-readability (ARCADE D12, ~40 s, DPR 2): the word-kill explosion set (medium frames at .55; small / medium /
// large unchanged, the finale keeps medium 1.0), the enemy -> set mapping, the draw order (smoke frames under the plates,
// flash frames on top, dying plates source-over), a kill next to a live plate keeping that plate's text readable, the
// lane rail stroke alpha .20, the kill ring 26 / word hit-stop .055, and the frame budget of a 6 s burst of kills.
// PASS = the feature works; exits 1 on any fail or page / console error.
import { openProbe, sleep, waitFor, installTypist, freshControlled } from "./measure_lib.mjs";

const P = await openProbe("t-arcade-readability", { dpr: 2 });
await P.installCanvasCounters();
await P.context.addInitScript(() => {
  // translucent full-frame fills (the opaque L0 base fill excluded), as play.mjs measures fullFrameFillMaxAlpha
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
await freshControlled(P, "READ");
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// 1. Explosion sets
const t1 = await P.g(() => JSON.parse(JSON.stringify(EXPLOSION_SETS)));
P.check("1. EXPLOSION_SETS.kill = medium frames, flash [9,7], scale .55, frameTime .06; small .9 / medium 1.0 / large 1.15 unchanged",
  JSON.stringify(t1.kill.frames) === JSON.stringify(t1.medium.frames) && JSON.stringify(t1.kill.flashFrames) === "[9,7]" && t1.kill.scale === 0.55 && t1.kill.frameTime === 0.06
  && t1.small.scale === 0.9 && t1.medium.scale === 1.0 && t1.large.scale === 1.15, t1);

// 2. Mapping; the finale keeps medium 1.0 and large 1.15
const t2 = await P.g(() => {
  const g = window.game;
  const en = (text, kind = "enemy") => new Enemy({ text, x: 600, y: 300, speed: 0, lane: 2, kind });
  const map = { spark: g.getExplosionTypeForEnemy(en("spark")), abc: g.getExplosionTypeForEnemy(en("abc")), j: g.getExplosionTypeForEnemy(en("j")), minion: g.getExplosionTypeForEnemy(en("qz", "bossMinion")), killScale: new ExplosionSprite({ x: 0, y: 0, type: "kill" }).scale };
  g.explosions.length = 0;
  g.bossFinaleOrigin = { x: 900, y: 360, w: 400, h: 300 };
  g.runBossFinaleBurst({ kind: "medium" });
  const med = g.explosions.map((e) => ({ type: e.type, scale: e.scale }));
  g.explosions.length = 0;
  g.runBossFinaleBurst({ kind: "shock" });
  const large = g.explosions.map((e) => ({ type: e.type, scale: e.scale }));
  g.explosions.length = 0; g.rings.length = 0; g.particles.length = 0; g.debris.length = 0;
  g.bossFinaleOrigin = null;
  return { map, med, large };
});
P.check("2. getExplosionTypeForEnemy: 'spark' -> kill (.55), 'abc' / 'j' / a minion -> small; a finale medium burst stays medium 1.0, a shock burst large 1.15",
  t2.map.spark === "kill" && t2.map.abc === "small" && t2.map.j === "small" && t2.map.minion === "small" && t2.map.killScale === 0.55 && t2.med.length === 3 && t2.med.every((e) => e.type === "medium" && e.scale === 1) && t2.large.length >= 1 && t2.large.every((e) => e.type === "large" && e.scale === 1.15), t2);

// 3. Draw order in one frame: smoke drawFrame calls before the first drawEnemy, flash frames after the last one,
//    drawDyingPlates under source-over
await P.g(() => {
  const g = window.game;
  window.__ty.clear(); window.__ty.hold();
  window.__ty.plate("neighbor", 2, 640); window.__ty.plate("another", 3, 820);
  g.explosions.length = 0;
  const smoke = g.addExplosionSprite(640, 360, "kill"); smoke.frameIndex = 4; smoke.perFrame = 1e9;
  const flash = g.addExplosionSprite(820, 300, "kill"); flash.frameIndex = 0; flash.perFrame = 1e9;
  const O = window.__ord = { log: [], on: false, done: null };
  const dfr = ExplosionSprite.prototype.drawFrame;
  ExplosionSprite.prototype.drawFrame = function (ctx) { if (O.on) O.log.push(this.isFlash() ? "flash" : "smoke"); return dfr.apply(this, arguments); };
  const de = g.drawEnemy;
  g.drawEnemy = function () { if (O.on) O.log.push("enemy"); return de.apply(this, arguments); };
  const dd = g.drawDyingPlates;
  g.drawDyingPlates = function (ctx) { if (O.on) O.log.push("dying:" + ctx.globalCompositeOperation); return dd.apply(this, arguments); };
  const r = g.render;
  g.render = function () { O.log = []; O.on = true; try { return r.apply(this, arguments); } finally { O.on = false; if (!O.done && O.log.length) O.done = O.log.slice(); } };
});
await waitFor(P, () => !!window.__ord.done, 3000);
const t3 = await P.g(() => window.__ord.done);
const firstEnemy = t3.indexOf("enemy"), lastEnemy = t3.lastIndexOf("enemy");
const smokeIdx = t3.map((x, i) => x === "smoke" ? i : -1).filter((i) => i >= 0), flashIdx = t3.map((x, i) => x === "flash" ? i : -1).filter((i) => i >= 0);
const dying = t3.filter((x) => x.startsWith("dying:"));
P.check("3. one frame: every smoke drawFrame precedes the first drawEnemy, flash frames follow the last drawEnemy, drawDyingPlates runs under source-over",
  firstEnemy >= 0 && smokeIdx.length >= 1 && smokeIdx.every((i) => i < firstEnemy) && flashIdx.length >= 1 && flashIdx.every((i) => i > lastEnemy) && dying.length === 1 && dying[0] === "dying:source-over", t3);
await P.g(() => { const g = window.game; g.explosions.length = 0; window.__ty.clear(); });

// 4. Pixels: kill a word ~90 px from a live plate; 100 ms later the neighbour's text keeps >= 80 % of its bright pixels
const band = () => P.g(() => {
  const g = window.game, s = g.renderScale, en = g.enemies.find((e) => e.text === "neighbor");
  const w = Math.ceil((en.textW || 90) + 12), h = 26;
  const X = Math.round((en.x - w / 2) * s), Y = Math.round((en.y - h / 2) * s), W = Math.round(w * s), H = Math.round(h * s);
  const d = g.ctx.getImageData(X, Y, W, H).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 170) n++;
  return n;
});
await P.g(() => { const g = window.game; window.__ty.hold(); window.__ty.plate("neighbor", 2, 700); window.__ty.plate("blaster", 3, 760); g.trauma = 0; });
await sleep(400);
const pre = await band();
await P.g(() => { const g = window.game; const en = g.enemies.find((e) => e.text === "blaster"); g.killEnemy(en); g.trauma = 0; });
await sleep(100);
await P.g(() => { window.game.trauma = 0; });
await new Promise((r) => setTimeout(r, 16));
const post = await band();
await P.shot("kill-next-to-plate");
const t4 = await P.g(() => ({ type: window.game.explosions.map((e) => e.type), dist: Math.round(Math.hypot(60, LANE_YS[3] - LANE_YS[2])) }));
P.check("4. a 'kill'-set explosion ~90 px from a live plate: 100 ms later the neighbour's text band keeps >= 80 % of its bright glyph pixels", pre > 100 && post >= 0.8 * pre && t4.type.includes("kill"), { pre, post, ratio: Math.round(post / Math.max(1, pre) * 100) / 100, ...t4 });
await P.g(() => { const g = window.game; g.explosions.length = 0; window.__ty.clear(); });

// 5. Lane rails: stroke alpha .20 under the existing fade
await P.g(() => { window.__ty.hold(); window.__ty.plate("rails", 2, 900); });
await sleep(700);
const t5 = await P.g(() => ({ k: RAIL_STROKE_ALPHA, dbg: window.game.debug.railStrokeAlpha, railAlpha: window.game.railAlpha, drawn: window.game.debug.railsDrawn }));
P.check("5. RAIL_STROKE_ALPHA === 0.2; with plates alive debug.railStrokeAlpha === 0.2 x max(railAlpha, .35)", t5.k === 0.2 && t5.drawn && near(t5.dbg, 0.2 * Math.max(t5.railAlpha, 0.35), 0.02), t5);

// 6. Ring 26 / hit-stop .055 on a word kill, ring 12 on a letter
const t6 = await P.g(async () => {
  const g = window.game;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  window.__ty.clear();
  const w = window.__ty.plate("ringer", 2, 600), l = window.__ty.plate("k", 4, 600);
  await frame(); await frame();   // drawn once (plateW measured), as any real target is before it dies
  g.rings.length = 0; g.hitStop = 0;
  g.killEnemy(w);
  const word = { ring: g.rings[g.rings.length - 1] && g.rings[g.rings.length - 1].size, hitStop: g.hitStop };
  g.rings.length = 0; g.hitStop = 0;
  g.killEnemy(l);
  const letter = { ring: g.rings[g.rings.length - 1] && g.rings[g.rings.length - 1].size, hitStop: g.hitStop };
  return { tokens: { ring: FX_MOTION.ring.kill, hitStop: FX_MOTION.hitStop.word }, word, letter };
});
P.check("6. FX_MOTION.ring.kill 26, hitStop.word .055; a word kill's ring 26 with hit-stop .055, a letter's ring 12", t6.tokens.ring === 26 && t6.tokens.hitStop === 0.055 && t6.word.ring === 26 && near(t6.word.hitStop, 0.055) && t6.letter.ring === 12, t6);

// 7. 6 s burst: 10 plates kept up and killed in turn (kill set, rings, debris): budgets
await sleep(500);   // the check-6 plates finish dying first
await P.g(() => {
  const g = window.game;
  window.__ty.clear(); window.__ty.hold();
  const words = ["comets", "nebula", "photon", "quasar", "pulsar", "vortex", "plasma", "ignite", "fusion", "galaxy"];
  for (let i = 0; i < 10; i++) window.__ty.plate(words[i], i % 5, 520 + (i % 5) * 140 + (i >= 5 ? 60 : 0));
  window.__burst = { words, i: 0 };
  window.__ff.on = true; window.__ff.max = 0;
  window.__e2Probe.mark();
  window.__burst.timer = setInterval(() => {
    const B = window.__burst, live = g.enemies.filter((e) => e.alive && !e.dying);
    if (live.length) g.killEnemy(live[B.i++ % live.length]);
    const n = g.enemies.filter((e) => e.alive && !e.dying).length;
    for (let k = n; k < 10; k++) window.__ty.plate(B.words[(B.i + k) % 10], (B.i + k) % 5, 520 + ((B.i + k) % 5) * 140);
    window.__ty.hold();
  }, 120);
});
await sleep(6000);
const t7 = await P.g(() => { clearInterval(window.__burst.timer); window.__ff.on = false; return { ...window.__e2Probe.snapshot(), ffMax: Math.round(window.__ff.max * 1000) / 1000, kills: window.game.stats.kills }; });
P.check("7. 6 s burst of word kills with 10 plates (DPR 2): compositeSetsPerFrame <= 6, shadowBlurPerFrame 0, translucent full-frame fills <= .12, maxRenderMs <= 16",
  t7.frames > 200 && t7.compositeSetsPerFrame <= 6 && t7.shadowBlurPerFrame === 0 && t7.ffMax <= 0.12 && t7.maxRenderMs <= 16 && t7.kills >= 40, t7);

P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
await P.finish();
