// t-pace-math (PACE, D2 numbers; CONTRACT 6 PACE): the constants, the target / step functions, the tuning table on
// sector 5 wave 2, the pilot sources (run >= 20 intervals, profile >= 60 intervals, table) with and without MEASURE's
// accessors, a fresh pilot's S1 W1 = 1.0 / quota 8, the 73 WPM ramp across a sector boundary, the diff() rows and the
// pure helpers; lead ruling Z12: pilotCpsEff = L / (L / handCps + acq / 1000) for 35 / 55 / 80 WPM x acquisition 120 /
// 300 / 600 ms x mean target length 1 / 5 / 7, the per-sector mean length from WORDS' mix (cached), the wave start
// reading MEASURE's typistAcquireMs (feature-detected, 300 ms without it) and the clean-timeout back-off target (never a
// faster wave; release review Z12-B3). No typing (~15 s). PASS = the pace controller computes what D2 / Z12 specify.
// Usage: node tools/playtest/probes/t-pace-math.mjs
import { openProbe, startFresh, waitFor } from "./b_lib.mjs";

const P = await openProbe("t-pace-math");
await startFresh(P, "PACE");

// ---- 1. constants ----
const c = await P.g(() => ({ PACE: { ...PACE }, hs: HUNGRY_SPAWN_S, hma: HUNGRY_MIN_ALIVE, roll: SPAWN_ROLLIN_PX.slice(), std: { ...PACE_DIFF_STANDARD }, cadet: { ...PACE_DIFF_CADET },
  frozen: Object.isFrozen(PACE_DIFF_STANDARD) && Object.isFrozen(PACE_DIFF_CADET) }));
const WANT = { pilotFactor: 0.85, mulMin: 1, mulMax: 2.5, stepMax: 0.35, runMinIntervals: 20, profileMinIntervals: 60, maxEnemiesPerMul: 2, maxEnemiesAddMax: 3,
  speedPerMul: 0.15, hungryMin2AtMul: 1.35, cadetMul: 0.75, cadetDamage: 0.75, cadetScore: 0.8, cadetAfterDeaths: 2, hullCarryFromLevel: 4, hullRepairFrac: 0.5,
  timeoutCalloutS: 1.6, paceTagMin: 1.1, acqDefaultMs: 300 };
const constOk = Object.entries(WANT).every(([k, v]) => c.PACE[k] === v);
P.check("1. PACE constants as spec-pace 1 (+ Z12 acqDefaultMs 300); HUNGRY_SPAWN_S 0.1, HUNGRY_MIN_ALIVE 1, SPAWN_ROLLIN_PX [10, 30]; frozen diff rows standard {1, 1} / cadet {0.8, 0.75}",
  constOk && c.hs === 0.1 && c.hma === 1 && JSON.stringify(c.roll) === "[10,30]" && c.frozen &&
  JSON.stringify(c.std) === JSON.stringify({ id: "standard", score: 1, damage: 1 }) && JSON.stringify(c.cadet) === JSON.stringify({ id: "cadet", score: 0.8, damage: 0.75 }), c);

// ---- 2 / 3. target and step ----
const ts = await P.g(() => ({
  t: [paceTargetMul(6.1, 1.2), paceTargetMul(4.1, 2.3), paceTargetMul(2.5, 3.0), paceTargetMul(0, 1.2), paceTargetMul(NaN, 1.2)],
  s: [paceStepMul(1, 2.5), paceStepMul(2.4, 2.5), paceStepMul(2.5, 1.0), paceStepMul(1.2, 1.0), paceStepMul(NaN, 2), paceStepMul(1.35, 1.515)]
}));
P.check("2. paceTargetMul (6.1, 1.2) 2.5, (4.1, 2.3) 1.515, (2.5, 3.0) 1.0, (0, 1.2) 1.0, (NaN) 1.0",
  ts.t[0] === 2.5 && Math.abs(ts.t[1] - 0.85 * 4.1 / 2.3) < 1e-9 && Math.abs(ts.t[1] - 1.515) < 0.001 && ts.t[2] === 1 && ts.t[3] === 1 && ts.t[4] === 1, ts.t);
P.check("3. paceStepMul (1, 2.5) 1.35, (2.4, 2.5) 2.5, (2.5, 1.0) 2.15, (1.2, 1.0) 1.0, (NaN, 2) 1.35, (1.35, 1.515) 1.52",
  JSON.stringify(ts.s) === JSON.stringify([1.35, 2.5, 2.15, 1, 1.35, 1.52]), ts.s);

// ---- 4. tuning on S5 wave 2 ----
const tu = await P.g(() => {
  const cfg = LEVELS[4];
  const rows = [1.0, 1.25, 1.75, 2.25, 2.5, 0.75].map((m) => { const t = paceApplyTuning({}, cfg, 1, m, 0); return [t.quota, t.maxEnemiesAdd, Math.round(t.speedMul * 1e4) / 1e4, t.hungryMinAlive, Object.is(t.maxEnemiesAdd, -0)]; });
  const carry = paceApplyTuning({}, cfg, 1, 1.25, 3).quota;
  // the 2-alive top-up switches on exactly at the knob (spec 1.5, shipped 1.35 after the balance pass)
  const k = PACE.hungryMin2AtMul;
  const h16 = paceApplyTuning({}, cfg, 1, k, 0).hungryMinAlive, h14 = paceApplyTuning({}, cfg, 1, paceRound2(k - 0.01), 0).hungryMinAlive;
  return { rows, carry, h16, h14, k };
});
const wantRows = [[18, 0, 1, 1], [23, 1, 1.0375, 1], [32, 2, 1.1125, 2], [41, 3, 1.1875, 2], [45, 3, 1.225, 2], [14, 0, 0.9625, 1]];
P.check("4. tuning at mul 1 / 1.25 / 1.75 / 2.25 / 2.5 / 0.75 on S5 W2: quota 18/23/32/41/45/14, add 0/1/2/3/3/0 (never -0), speed x1/1.0375/1.1125/1.1875/1.225/0.9625, hungry 1/1/2/2/2/1; carry 3 adds 3; hungry 2 from the knob (1.35), 1 just below (spec: 1.5)",
  tu.rows.every((r, i) => r.slice(0, 4).join() === wantRows[i].join() && r[4] === false) && tu.carry === 26 && tu.h16 === 2 && tu.h14 === 1, tu);

// ---- 5. pilot sources ----
const pil = await P.g(() => {
  const g = window.game;
  const cfg = LEVELS[0];
  const pick = (p) => ({ source: p.source, cps: Math.round(p.cps * 100) / 100, n: p.n });
  const out = {};
  const savedProfile = g.save.profile;
  g.speedFor = () => ({ wpm: 72, n: 20 });
  out.run = pick(g.pacePilot(cfg));
  g.speedFor = () => ({ wpm: 72, n: 19 });
  g.save.profile = Object.assign(JSON.parse(JSON.stringify(savedProfile || {})), { speedEma: 50, speedN: 70 });
  out.profile = pick(g.pacePilot(cfg));
  g.save.profile.speedN = 59;
  out.floor = pick(g.pacePilot(cfg));
  // MEASURE's accessors absent: save.profile fields, speedN missing -> the bigram count
  g.speedFor = undefined; g.typistSpeed = undefined;
  g.save.profile = { speedEma: 50, bigrams: { th: { n: 70 } } };
  out.noMeasureProfile = pick(g.pacePilot(cfg));
  g.save.profile = { speedEma: 50, bigrams: { th: { n: 30 } } };
  out.noMeasureFloor = pick(g.pacePilot(cfg));
  g.save.profile = null;
  out.noMeasure = pick(g.pacePilot(cfg));
  delete g.speedFor; delete g.typistSpeed;
  g.save.profile = savedProfile;
  out.real = pick(g.pacePilot(cfg));
  return out;
});
P.check("5. pacePilot: run n 20 / 72 WPM -> run cps 6; run n 19 + lifetime 50 WPM n 70 -> profile 4.17; n 59 -> table 1.2; no MEASURE: profile bigrams 70 -> 4.17, 30 -> table, none -> table",
  pil.run.source === "run" && pil.run.cps === 6 && pil.profile.source === "profile" && pil.profile.cps === 4.17 && pil.floor.source === "table" && pil.floor.cps === 1.2 &&
  pil.noMeasureProfile.source === "profile" && pil.noMeasureProfile.cps === 4.17 && pil.noMeasureFloor.source === "table" && pil.noMeasure.source === "table" && pil.real.source === "table", pil);

// ---- 6. fresh save S1 W1 ----
const w1 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { mul: s.state && s.state.mul, waveMuls: s.state && s.state.waveMuls, quota: g.waveQuota(), tq: g.waveTuningNow() && g.waveTuningNow().quota, last: s.last, wave: g.wave, level: g.levelIndex + 1 }; });
P.check("6. fresh save, Start: the first waveWillStart of S1 runs at paceMul 1.0 (state.mul 1, waveMuls [1]) with waveTuning.quota 8 (source table)",
  w1.level === 1 && w1.wave === 0 && w1.mul === 1 && JSON.stringify(w1.waveMuls) === "[1]" && w1.quota === 8 && w1.tq === 8 && w1.last && w1.last.source === "table", w1);

// ---- 7. 73 WPM ramp across a sector boundary ----
// acq 0 (an instance stub of typistAcquireMs) = D2's hand-speed-only ramp; acq 300 = Z12 with a fresh pilot's default.
const rampAt = (acq) => P.g((acq) => {
  const g = window.game;
  g.stopToMenu(true);
  g.startNewRun();
  g.speedFor = () => ({ wpm: 73, n: 40 });
  g.typistAcquireMs = () => acq;
  const muls = [], quotas = [], lens = [];
  for (let w = 0; w < 3; w++) { g.beginWave(w); muls.push(g.paceState().mul); quotas.push(g.waveQuota()); }
  lens.push(g._paceLast.len);
  g.startLevel(1, { fromMenu: true, fresh: true });
  g.beginWave(0);
  muls.push(g.paceState().mul); quotas.push(g.waveQuota()); lens.push(g._paceLast.len);
  const st = g.paceSnapshot().state;
  delete g.speedFor; delete g.typistAcquireMs;
  return { muls, quotas, lens, cpMul: st.cpMul, waveMuls: st.waveMuls, applied: st.applied, L: [paceMeanLen(LEVELS[0]), paceMeanLen(LEVELS[1])], cps: [LEVELS[0].targetCps, LEVELS[1].targetCps] };
}, acq);
const ramp = await rampAt(0);
P.check("7. 73 WPM / n 40 stub, acquisition 0 (hand speed alone, D2): S1 W1-3 paceMul 1.35 / 1.70 / 2.05, then S2 W1 2.40; quotas 11 / 17 / 25 / 24; S2 cpMul 2.05",
  JSON.stringify(ramp.muls) === "[1.35,1.7,2.05,2.4]" && JSON.stringify(ramp.quotas) === "[11,17,25,24]" && ramp.cpMul === 2.05 && JSON.stringify(ramp.waveMuls) === "[2.4]", ramp);
const ramp3 = await rampAt(300);
// reference (node): the step rule over clamp(0.85 x L / (L / 6.083 + 0.3) / targetCps, 1, 2.5)
const refRamp = (() => {
  const t = (L, cps) => Math.min(2.5, Math.max(1, 0.85 * (L / (L / (73 / 12) + 0.3)) / cps));
  const step = (p, x) => Math.round(Math.min(2.5, Math.max(1, Math.min(p + 0.35, Math.max(p - 0.35, x)))) * 100) / 100;
  const out = [];
  let p = 1;
  for (let w = 0; w < 3; w++) { p = step(p, t(ramp3.L[0], ramp3.cps[0])); out.push(p); }
  out.push(step(p, t(ramp3.L[1], ramp3.cps[1])));
  return out;
})();
P.check("7b. Z12: the same 73 WPM ramp at acquisition 300 ms: S1 W1-3 1.35 / 1.70 / 2.05 (the step rule binds), S2 W1 drops to the target of pilotCpsEff over S2's mean length (reference: step rule over clamp(0.85 x L / (L / 6.08 + 0.3) / targetCps)), below the hand-only 2.40",
  JSON.stringify(ramp3.muls) === JSON.stringify(refRamp) && ramp3.muls[3] < 2.4 && Math.abs(ramp3.lens[1] - Math.round(ramp3.L[1] * 100) / 100) < 1e-9, { ramp3, refRamp });

// ---- 8. diff rows ----
await waitFor(P, () => !window.game.levelIntro, 6000);
const d = await P.g(() => {
  const g = window.game;
  const ps = g.paceState();
  const L = LEVELS[g.levelIndex].level;
  const std = { ...g.diff() };
  ps.cadetLevel = L;
  const cad = { ...g.diff() }, same = g.diff() === g.diff(), active = g.paceCadetActive();
  ps.cadetLevel = L === 10 ? 9 : L + 1;
  const other = { ...g.diff() };
  ps.cadetLevel = 0;
  return { std, cad, other, same, active, after: { ...g.diff() } };
});
P.check("8. diff(): standard {standard, 1, 1}; run.pace.cadetLevel = this sector -> cadet {cadet, 0.8, 0.75} (same frozen object every call); another sector -> standard",
  JSON.stringify(d.std) === '{"id":"standard","score":1,"damage":1}' && JSON.stringify(d.cad) === '{"id":"cadet","score":0.8,"damage":0.75}' && d.same && d.active &&
  JSON.stringify(d.other) === '{"id":"standard","score":1,"damage":1}' && d.after.id === "standard", d);

// ---- 9. pure helpers ----
const h = await P.g(() => ({
  hull: paceHullAfterClear(220, 500, 600), full: paceHullAfterClear(600, 600, 700), low: paceHullAfterClear(1, 500, 600),
  plan: window.game.pacePlan(4, 1, 8.7, 1.4),
  norm: paceNormalizeState({ mul: "x", deaths: 5, applied: [], waveMuls: [1.2, "a", 9, 1.3, 1.4, 1.5], carry: 3, carryTo: { level: 2, wave: 1 }, hullNote: { level: 5, pct: 72, rep: 28, shown: false } }),
  bad: paceNormalizeState("garbage"), fresh: paceFreshState()
}));
P.check("9. paceHullAfterClear 220/500 -> 432/600 (72 %, +28); flawless 600/600 -> 700/700 (100 %, +0); 1/500 -> 50 %; pacePlan(S5 W2, 8.7 cps, prev 1.4) -> target 2.0, mul 1.75, quota 32; normaliser keeps valid fields only",
  h.hull.hp === 432 && h.hull.pct === 72 && h.hull.rep === 28 && h.full.hp === 700 && h.full.pct === 100 && h.full.rep === 0 && h.low.pct === 50 &&
  h.plan.mul === 1.75 && h.plan.tuning.quota === 32 && h.plan.tuning.maxEnemiesAdd === 2 && h.norm.mul === 1 && JSON.stringify(h.norm.deaths) === '{"level":0,"n":0}' && h.norm.applied === null &&
  JSON.stringify(h.norm.waveMuls) === "[1.2,1.3,1.4]" && h.norm.carry === 3 && h.norm.hullNote.pct === 72 && JSON.stringify(h.bad) === JSON.stringify(h.fresh), h);

// ---- 10. Z12 formula: pilotCpsEff = L / (L / handCps + acq / 1000), 35 / 55 / 80 WPM x acq 120 / 300 / 600 x L 1 / 5 / 7 ----
const fx = await P.g(() => {
  const rows = [];
  for (const wpm of [35, 55, 80]) for (const acq of [120, 300, 600]) for (const L of [1, 5, 7]) {
    const eff = paceEffCps(wpm / 12, L, acq);
    rows.push({ wpm, acq, L, eff, mulS5: paceTargetMul(eff, LEVELS[4].targetCps), mulS2: paceTargetMul(eff, LEVELS[1].targetCps) });
  }
  return { rows, zero: paceEffCps(55 / 12, 5, 0), none: paceEffCps(0, 5, 300), nan: paceEffCps(NaN, 5, 300), badLen: paceEffCps(55 / 12, 0, 300), plan: window.game.pacePlan(4, 1, 80 / 12, 1.4, 300), planHand: window.game.pacePlan(4, 1, 80 / 12, 1.4) };
});
const fxBad = fx.rows.filter((r) => {
  const h = r.wpm / 12, ref = r.L / (r.L / h + r.acq / 1000);
  const clampM = (x) => Math.min(2.5, Math.max(1, x));
  return !(Math.abs(r.eff - ref) < 1e-9 && Math.abs(r.mulS5 - clampM(0.85 * ref / 3.7)) < 1e-9 && Math.abs(r.mulS2 - clampM(0.85 * ref / 1.7)) < 1e-9 && r.eff < h);
});
const pick = (wpm, acq, L) => { const r = fx.rows.find((x) => x.wpm === wpm && x.acq === acq && x.L === L); return Math.round(r.eff * 1000) / 1000; };
const L5 = 5 / (5 / (80 / 12) + 0.3);
P.check("10. Z12 paceEffCps for 35 / 55 / 80 WPM x acq 120 / 300 / 600 ms x L 1 / 5 / 7 = L / (L / (WPM / 12) + acq / 1000), always below the hand speed, and the target paceMul on S5 / S2 = clamp(0.85 x eff / targetCps, 1, 2.5) (27 / 27 rows; e.g. 80 WPM, 300 ms: L 1 2.222, L 5 4.762, L 7 5.185 cps); acq 0 -> the hand speed; hand speed 0 / NaN -> 0; pacePlan with acq 300 targets 0.85 x eff / 3.7, without acq the hand speed",
  fx.rows.length === 27 && fxBad.length === 0 && pick(80, 300, 1) === 2.222 && pick(80, 300, 5) === 4.762 && pick(80, 300, 7) === 5.185 && pick(35, 600, 1) === 1.061 && pick(55, 120, 7) === 4.249 &&
  Math.abs(fx.zero - 55 / 12) < 1e-12 && fx.none === 0 && fx.nan === 0 && Math.abs(fx.badLen - 1 / (1 / (55 / 12) + 0.3)) < 1e-9 &&
  Math.abs(fx.plan.target - Math.min(2.5, Math.max(1, 0.85 * (5.13 / (5.13 / (80 / 12) + 0.3)) / 3.7))) < 0.02 && Math.abs(fx.planHand.target - Math.min(2.5, 0.85 * (80 / 12) / 3.7)) < 1e-9,
  { bad: fxBad.slice(0, 3), samples: fx.rows.filter((r) => r.wpm === 80 && r.acq === 300).map((r) => ({ L: r.L, eff: Math.round(r.eff * 1000) / 1000, mulS5: Math.round(r.mulS5 * 100) / 100 })), L5, zero: fx.zero, plan: fx.plan.target, planHand: fx.planHand.target });

// ---- 11. Z12 mean target length per sector (WORDS' mix), cached ----
const ml = await P.g(() => {
  const ref = LEVELS.map((cfg) => { let n = 0, c = 0; for (let w = 0; w < 3; w++) { n += cfg.quota[w]; c += cfg.quota[w] * waveCharsPerEnemy(cfg, w); } return c / n; });
  const got = LEVELS.map((cfg) => paceMeanLen(cfg));
  // cached: a later change to the row's mix does not move the cached value (the mix is fixed at load)
  const cfg = LEVELS[2], keep = cfg.waveTextLen.slice();
  cfg.waveTextLen[0] = 40; cfg.waveTextLen[1] = 40; cfg.waveTextLen[2] = 40;
  const cached = paceMeanLen(cfg), fresh = paceMeanLen({ ...cfg });
  for (let w = 0; w < 3; w++) cfg.waveTextLen[w] = keep[w];
  return { ref, got, cached, fresh, bad: [paceMeanLen(null), paceMeanLen({ quota: [1, 1, 1], letterRatio: 1, avgWordLen: 1, waveTextLen: [0, 0, 0] })] };
});
P.check("11. Z12 paceMeanLen: per sector = the quota-weighted mean of waveCharsPerEnemy over W1-3 (letters 1, WORDS' common / themed / phrase lengths), rising S1 -> S10 (S1 ~2.1, S10 ~8.3), cached per LEVELS row; >= 1 for odd input",
  ml.got.every((x, i) => Math.abs(x - ml.ref[i]) < 1e-9) && ml.got.every((x, i) => i === 0 || x > ml.got[i - 1]) && ml.got[0] > 1.8 && ml.got[0] < 2.5 && ml.got[9] > 7.5 && ml.got[9] < 9 &&
  Math.abs(ml.cached - ml.got[2]) < 1e-12 && ml.fresh > ml.got[2] + 5 && ml.bad[0] === 1 && ml.bad[1] >= 1, { got: ml.got.map((x) => Math.round(x * 100) / 100), cached: ml.cached, fresh: ml.fresh, bad: ml.bad });

// ---- 12. Z12 at the wave start: MEASURE's typistAcquireMs (feature-detected), the effective speed, the target ----
const ws = await P.g(() => {
  const g = window.game;
  g.stopToMenu(true);
  g.startNewRun();
  g.startLevel(4, { fromMenu: true, fresh: true });
  const cfg = LEVELS[4];
  const out = {};
  const at = (stubAcq) => {
    g.speedFor = () => ({ wpm: 120, n: 40 });
    if (stubAcq === "absent") g.typistAcquireMs = undefined; else if (stubAcq !== "real") g.typistAcquireMs = () => stubAcq;
    g.paceState().mul = 1.5;
    g.paceState().applied = null;   // not a replay of the previous call's wave
    g.beginWave(1);
    const l = { ...g._paceLast };
    delete g.speedFor; delete g.typistAcquireMs;
    return l;
  };
  out.s450 = at(450); out.absent = at("absent"); out.nan = at(NaN); out.real = at("real"); out.realMs = g.typistAcquireMs();
  out.L = paceMeanLen(cfg); out.cps = cfg.targetCps;
  return out;
});
const wsRef = (acq) => { const eff = ws.L / (ws.L / 10 + acq / 1000); const t = Math.min(2.5, Math.max(1, 0.85 * eff / ws.cps)); return { eff: Math.round(eff * 100) / 100, target: Math.round(t * 100) / 100, mul: Math.round(Math.min(1.85, Math.max(1.15, t)) * 100) / 100 }; };
const wsOk = (l, acq) => { const r = wsRef(acq); return l.acq === acq && l.source === "run" && l.eff === r.eff && l.target === r.target && l.mul === r.mul && Math.abs(l.len - Math.round(ws.L * 100) / 100) < 1e-9 && l.backoff === false; };
P.check("12. Z12 wave start (S5 W2, run speed 120 WPM, prev 1.5): typistAcquireMs 450 -> acq 450, eff = L / (L / 10 + .45), target 0.85 x eff / 3.7 (1.22), mul by the step rule; MEASURE's accessor absent or returning NaN -> 300 ms (target 1.45); the real accessor on a fresh profile -> 300",
  wsOk(ws.s450, 450) && wsOk(ws.absent, 300) && wsOk(ws.nan, 300) && ws.realMs === 300 && wsOk(ws.real, 300) && ws.s450.mul < ws.absent.mul, { ws, ref450: wsRef(450), ref300: wsRef(300) });

// ---- 13. Z12 safety net (release review Z12-B3): the back-off target; the wave after a clean timeout is never faster ----
const bo = await P.g(() => {
  const rows = [];
  for (let p = 100; p <= 250; p += 5) for (let t = 100; t <= 250; t += 5) {
    const prev = p / 100, target = t / 100, bt = paceBackoffTarget(target, prev);
    rows.push({ prev, target, bt, mul: paceStepMul(prev, bt) });
  }
  const ex = (target, prev) => { const bt = paceBackoffTarget(target, prev); return { bt: paceRound2(bt), mul: paceStepMul(prev, bt), old: paceStepMul(prev, Math.max(1, target - 0.35)) }; };
  return { rows, ramp: ex(2.11, 1.35), ramp2: ex(2.5, 1.7), steady: ex(1.7, 1.7), slowing: ex(1.4, 2.05), odd: [paceBackoffTarget(NaN, 1.7), paceBackoffTarget(2, NaN), paceBackoffTarget(2, 0)] };
});
const boBad = bo.rows.filter((r) => !(Math.abs(r.bt - Math.max(1, Math.min(r.target, r.prev) - 0.35)) < 1e-9 && r.mul === Math.max(1, Math.round((r.prev - 0.35) * 100) / 100) && r.mul <= r.prev));
P.check("13. Z12 back-off (review Z12-B3): paceBackoffTarget(target, prev) = max(1, min(target, prev) - 0.35), so under the step rule the wave after a clean timeout runs at max(1, prev - 0.35) for every prev / own target in 1.0 .. 2.5 (961 pairs, never faster than prev); prev 1.35 / own 2.11 -> 1.0 (own - 0.35 alone: 1.70), prev 1.7 / own 2.5 -> 1.35 (alone: 2.05), steady 1.7 -> 1.35, slowing 2.05 / own 1.4 -> 1.70; odd input -> 1.0",
  bo.rows.length === 961 && boBad.length === 0 && bo.ramp.mul === 1 && bo.ramp.old === 1.7 && bo.ramp2.mul === 1.35 && bo.ramp2.old === 2.05 && bo.steady.mul === 1.35 && bo.steady.bt === 1.35 &&
  bo.slowing.mul === 1.7 && bo.slowing.old === 1.7 && bo.odd.every((x) => x === 1), { bad: boBad.slice(0, 3), ramp: bo.ramp, ramp2: bo.ramp2, steady: bo.steady, slowing: bo.slowing, odd: bo.odd });

P.check("zero page errors and console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors, consoleErrors: P.errors.consoleErrors });
await P.finish();
