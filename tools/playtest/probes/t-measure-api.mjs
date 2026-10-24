// t-measure-api (MEASURE, the contract other tracks consume, CONTRACT 2.2): typistSpeed scopes and their reuse, the
// typistInterval event, keyMiss attribution, stats / session shapes, typistEndSession mode bests (R17), cost, and the
// null-run (Flight Check) contract. PASS = the API behaves as documented.
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

// ---- 3. lifetime after a cleared sector; a new run resets run speed and the HUD ----
await holdField(P);
await runSteps(P, wordSteps(SIGNAL12, 180));
await clearBoss(P, { wpm: 80, accuracy: 0.99 });
await sleep(300);
const life = await P.g(() => ({ ...window.game.typistSpeed("lifetime"), speedN: window.game.save.profile.speedN, mode: window.game.mode }));
await P.g(() => { const g = window.game; g.stopToMenu(true); g.startNewRun(); });
await waitFor(P, () => window.game.mode === "playing", 10000);
await sleep(400);
const fresh = await P.g(() => ({ run: window.game.typistSpeed("run").n, hud: document.getElementById("hudWpm").textContent }));
P.check("3. after a cleared sector: lifetime wpm > 0 and n === profile.speedN; a new run starts with run n 0 and the HUD WPM reads '--'",
  life.mode === "levelComplete" && life.wpm > 0 && life.n === life.speedN && life.n > 60 && fresh.run === 0 && fresh.hud === "--", { life, fresh });

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
