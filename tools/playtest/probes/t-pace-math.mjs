// t-pace-math (PACE, D2 numbers; CONTRACT 6 PACE): the constants, the target / step functions, the tuning table on
// sector 5 wave 2, the pilot sources (run >= 20 intervals, profile >= 60 intervals, table) with and without MEASURE's
// accessors, a fresh pilot's S1 W1 = 1.0 / quota 8, the 73 WPM ramp across a sector boundary, the diff() rows and the
// pure helpers. No typing (~15 s). PASS = the pace controller computes what D2 specifies.
// Usage: node tools/playtest/probes/t-pace-math.mjs
import { openProbe, startFresh, waitFor } from "./b_lib.mjs";

const P = await openProbe("t-pace-math");
await startFresh(P, "PACE");

// ---- 1. constants ----
const c = await P.g(() => ({ PACE: { ...PACE }, hs: HUNGRY_SPAWN_S, hma: HUNGRY_MIN_ALIVE, roll: SPAWN_ROLLIN_PX.slice(), std: { ...PACE_DIFF_STANDARD }, cadet: { ...PACE_DIFF_CADET },
  frozen: Object.isFrozen(PACE_DIFF_STANDARD) && Object.isFrozen(PACE_DIFF_CADET) }));
const WANT = { pilotFactor: 0.85, mulMin: 1, mulMax: 2.5, stepMax: 0.35, runMinIntervals: 20, profileMinIntervals: 60, maxEnemiesPerMul: 2, maxEnemiesAddMax: 3,
  speedPerMul: 0.15, hungryMin2AtMul: 1.35, cadetMul: 0.75, cadetDamage: 0.75, cadetScore: 0.8, cadetAfterDeaths: 2, hullCarryFromLevel: 4, hullRepairFrac: 0.5,
  timeoutCalloutS: 1.6, paceTagMin: 1.1 };
const constOk = Object.entries(WANT).every(([k, v]) => c.PACE[k] === v);
P.check("1. PACE constants as spec-pace 1; HUNGRY_SPAWN_S 0.1, HUNGRY_MIN_ALIVE 1, SPAWN_ROLLIN_PX [10, 30]; frozen diff rows standard {1, 1} / cadet {0.8, 0.75}",
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
const ramp = await P.g(() => {
  const g = window.game;
  g.stopToMenu(true);
  g.startNewRun();
  g.speedFor = () => ({ wpm: 73, n: 40 });
  const muls = [], quotas = [];
  for (let w = 0; w < 3; w++) { g.beginWave(w); muls.push(g.paceState().mul); quotas.push(g.waveQuota()); }
  g.startLevel(1, { fromMenu: true, fresh: true });
  g.beginWave(0);
  muls.push(g.paceState().mul); quotas.push(g.waveQuota());
  const st = g.paceSnapshot().state;
  delete g.speedFor;
  return { muls, quotas, cpMul: st.cpMul, waveMuls: st.waveMuls, applied: st.applied };
});
P.check("7. 73 WPM / n 40 stub from a new run: S1 W1-3 paceMul 1.35 / 1.70 / 2.05, then S2 W1 2.40; quotas 11 / 17 / 25 / 24; S2 cpMul 2.05",
  JSON.stringify(ramp.muls) === "[1.35,1.7,2.05,2.4]" && JSON.stringify(ramp.quotas) === "[11,17,25,24]" && ramp.cpMul === 2.05 && JSON.stringify(ramp.waveMuls) === "[2.4]", ramp);

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

P.check("zero page errors and console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors, consoleErrors: P.errors.consoleErrors });
await P.finish();
