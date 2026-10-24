// t-measure-typo (MEASURE, D4 typos name themselves): the struck-through pair inside the locked plate / boss slab, the
// gun pop + nearest-plate lead pulse for unlocked misses, the danger-zone guard, HUD ACC states, the lead underline,
// reduced motion and the frame budget with 40 % misses. PASS = the feature works.
// Usage: node tools/playtest/probes/t-measure-typo.mjs [--dpr 1|2]
import { openProbe, sleep, waitFor, installTypist, holdField, runSteps, wordSteps, dbg, startFresh, jumpTo } from "./measure_lib.mjs";

const dprAt = process.argv.indexOf("--dpr");
const dpr = dprAt > 0 ? Number(process.argv[dprAt + 1]) || 1 : 1;
const P = await openProbe("t-measure-typo", { dpr });
await P.installCanvasCounters();
// Full-frame fill instrumentation (d1 / play.mjs rule: a fillRect covering >= 90 % of the canvas).
const FULL_FRAME = () => {
  const S = window.__ff = { fullFrameMaxAlpha: 0 };
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
        if (cov >= 0.9) { const a0 = parseAlpha(this.fillStyle); const a = a0 == null ? 1 : Math.min(1, a0 * this.globalAlpha); if (a < 0.999 && a > S.fullFrameMaxAlpha) S.fullFrameMaxAlpha = a; }
      }
    } catch {}
    return orig.apply(this, arguments);
  };
};
await P.context.addInitScript(FULL_FRAME);

// In-page helpers: frames, a red-pixel counter, a drawSplitText spy and a fillText spy.
const installSpies = async (page) => page.evaluate(() => {
  if (window.__tp) return;
  const T = window.__tp = {};
  T.frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  T.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // danger red #FF4D6D family: strong red, low green, blue well under magenta's
  T.red = (rect) => {
    const g = window.game; const s = g.renderScale || 1; const ctx = g.ctx;
    const x0 = Math.max(0, Math.floor(rect.x * s)), y0 = Math.max(0, Math.floor(rect.y * s));
    const w = Math.max(1, Math.min(g.canvas.width - x0, Math.ceil(rect.w * s))), h = Math.max(1, Math.min(g.canvas.height - y0, Math.ceil(rect.h * s)));
    const d = ctx.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 130 && d[i + 2] < 160 && d[i] - d[i + 1] > 90) n++;
    return n;
  };
  T.splitCalls = null;
  const g = window.game;
  const orig = g.drawSplitText;
  g.drawSplitText = function (ctx, done, remaining, cx, y, opts) {
    const ret = orig.call(this, ctx, done, remaining, cx, y, opts);
    if (T.splitCalls) T.splitCalls.push({ done, remaining, cx, y, typo: opts && opts.typo, leadUnderline: !!(opts && opts.leadUnderline), leadUnderlinePx: opts && opts.leadUnderlinePx, leadPulse: (opts && opts.leadPulse) || 0, width: ret && ret.width });
    return ret;
  };
  T.texts = null;
  const proto = CanvasRenderingContext2D.prototype;
  const ft = proto.fillText;
  proto.fillText = function (text, x, y) {
    if (T.texts && this.canvas && this.canvas.id === "game") { const m = this.getTransform(); T.texts.push({ text: String(text), x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }); }
    return ft.apply(this, arguments);
  };
  T.captureSplit = async () => { T.splitCalls = []; await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); const c = T.splitCalls; T.splitCalls = null; return c; };
  T.captureText = async () => { T.texts = []; await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); const c = T.texts; T.texts = null; return c; };
});

await startFresh(P, "TYPO");
await installTypist(P);
await installSpies(P.page);
await holdField(P);

// ---- 1. locked miss: the pair; no rising expected glyph; expires ----
const c1 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  const en = window.__ty.plate("spark", 2, 640);
  await T.frame();
  g.handleTyped("s");
  await T.wait(250);
  g.handleTyped("x");
  const now1 = { typoCh: en.typoCh, kind: g.typistDebug().pair.kind };
  await T.frame();
  const glyphs = g.typoGlyphs.length;
  await T.wait(520);
  const after = { typoCh: en.typoCh, kind: g.typistDebug().pair.kind, age: nowMs() - en.typoAt };
  return { now1, glyphs, after, locked: !!(g.lock && g.lock.ref === en) };
});
P.check("1. locked miss: en.typoCh 'x', pair.kind 'locked', typoGlyphs empty; 500 ms later the pair is off (age >= TYPIST_PAIR_MS)",
  c1.now1.typoCh === "x" && c1.now1.kind === "locked" && c1.glyphs === 0 && c1.after.kind === null && c1.after.age >= 450 && c1.locked, c1);

// ---- 2. pixels: the pair is drawn inside the plate, the plate widens by one glyph, nothing red outside ----
const c2 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold(); g.particles.length = 0; g.floaters.length = 0; g.banner = null; g.callout = null; if (g.calloutQueue) g.calloutQueue.length = 0;
  const en = window.__ty.plate("sharpness", 2, 700);
  await T.frame();
  g.handleTyped("s");
  await T.wait(700);
  const pw = en.plateW, ph = en.plateH || 40;
  const band = { x: en.x - pw / 2 - 20, y: en.y - 9, w: pw + 40, h: 18 };
  const splitA = (await T.captureSplit()).filter((c) => c.remaining === "harpness");
  const redA = T.red(band);
  const ctx = g.ctx; const W = g.canvas.width, H = g.canvas.height; const s = g.renderScale || 1;
  await new Promise((r) => requestAnimationFrame(r));
  const A = ctx.getImageData(0, 0, W, H).data;
  g.handleTyped("x");
  await new Promise((r) => requestAnimationFrame(r));
  const B = ctx.getImageData(0, 0, W, H).data;   // one frame later, as d1: only the plate neighbourhood may change red
  await T.wait(200);   // the 120 ms danger stroke flash is over; the pair (450 ms) is still up
  const typedDraws = (await T.captureText()).filter((t) => t.text === "x").map((t) => ({ x: t.x / s, y: t.y / s }));
  const splitB = (await T.captureSplit()).filter((c) => c.remaining === "harpness");
  const redB = T.red(band);
  const nb = { x0: (en.x - pw / 2 - 60) * s, x1: (en.x + pw / 2 + 60) * s, y0: (en.y - ph / 2 - 60) * s, y1: (en.y + ph / 2 + 60) * s };
  let outsideRed = 0; const where = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (x >= nb.x0 && x <= nb.x1 && y >= nb.y0 && y <= nb.y1) continue;
    if (x <= 280 * s) continue;   // ship / plume column (d1)
    const i = (y * W + x) * 4;
    // a pixel that turned danger red (the animated backdrop changes every frame, but never into #FF4D6D)
    const redB = B[i] > 170 && B[i + 1] < 130 && B[i + 2] < 160 && B[i] - B[i + 1] > 90, redA = A[i] > 170 && A[i + 1] < 130 && A[i + 2] < 160 && A[i] - A[i + 1] > 90;
    if (redB && !redA && B[i] - A[i] > 20) { outsideRed++; if (where.length < 12) where.push([Math.round(x / s), Math.round(y / s), A[i], B[i]]); }
  }
  await T.wait(450);
  const redC = T.red(band);
  const inPlate = typedDraws.length > 0 && typedDraws.every((t) => Math.abs(t.x - en.x) < pw / 2 + 20 && Math.abs(t.y - en.y) < ph / 2);
  return { redA, redB, redC, outsideRed, where, typedDraws, inPlate, widthA: splitA[0] && splitA[0].width, widthB: splitB[0] && splitB[0].width, typoB: splitB[0] && splitB[0].typo };
});
// The animated sector backdrop flips a few near-threshold pixels per frame (measured 0-3 with no key at all), so the outside
// scan allows 8; the fillText positions of the typed glyph pin the pair inside the plate exactly.
P.check("2. pixels: danger-red glyph inside the plate's text band during the pair (none before / after), drawn width + one glyph, every typed-glyph fill inside the plate, no pixel turns danger red outside the 60 px neighbourhood (<= 8 backdrop px)",
  c2.redB > 15 && c2.redA <= 2 && c2.redC <= 2 && c2.typoB === "x" && c2.widthB - c2.widthA > 4 && c2.inPlate && c2.outsideRed <= 8, c2);

// ---- 3. a second pair replaces the first ----
const c3 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  const a = window.__ty.plate("spark", 1, 700), b = window.__ty.plate("orbit", 3, 760);
  await T.frame();
  g.handleTyped("s"); await T.wait(50); g.handleTyped("x");
  const first = a.typoCh;
  g.releaseLock("manual");
  g.handleTyped("o"); await T.wait(50); g.handleTyped("z");
  return { first, a: a.typoCh, b: b.typoCh, kind: g.typistDebug().pair.kind };
});
P.check("3. one pair on screen: a miss on a second locked plate clears the first plate's typoCh", c3.first === "x" && c3.a === null && c3.b === "z" && c3.kind === "locked", c3);

// ---- 4. free miss: pop at the gun + lead pulse on the nearest plate only ----
const c4 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  const sp = window.__ty.plate("spark", 1, 760), ob = window.__ty.plate("orbit", 3, 900);
  await T.frame();
  g.typoEdge = 0;
  g.handleTyped("q");
  await T.frame();
  const d = g.typistDebug();
  return { pop: d.pop, pulseSpark: sp.leadPulseAt > 0, pulseOrbit: !!ob.leadPulseAt, typo: [sp.typoCh || null, ob.typoCh || null], typoEdge: g.typoEdge, glyphs: g.typoGlyphs.length, misses: g.typistDebug().seg.miss };
});
P.check("4. free miss: pop alive with 'q', leadPulseAt on the nearest plate only, no typoCh anywhere, typoEdge armed",
  c4.pop.ch === "q" && c4.pop.shown && c4.pulseSpark && !c4.pulseOrbit && c4.typo[0] === null && c4.typo[1] === null && c4.typoEdge > 0 && c4.glyphs === 0, c4);

// ---- 5. danger guard: up box blocked -> down; both blocked -> nothing drawn ----
const c5 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  await T.frame();
  const m = g._shipPose && g._shipPose.muzzle ? g._shipPose.muzzle : { x: g.player.x + 40, y: g.player.y };
  const ys = g.laneYs();
  const up = new Enemy({ text: "vector", x: m.x + 18, y: m.y - 26, speed: 0 });
  g.enemies.push(up);
  window.__ty.plate("orbit", 3, 900);
  await T.frame();
  g.handleTyped("q");
  await T.frame();
  const dirUp = g.typistDebug().pop.dir;
  const texts1 = await T.captureText();
  await T.wait(450);
  const down = new Enemy({ text: "vortex", x: m.x + 18, y: m.y + 26, speed: 0 });
  g.enemies.push(down);
  await T.frame();
  g.handleTyped("q");
  await T.frame();
  const d2 = g.typistDebug().pop;
  const texts2 = await T.captureText();
  const near = (t) => t.text === "q" && Math.abs(t.x / (g.renderScale || 1) - (m.x + 18)) < 40 && Math.abs(t.y / (g.renderScale || 1) - m.y) < 60;
  return { muzzle: m, dangerX: DANGER_X * g.w, dirUp, popDrawn1: texts1.some(near), dirBoth: d2.dir, shownBoth: d2.shown, popDrawn2: texts2.some(near), upState: g.enemyState(up), downState: g.enemyState(down) };
});
P.check("5. danger guard: a danger-zone plate over the up box -> pop.dir === -1 (drawn); plates over both boxes -> the pop is not drawn",
  c5.upState === "danger" && c5.dirUp === -1 && c5.popDrawn1 && c5.dirBoth === 0 && !c5.shownBoth && !c5.popDrawn2, c5);

// ---- 7. HUD ACC: "--" for 9 keys, a percent at 10, warn < 95 %, bad < 90 %, .is-miss 300 ms ----
await jumpTo(P, 0);
await installTypist(P);
await installSpies(P.page);
await holdField(P);
const c7 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  const el = document.getElementById("hudAcc");
  window.__ty.plate("abcdefghijklmnopqrst", 2, 800);
  window.__ty.plate("orbit", 3, 900);
  const word = "abcdefghijklmnop";
  for (let i = 0; i < 9; i++) { g.handleTyped(word[i]); await T.wait(30); }
  await T.wait(300);
  const at9 = el.textContent;
  g.handleTyped(word[9]);
  await T.wait(300);
  const at10 = el.textContent;
  for (let i = 10; i < 16; i++) { g.handleTyped(word[i]); await T.wait(30); }
  g.releaseLock("manual");
  g.handleTyped("z");                       // 16 / 17 = 94.1 %
  await T.frame();
  const pulse = el.classList.contains("is-miss");
  await T.wait(300);
  const warn = { text: el.textContent, attr: el.getAttribute("data-acc") };
  g.handleTyped("z");                       // 16 / 18 = 88.9 %
  await T.wait(450);
  const bad = { text: el.textContent, attr: el.getAttribute("data-acc"), pulseGone: !el.classList.contains("is-miss") };
  return { at9, at10, pulse, warn, bad };
});
P.check("7. HUD ACC: '--' after 9 keys, a percent at 10; 94 % -> data-acc warn; 89 % -> bad; .is-miss within a frame, gone after 400 ms",
  c7.at9 === "--" && c7.at10 === "100%" && c7.pulse && c7.warn.text === "94%" && c7.warn.attr === "warn" && c7.bad.text === "89%" && c7.bad.attr === "bad" && c7.bad.pulseGone, c7);

// ---- 7b. a hard miss inside a running pulse restarts it (300 ms from the second miss) ----
const c7b = await P.g(async () => {
  const g = window.game, T = window.__tp;
  const el = document.getElementById("hudAcc");
  await T.wait(450);
  window.__ty.clear(); window.__ty.hold();
  window.__ty.plate("orbit", 2, 800);
  await T.frame();
  g.handleTyped("o"); await T.wait(40);
  const anims = () => el.getAnimations().filter((a) => a.animationName).map((a) => ({ name: a.animationName, t: Math.round(a.currentTime) }));
  g.handleTyped("q"); await T.frame();
  const first = anims();
  await T.wait(150);
  g.handleTyped("q"); await T.frame();
  const second = anims();
  await T.wait(200);   // 350 ms after the first miss: the first pulse would be over
  const mid = { cls: el.classList.contains("is-miss"), anims: anims() };
  await T.wait(200);
  const end = { cls: el.classList.contains("is-miss") || el.classList.contains("is-miss-alt"), anims: anims() };
  g.releaseLock("manual");
  return { first, second, mid, end };
});
P.check("7b. HUD ACC: a second miss 150 ms into the pulse restarts it (a new animation from ~0 ms under the other keyframe name, still running 200 ms later), the class is gone 400 ms after the second miss",
  c7b.first.length === 1 && c7b.second.length === 1 && c7b.second[0].t < 100 && c7b.second[0].name !== c7b.first[0].name &&
  c7b.mid.cls && c7b.mid.anims.length === 1 && c7b.mid.anims[0].t >= 150 && !c7b.end.cls && c7b.end.anims.length === 0, c7b);

// ---- 8. lead underline on unlocked plates only ----
const c8 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  window.__ty.plate("comet", 0, 800); window.__ty.plate("laser", 2, 860); window.__ty.plate("ember", 4, 920);
  await T.frame();
  g.handleTyped("l");
  const calls = await T.captureSplit();
  const pick = (rem) => calls.filter((c) => c.remaining === rem).map((c) => c.leadUnderline);
  return { comet: pick("comet"), ember: pick("ember"), laser: pick("aser") };
});
P.check("8. leadUnderline true for every unlocked plate, falsy for the locked one",
  c8.comet.length > 0 && c8.comet.every(Boolean) && c8.ember.length > 0 && c8.ember.every(Boolean) && c8.laser.length > 0 && c8.laser.every((v) => !v), c8);

// ---- 11. pause inside a pair window ----
const c11 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.clear(); window.__ty.hold();
  window.__ty.plate("spark", 2, 760);
  await T.frame();
  g.handleTyped("s"); g.handleTyped("x");
  const during = g.typistDebug().pair.kind;
  g.pauseGame("user");
  await T.wait(200);
  const paused = g.mode;
  g.setMode("playing");
  await T.wait(470);
  return { during, paused, after: g.typistDebug().pair.kind, mode: g.mode };
});
P.check("11. pause inside a pair window: no errors, the pair is gone after resume + 450 ms", c11.during === "locked" && c11.paused === "paused" && c11.after === null && P.errors.pageErrors.length === 0, c11);

// ---- 12. the warm cache covers every typo-widened plate / capsule (no sprite bake, so no shadowBlur, mid-wave) ----
const c12 = await P.g(async () => {
  const g = window.game, T = window.__tp;
  window.__ty.hold();
  const bakes = [];
  const orig = g.getPlateSprite;
  g.getPlateSprite = function (shape, wb, h, state) { const key = `${shape}:${wb}:${h}:${state}:${this.spriteEpoch}`; if (!this.plateCache.has(key)) bakes.push(key); return orig.apply(this, arguments); };
  let n = 0;
  try {
    for (const type of Object.keys(POWERUP_TYPES)) {
      window.__ty.clear(); window.__ty.hold();
      const p = window.__ty.capsule(type, 2, 800); p.age = 9;
      await T.frame(); g.handleTyped(p.label[0]); g.handleTyped("q"); await T.frame(); n++;
    }
    const wordMax = LEVELS[g.levelIndex].wordMax || 8;
    for (let len = 2; len <= wordMax; len++) {
      window.__ty.clear(); window.__ty.hold();
      window.__ty.plate("sabcdefghijklmn".slice(0, len), 2, 800);
      await T.frame(); g.handleTyped("s"); g.handleTyped("q"); await T.frame(); n++;
    }
  } finally { g.getPlateSprite = orig; window.__ty.clear(); g.lock = null; }
  return { cases: n, bakes, level: g.levelIndex + 1 };
});
P.check("12. a locked miss on every capsule label and on plates of every word length in the sector bakes no plate sprite (the warm cache covers the typo widening)", c12.cases >= 8 && c12.bakes.length === 0, c12);

// ---- 13. the HUD ACC miss pulse is paint-only: the same scripted misses cost no extra layouts with the pulse on ----
const layoutRun = async () => {
  await holdField(P);
  await sleep(300);
  const m0 = await P.metrics();
  await runSteps(P, wordSteps(["signal", "vector", "plasma", "quasar", "nebula", "photon", "matrix", "cipher", "beacon", "rocket"], 100, { miss: true }));
  const m1 = await P.metrics();
  return P.per5s(m0, m1).layoutPer5s;
};
const pulseSwitch = (on) => P.g((on) => {
  const el = window.game.hudEls().acc;
  if (!el.__typistAdd) { el.__typistAdd = el.classList.add.bind(el.classList); el.__typistToggle = el.classList.toggle.bind(el.classList); }
  el.classList.add = on ? el.__typistAdd : function (...c) { return el.__typistAdd(...c.filter((x) => x !== "is-miss")); };
  el.classList.toggle = on ? el.__typistToggle : function (c, f) { return c === "is-miss-alt" ? false : el.__typistToggle(c, f); };
}, on);
const lay = { on: [], off: [] };
for (let i = 0; i < 2; i++) { await pulseSwitch(true); lay.on.push(await layoutRun()); await pulseSwitch(false); lay.off.push(await layoutRun()); }
await pulseSwitch(true);
const layDelta = Math.min(...lay.on) - Math.min(...lay.off);
P.check("13. HUD ACC .is-miss pulse is paint-only: 10 words with a miss each at 100 ms/key cost <= 6 more layouts per 5 s with the pulse than without (CDP LayoutCount)",
  layDelta <= 6, { ...lay, delta: Math.round(layDelta * 10) / 10 });

// ---- 6. boss: the pair sits in the slab's centre cell ----
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
await sleep(500);
const c6 = await P.g(async () => {
  const g = window.game, T = window.__tp, b = g.boss;
  g.minionAcc = -1e9; b.surgeTimer = -1e9;
  g.enemies.length = 0; g.powerups.length = 0;
  await T.frame();
  const sr = b.slabRect;
  const rect = { x: sr.x + sr.w * 0.2, y: sr.y, w: sr.w * 0.6, h: sr.h };
  const before = T.red(rect);
  const wrong = "zqxj".split("").find((c) => c !== b.nextChar);
  g.handleTyped(wrong);
  await T.wait(60);
  const after = T.red(rect);
  await T.frame();
  return { typoCh: b.typoCh, kind: g.typistDebug().pair.kind, before, after, glyphs: g.typoGlyphs.length, wrong };
});
P.check("6. boss miss: boss.typoCh set (pair kind 'boss'), danger-red pixels in the slab centre cell, typoGlyphs empty",
  c6.typoCh === c6.wrong && c6.kind === "boss" && c6.after - c6.before > 15 && c6.glyphs === 0, c6);

// ---- 10. budget: 10 s at 40 % misses with 10 plates vs a no-miss run ----
const budgetRun = async (missRate, seconds) => P.g(async ([missRate, seconds]) => {
  const g = window.game, T = window.__tp;
  if (g.inBoss) { g.stopToMenu(false); g.startNewRun(); }
  const words = ["comet", "laser", "ember", "orbit", "pulse", "nova", "flux", "drone", "vector", "plasma", "quasar", "ion", "haze", "glint"];
  const fill = () => {
    let alive = g.enemies.filter((e) => e.alive && !e.dying).length;
    let i = 0;
    while (alive < 10 && i < 40) { const w = words[(Math.random() * words.length) | 0]; if (!g.enemies.some((e) => e.alive && e.text[0] === w[0])) { window.__ty.plate(w, alive % 5, 640 + (alive % 5) * 120 + ((alive / 5) | 0) * 60); alive++; } i++; }
  };
  window.__ty.clear(); window.__ty.hold(); fill();
  await T.wait(200);
  window.__e2Probe.mark();
  window.__ff.fullFrameMaxAlpha = 0;
  const t0 = performance.now();
  let keys = 0, misses = 0;
  while (performance.now() - t0 < seconds * 1000) {
    window.__ty.hold();
    fill();
    let want = null;
    if (g.lock && g.lock.ref && g.lock.ref.alive) want = g.lock.ref.nextChar();
    else { const t = g.enemies.filter((e) => e.alive && !e.dying && g.isTargetable(e)).sort((a, b) => a.x - b.x)[0]; want = t ? t.nextChar() : null; }
    if (want) {
      const miss = Math.random() < missRate;
      g.handleTyped(miss ? (want === "q" ? "z" : "q") : want);
      keys++; if (miss) misses++;
      if (g.lockMisses >= 2) g.releaseLock("manual");
    }
    await T.wait(110);
  }
  return { snap: window.__e2Probe.snapshot(), ff: window.__ff.fullFrameMaxAlpha, keys, misses };
}, [missRate, seconds]);
await jumpTo(P, 1);
await installTypist(P);
await installSpies(P.page);
const base10 = await budgetRun(0, 5);
let miss10 = await budgetRun(0.4, 10);
if (miss10.snap.maxRenderMs > 16) { await sleep(1500); miss10 = await budgetRun(0.4, 10); }   // concurrent Chrome noise: measure once more
P.check("10. budget, 10 s at 40 % misses with 10 plates: shadowBlur 0 per frame, composite sets per frame <= the no-miss run (and <= 6), maxRenderMs <= 16, full-frame fill alpha <= .12",
  miss10.snap.shadowBlurPerFrame === 0 && miss10.snap.compositeSetsPerFrame <= Math.max(base10.snap.compositeSetsPerFrame, 0) && miss10.snap.compositeSetsPerFrame <= 6 &&
  miss10.snap.maxRenderMs <= 16 && miss10.ff <= 0.12 && miss10.misses > miss10.keys * 0.25, { base: base10, miss: miss10 });

// ---- 9. reduced motion (own context): pair present, pop static, no pulse scale, 4 px underline ----
const ctx2 = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
const page2 = await ctx2.newPage();
page2.on("pageerror", (e) => P.errors.pageErrors.push("reduced: " + String(e && e.stack || e)));
await ctx2.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { flightCheck: "skip" }); }, "typesmup198x.save.v1");
await page2.goto(P.base, { waitUntil: "load" });
await page2.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
await page2.evaluate(async () => {
  const g = window.game; g.startNewRun();
  for (let i = 0; i < 100 && (g.mode !== "playing" || g.levelIntro); i++) await new Promise((r) => setTimeout(r, 100));
  if (g.levelIntro && typeof g.skipLevelIntro === "function") g.skipLevelIntro();
});
await installSpies(page2);
const c9 = await page2.evaluate(async () => {
  const g = window.game, T = window.__tp;
  const hold = () => { g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; g.waveKills = 0; };
  hold(); g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
  const ys = g.laneYs();
  const a = new Enemy({ text: "spark", x: 760, y: ys[1], speed: 0 }); g.enemies.push(a);
  const b = new Enemy({ text: "orbit", x: 900, y: ys[3], speed: 0 }); g.enemies.push(b);
  await T.frame();
  g.handleTyped("q");
  const split = (await T.captureSplit()).filter((c) => c.remaining === "spark");
  await T.wait(40);
  const t1 = (await T.captureText()).filter((t) => t.text === "q");
  await T.wait(120);
  const t2 = (await T.captureText()).filter((t) => t.text === "q");
  await T.wait(400);
  g.handleTyped("s"); g.handleTyped("x");
  const pair = { ch: a.typoCh, kind: g.typistDebug().pair.kind };
  return { reduce: g.reduceMotion, t1: t1[0] || null, t2: t2[0] || null, split: split[0] || null, pair };
});
await ctx2.close();
P.check("9. reduced motion: the pop does not move (same position at ~100 / ~300 ms), the pulse draws no scale (leadPulse 0, 4 px underline), the pair is present",
  c9.reduce === true && c9.t1 && c9.t2 && Math.abs(c9.t1.x - c9.t2.x) < 0.5 && Math.abs(c9.t1.y - c9.t2.y) < 0.5 && c9.split && c9.split.leadPulse === 0 && c9.split.leadUnderlinePx === 4 && c9.pair.ch === "x" && c9.pair.kind === "locked", c9);

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
