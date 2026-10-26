// t-measure-api (MEASURE, the contract other tracks consume, CONTRACT 2.2): typistSpeed scopes and their reuse, the
// typistInterval event, keyMiss attribution, stats / session shapes, typistEndSession mode bests (R17), cost, the
// null-run (Flight Check) contract, and lead ruling Z12's acquisition gap (typistAcquireMs: the gap from a target's end
// to the next lock's first correct key, its run / lifetime EMAs, fallbacks and clamp; boss fights and a real Flight
// Check never feed it) with lead ruling Z14's blend before 10 samples ((n x run EMA + (10 - n) x lifetime, else 300) / 10).
// PASS = the API behaves as documented.
// Usage: node tools/playtest/probes/t-measure-api.mjs
import { openProbe, sleep, waitFor, installTypist, holdField, startFresh, clearBoss, wordSteps, runSteps, SIGNAL12 } from "./measure_lib.mjs";

const P = await openProbe("t-measure-api");
await startFresh(P, "API");
await installTypist(P);
await holdField(P);

// ---- 1. fresh save ----
const f = await P.g(() => {
  const g = window.game;
  const copy = (s) => ({ wpm: s.wpm, n: s.n });
  const out = {
    live: copy(g.typistSpeed("live")), run: copy(g.typistSpeed("run")), sector: copy(g.typistSpeed("sector")), lifetime: copy(g.typistSpeed("lifetime")),
    window: copy(g.typistWindowSpeed(2500)), weak: g.typistWeakKeys(), weakFrozen: Object.isFrozen(g.typistWeakKeys()), bigram: g.typistWeakBigram(), goal: g.typistGoal().text,
    speedForSame: JSON.stringify(copy(g.speedFor("run"))) === JSON.stringify(copy(g.typistSpeed("run"))) && JSON.stringify(copy(g.speedFor("lifetime"))) === JSON.stringify(copy(g.typistSpeed("lifetime"))),
    sessions: g.typistSessions(), days: g.typistDaysFlown(), lastMiss: g.typistLastMissAt(),
    consts: [typeof SPEED_GAP_MAX_MS, typeof TYPIST_PAIR_MS, typeof TYPIST_PULSE_MS, typeof typistMigrateProfile, SPEED_GAP_MAX_MS, TYPIST_PAIR_MS, TYPIST_PULSE_MS]
  };
  return out;
});
P.check("1. fresh save: live / run wpm null, lifetime {null, 0}, window n 0, weak keys [] (frozen), bigram null, goal 'NEXT GOAL · CLEAR SECTOR 1 ...', speedFor === typistSpeed, globals exported",
  f.live.wpm === null && f.run.wpm === null && f.lifetime.wpm === null && f.lifetime.n === 0 && f.window.n === 0 && Array.isArray(f.weak) && f.weak.length === 0 && f.weakFrozen &&
  f.bigram === null && f.goal.startsWith("NEXT GOAL · CLEAR SECTOR 1") && f.speedForSame && Array.isArray(f.sessions) && f.sessions.length === 0 && f.days === 0 && f.lastMiss === 0 &&
  f.consts.slice(0, 3).every((t) => t === "number") && f.consts[3] === "function" && f.consts[4] === 1500 && f.consts[5] === 450 && f.consts[6] === 300, f);

// ---- 2. 25 intervals at 200 ms ----
await P.g(() => {
  window.__ivs = null;
  onGameHook("typistInterval", function (e) { if (window.__ivs) window.__ivs.push({ ms: e.ms, kind: e.kind, t: e.t }); });
  window.__ivs = [];
});
await runSteps(P, wordSteps(SIGNAL12.slice(0, 5), 200));
const s2 = await P.g(() => {
  const g = window.game;
  const run = { ...g.typistSpeed("run") };
  const win = { ...g.typistWindowSpeed(2500) };
  const ivs = window.__ivs.slice();
  return { run, win, ivs: ivs.length, msOk: ivs.every((v) => v.ms >= 180 && v.ms <= 220), kinds: [...new Set(ivs.map((v) => v.kind))] };
});
await sleep(3000);
const s2b = await P.g(() => ({ ...window.game.typistWindowSpeed(2500) }));
P.check("2. 25 controlled intervals at 200 ms: run {n 25, 57-63 WPM}; window(2500) 57-63 right after and n 0 after 3 s idle; a typistInterval listener saw 25 events of 180-220 ms",
  s2.run.n === 25 && s2.run.wpm >= 57 && s2.run.wpm <= 63 && s2.win.wpm >= 57 && s2.win.wpm <= 63 && s2b.n === 0 && s2b.wpm === null && s2.ivs === 25 && s2.msOk && s2.kinds.join() === "enemy", { s2, s2b });

// ---- 4. keyMiss attribution for later listeners ----
const km = await P.g(async () => {
  const g = window.game;
  window.__km = null;
  onGameHook("keyMiss", function (e) { if (window.__km === null) window.__km = { expected: e.expected, claimed: e.claimed, locked: e.locked }; });
  window.__ty.clear(); window.__ty.hold();
  window.__ty.plate("spark", 1, 760); window.__ty.plate("orbit", 3, 900);
  await new Promise((r) => requestAnimationFrame(r));
  g.handleTyped("q");
  return window.__km;
});
P.check("4. an unlocked miss with 'spark' nearest and 'orbit': a keyMiss listener registered after MEASURE sees expected === 's' (and claimed)", km && km.expected === "s" && km.claimed === true && km.locked === false, km);

// ---- 5. shapes ----
const shapes = await P.g(() => {
  const g = window.game;
  const ks = g.typistKeyStats("s"), bs = g.typistBigramStats("si"), sb = g.typistScopeBigramMs("si");
  const es = g.typistEndSession({ mode: "drill" });
  const ee = g.typistEndSession({ mode: "endless", ceiling: 64 });
  const sess = g.typistSessions();
  const keysOf = (o) => Object.keys(o).sort().join();
  return {
    ks: keysOf(ks), bs: keysOf(bs), sbType: typeof sb, es: keysOf(es), esMode: es.mode, ee: ee.mode, ceiling: g.save.profile.bests.ceiling,
    sess: sess.map(keysOf), sessModes: sess.map((s) => s.mode), ksN: ks.n, bsN: bs.n, bsSegN: bs.segN
  };
});
const D6 = ["acc", "misses", "mode", "rank", "score", "sector", "speed", "steady", "t", "weak"].join();
P.check("5. shapes: typistKeyStats {n, err, ms, segN, segMiss}, typistBigramStats {n, ms, segN, segMs} ('si'), typistScopeBigramMs number, typistEndSession fields, typistSessions() objects with the ten D6 names; endless ceiling 64 -> bests.ceiling 64",
  shapes.ks === "err,ms,n,segMiss,segN" && shapes.bs === "ms,n,segMs,segN" && shapes.sbType === "number" && shapes.es === "acc,misses,mode,n,rank,score,sector,speed,steady,t,weak" &&
  shapes.esMode === "drill" && shapes.ee === "endless" && shapes.ceiling === 64 && shapes.sess.length === 2 && shapes.sess.every((k) => k === D6) && shapes.sessModes.join() === "drill,endless" &&
  shapes.ksN >= 5 && shapes.bsN >= 5 && shapes.bsSegN >= 5, shapes);

// ---- 6. reuse contract ----
const reuse = await P.g(() => {
  const g = window.game, ty = g._ty;
  const a = g.typistSpeed("live"), b = g.typistSpeed("sector"), c = g.typistWindowSpeed(10000);
  const w1 = g.typistWeakKeys(), w2 = g.typistWeakKeys();
  // a recompute that changes the result yields a new frozen array
  ty.kN[0] = 40; ty.kErr[0] = 0.3; ty.wStale = true; ty.wAt = -1e9;
  const w3 = g.typistWeakKeys();
  return { sameSpeed: a === b && b === c, sameWeak: w1 === w2, newWeak: w3 !== w1, w3: w3.slice(), frozen: Object.isFrozen(w3) };
});
P.check("6. reuse: typistSpeed / typistWindowSpeed return the same reused object; typistWeakKeys() is the same frozen array until a recompute changes it",
  reuse.sameSpeed && reuse.sameWeak && reuse.newWeak && reuse.w3[0] === "a" && reuse.frozen, reuse);

// ---- 7. cost ----
const cost = await P.g(() => {
  const g = window.game, ty = g._ty;
  for (let i = 0; i < 140; i++) g.typistAddInterval(ty, 150 + (i % 20), 18, 15, nowMs(), "probe");
  const ring = ty.rCount;
  let t0 = performance.now(), acc = 0;
  for (let i = 0; i < 1000; i++) acc += g.typistWindowSpeed(10000).n;
  const winMs = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < 1000; i++) acc += g.typistWeakKeys().length;
  const weakMs = performance.now() - t0;
  return { ring, winMs: Math.round(winMs * 1000) / 1000, weakMs: Math.round(weakMs * 1000) / 1000, acc };
});
P.check("7. cost: 1,000 x typistWindowSpeed(10000) over a full 128-entry ring and 1,000 x typistWeakKeys() take < 2 ms each", cost.ring === 128 && cost.winMs < 2 && cost.weakMs < 2, cost);

// ---- 8. null run (ONBOARD's Flight Check contract) ----
const nr = await P.g(async () => {
  const g = window.game;
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ty.clear(); window.__ty.hold();
  const before = { s: g.typistKeyStats("s").n, run: g.typistSpeed("run").n, sessions: g.save.profile.sessions.length, mode: g.runMode() };
  const keep = g.run;
  g.run = null;
  window.__ty.plate("sassy", 2, 800);
  for (const c of "sassy") { g.handleTyped(c); await T(200); }
  const after = { s: g.typistKeyStats("s").n, run: g.typistSpeed("run").n, sessions: g.save.profile.sessions.length, mode: g.runMode(), sector: g.typistSpeed("sector").n };
  g.run = keep;
  return { before, after };
});
P.check("8. this.run === null on a playing field: typing a plate raises key stats, leaves run speed and sessions unchanged, runMode() reads campaign, no page errors",
  nr.after.s === nr.before.s + 3 && nr.after.run === nr.before.run && nr.after.sessions === nr.before.sessions && nr.after.mode === "campaign" && P.errors.pageErrors.length === 0, nr);

// ---- 9. Z12 acquisition gap ----
await holdField(P);
const aq = await P.g(async () => {
  const g = window.game, ty = g.typistState();
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = window.__acqLog = [];
  const orig = g.typistAddAcquire;
  g.typistAddAcquire = function (t, ms) { log.push(ms); return orig.call(this, t, ms); };   // instance wrapper: sees every sample
  const dbg = () => g.typistDebug().acq;
  // checks 2-8 may have left a few samples (a kill drop's capsule counts as a lockable target); none reached 10
  const fresh = { ms: g.typistAcquireMs(), n: dbg().n, ema: ty.aqRunEma, same: ty.aqRunId === g.typistRunKey(), life: dbg().life, has: "acqEma" in g.save.profile };
  ty.aqRunId = null;   // the next sample restarts the run EMA (as a new run would)
  // (a) letter plates: each kill with another plate up opens a gap, the next first key closes it (13 letters, 12 gaps)
  window.__ty.clear(); window.__ty.hold();
  const letters = "qwertyuiopzxc", gaps = [400, 250, 600, 320, 180, 900, 450, 300, 520, 260, 700, 350];
  window.__ty.plate(letters[0], 1, 760); window.__ty.plate(letters[1], 3, 820);
  g.handleTyped(letters[0]);
  const at9 = {}, at10 = {};
  for (let i = 1; i < letters.length; i++) {
    if (i + 1 < letters.length) window.__ty.plate(letters[i + 1], i % 2 ? 2 : 4, 880);
    await T(gaps[i - 1]);
    g.handleTyped(letters[i]);
    if (log.length === 9) Object.assign(at9, { ms: g.typistAcquireMs(), life: g.save.profile.acqEma, n: dbg().n, ema: ty.aqRunEma });
    if (log.length === 10) Object.assign(at10, { ms: g.typistAcquireMs(), life: g.save.profile.acqEma, ema: ty.aqRunEma });
  }
  let ema = 0, life = 0;
  log.forEach((ms, k) => { ema = k ? ema + 0.1 * (ms - ema) : ms; if (k === 9) life = ema; else if (k > 9) life += 0.1 * (ms - life); });
  const a = { samples: log.map((ms) => Math.round(ms * 10) / 10), gaps: gaps.slice(), n: dbg().n, ema: ty.aqRunEma, ref: ema, lifeRef: life, life: g.save.profile.acqEma, ms: g.typistAcquireMs(), at9, at10 };
  const run = async (fn) => { const n0 = log.length; window.__ty.clear(); window.__ty.hold(); await fn(); await T(30); return { added: log.slice(n0), pending: dbg().pending }; };
  // (b) the field is empty when the target dies: nothing opens, a later plate's first key adds nothing
  const b = await run(async () => { window.__ty.plate("solo", 2, 800); for (const c of "solo") { g.handleTyped(c); await T(60); } window.__ty.plate("next", 2, 800); await T(300); g.handleTyped("n"); });
  // (c) a gap over 1.5 s is not counted
  const c = await run(async () => { window.__ty.plate("f", 1, 760); window.__ty.plate("g", 3, 820); g.handleTyped("f"); await T(1600); g.handleTyped("g"); });
  // (d) a manual release (Space / Backspace) ends the target: the next lock's first key closes the gap
  const d = await run(async () => { window.__ty.plate("comet", 1, 900); window.__ty.plate("laser", 3, 700); g.handleTyped("c"); await T(60); g.handleTyped("o"); await T(60); g.releaseLock("manual"); await T(350); g.handleTyped("l"); });
  // (e) a lost lock (three misses) ends it too
  const e = await run(async () => { window.__ty.plate("zulu", 1, 900); window.__ty.plate("kilo", 3, 700); g.handleTyped("z"); for (const m of "qqq") { await T(40); g.handleTyped(m); } await T(250); g.handleTyped("k"); });
  // (f) the locked target leaks: the gap opens at the leak
  const hp0 = g.player.hp;
  const f = await run(async () => { const dr = window.__ty.plate("drift", 1, 900); window.__ty.plate("orbit", 3, 700); g.handleTyped("d"); await T(60); g.handleTyped("r"); await T(60); g.leakEnemy(dr); await T(300); g.handleTyped("o"); });
  g.player.hp = hp0;
  // (g) a pause in between (modeChange) drops the pending gap
  const pz = await run(async () => { window.__ty.plate("h", 1, 760); window.__ty.plate("j", 3, 820); g.handleTyped("h"); await T(50); g.pauseGame("user"); g.setMode("playing"); await T(200); g.handleTyped("j"); });
  // (h) clamp and fallbacks: run EMA below / above the clamp; another run's id -> the lifetime EMA; no lifetime -> 300
  const before = g.typistAcquireMs();
  const keep = { ema: ty.aqRunEma, id: ty.aqRunId, life: g.save.profile.acqEma, mirror: ty.aqLife };
  ty.aqRunEma = 50; const lo = g.typistAcquireMs();
  ty.aqRunEma = 2000; const hi = g.typistAcquireMs();
  ty.aqRunEma = keep.ema; ty.aqRunId = "another-run";
  g.save.profile.acqEma = 640; const lifeOnly = g.typistAcquireMs();
  g.save.profile.acqEma = 1400; const lifeHi = g.typistAcquireMs();
  delete g.save.profile.acqEma; const none = g.typistAcquireMs();
  // (i) lead ruling Z14: this run's n samples (run EMA 250 / 600 / 100) against no lifetime value, 900, 200 and 1400
  const keepN = ty.aqRunN;
  ty.aqRunId = g.typistRunKey();
  const blend = [];
  for (const [ema, life] of [[250, null], [250, 900], [600, 200], [100, 1400]]) {
    if (life === null) delete g.save.profile.acqEma; else g.save.profile.acqEma = life;
    for (const n of [0, 1, 5, 9, 10, 12]) { ty.aqRunN = n; ty.aqRunEma = ema; blend.push({ ema, life, n, ms: Math.round(g.typistAcquireMs() * 1000) / 1000 }); }
  }
  ty.aqRunN = 5; ty.aqRunEma = 250; g.save.profile.acqEma = 900; ty.aqRunId = "another-run";
  const otherRun = g.typistAcquireMs();   // another run's 5 samples count as none: the lifetime value
  ty.aqRunN = keepN; ty.aqRunEma = keep.ema;
  ty.aqRunId = keep.id; if (keep.life === undefined) delete g.save.profile.acqEma; else g.save.profile.acqEma = keep.life; ty.aqLife = keep.mirror;
  return { fresh, a, b, c, d, e, f, pz, lo, hi, lifeOnly, lifeHi, none, before, blend, otherRun, back: g.typistAcquireMs() };
});
const within = (x, want, tol = 45) => typeof x === "number" && Math.abs(x - want) <= tol;
const clampAcq = (x) => Math.min(900, Math.max(120, x));
const freshWant = aq.fresh.same && aq.fresh.n > 0 ? clampAcq((aq.fresh.n * aq.fresh.ema + (10 - aq.fresh.n) * 300) / 10) : 300;   // Z14: earlier checks' samples blend with 300
P.check("9a. Z12 acquisition gap: fresh save, no profile.acqEma (300 ms, or Z14's blend with 300 of the few samples earlier checks left); 12 letter-to-letter gaps (another plate up at each kill) give 12 samples within 45 ms of the scripted gaps, the run EMA follows the alpha .1 recurrence; 9 samples -> Z14 (9 x run EMA + 300) / 10 and no lifetime field; the 10th writes profile.acqEma = the run EMA and typistAcquireMs() = it (clamped 120..900); later samples step the lifetime EMA",
  Math.abs(aq.fresh.ms - freshWant) < 1e-6 && aq.fresh.n < 10 && aq.fresh.life === null && !aq.fresh.has && aq.a.samples.length === 12 && aq.a.samples.every((ms, i) => within(ms, aq.a.gaps[i])) &&
  Math.abs(aq.a.ema - aq.a.ref) < 1e-6 && aq.a.n === 12 && Math.abs(aq.a.at9.ms - clampAcq((9 * aq.a.at9.ema + 300) / 10)) < 1e-6 && aq.a.at9.life === undefined && aq.a.at10.life === Math.round(aq.a.at10.ema) &&
  Math.abs(aq.a.at10.ms - Math.min(900, Math.max(120, aq.a.at10.ema))) < 1e-9 && aq.a.life === Math.round(aq.a.lifeRef) && Math.abs(aq.a.ms - Math.min(900, Math.max(120, aq.a.ref))) < 1e-6, aq.a);
P.check("9b. Z12 gaps: nothing when the field was empty at the kill; nothing over 1.5 s; a manual release (350 ms) and a lost lock (250 ms) open a gap closed by the next lock's first key; the locked plate leaking opens one (300 ms); a pause drops the pending gap",
  aq.b.added.length === 0 && !aq.b.pending && aq.c.added.length === 0 && !aq.c.pending && aq.d.added.length === 1 && within(aq.d.added[0], 350) &&
  aq.e.added.length === 1 && within(aq.e.added[0], 250) && aq.f.added.length === 1 && within(aq.f.added[0], 300) && aq.pz.added.length === 0 && !aq.pz.pending, { b: aq.b, c: aq.c, d: aq.d, e: aq.e, f: aq.f, pz: aq.pz });
P.check("9c. typistAcquireMs clamp and fallbacks: run EMA 50 -> 120, 2000 -> 900; another run's samples -> the lifetime EMA (640; 1400 -> 900); no lifetime -> 300",
  aq.lo === 120 && aq.hi === 900 && aq.lifeOnly === 640 && aq.lifeHi === 900 && aq.none === 300 && aq.back === aq.before, { lo: aq.lo, hi: aq.hi, lifeOnly: aq.lifeOnly, lifeHi: aq.lifeHi, none: aq.none, before: aq.before, back: aq.back });
// Z14 expected values, by hand: (n x run EMA + (10 - n) x (lifetime or 300)) / 10 before 10 samples, the run EMA from 10, clamped 120..900
const BLEND_WANT = {
  "250/none": [300, 295, 275, 255, 250, 250],   // no lifetime value: blended with 300
  "250/900": [900, 835, 575, 315, 250, 250],    // a stale stored 900 gives way sample by sample
  "600/200": [200, 240, 400, 560, 600, 600],
  "100/1400": [900, 900, 750, 230, 120, 120]    // clamp on both ends (a hand-edited 1400; a run EMA of 100)
};
const blendBad = aq.blend.filter((r) => { const want = BLEND_WANT[`${r.ema}/${r.life === null ? "none" : r.life}`][[0, 1, 5, 9, 10, 12].indexOf(r.n)]; return Math.abs(r.ms - want) > 1e-6; });
P.check("9d. Z14 blend before 10 samples: n = 0 / 1 / 5 / 9 / 10 / 12 at run EMA 250 with no lifetime -> 300 / 295 / 275 / 255 / 250 / 250, with a stored 900 -> 900 / 835 / 575 / 315 / 250 / 250; run EMA 600 over 200 -> 200 / 240 / 400 / 560 / 600 / 600; clamped (100 over 1400 -> 900 / 900 / 750 / 230 / 120 / 120); another run's 5 samples -> the lifetime value",
  aq.blend.length === 24 && blendBad.length === 0 && aq.otherRun === 900 && aq.back === aq.before, { bad: blendBad, blend: aq.blend.map((r) => `${r.ema}/${r.life}/n${r.n}:${r.ms}`).join(" "), otherRun: aq.otherRun });

// ---- 3. lifetime after a cleared sector; a new run resets run speed and the HUD ----
await holdField(P);
await runSteps(P, wordSteps(SIGNAL12, 180));
const acqBoss0 = await P.g(() => window.__acqLog.length);
await clearBoss(P, { wpm: 80, accuracy: 0.99 });
const acqBoss1 = await P.g(() => ({ samples: window.__acqLog.length, pending: window.game.typistDebug().acq.pending, mode: window.game.mode }));
P.check("10. Z12: a boss fight (forced boss, 80 WPM typist on segments and minions until the kill) adds no acquisition sample", acqBoss1.samples === acqBoss0 && !acqBoss1.pending && acqBoss1.mode === "levelComplete", { acqBoss0, acqBoss1 });
await sleep(300);
const life = await P.g(() => ({ ...window.game.typistSpeed("lifetime"), speedN: window.game.save.profile.speedN, mode: window.game.mode }));
await P.g(() => { const g = window.game; g.stopToMenu(true); g.startNewRun(); });
await waitFor(P, () => window.game.mode === "playing", 10000);
await sleep(400);
const fresh = await P.g(() => ({ run: window.game.typistSpeed("run").n, hud: document.getElementById("hudWpm").textContent }));
P.check("3. after a cleared sector: lifetime wpm > 0 and n === profile.speedN; a new run starts with run n 0 and the HUD WPM reads '--'",
  life.mode === "levelComplete" && life.wpm > 0 && life.n === life.speedN && life.n > 60 && fresh.run === 0 && fresh.hud === "--", { life, fresh });

// ---- 11. W4: a real Flight Check (lock, Space release with another plate up, the next lock) never feeds the gap ----
await P.g(() => window.game.stopToMenu(true));
await sleep(400);
const fc0 = await P.g(() => { const g = window.game; return { started: g.startFlightCheck(), samples: window.__acqLog.length, life: g.save.profile.acqEma, active: g.isFlightCheckActive() }; });
const fcWait = (fn, ms = 6000) => P.page.waitForFunction(fn, null, { timeout: ms }).then(() => true).catch(() => false);
const fcSteps = [];
fcSteps.push(await fcWait(() => { const s = window.game.flightCheckState(); return !!(s && s.step === 1 && s.plates[0] && s.plates[0].targetable); }));
await P.g(() => window.game.handleTyped("j"));
fcSteps.push(await fcWait(() => { const s = window.game.flightCheckState(); return !!(s && s.step === 2 && s.plates[0] && s.plates[0].targetable); }));
for (const k of "spark") { await P.g((c) => window.game.handleTyped(c), k); await sleep(60); }
fcSteps.push(await fcWait(() => { const s = window.game.flightCheckState(); return !!(s && s.step === 3 && s.plates[0] && s.plates[0].targetable); }));
await sleep(1300);
await P.g(() => window.game.handleTyped("c"));
fcSteps.push(await fcWait(() => { const s = window.game.flightCheckState(); return !!(s && s.plates.length === 2); }, 2000));
await sleep(80);
const fcMid = await P.g(() => { const g = window.game; g.releaseLock("manual"); return { pending: g.typistDebug().acq.pending, lock: g.lock }; });   // what Space does (30-input.js step 9)
await sleep(300);
for (const k of "laser") { await P.g((c) => window.game.handleTyped(c), k); await sleep(60); }
fcSteps.push(await fcWait(() => !window.game.flightCheck, 4000));
const fc1 = await P.g(() => { const g = window.game; return { samples: window.__acqLog.length, pending: g.typistDebug().acq.pending, life: g.save.profile.acqEma, result: g.flightCheckLastResult ? g.flightCheckLastResult() : null }; });
P.check("11. W4: a real Flight Check (j, spark, comet locked then released with laser up, laser) adds no acquisition sample and leaves profile.acqEma unchanged",
  fc0.started && fc0.active && fcSteps.every(Boolean) && fcMid.lock === null && !fcMid.pending && fc1.samples === fc0.samples && !fc1.pending && fc1.life === fc0.life &&
  !!fc1.result && fc1.result.result === "passed", { fc0, fcSteps, fcMid, fc1 });

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
