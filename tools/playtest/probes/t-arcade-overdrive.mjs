// t-arcade-overdrive (ARCADE D11 Overdrive, ~3 min, DPR 1 + a fresh-pilot and a reduced-motion context): the
// threshold relative to the pilot (25 fresh, 1.05 x run speed; a first Overdrive started at the provisional floor meets
// the real T and ends by the slow rule, lead ruling Z2), activation from MEASURE's honest intervals at 100 WPM, x1.25 on
// kill / bossChar / segment only, white-hot beams / amber floaters / plume x2 / the arc, vent on a miss / a leak (hiss,
// announce, steam), the slow exit, holding through pause and an empty field, a silent charge reset, the silent end on a
// boss kill and the reset at the next sector, the card note, no per-key save writes, scripted input never charging,
// reduced motion, drill (a real MODES drill, a daily as the control) / Flight Check blocking, the typed-array state and heap growth. Keys go through
// game.handleTyped(ch) from a setTimeout chain scheduled on performance.now() (exact intervals). PASS = the feature
// works; exits 1 on any fail or page / console error.
import { openProbe, sleep, waitFor, installTypist, freshControlled } from "./measure_lib.mjs";
import { harnessFlags } from "./_lib.mjs";

const P = await openProbe("t-arcade-overdrive");
await freshControlled(P, "OVERDRIVE");

// ---- page-side recorders and the runner (target object T = { g(fn, arg) }) ----
async function installOd(T) {
  await T.g(() => {
    if (window.__od) return;
    const g = window.game;
    const O = window.__od = { ev: [], ann: [], keyT: [], score: [], lasers: [], floaters: [], frames: [], sample: false, snaps: [], store: 0, countStore: false, steam: [], pushes: 0 };
    onGameHook("overdrive", function (e) {
      O.ev.push({ on: e.on, reason: e.reason, ms: e.ms, t: performance.now(), cue: this.sfx.lastCue, titles: [this.callout && this.callout.title, ...(this.calloutQueue || []).map((c) => c.title)], ann: O.ann[O.ann.length - 1] || "",
        T: this._od ? this._od.threshold : null, provisional: this._od ? this._od.provisional : null });
    });
    onGameHook("keyCorrect", function (e) { if (O.keyT.length < 6000) O.keyT.push(e.t); });
    const wrap = (name, fn) => { const o = g[name]; g[name] = function () { return fn.call(this, o, arguments); }; };
    wrap("announce", function (o, a) { O.ann.push(String(a[0])); if (O.ann.length > 300) O.ann.shift(); return o.apply(this, a); });
    wrap("addScore", function (o, a) {
      const on = this.overdriveOn === true, mult = this.scoringMult();
      const r = o.apply(this, a);
      if (O.score.length < 3000) O.score.push({ amount: a[0], kind: a[1] && a[1].kind, gained: r, on, mult });
      return r;
    });
    wrap("fireLaserTo", function (o, a) {
      const on = this.overdriveOn === true;
      const r = o.apply(this, a);
      const b = this.bullets[this.bullets.length - 1], m = this.muzzles[this.muzzles.length - 1];
      if (O.lasers.length < 3000) O.lasers.push({ on, hot: b && b.hot, width: b && b.width, color: b && b.color, muzzle: m && m.color, li: this.levelIndex });
      return r;
    });
    wrap("addFloater", function (o, a) { if (O.floaters.length < 3000) O.floaters.push({ text: String(a[2]), color: a[3], on: this.overdriveOn === true, mult: this.stats.mult | 0 }); return o.apply(this, a); });
    wrap("pushParticle", function (o, a) { O.pushes++; return o.apply(this, a); });
    wrap("odSteam", function (o, a) { const n = O.pushes; const r = o.apply(this, a); O.steam.push(O.pushes - n); return r; });
    const si = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { if (O.countStore) O.store++; return si.apply(this, arguments); };
    const frame = () => {
      if (O.sample && O.frames.length < 4000) { const S = g._od; O.frames.push({ t: performance.now(), on: g.overdriveOn === true, len: g.debug.plumeLen, arcDraws: S ? S.arcDraws : 0, arcAlpha: S ? S.arcAlpha : 0, charge: S ? S.charge : 0 }); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // steps: [{at, ch} | {at, plate, lane, x} | {at, capsule} | {at, hold: true} | {at, snap: label} | {at, clear: true}]
    window.__odrun = (steps) => new Promise((resolve) => {
      const T = window.__ty;
      let i = 0;
      const t0 = performance.now();
      const doStep = (s) => {
        if (s.hold) T.hold();
        else if (s.clear) T.clear();
        else if (s.plate) T.plate(s.plate, s.lane == null ? 2 : s.lane, s.x == null ? null : s.x);
        else if (s.capsule) T.capsule(s.capsule, s.lane == null ? 2 : s.lane);
        else if (s.snap) { const S = g._od; O.snaps.push({ label: s.snap, t: performance.now(), on: g.overdriveOn === true, charge: S.charge, burst: S.burst, threshold: S.threshold, count: S.count, clock: S.clock, reason: S.lastReason, cue: g.sfx.lastCue, ev: O.ev.length, ann: O.ann.length, run: typeof g.typistSpeed === "function" ? { ...g.typistSpeed("run") } : null }); }
        else if (s.ch) g.handleTyped(s.ch);
      };
      const next = () => {
        while (i < steps.length) {
          const s = steps[i];
          const wait = t0 + s.at - performance.now();
          if (wait > 0.5) { setTimeout(next, wait); return; }
          i++;
          try { doStep(s); } catch (e) { console.error("__odrun", e); }
        }
        resolve(performance.now() - t0);
      };
      next();
    });
  });
}
const PoolW = ["skylines", "galaxies", "moonbeam", "starship", "sunbeams", "crossbow", "stardust", "daylight", "airships", "overcast", "midnight", "pinwheel", "keyboard", "sapphire", "lanterns", "monorail"];
let wi = 0;
const nextWords = (n) => Array.from({ length: n }, () => PoolW[(wi++) % PoolW.length]);
// Typing plan: each word is pushed as a plate just before its first key; extra = [{ afterWord, steps(t) }].
// gap: extra ms between two words, with the next plate already up (a between-target pause inside the 600 ms grace: the
// arc keeps filling, no interval is added), so MEASURE's 20th interval comes later than a fresh pilot's first activation.
function plan(words, ms, { start = 40, hold = true, gap = 0 } = {}) {
  const steps = [];
  let t = start;
  words.forEach((w, i) => {
    const up = t;
    if (i && gap) t += gap;
    if (hold) steps.push({ at: up - 20, hold: true });
    steps.push({ at: up - 10, plate: w });
    for (const ch of w) { steps.push({ at: t, ch }); t += ms; }
  });
  return { steps, end: t };
}
// A fresh pilot's first Overdrive (checks 2 and 2b): three words at 120 ms / key (100 WPM) with 400 ms between words
// activate it at ~2.5 s while T is the provisional 25 WPM floor, before the 20th interval (~3.7 s); the next words at
// 90 ms / key (133 WPM) keep it on once T meets 1.05 x the run speed (Z2), whatever the timer jitter.
function firstOdPlan() {
  const a = plan(nextWords(3), 120, { gap: 400 });
  const b = plan(nextWords(2), 90, { start: a.end + 120 });
  return { steps: [...a.steps, ...b.steps], end: b.end };
}
const run = (T, steps) => T.g((s) => window.__odrun(s), steps);
const od = (T = P) => T.g(() => { const S = window.game._od; return { on: window.game.overdriveOn === true, charge: S.charge, burst: S.burst, threshold: S.threshold, count: S.count, clock: S.clock, reason: S.lastReason, ventT: S.ventT, activations: S.activations }; });
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
await installOd(P);

// 1. API: fields, fresh threshold 25, a stubbed run speed of 60 (n 50) -> 63
const t1 = await P.g(() => {
  const g = window.game, S = g.overdriveState();
  const fields = ["enabled", "on", "charge", "below", "threshold", "burst", "clock", "open", "chainLive", "endAt", "ms", "head", "count", "runN", "runMs", "ventT", "activations", "lastReason", "arcDraws", "arcAlpha"].filter((k) => !(k in S));
  const fresh = { T: g.odThreshold(), S: S.threshold, run: g.pilotWpm("run"), life: g.pilotWpm("lifetime"), base: g.pilotWpm("base") };
  const orig = g.typistSpeed;
  g.typistSpeed = function (scope, w) { if (scope === "run") return { wpm: 60, n: 50 }; return orig.call(this, scope, w); };
  const stub = { T: g.odThreshold(), run: g.pilotWpm("run") };
  g.typistSpeed = function (scope, w) { if (scope === "run") return { wpm: 60, n: 19 }; return orig.call(this, scope, w); };
  const stubFew = { run: g.pilotWpm("run"), T: g.odThreshold() };
  delete g.typistSpeed;
  return { missing: fields, typed: S.endAt instanceof Float64Array && S.ms instanceof Float64Array, fresh, stub, stubFew, measure: typeof g.typistSpeed === "function", flags: { mul: OVERDRIVE.scoreMul, kinds: Object.keys(OVERDRIVE.scoreKinds) } };
});
P.check("1. overdriveState() fields; fresh threshold 25 (no run / lifetime speed); stubbed run 60 (n 50) -> pilotWpm('run') 60 and threshold 63; n 19 -> run ignored (25)",
  t1.missing.length === 0 && t1.typed && t1.fresh.T === 25 && t1.fresh.S === 25 && t1.fresh.run === null && t1.fresh.base === null && t1.stub.run === 60 && near(t1.stub.T, 63) && t1.stubFew.run === null && t1.stubFew.T === 25 && t1.measure, t1);

// 2-4. Run A on a fresh pilot (T 25): 100 WPM words (firstOdPlan), a SHIELD capsule and more words at 133 WPM
await P.g(() => { window.__od.sample = true; window.__od.frames.length = 0; window.__od.keyT.length = 0; });
const A1 = firstOdPlan();
const capT = A1.end;
const capSteps = [{ at: capT - 20, hold: true }, { at: capT - 10, capsule: "SHIELD" }, ...[..."shield"].map((ch, k) => ({ at: capT + k * 90, ch }))];
const A2 = plan(nextWords(4), 90, { start: capT + 6 * 90 });
await run(P, [...A1.steps, ...capSteps, ...A2.steps]);
await P.g(() => { window.__od.sample = false; });
const A = await P.g(() => { const O = window.__od; return { ev: O.ev.slice(), key2: O.keyT[1], ann: O.ann.slice(), frames: O.frames.slice(), lasers: O.lasers.slice(), floaters: O.floaters.slice(), score: O.score.slice(), on: window.game.overdriveOn === true }; });
const act = A.ev.find((e) => e.on);
const actS = act ? (act.t - A.key2) / 1000 : null;
P.check("2. 100 WPM on a fresh pilot: OVERDRIVE 2.0-3.2 s after the second key; OVERDRIVE callout, announce 'Overdrive.', sfx overdrive, overdrive {on: true, reason burst}",
  !!act && actS >= 2.0 && actS <= 3.2 && act.reason === "burst" && act.titles.includes("OVERDRIVE") && /^Overdrive\./.test(act.ann) && act.cue === "overdrive" && A.on,
  { afterSecondKeyS: actS && Math.round(actS * 1000) / 1000, event: act && { reason: act.reason, cue: act.cue, titles: act.titles, ann: act.ann }, stillOn: A.on });

const killOn = A.score.filter((s) => s.kind === "kill" && s.on), killOff = A.score.filter((s) => s.kind === "kill" && !s.on);
const word8 = 60 + 12 * 8;
const killOk = killOn.length >= 3 && killOn.every((s) => near(s.amount, word8 * 1.2 * s.mult, 1e-6) && s.gained === Math.round(s.amount * 1.25))
  && killOff.length >= 1 && killOff.every((s) => s.gained === Math.round(s.amount));
const pick = A.score.filter((s) => s.kind === "pickup");
const pickOk = pick.length === 1 && pick[0].on && pick[0].amount === 100 * pick[0].mult && pick[0].gained === pick[0].amount;
// perfect-wave bonus while active (kind bonus, never multiplied)
const pw = await P.g(() => {
  const g = window.game, O = window.__od;
  const on = g.overdriveOn === true;
  const n = O.score.length;
  // PACE (D3) pays PERFECT WAVE only when the wave ends by quota: force the end at the (paced) quota.
  g.waveDmg = 0; g.waveKills = Math.max(1, g.waveKills | 0, g.waveQuota()); g.wavePhase = "spawn";
  g.endWave();
  window.__ty.hold();
  const b = O.score.slice(n).filter((s) => s.kind === "bonus");
  return { on, bonus: b, want: Math.round(SCORE.perfectWave(1) * SCORE.retryMul(g.levelStats.retries | 0)) };
});
P.check("3a. score in Overdrive: clean 8-letter kills gain round(SCORE.word(8) x 1.2 x mult x 1.25) (x1 before it), the SHIELD pickup exactly 100 x mult, a forced perfect wave exactly round(250 L x retryMul)",
  killOk && pickOk && pw.on && pw.bonus.length === 1 && pw.bonus[0].gained === pw.want,
  { killsOn: killOn.slice(0, 3), killsOff: killOff.slice(0, 2), pickup: pick, perfect: pw });

const lasOn = A.lasers.filter((l) => l.on), lasOff = A.lasers.filter((l) => !l.on);
const lasOk = lasOn.length >= 10 && lasOn.every((l) => l.hot === true && near(l.width, (3 + 0.7 * l.li) * 1.6) && l.muzzle === "text") && lasOff.length >= 5 && lasOff.every((l) => l.hot === false && near(l.width, 3 + 0.7 * l.li));
const fOn = A.floaters.filter((f) => /^\+/.test(f.text) && f.on), fOff = A.floaters.filter((f) => /^\+/.test(f.text) && !f.on && f.mult < 4);
const actAt = act ? act.t : 0;
const before = A.frames.filter((f) => !f.on && f.t >= actAt - 1000 && f.t < actAt), after = A.frames.filter((f) => f.on && f.t > actAt && f.t <= actAt + 1000);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const plumeRatio = mean(after.map((f) => f.len)) / Math.max(1e-6, mean(before.map((f) => f.len)));
const arcGrow = after.length > 2 && after[after.length - 1].arcDraws > after[0].arcDraws;
await P.shot("overdrive");
P.check("4. visuals: hot main beams 1.6x wide ((3 + .7 li) x 1.6) with a white muzzle in Overdrive (3 px, not hot before), amber kill floaters (tier colour before), plume >= 1.9x, arc drawn every frame",
  lasOk && fOn.length >= 3 && fOn.every((f) => f.color === "amber") && fOff.length >= 1 && fOff.every((f) => f.color !== "amber") && plumeRatio >= 1.9 && arcGrow,
  { lasersOn: lasOn.length, sampleOn: lasOn[0], sampleOff: lasOff[0], floatersOn: fOn.slice(0, 2), floatersOff: fOff.slice(0, 2), plumeRatio: Math.round(plumeRatio * 100) / 100, frames: [before.length, after.length], arcDraws: after.length && [after[0].arcDraws, after[after.length - 1].arcDraws] });

// 1b. With MEASURE present pilotWpm('run') is typistSpeed('run').wpm (n >= 20 now)
const t1b = await P.g(() => { const g = window.game; const s = g.typistSpeed("run"); return { pilot: g.pilotWpm("run"), wpm: s.wpm, n: s.n }; });
P.check("1b. MEASURE present: pilotWpm('run') === typistSpeed('run').wpm once n >= 20", t1b.n >= 20 && t1b.pilot === t1b.wpm && t1b.wpm > 60, t1b);

// 5. Vent on a hard miss: synchronous end, reason miss, hiss, announce, vent arc, 10 steam particles
const t5 = await P.g(() => {
  const g = window.game, O = window.__od, S = g._od;
  const on0 = g.overdriveOn === true, evN = O.ev.length, steamN = O.steam.length;
  window.__ty.plate("zzzz", 2);
  g.handleTyped("q");
  const r = { on0, on: g.overdriveOn === true, reason: S.lastReason, ventT: S.ventT, ventDanger: S.ventDanger, ev: O.ev.slice(evN), steam: O.steam.slice(steamN) };
  window.__ty.clear();
  return r;
});
P.check("5. hard miss in Overdrive: overdriveOn false at once, lastReason miss, sfx overdriveVent, announce 'Overdrive vented.', vent arc (ventT > 0, danger), 10 steam particles",
  t5.on0 && !t5.on && t5.reason === "miss" && t5.ventT > 0 && t5.ventDanger && t5.ev.length === 1 && !t5.ev[0].on && t5.ev[0].cue === "overdriveVent" && t5.ev[0].ann === "Overdrive vented." && t5.steam.length === 1 && t5.steam[0] === 10, t5);

// 6. Vent on a leak (the threshold now follows the pilot: 1.05 x run speed; 160 WPM clears it)
const T6 = await P.g(() => { const g = window.game; g._od.threshold = g.odThreshold(); return g._od.threshold; });
await run(P, plan(nextWords(5), 75).steps);
const t6a = await od();
await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; window.__ty.plate("leak", 2, g.player.x + 30); });
await sleep(150);
const t6 = await od();
await P.g(() => window.__ty.clear());
P.check("6. a leak in Overdrive vents it (next frame lastReason leak); the threshold followed the pilot (1.05 x run speed)", t6a.on && !t6.on && t6.reason === "leak" && T6 > 60 && near(T6, Math.max(25, 1.05 * t1b.wpm), 40), { threshold: Math.round(T6 * 10) / 10, before: t6a, after: t6 });

// 7. Slow exit: active at 160 WPM, then 300 ms / key (< 0.9 T) -> ends 'slow' 1.0-3.5 s after the slowdown
await P.g(() => { const g = window.game; g._od.threshold = g.odThreshold(); });
const C1 = plan(nextWords(5), 75);
const C2 = plan(["slowerslowerslower", "dragonflies"], 300, { start: C1.end });
const slowAt = C1.end;
await run(P, [...C1.steps, { at: slowAt - 1, snap: "slow" }, ...C2.steps]);
const t7 = await P.g((n0) => { const O = window.__od; const snap = O.snaps.find((s) => s.label === "slow"); const off = O.ev.slice(snap ? snap.ev : 0).find((e) => !e.on); return { snap, off, T: window.game._od.threshold }; });
const slowS = t7.off && t7.snap ? (t7.off.t - t7.snap.t) / 1000 : null;
P.check("7. slowing to 300 ms / key (40 WPM < 0.9 T) ends Overdrive with lastReason slow 1.0-3.5 s after the slowdown (vent cue)",
  t7.snap && t7.snap.on && t7.off && t7.off.reason === "slow" && slowS >= 1.0 && slowS <= 3.5 && t7.off.cue === "overdriveVent", { T: t7.snap && Math.round(t7.snap.threshold), onAtSlowdown: t7.snap && t7.snap.on, endS: slowS && Math.round(slowS * 100) / 100, reason: t7.off && t7.off.reason });
await P.g(() => window.__ty.clear());

// From here the threshold is pinned with a stubbed run speed of 60 WPM (T 63), so later checks do not depend on how
// fast the probe itself typed so far.
await P.g(() => {
  const g = window.game, orig = Game.prototype.typistSpeed;
  g.typistSpeed = function (scope, w) { if (scope === "run") return { wpm: 60, n: 50 }; return orig.call(this, scope, w); };
  g._od.threshold = g.odThreshold();
});

// 8. Holds: pause 2 s, then an empty field for 1.5 s: still active, the engaged clock does not move
await run(P, plan(nextWords(6), 90).steps);
const t8 = await P.g(async () => {
  const g = window.game, S = g._od;
  window.__ty.hold();
  const on0 = g.overdriveOn === true;
  g.togglePause();
  const paused = g.mode === "paused";
  await new Promise((r) => setTimeout(r, 2000));
  const onPaused = g.overdriveOn === true;
  g.togglePause();
  const onResumed = g.overdriveOn === true && g.mode === "playing";
  const c0 = S.clock;
  await new Promise((r) => setTimeout(r, 1500));
  return { on0, paused, onPaused, onResumed, onEmpty: g.overdriveOn === true, clock: [c0, S.clock], enemies: g.enemies.filter((e) => e.alive).length, texts: g.enemies.filter((e) => e.alive).map((e) => e.text + ":" + e.kind + ":" + Math.round(e.x)), wave: [g.wave, g.wavePhase, g.waveKills, Math.round(g.spawnAcc), g.levelT, g.waveT], reason: S.lastReason };
});
P.check("8. holds: active -> pause 2 s -> still active after resume; empty field 1.5 s -> still active, engaged clock unchanged",
  t8.on0 && t8.paused && t8.onPaused && t8.onResumed && t8.onEmpty && t8.clock[0] === t8.clock[1] && t8.enemies === 0, t8);

// 12. No per-key save writes: localStorage.setItem calls in 5 s of typing in Overdrive
await P.g(() => { window.__od.store = 0; window.__od.countStore = true; });
const evBefore12 = await P.g(() => window.__od.ev.length);
await run(P, plan(nextWords(7), 90).steps);
const t12 = await P.g((n) => { const O = window.__od; O.countStore = false; return { store: O.store, on: window.game.overdriveOn === true, offs: O.ev.slice(n).filter((e) => !e.on).length, keys: 7 * 8 }; }, evBefore12);
P.check("12. 5 s of typing (56 keys) in Overdrive: <= 4 localStorage.setItem calls (the 1.5 s autosave only), Overdrive held throughout", t12.store <= 4 && t12.on && t12.offs === 0, t12);

// 9. A miss while charging resets the charge silently (no hiss, no announcement, no event)
await P.g(() => { window.game.setOverdriveEnabled(false); window.game.setOverdriveEnabled(true); });
const F = plan(["abcdefghijklmnop"], 75);
const F2 = F.steps.slice(0, 2 + 13);   // hold + plate + 13 keys
await run(P, [...F2, { at: F2[F2.length - 1].at + 30, snap: "pre9" }, { at: F2[F2.length - 1].at + 40, ch: "q" }, { at: F2[F2.length - 1].at + 50, snap: "post9" }]);
const t9 = await P.g(() => { const O = window.__od; const pre = O.snaps.find((s) => s.label === "pre9"), post = O.snaps.find((s) => s.label === "post9"); return { pre, post, ev: O.ev.slice(pre.ev), ann: O.ann.slice(pre.ann) }; });
await P.g(() => window.__ty.clear());
P.check("9. a hard miss while charging (charge > .3, not active): charge 0, no overdriveVent cue, no announcement, no overdrive event",
  t9.pre && !t9.pre.on && t9.pre.charge > 0.3 && t9.post.charge === 0 && !t9.post.on && t9.post.cue !== "overdriveVent" && t9.ev.length === 0 && !t9.ann.includes("Overdrive vented."),
  { preCharge: t9.pre && Math.round(t9.pre.charge * 100) / 100, postCharge: t9.post && t9.post.charge, cue: t9.post && t9.post.cue, events: t9.ev.length, ann: t9.ann });

// 3b / 10 / 11. Into the sector 1 boss in Overdrive (held through the approach and the intro), boss letters x1.25, the kill
// ends it silently, the card note, the next sector resets the meter
await run(P, plan(nextWords(4), 90).steps);
const onBeforeBoss = (await od()).on;
await P.g(() => { const g = window.game; g.levelT = LEVELS[0].duration + 0.01; });
await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
const bossIn = await P.g(() => { const g = window.game; g.minionAcc = -1e9; g.enemies.length = 0; return { on: g.overdriveOn === true, segs: g.boss.segments.slice(g.boss.segmentIndex), n: window.__od.score.length, evN: window.__od.ev.length, annN: window.__od.ann.length }; });
const bossSteps = [];
{ let t = 40; for (const s of bossIn.segs) for (const ch of s) { bossSteps.push({ at: t, ch }); t += 100; } }
await run(P, bossSteps);
const tb = await P.g(([n, evN, annN]) => { const O = window.__od, g = window.game; return { score: O.score.slice(n), ev: O.ev.slice(evN), ann: O.ann.slice(annN), reason: g._od.lastReason, on: g.overdriveOn === true, bossClear: !!g.bossClear, ventT: g._od.ventT, odMs: g.levelStats.overdriveMs }; }, [bossIn.n, bossIn.evN, bossIn.annN]);
const bcOn = tb.score.filter((s) => s.kind === "bossChar" && s.on), segOn = tb.score.filter((s) => s.kind === "segment" && s.on), bonusOn = tb.score.filter((s) => s.kind === "bonus");
P.check("3b. boss letters in Overdrive gain round(10 x mult x 1.25), segments round(30 len x mult x 1.25); phase bonuses x1 (entered the boss in Overdrive: held through approach and intro)",
  onBeforeBoss && bossIn.on && bcOn.length >= 10 && bcOn.every((s) => s.amount === 10 * s.mult && s.gained === Math.round(s.amount * 1.25)) && segOn.length >= 2 && segOn.every((s) => s.gained === Math.round(s.amount * 1.25)) && bonusOn.every((s) => s.gained === Math.round(s.amount)),
  { onBeforeBoss, onAtUnlock: bossIn.on, bossChars: bcOn.length, sample: bcOn[0], segments: segOn.slice(0, 2), bonus: bonusOn.slice(0, 2) });
const offEv = tb.ev.filter((e) => !e.on);
P.check("10a. the boss kill ends Overdrive silently: lastReason boss, no vent (no hiss, no 'Overdrive vented.', ventT 0)",
  tb.bossClear && !tb.on && tb.reason === "boss" && offEv.length === 1 && offEv[0].reason === "boss" && offEv[0].cue !== "overdriveVent" && !tb.ann.includes("Overdrive vented.") && tb.ventT === 0, { reason: tb.reason, ev: tb.ev, ann: tb.ann.slice(-3) });
await waitFor(P, () => window.game.bossClear && window.game.bossClear.t >= 2.1, 5000);
await P.page.keyboard.press("Enter");
await waitFor(P, () => window.game.mode === "levelComplete", 5000);
await sleep(300);
const t11 = await P.g(() => { const g = window.game, r = g.lastResults; const li = document.querySelector('#resultsLevel .resultsNote[data-note="overdrive"]'); return { ms: g.levelStats.overdriveMs, notes: r.notes, s: r.overdriveS, dom: li && li.textContent, ann: window.__od.ann.slice(-2) }; });
const n11 = (t11.notes || []).find((n) => n.id === "overdrive");
const want11 = Math.round(t11.ms / 1000);
P.check("11. card: levelStats.overdriveMs > 1000 -> results.overdriveS = round(ms / 1000), note OVERDRIVE n S (+aria) in the DOM and the announcement",
  t11.ms > 1000 && t11.s === want11 && !!n11 && n11.text === `OVERDRIVE ${want11} S` && n11.aria === `Overdrive: ${want11} seconds.` && t11.dom === n11.text && t11.ann.some((a) => a.includes(n11.aria)), t11);
await P.page.click("#btnNextLevel");
await waitFor(P, () => window.game.mode === "playing" && window.game.levelIndex === 1, 8000);
const t10b = await od();
P.check("10b. the next sectorStart resets the meter: charge 0, ring count 0, off", t10b.charge === 0 && t10b.count === 0 && !t10b.on, t10b);

// 13. Scripted input: 20 synchronous handleTyped chars, then 3 s with a target on screen -> nothing charges
await waitFor(P, () => !window.game.levelIntro, 6000);
await P.g(() => { window.__ty.clear(); window.__ty.hold(); window.game.setOverdriveEnabled(false); window.game.setOverdriveEnabled(true); window.game.odReset(false); });
const t13a = await P.g(() => { const g = window.game; window.__ty.plate("abcdefghijklmnopqrst", 2); for (const ch of "abcdefghijklmnopqrst") g.handleTyped(ch); window.__ty.plate("waiting", 2); return { count: g._od.count }; });
await sleep(3000);
const t13 = await od();
await P.g(() => window.__ty.clear());
P.check("13. 20 synchronous handleTyped keys, then 3 s with a target up: no interval reaches the burst ring (count 0), never charges", t13a.count === 0 && t13.count === 0 && t13.charge === 0 && !t13.on, { afterBurst: t13a, after3s: t13 });

// 13b. A fast burst then a pause never charges to full: 6 keys at 150 ms (80 WPM) on a fresh pilot's threshold (T pinned
//      at the 25 WPM floor: the d4 scenario, where the open-interval burst stays above T for ~2 s of the pause), then 2 s
//      idle with the plate still up: the arc drains instead of filling (it charges only while the pilot types), no activation
await P.g(() => { window.__ty.clear(); window.__ty.hold(); window.game.odReset(false); window.game._od.threshold = OVERDRIVE.floorWpm; window.__od.frames.length = 0; window.__od.sample = true; });
await run(P, [{ at: 10, plate: "heatwave" }, ...[..."heatwa"].map((ch, k) => ({ at: 40 + k * 150, ch }))]);
const T13b = await P.g(() => window.game._od.threshold);
await sleep(2000);
const t13b = await P.g(() => { const O = window.__od; O.sample = false; const ch = O.frames.map((f) => f.charge); return { peak: Math.max(0, ...ch), end: ch[ch.length - 1], anyOn: O.frames.some((f) => f.on), threshold: window.game._od.threshold, frames: ch.length }; });
await P.g(() => window.__ty.clear());
P.check("13b. 6 keys at 80 WPM then a 2 s pause with the plate up, T at the 25 WPM floor: the charge never fills (peak < .6) and drains during the pause, no activation", T13b === 25 && !t13b.anyOn && t13b.peak > 0 && t13b.peak < 0.6 && t13b.end < t13b.peak, { T: T13b, ...t13b });

// 15. Drill (MODES): blocked, in a real drill (MODES' beginModeRun from the menu, lead ruling Z8), with a Daily Sortie as
//     the control (Overdrive charges there); the Flight Check block reads ONBOARD's flightCheck. Both runs hold the
//     field and type the same 6 words at 75 ms / key (160 WPM) over the stubbed T of 63 WPM.
async function modeRunCharge(mode) {
  const ok = await P.g((m) => { const g = window.game; g.stopToMenu(true); return g.beginModeRun(m); }, mode);
  const live = ok && await waitFor(P, () => { const g = window.game; return g.mode === "playing" && !g.levelIntro && g.wavePhase === "spawn"; }, 15000);
  await P.g(() => { window.__ty.clear(); window.__ty.hold(); window.__od.frames.length = 0; window.__od.sample = true; });
  if (live) await run(P, plan(nextWords(6), 75).steps);
  return P.g((ok) => {
    const g = window.game, O = window.__od;
    O.sample = false;
    const r = { ok, runMode: g.runMode(), runRecordMode: g.run && g.run.mode, blocked: g.odBlocked(), frames: O.frames.length,
      maxCharge: Math.round(Math.max(0, ...O.frames.map((f) => f.charge)) * 100) / 100, anyOn: O.frames.some((f) => f.on) };
    window.__ty.clear();
    return r;
  }, !!live);
}
const hasModes = await P.g(() => typeof window.game.beginModeRun === "function");
const t15d = hasModes ? await modeRunCharge("drill") : { ok: false };
const t15c = hasModes ? await modeRunCharge("daily") : { ok: false };
const t15f = await P.g(() => {
  const g = window.game, fc0 = g.flightCheck;
  const daily = g.odBlocked();
  g.flightCheck = { probe: true };
  const fcBlocked = g.odBlocked();
  g.flightCheck = fc0 || null;
  return { daily, fcBlocked };
});
P.check("15. a real drill (beginModeRun): 3.6 s at 160 WPM never charges or activates (odBlocked); the Daily Sortie control with the same typing charges and activates; the Flight Check (flightCheck set) blocks it too",
  hasModes && t15d.ok && t15d.runMode === "drill" && t15d.runRecordMode === "drill" && t15d.blocked && t15d.frames > 60 && !t15d.anyOn && t15d.maxCharge === 0
    && t15c.ok && t15c.runMode === "daily" && !t15c.blocked && t15c.maxCharge > 0.5 && t15c.anyOn && !t15f.daily && t15f.fcBlocked, { drill: t15d, daily: t15c, flightCheck: t15f });

// 16. Typed arrays; heap growth over 10 s of Overdrive typing < 1 MB (after a forced GC)
const cdp = await P.cdp();
await cdp.send("Performance.enable");
const heap = async () => { try { await cdp.send("HeapProfiler.collectGarbage"); } catch {} const { metrics } = await cdp.send("Performance.getMetrics"); return metrics.find((m) => m.name === "JSHeapUsedSize").value; };
await run(P, plan(nextWords(4), 90).steps);   // activate first
const h0 = await heap();
const onAt0 = (await od()).on;
await run(P, plan(nextWords(14), 90).steps);   // ~10 s
const onAt1 = (await od()).on;
const h1 = await heap();
const t16 = await P.g(() => ({ endAt: window.game._od.endAt instanceof Float64Array, ms: window.game._od.ms instanceof Float64Array, len: window.game._od.endAt.length }));
P.check("16. state ring is Float64Array (64); JS heap growth over 10 s of typing in Overdrive < 1 MB (forced GC)", t16.endAt && t16.ms && t16.len === 64 && onAt0 && onAt1 && h1 - h0 < 1024 * 1024,
  { ...t16, onAt0, onAt1, heapDeltaKB: Math.round((h1 - h0) / 1024) });

// A second browser context on a fresh save, started from the menu (sector 1, typist installed, field held).
async function freshContext(tag, name, opts = {}) {
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await harnessFlags(ctx);
  await ctx.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => P.errors.pageErrors.push(tag + ": " + String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") P.errors.consoleErrors.push(tag + ": " + m.text()); });
  const R = { g: (fn, a) => page.evaluate(fn, a), page, ctx };
  await page.goto(P.base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
  await page.fill("#playerName", name).catch(() => {});
  await page.click("#btnStart");
  try { const s = page.locator("#btnStoryLaunch"); await s.waitFor({ state: "visible", timeout: 2500 }); await s.click(); } catch {}
  await page.waitForFunction(() => window.game && window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 30000 });
  await installTypist(R);
  await R.g(() => { window.__ty.clear(); window.__ty.hold(); });
  await installOd(R);
  return R;
}

// 2c. Lead ruling Z2: a fresh pilot's first Overdrive starts while T is the provisional 25 WPM floor (no run speed yet);
//     once MEASURE has 20 intervals T refreshes to 1.05 x the run speed while it is active, so slowing down ends it by the
//     normal rule (slow, 1 s under 0.9 T) instead of lasting until a miss. 3-letter words at 200 ms / key (60 WPM)
//     activate at ~3 s, well before the 20th interval (~5.8 s); then 420 ms / key (29 WPM, above the floor's 22.5 exit).
{
  const R = await freshContext("z2", "FIRSTOD");
  const W3 = ["sky", "map", "cat", "dog", "sun", "red", "box", "pen", "cup", "hat", "jet", "kit", "log", "net"];
  const A = plan(W3, 200);
  const B = plan(["fog", "tin", "rug", "wax", "yak", "elk"], 420, { start: A.end });
  await run(R, [...A.steps, { at: A.end - 1, snap: "slow2c" }, ...B.steps]);
  const r = await R.g(() => {
    const O = window.__od, g = window.game, S = g._od, snap = O.snaps.find((x) => x.label === "slow2c");
    const s = g.typistSpeed("run");
    return { ev: O.ev.map((e) => ({ on: e.on, reason: e.reason, T: e.T && Math.round(e.T * 10) / 10, provisional: e.provisional, dt: snap ? Math.round(e.t - snap.t) : null })),
      snap: snap && { on: snap.on, T: Math.round(snap.threshold * 10) / 10, runWpm: snap.run && Math.round(snap.run.wpm * 10) / 10, runN: snap.run && snap.run.n },
      T: Math.round(S.threshold * 10) / 10, provisional: S.provisional, run: { wpm: Math.round(s.wpm * 10) / 10, n: s.n },
      misses: g.levelStats.total - g.levelStats.correct, reason: S.lastReason, on: g.overdriveOn === true };
  });
  const first = r.ev.find((e) => e.on), end = r.ev.find((e) => !e.on);
  P.check("2c. Z2: a fresh pilot's first Overdrive (activated at the provisional floor, T 25) meets T = 1.05 x run speed once the run speed exists and ends by the slow rule after slowing to 29 WPM (no miss), within 4.5 s of the slowdown",
    !!first && first.T === 25 && first.provisional === true && !!r.snap && r.snap.on && r.snap.T > 50 && r.snap.runN >= 20 && Math.abs(r.snap.T - 1.05 * r.snap.runWpm) < 3 && !r.provisional
      && !!end && end.reason === "slow" && end.dt !== null && end.dt >= 0 && end.dt <= 4500 && r.misses === 0 && !r.on, r);
  await R.ctx.close();
}

// 14. Reduced motion: steady arc alpha while active, no vent particles
{
  const R = await freshContext("rm", "CALM", { reducedMotion: "reduce" });
  const page = R.page, ctx = R.ctx;
  // 2b (fresh save, S1, tutorial on): an S1 tutorial tip is on screen when the first Overdrive fires; the Overdrive tip
  //    stacks beside it under its own toast key instead of replacing it (the other S1 tips are marked seen so none
  //    takes the tip slot meanwhile)
  await R.g(() => { const g = window.game, ts = g.save.tutorialSeen; ts.lock = ts.finish = ts.release = ts.accuracy = true; g.tutorialToast("powerup", "TYPE SHIELD TO GRAB IT", 20000); });
  await R.g(() => { window.__od.sample = true; });
  wi = 0;
  await run(R, firstOdPlan().steps);
  const tip = await R.g(() => ({ on: window.game.overdriveOn === true, enabled: window.game.tutorialEnabled(), toasts: [...document.querySelectorAll(".toast")].map((e) => e.textContent) }));
  P.check("2b. first Overdrive on a save with an S1 tutorial tip up: the Overdrive tip stacks beside it (own toast key), the tutorial tip stays",
    tip.on && tip.enabled && tip.toasts.includes("TYPE SHIELD TO GRAB IT") && tip.toasts.some((t) => /^OVERDRIVE — FAST AND CLEAN/.test(t)), tip);
  const rm = await R.g(() => {
    const g = window.game, O = window.__od;
    O.sample = false;
    const onFrames = O.frames.filter((f) => f.on).slice(-10).map((f) => f.arcAlpha);
    const on = g.overdriveOn === true, steamN = O.steam.length, pushes0 = O.pushes;
    window.__ty.plate("zzzz", 2);
    g.handleTyped("q");
    const r = { reduce: g.reduceMotion, on, alphas: onFrames, steam: O.steam.slice(steamN), reason: g._od.lastReason };
    window.__ty.clear();
    return r;
  });
  P.check("14. reduced motion: arc alpha identical over 10 active frames (no pulse); a vent adds no steam particles", rm.reduce === true && rm.on && rm.alphas.length === 10 && rm.alphas.every((a) => a === rm.alphas[0] && a > 0.9) && rm.reason === "miss" && rm.steam.length === 1 && rm.steam[0] === 0, rm);
  await ctx.close();
}

P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
await P.finish();
