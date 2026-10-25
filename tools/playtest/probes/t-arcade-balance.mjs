// t-arcade-balance (ARCADE D10 / D12 balance, ~25 min): runs the B10 typist profiles (probes/b10.mjs, one child
// process per profile, sequential by default) and asserts the Counter-Signal targets on their out/b10/<label>.json:
// sector 1 never surges, every sector 2-3 fight starts >= 1 surge, a fight never fires more than 2 per phase (fight-level
// bound from b10's totals; the per-phase cap itself is t-arcade-counter 9), 80/.97 at sector 10 counters >= 75 % of the
// surges it started and its time bonus stays below its accuracy bonus (par = chars / (0.9 x targetCps)), no death in
// sectors 1-3 for 35/.90, 55/.93 and 80/.97, 55/.93 clears sector 10 from a direct jump. Every child run must end with
// zero page / console errors. Writes out/t-arcade-balance/summary.json (per profile and sector: surges started /
// countered / fired, surge damage, boss seconds, tally clear / time / accuracy / flawless) for PACE's re-pass.
// Lead ruling Z6 (fair surge windows): 35/.90 takes 0 surge damage in S1-3; 55/.93 keeps >= 15 % hull through the S10
// jump; 80/.97 still meets real surges in S8-10 (a jump to S8, three sectors): every fight starts one, some are
// countered, and its windows stay near the table (mean window / table window <= 1.5: the fair floor, fairMul x its own
// time for the segment, barely lengthens a fast pilot's surges).
//
// Usage: node probes/t-arcade-balance.mjs [--only w80-a.97-j10] [--reuse] [--parallel 2]
//   --reuse     skip a profile whose JSON already exists (re-check the assertions without re-running Chrome)
//   --parallel  run that many profiles at once (default 1; the typist is paced by the play clock, so it stays honest)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../out/t-arcade-balance");
const B10_DIR = path.resolve(HERE, "../out/b10");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : d; };
const ONLY = arg("only");
const REUSE = !!arg("reuse");
const PARALLEL = Math.max(1, Number(arg("parallel", 1)) || 1);

const PROFILES = [
  { key: "w35-a.9-s1-3", wpm: 35, acc: 0.9, sectors: 3 },
  { key: "w55-a.93-s1-3", wpm: 55, acc: 0.93, sectors: 3 },
  { key: "w80-a.97-s1-3", wpm: 80, acc: 0.97, sectors: 3 },
  { key: "w55-a.93-j10", wpm: 55, acc: 0.93, jump: 10 },
  { key: "w80-a.97-j10", wpm: 80, acc: 0.97, jump: 10 },
  { key: "w80-a.97-j8", wpm: 80, acc: 0.97, jump: 8, sectors: 3 }
].filter((p) => !ONLY || p.key === ONLY);
const labelOf = (p) => `t-arcade-${p.key}`;

const results = [];
const check = (name, pass, evidence) => { results.push({ check: name, result: pass ? "pass" : "fail", evidence }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(evidence)}`); };
const note = (name, evidence) => { results.push({ check: name, result: "not-run", evidence }); console.log(`NOTE  ${name}  ${JSON.stringify(evidence)}`); };

function runB10(p) {
  const label = labelOf(p);
  const file = path.join(B10_DIR, `${label}.json`);
  if (REUSE && fs.existsSync(file)) return Promise.resolve({ p, label, code: null, reused: true, ms: 0 });
  const args = [path.join(HERE, "b10.mjs"), "--wpm", String(p.wpm), "--accuracy", String(p.acc), "--label", label, "--minions", "danger"];
  if (p.jump) args.push("--jump", String(p.jump));
  if (p.sectors) args.push("--sectors", String(p.sectors));
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: path.resolve(HERE, ".."), stdio: ["ignore", "pipe", "pipe"] });
    const log = fs.createWriteStream(path.join(OUT, `${label}.log`));
    child.stdout.pipe(log); child.stderr.pipe(log);
    child.on("close", (code) => { console.log(`ran ${label}: exit ${code} in ${Math.round((Date.now() - t0) / 1000)} s`); resolve({ p, label, code, reused: false, ms: Date.now() - t0 }); });
  });
}

// ---- run the profiles ----
const runs = [];
for (let i = 0; i < PROFILES.length; i += PARALLEL) runs.push(...await Promise.all(PROFILES.slice(i, i + PARALLEL).map(runB10)));

// ---- read and summarise ----
const summary = { generated: new Date().toISOString(), note: "B10 typist profiles on the ARCADE tree (Counter-Signal D10, par, kill set D12); surgesStarted = fired + countered (b10 wraps fireSurge / cancelSurge)", profiles: {} };
const fights = [];
for (const r of runs) {
  const file = path.join(B10_DIR, `${r.label}.json`);
  const probeFile = path.resolve(HERE, `../out/probe-b10-${r.label}/probe.json`);
  if (!fs.existsSync(file)) { check(`${r.p.key}: b10 wrote ${path.basename(file)}`, false, { code: r.code }); continue; }
  const rep = JSON.parse(fs.readFileSync(file, "utf8"));
  const pj = fs.existsSync(probeFile) ? JSON.parse(fs.readFileSync(probeFile, "utf8")) : null;
  const sectors = rep.sectors.map((s) => {
    const b = s.boss || null;
    const fired = b ? b.surgesFired | 0 : 0, countered = b ? b.surgesCountered | 0 : 0;
    const phases = b ? b.phases.length : 0;
    return {
      level: s.level, mode: s.mode, death: s.death, minHpPct: s.minHpPct, bossReached: !!b, bossCleared: !!s.bossCleared, bossSeconds: s.bossDurationS,
      surgesStarted: fired + countered, surgesCountered: countered, surgesFired: fired, bossPhases: phases,
      surgeDamage: b ? (b.damageBySource && b.damageBySource.surge) | 0 : 0, bossDamage: b ? b.damage | 0 : 0,
      windows: b && b.surgeWindows ? b.surgeWindows : [],
      tally: s.tally ? { clear: s.tally.clear, time: s.tally.time, accuracy: s.tally.accuracy, flawless: s.tally.flawless, total: s.tally.total, par: s.tally.par, elapsed: s.tally.elapsed } : null,
      rank: s.results && s.results.rank, wpm: s.results && s.results.wpm, acc: s.results && s.results.acc, clockRatio: s.clockRatio
    };
  });
  summary.profiles[r.p.key] = { wpm: rep.wpm, accuracy: rep.accuracy, jump: rep.jump || 0, b10Exit: r.code, b10Fails: pj ? pj.results.filter((x) => x.result === "fail").map((x) => x.check) : null, sectors };
  for (const s of sectors) fights.push({ key: r.p.key, ...s });
  check(`${r.p.key}: b10 run without page / console errors`, !!pj && pj.pageErrors.length === 0 && pj.consoleErrors.length === 0, pj ? { pageErrors: pj.pageErrors.slice(0, 2), consoleErrors: pj.consoleErrors.slice(0, 2) } : { probeJson: "missing" });
  if (pj && pj.fail) note(`${r.p.key}: b10's own checks (not ARCADE targets)`, summary.profiles[r.p.key].b10Fails);
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log("wrote", path.join(OUT, "summary.json"));

// ---- ARCADE targets ----
const s13 = fights.filter((f) => /-s1-3$/.test(f.key));
const s1 = s13.filter((f) => f.level === 1 && f.bossReached);
const s23 = s13.filter((f) => (f.level === 2 || f.level === 3) && f.bossReached);
if (s13.length) {
  check("sector 1 never surges (surgeEvery null)", s1.length > 0 && s1.every((f) => f.surgesStarted === 0), s1.map((f) => `${f.key}:S1 ${f.surgesStarted}`));
  check("every sector 2-3 boss fight starts >= 1 surge", s23.length > 0 && s23.every((f) => f.surgesStarted >= 1), s23.map((f) => `${f.key}:S${f.level} started ${f.surgesStarted} (c ${f.surgesCountered} / f ${f.surgesFired}) boss ${f.bossSeconds} s`));
  const deaths = s13.filter((f) => f.death);
  check("no death in sectors 1-3 (35/.90, 55/.93, 80/.97)", deaths.length === 0 && ["w35-a.9-s1-3", "w55-a.93-s1-3", "w80-a.97-s1-3"].filter((k) => summary.profiles[k]).every((k) => summary.profiles[k].sectors.length === 3 && summary.profiles[k].sectors.every((s) => s.mode === "levelComplete")),
    s13.map((f) => `${f.key}:S${f.level} ${f.mode} minHp ${f.minHpPct}%`));
}
const bound = fights.filter((f) => f.bossReached);
if (bound.length) check("no fight fires more than 2 surges per phase (fired <= 2 x phases; the per-phase cap is t-arcade-counter 9)", bound.every((f) => f.surgesFired <= 2 * Math.max(1, f.bossPhases)), bound.map((f) => `${f.key}:S${f.level} f ${f.surgesFired} / ${f.bossPhases} phases`));
const j80 = fights.find((f) => f.key === "w80-a.97-j10");
if (j80) {
  check("80/.97 sector 10 counters >= 75 % of the surges it started", j80.surgesStarted > 0 && j80.surgesCountered / j80.surgesStarted >= 0.75, { started: j80.surgesStarted, countered: j80.surgesCountered, fired: j80.surgesFired, mode: j80.mode });
  check("80/.97 sector 10: tally.time <= tally.accuracy (the time bonus is a tie-breaker)", !!j80.tally && j80.tally.time <= j80.tally.accuracy, j80.tally);
}
const j55 = fights.find((f) => f.key === "w55-a.93-j10");
if (j55) check("55/.93 sector 10 from a direct jump ends in victory", j55.mode === "victory", { mode: j55.mode, minHpPct: j55.minHpPct, death: j55.death, surges: [j55.surgesStarted, j55.surgesCountered, j55.surgesFired], surgeDamage: j55.surgeDamage });

// ---- Z6: fair surge windows ----
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
const w35 = fights.filter((f) => f.key === "w35-a.9-s1-3");
if (w35.length) check("Z6: 35/.90 takes 0 surge damage in S1-3", w35.length === 3 && w35.every((f) => f.surgeDamage === 0),
  w35.map((f) => `S${f.level}: started ${f.surgesStarted} c ${f.surgesCountered} f ${f.surgesFired} dmg ${f.surgeDamage} windows ${f.windows.map((w) => `${w.dur}/${w.table}`).join(",")}`));
if (j55) check("Z6: 55/.93 sector 10 jump keeps min hull >= 15 %", j55.minHpPct >= 15, { minHpPct: j55.minHpPct, mode: j55.mode, surges: [j55.surgesStarted, j55.surgesCountered, j55.surgesFired], surgeDamage: j55.surgeDamage,
  window: r2(mean(j55.windows.map((w) => w.dur))), table: r2(mean(j55.windows.map((w) => w.table))), need: r2(mean(j55.windows.filter((w) => w.need).map((w) => w.need))) });
const j8 = fights.filter((f) => f.key === "w80-a.97-j8");
if (j8.length) {
  const ws = j8.flatMap((f) => f.windows.filter((w) => w.need > 0));
  const ratio = mean(ws.map((w) => w.dur / w.need));
  const overTable = mean(ws.map((w) => w.dur / w.table));
  check("Z6: 80/.97 meets real surges in S8-10: every fight starts >= 1, some countered, windows near the table (mean window / table <= 1.5)",
    j8.length === 3 && j8.every((f) => f.bossReached && f.surgesStarted >= 1) && j8.reduce((a, f) => a + f.surgesCountered, 0) >= 1 && overTable !== null && overTable <= 1.5,
    { sectors: j8.map((f) => `S${f.level} ${f.mode}: started ${f.surgesStarted} c ${f.surgesCountered} f ${f.surgesFired} dmg ${f.surgeDamage} minHp ${f.minHpPct}%`), windowOverNeed: r2(ratio),
      windowOverTable: r2(overTable), n: ws.length });
}

const fail = results.filter((r) => r.result === "fail").length;
fs.writeFileSync(path.join(OUT, "probe.json"), JSON.stringify({ probe: "t-arcade-balance", pass: results.filter((r) => r.result === "pass").length, fail, results }, null, 2));
console.log(JSON.stringify({ probe: "t-arcade-balance", pass: results.filter((r) => r.result === "pass").length, fail, out: OUT }));
process.exit(fail ? 1 : 0);
