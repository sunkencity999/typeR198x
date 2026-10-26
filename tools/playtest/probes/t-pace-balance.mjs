// t-pace-balance (PACE, the D2 / D3 balance targets as restated by R26 / lead ruling Q1). Drives one harness typist
// (play-clock paced, b10's typist) through consecutive sectors and classifies every frame of play like the pedagogy
// probe: card / boss intro / finale / transition (drain, banner, approach) / boss / active (something targetable) / idle
// (a spawn phase with nothing targetable). Idle share = idle / sector play time. Per sector it prints and stores the
// idle share, the longest idle gap, deaths, min hull, the carried hull on the card, damage, rank, hand speed, and per
// wave paceMul / source / quota / carry / timeout / escaped, so the lead's re-pass on the merged tree can compare.
// Targets (checked with --expect, auto by default):
//   p55 / p80 (fresh and --seed-profile): S2 and S3 idle <= 15 %; S1 <= 15 % seeded, <= 30 % fresh
//   p35 (35 / .90, fresh): 0 deaths, 0 hull damage, rank >= B in S1-3 (not made harder)
//   p55: reaches the S1 boss in 25-70 s of play clock, clears S1-3, min hull > 25 %
//   p80: no idle gap > 2 s inside a spawn phase
// Lead ruling Z7: --acquire-ms N adds a target-acquisition latency (N ms on the play clock before the first key of every
// new target, 2N with probability .1; --acquire-slow-ms / --acquire-slow-p) to the typist; off by default.
// Lead ruling Z12 (pace counts the pilot's acquisition time): with --acquire-ms the p55 / p80 runs judge "no S2 / S3 wave
// times out with 0 leaks", S2-3 idle <= 15 % and 0 deaths (S1 idle and the 2 s gap line are reported only); every run
// also records per wave the leaks, the acquisition PACE used (acq ms, mean target length, effective cps, back-off), and
// per sector the PERFECT WAVE count and whether the sector clock cut the waves (the boss approach started before wave
// 3's drain). --matrix prints the clock-cut share and PERFECT WAVE of S2 / S3 over its 55 / 80 runs (Z12: cuts <= 15 %
// of those sectors over >= 4 runs per profile; PERFECT WAVE no worse than live a0a3845 with the same typist).
// Lead ruling Z13 (floor waves): a wave at exactly paceMul 1.0 with no carry runs on live a0a3845's rule, so its end at
// the table cap is no timeout: per wave `floor`, `capEnd` (ended by the cap) and `leftover` (plates up at the cap, they
// stay in the drain); `timedOut` / `escaped` count the D3 / Z5 judgement of the other waves only. Damage is split into
// waves and boss. With --acquire-ms the p35 run judges Z13's targets: 0 deaths, 0 wave damage and no wave timed out with
// 0 leaks in S1-3 (boss damage, rank and PERFECT WAVE reported for the comparison with live).
// Lead ruling Z14: --seed-acq MS stores profile.acqEma = MS in the seeded fixture (a returning pilot's stale value).
// Usage: node tools/playtest/probes/t-pace-balance.mjs --wpm 55 --accuracy .93 [--sectors 3] [--seed-profile auto|WPM]
//          [--seed-acq MS] [--jump L] [--retry N] [--expect auto|none|p35|p55|p80] [--set hungryMin2AtMul=1.3,rollin=10-20]
//          [--label x] [--acquire-ms 300]
//        node tools/playtest/probes/t-pace-balance.mjs --matrix [--parallel 2] [--set ...] [--acquire-ms 300] [--tag r1]
//          (35 / 55 / 80 fresh + 55 / 80 seeded; --tag suffixes the labels so rounds do not overwrite each other)
// Writes tools/playtest/out/t-pace-balance/<label>.json (and summary.json for --matrix). ~4-6 min per profile.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../out/t-pace-balance");
fs.mkdirSync(OUT_DIR, { recursive: true });
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) args[k] = "true"; else { args[k] = v; i++; }
}

// ----------------------------- --matrix: the five R26 profiles as child processes -----------------------------
if (args.matrix === "true") {
  const PAR = Math.max(1, Number(args.parallel || 2));
  const extra = args.set ? ["--set", args.set] : [];
  for (const k of ["acquire-ms", "acquire-slow-ms", "acquire-slow-p"]) if (args[k]) extra.push(`--${k}`, args[k]);
  const sfx = (args["acquire-ms"] ? `-acq${args["acquire-ms"]}` : "") + (args.tag ? `-${args.tag}` : "");
  const runs = [
    { label: "w35-fresh", argv: ["--wpm", "35", "--accuracy", ".90"] },
    { label: "w55-fresh", argv: ["--wpm", "55", "--accuracy", ".93"] },
    { label: "w80-fresh", argv: ["--wpm", "80", "--accuracy", ".97"] },
    { label: "w55-seeded", argv: ["--wpm", "55", "--accuracy", ".93", "--seed-profile", "auto"] },
    { label: "w80-seeded", argv: ["--wpm", "80", "--accuracy", ".97", "--seed-profile", "auto"] }
  ].map((r) => ({ ...r, label: r.label + sfx }));
  const results = [];
  let next = 0;
  const runOne = (r) => new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...r.argv, "--label", r.label, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      const lines = out.split("\n").filter((l) => /^(PASS|FAIL|SKIP|SECTOR|  )/.test(l));
      console.log(`== ${r.label} exit ${code}\n${lines.join("\n")}`);
      resolve({ label: r.label, code });
    });
  });
  const workers = Array.from({ length: PAR }, async () => { while (next < runs.length) { const r = runs[next++]; results.push(await runOne(r)); } });
  await Promise.all(workers);
  const table = [];
  for (const r of runs) {
    const f = path.join(OUT_DIR, `${r.label}.json`);
    if (!fs.existsSync(f)) { table.push({ label: r.label, missing: true }); continue; }
    const rep = JSON.parse(fs.readFileSync(f, "utf8"));
    table.push({ label: r.label, exit: (results.find((x) => x.label === r.label) || {}).code, sectors: rep.sectors.map((s) => ({ S: s.level, outcome: s.outcome, idle: s.idleShare, gap: s.idleMaxGapS,
      toBoss: s.toBossS, deaths: s.deaths, minHullPct: s.minHullPct, dmg: s.damage, waveDmg: s.waveDamage, bossDmg: s.bossDamage, rank: s.rank, wpm: s.wpm, muls: s.waves.map((w) => w.mul), timeouts: s.waves.filter((w) => w.timedOut).length, escaped: s.waves.reduce((a, w) => a + (w.escaped || 0), 0),
      cleanTimeouts: s.waves.filter((w) => w.timedOut && !(w.leaks > 0)).length, floor: s.waves.filter((w) => w.floor).length, floorCapEnds: s.waves.filter((w) => w.floor && w.capEnd).length,
      clockCut: !!s.clockCut, perfectWaves: s.perfectWaves, acq: s.waves.map((w) => w.acq), ratio: s.clockRatio })) });
  }
  // Z12 aggregate over this round's 55 / 80 runs: S2 / S3 clock cuts and PERFECT WAVE
  const z12 = table.filter((r) => !r.missing && /^w(55|80)/.test(r.label)).flatMap((r) => r.sectors.filter((s) => s.S === 2 || s.S === 3));
  const cuts = z12.filter((s) => s.clockCut).length;
  fs.writeFileSync(path.join(OUT_DIR, `summary${sfx}.json`), JSON.stringify({ when: new Date().toISOString(), set: args.set || null, acquireMs: args["acquire-ms"] || null,
    z12: { sectors: z12.length, clockCuts: cuts, cutShare: z12.length ? Math.round(1000 * cuts / z12.length) / 1000 : null, perfectWaves: z12.map((s) => s.perfectWaves) }, table }, null, 1));
  console.log("\nSUMMARY (idle share / longest idle gap s / deaths / min hull % / damage / rank / hand WPM / paceMul per wave / acquisition ms per wave)");
  for (const row of table) {
    if (row.missing) { console.log(`${row.label}: no report`); continue; }
    console.log(`${row.label} (exit ${row.exit})`);
    for (const s of row.sectors) console.log(`  S${s.S} ${s.outcome} idle ${Math.round(s.idle * 100)}% gap ${s.gap}s toBoss ${s.toBoss}s deaths ${s.deaths} minHull ${s.minHullPct}% dmg ${s.dmg} (waves ${s.waveDmg} boss ${s.bossDmg}) rank ${s.rank} wpm ${s.wpm} mul ${s.muls.join("/")} acq ${s.acq.join("/")} timeouts ${s.timeouts} (0-leak ${s.cleanTimeouts}) escaped ${s.escaped} floor ${s.floor} (cap ends ${s.floorCapEnds}) PW ${s.perfectWaves}${s.clockCut ? " CLOCK-CUT" : ""} play / wall ${s.ratio}`);
  }
  console.log(`Z12 S2 / S3 of the 55 / 80 runs: ${cuts} clock cuts in ${z12.length} sectors (${z12.length ? Math.round(100 * cuts / z12.length) : 0} %), PERFECT WAVE ${z12.map((s) => s.perfectWaves).join(" ")}`);
  console.log("wrote", path.join(OUT_DIR, `summary${sfx}.json`));
  process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
}

// ----------------------------- one profile -----------------------------
const { openProbe, sleep, waitFor, paceType } = await import("./pace_lib.mjs");
const { acquireOpts } = await import("./b_lib.mjs");
const ACQ = acquireOpts({ acquireMs: args["acquire-ms"], acquireSlowMs: args["acquire-slow-ms"] ?? null, acquireSlowP: args["acquire-slow-p"] ?? 0.1 });
const WPM = Number(args.wpm || 55);
const ACC = Number(args.accuracy || 0.93);
const SEED = args["seed-profile"] ? (args["seed-profile"] === "auto" ? Math.round(WPM * ACC) : Number(args["seed-profile"])) : 0;
const SEED_ACQ = args["seed-acq"] ? Number(args["seed-acq"]) : 0;   // Z14: a stored profile.acqEma in the seeded fixture
const JUMP = args.jump ? Number(args.jump) : 0;
const SECTORS = Number(args.sectors || (JUMP ? 4 : 3));
const RETRY = Number(args.retry || 0);
const SECONDS = Number(args.seconds || 420);
const SETS = args.set ? String(args.set).split(",").map((kv) => kv.split("=")).filter((p) => p.length === 2) : [];
let EXPECT = args.expect || "auto";
if (EXPECT === "auto") EXPECT = JUMP ? "none" : WPM <= 40 ? "p35" : WPM <= 65 ? "p55" : "p80";
const LABEL = args.label || `w${WPM}-a${String(ACC).replace(/^0/, "")}${SEED ? `-seed${SEED}` : "-fresh"}${SEED_ACQ ? `-sacq${SEED_ACQ}` : ""}${JUMP ? `-j${JUMP}` : ""}${ACQ.ms ? `-acq${ACQ.ms}` : ""}`;

const P = await openProbe(`t-pace-balance-${LABEL}`);
if (SEED) {
  const bigrams = {};
  const L = "etaoinshrdlucmfwypvbgk";
  let k = 0;
  for (const a of L) for (const b of L) { if (k >= 100) break; bigrams[a + b] = { n: 3, ms: Math.round(12000 / SEED) }; k++; }
  await P.goto({ schema: 3, playerName: "BALANCE", selectedShip: "coconut", lastUnlockedLevel: Math.max(1, JUMP || 1), storySeen: true, keyboardHintSeen: true, onboardingDone: Date.now(),
    settings: { muted: true }, profile: { v: 1, keys: {}, bigrams, speedEma: SEED, thrEma: Math.round(SEED * 0.6), speedN: 300, sessions: [], sectorBest: {}, bests: { speed: 0, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 3, last: 20261020 }, ...(SEED_ACQ ? { acqEma: SEED_ACQ } : {}) } });
} else {
  if (SEED_ACQ) throw new Error("--seed-acq needs --seed-profile (a returning pilot's fixture)");
  await P.goto("fresh");
}
if (SETS.length) {
  await P.g((sets) => {
    for (const [k, v] of sets) {
      if (k === "rollin") { const [a, b] = v.split("-").map(Number); SPAWN_ROLLIN_PX[0] = a; SPAWN_ROLLIN_PX[1] = b; }
      else if (k in PACE) PACE[k] = Number(v);
    }
  }, SETS);
}

// page-side classifier and per-wave log (listeners registered after PACE's, so they read the tuning PACE wrote)
await P.g(() => {
  const B = window.__bal = {
    reset() { B.st = { card: 0, bossIntro: 0, finale: 0, transition: 0, boss: 0, active: 0, idle: 0, total: 0 }; B.gap = 0; B.gapMax = 0; B.waves = B.waves ? B.waves.filter((w) => w.L === LEVELS[window.game.levelIndex].level) : []; B.minHp = Infinity; B.dmg = 0; B.waveDmg = 0; B.bossDmg = 0; B.toBoss = null; B.t0 = window.game.playClock || 0; B.hullIn = B.lastCard || null; B.approach = null; },
    st: null
  };
  B.reset();
  onGameHook("tick", function (e) {
    if (this.mode !== "playing" || !B.st) return;
    const dt = e.dt, s = B.st;
    s.total += dt;
    let idle = false;
    if (this.levelIntro) s.card += dt;
    else if (this.bossIntro && this.bossIntro.locked) s.bossIntro += dt;
    else if (this.bossClear) s.finale += dt;
    else if (this.inBoss) { s.boss += dt; if (B.toBoss === null) B.toBoss = (this.playClock || 0) - B.t0; }
    else if (this.wavePhase === "drain" || this.wavePhase === "banner" || this.wavePhase === "approach") s.transition += dt;
    else if (this.hasVisibleTargets()) s.active += dt;
    else { s.idle += dt; idle = true; }
    if (idle) { B.gap += dt; if (B.gap > B.gapMax) B.gapMax = B.gap; } else B.gap = 0;
    if (this.player.hp < B.minHp) B.minHp = this.player.hp;
  });
  onGameHook("waveWillStart", function (e) {
    const l = this._paceLast || {};
    B.waves.push({ L: e.level, w: e.wave, mul: e.tuning.spawnMul, quota: e.tuning.quota, source: l.source || null, target: l.target ?? null, runN: l.n ?? null, carry: l.carry || 0,
      acq: l.acq ?? null, len: l.len ?? null, eff: l.eff ?? null, backoff: !!l.backoff, leaks: 0, timedOut: false, escaped: 0, floor: !!e.tuning.floor, cap: e.tuning.cap, capEnd: false, leftover: 0 });
  });
  // Z12: wave leaks (a timeout with none is the "WAVE TIMED OUT for a pilot who missed nothing" case) and the clock cut
  onGameHook("leak", function (e) { const w = B.waves[B.waves.length - 1]; if (w && !this.inBoss && e.kind !== "bossMinion" && w.L === LEVELS[this.levelIndex].level) w.leaks++; });
  onGameHook("bossWillApproach", function () { if (!B.approach) B.approach = { wave: this.wave | 0, phase: this.wavePhase, levelT: Math.round(this.levelT * 10) / 10, cut: !(this.wave === 2 && this.wavePhase === "drain") }; });
  // Z5: the plates alive at the cap leave at once, so escaped = alive at the cap (+ any a drain timeout detonated).
  // Z13: a floor wave's cap end is live a0a3845's wave end, not a timeout: its plates stay (leftover), none escape.
  onGameHook("waveWillEnd", function (e) {
    const w = B.waves[B.waves.length - 1];
    if (!w || e.byQuota) return;
    w.capEnd = true; w.aliveAtCap = e.alive;
    if (e.floor) w.leftover = e.alive | 0; else { w.timedOut = true; w.escaped = e.alive | 0; }
  });
  onGameHook("waveDrained", function (e) { const w = B.waves[B.waves.length - 1]; if (w && !e.byQuota) { if (e.floor) w.leftoverDetonated = e.detonated | 0; else w.escaped += e.detonated | 0; } });
  onGameHook("hullDamage", function (e) { B.dmg += e.dmg; if (e.inBoss) B.bossDmg += e.dmg; else B.waveDmg += e.dmg; });
  onGameHook("sectorCardWillShow", function () { B.lastCard = { hp: this.player.hp, maxHp: this.player.maxHp }; if (!B.hullIn) B.hullIn = B.lastCard; });
});

// the classifier only counts mode "playing", so arming it before Start keeps the first sector's card and wave 1
await P.g(() => window.__bal.reset());
await P.startRun("BALANCE");
if (JUMP) {
  await P.g((i) => { window.__jumpTo = i; window.game.startSector(i); }, JUMP - 1);
  await waitFor(P, () => window.game && window.game.mode === "playing" && window.game.levelIndex === window.__jumpTo, 8000);
  await P.g(() => window.__bal.reset());
}

const report = { label: LABEL, wpm: WPM, accuracy: ACC, seedProfile: SEED || null, seedAcq: SEED_ACQ || null, jump: JUMP, sets: SETS, expect: EXPECT, acquire: ACQ.ms ? ACQ : null, sectors: [] };
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
for (let s = 0; s < SECTORS; s++) {
  const t0 = Date.now();
  let deaths = 0, outcome = "timeout", acquired = 0;
  const level = await P.g(() => window.game.levelIndex + 1);
  while (Date.now() - t0 < SECONDS * 1000) {
    const typed = await paceType(P, SECONDS, { wpm: WPM, accuracy: ACC, until: (st) => st.mode !== "playing", acquireMs: ACQ.ms, acquireSlowMs: ACQ.slowMs, acquireSlowP: ACQ.slowP });
    acquired += typed.acquired | 0;
    const mode = await P.g(() => window.game.mode);
    if (mode === "gameOver") {
      deaths++;
      if (deaths > RETRY) { outcome = "gameOver"; break; }
      await sleep(900);
      await P.g(() => document.getElementById("btnTryAgain").click());
      await waitFor(P, () => window.game.mode === "playing", 8000);
      continue;
    }
    if (mode === "levelComplete" || mode === "victory") { outcome = mode; break; }
    if (mode !== "playing") await sleep(200);
  }
  const ev = await P.g(() => {
    const g = window.game, B = window.__bal, r = g.lastResults;
    return { st: B.st, gapMax: B.gapMax, waves: B.waves, minHp: B.minHp, dmg: B.dmg, waveDmg: B.waveDmg, bossDmg: B.bossDmg, toBoss: B.toBoss, playS: (g.playClock || 0) - B.t0, hullIn: B.hullIn,
      results: r && { rank: r.rank, wpm: r.wpm, throughput: r.throughput, acc: r.acc, tags: r.tags }, maxHp: g.player.maxHp, hpEnd: g.player.hp, pace: g.paceSnapshot().state,
      approach: B.approach, perfectWaves: g.levelStats ? g.levelStats.perfectWaves | 0 : null, acqMs: typeof g.typistAcquireMs === "function" ? Math.round(g.typistAcquireMs()) : null };
  });
  const tot = Math.max(1e-6, ev.st.total);
  const wallS = (Date.now() - t0) / 1000;
  const rec = {
    level, outcome, deaths, playS: r2(ev.playS), wallS: r2(wallS), clockRatio: r2(ev.playS / Math.max(0.1, wallS)), toBossS: r2(ev.toBoss), idleShare: r2(ev.st.idle / tot), spawnPhaseIdle: r2(ev.st.idle / Math.max(1e-6, ev.st.idle + ev.st.active)),
    idleMaxGapS: r2(ev.gapMax), frac: Object.fromEntries(Object.entries(ev.st).filter(([k]) => k !== "total").map(([k, v]) => [k, r2(v / tot)])),
    minHp: ev.minHp === Infinity ? null : ev.minHp, minHullPct: ev.minHp === Infinity ? null : Math.round(1000 * ev.minHp / Math.max(1, ev.hullIn ? ev.hullIn.maxHp : ev.maxHp)) / 10,
    hullIn: ev.hullIn, damage: ev.dmg, waveDamage: ev.waveDmg, bossDamage: ev.bossDmg, rank: ev.results && ev.results.rank, wpm: ev.results && Math.round(ev.results.wpm), throughput: ev.results && ev.results.throughput,
    acc: ev.results && ev.results.acc, tags: ev.results && ev.results.tags,
    waves: ev.waves.map((w) => ({ ...w, target: r2(w.target) })), cadet: ev.pace && ev.pace.cadetLevel === level, acquisitions: acquired,
    approach: ev.approach, clockCut: !!(ev.approach && ev.approach.cut), perfectWaves: ev.perfectWaves, acqMsEnd: ev.acqMs
  };
  report.sectors.push(rec);
  console.log(`SECTOR ${rec.level} ${rec.outcome} play ${rec.playS}s (play / wall ${rec.clockRatio}) toBoss ${rec.toBossS}s idle ${Math.round(rec.idleShare * 100)}% (spawn-phase ${Math.round(rec.spawnPhaseIdle * 100)}%) gap ${rec.idleMaxGapS}s deaths ${rec.deaths} ` +
    `hullIn ${rec.hullIn ? `${rec.hullIn.hp}/${rec.hullIn.maxHp}` : "-"} minHull ${rec.minHullPct}% dmg ${rec.damage} (waves ${rec.waveDamage} boss ${rec.bossDamage}) rank ${rec.rank} wpm ${rec.wpm} acc ${rec.acc} ` +
    `waves ${rec.waves.map((w) => `${w.mul}${w.floor ? "F" : ""}(${w.source}${w.carry ? `+${w.carry}` : ""}${w.backoff ? " backoff" : ""} acq ${w.acq} eff ${w.eff}) q${w.quota}${w.leaks ? ` lk ${w.leaks}` : ""}${w.timedOut ? ` TIMEOUT esc ${w.escaped}` : ""}${w.floor && w.capEnd ? ` CAP left ${w.leftover}` : ""}`).join(" / ")}` +
    ` PW ${rec.perfectWaves}${rec.clockCut ? ` CLOCK-CUT (W${rec.approach.wave + 1} ${rec.approach.phase})` : ""}${ACQ.ms ? ` acquisitions ${acquired}` : ""}`);
  if (outcome !== "levelComplete") break;
  if (s + 1 < SECTORS) {
    await sleep(600);
    await P.g(() => { document.getElementById("btnNextLevel").click(); });
    await waitFor(P, () => window.game.mode === "playing", 8000);
    await P.g(() => window.__bal.reset());
  }
}
fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify(report, null, 1));
console.log("wrote", path.join(OUT_DIR, `${LABEL}.json`));

// ----------------------------- targets -----------------------------
const S = report.sectors;
const by = (L) => S.find((r) => r.level === L);
const idleLine = S.map((r) => `S${r.level} ${Math.round(r.idleShare * 100)}%`).join(" ");
// Z7: with an acquisition latency the idle targets are reported only (P.note); every other target is still judged.
const judge = (name, pass, evidence) => (ACQ.ms ? P.note(`${name} (Z7 acquisition latency: report only; ${pass ? "would pass" : "would fail"})`, typeof evidence === "string" ? evidence : JSON.stringify(evidence)) : P.check(name, pass, evidence));
if (EXPECT === "p55" || EXPECT === "p80") {
  const s1 = by(1), s2 = by(2), s3 = by(3);
  // Z12: S2-3 idle is judged with the acquisition latency too (S1 idle stays report-only under Z7)
  P.check(`${LABEL}: S2 and S3 idle share <= 15 %`, !!s2 && !!s3 && s2.idleShare <= 0.15 && s3.idleShare <= 0.15, idleLine);
  const s1Max = SEED ? 0.15 : 0.30;
  judge(`${LABEL}: S1 idle share <= ${Math.round(s1Max * 100)} % (${SEED ? "returning, seeded" : "fresh"} profile)`, !!s1 && s1.idleShare <= s1Max, idleLine);
  if (ACQ.ms) {
    const s23 = S.filter((r) => r.level === 2 || r.level === 3);
    P.check(`${LABEL}: Z12 no S2 / S3 wave times out with 0 leaks`, s23.length === 2 && s23.every((r) => r.waves.every((w) => !(w.timedOut && !(w.leaks > 0)))),
      s23.map((r) => `S${r.level}: ${r.waves.map((w) => `W${w.w + 1} ${w.timedOut ? `TO esc ${w.escaped} lk ${w.leaks}` : "ok"}`).join(" ")}`).join(" · "));
    P.check(`${LABEL}: Z12 0 deaths in S1-3`, S.length === 3 && S.every((r) => r.deaths === 0 && r.outcome === "levelComplete"), S.map((r) => `S${r.level}:${r.outcome}/${r.deaths}`));
    P.note(`${LABEL}: Z12 S2 / S3 clock cuts and PERFECT WAVE (aggregate targets: cuts <= 15 % of sectors over >= 4 runs; PERFECT WAVE no worse than live a0a3845)`,
      s23.map((r) => `S${r.level} ${r.clockCut ? "CUT" : "no cut"} PW ${r.perfectWaves}`).join(" · "));
  }
}
if (EXPECT === "p55") {
  const s1 = by(1);
  P.check(`${LABEL}: reaches the S1 boss in 25-70 s of play clock`, !!s1 && s1.toBossS !== null && s1.toBossS >= 25 && s1.toBossS <= 70, { toBossS: s1 && s1.toBossS });
  P.check(`${LABEL}: clears S1-3 without dying, min hull > 25 % in every sector`, S.length === 3 && S.every((r) => r.outcome === "levelComplete" && r.deaths === 0 && r.minHullPct > 25), S.map((r) => `S${r.level}:${r.outcome}/${r.deaths}/${r.minHullPct}%`));
}
if (EXPECT === "p80") {
  judge(`${LABEL}: no idle gap > 2 s inside a spawn phase`, S.every((r) => r.idleMaxGapS <= 2), S.map((r) => `S${r.level}:${r.idleMaxGapS}s`));
}
if (EXPECT === "p35") {
  const order = ["S", "A", "B", "C", "D"];
  if (!ACQ.ms) {
    P.check(`${LABEL}: not made harder in S1-3: 0 deaths, 0 hull damage, rank >= B`, S.length === 3 && S.every((r) => r.outcome === "levelComplete" && r.deaths === 0 && r.damage === 0 && order.indexOf(r.rank) >= 0 && order.indexOf(r.rank) <= 2),
      S.map((r) => `S${r.level}:${r.outcome} deaths ${r.deaths} dmg ${r.damage} rank ${r.rank}`));
  } else {
    // Z13 with the latency: wave damage and 0-leak timeouts no worse than live's 10 runs (0 / 0); boss damage is ARCADE's
    P.check(`${LABEL}: Z13 S1-3 with latency: 0 deaths, 0 wave damage, no wave timed out with 0 leaks`,
      S.length === 3 && S.every((r) => r.outcome === "levelComplete" && r.deaths === 0 && r.waveDamage === 0 && r.waves.every((w) => !(w.timedOut && !(w.leaks > 0)))),
      S.map((r) => `S${r.level}:${r.outcome} deaths ${r.deaths} waveDmg ${r.waveDamage} timeouts ${r.waves.filter((w) => w.timedOut).length} (0-leak ${r.waves.filter((w) => w.timedOut && !(w.leaks > 0)).length})`));
    P.note(`${LABEL}: Z13 boss damage, rank, floor cap ends and PERFECT WAVE (S2 / S3 no worse than live a0a3845)`,
      S.map((r) => `S${r.level} bossDmg ${r.bossDamage} rank ${r.rank} floor ${r.waves.filter((w) => w.floor).length}/3 cap ends ${r.waves.filter((w) => w.floor && w.capEnd).length} PW ${r.perfectWaves}`).join(" · "));
  }
}
if (EXPECT === "none") P.note(`${LABEL}: stakes run (no targets)`, S.map((r) => `S${r.level}:${r.outcome} hullIn ${r.hullIn ? r.hullIn.hp + "/" + r.hullIn.maxHp : "-"} minHull ${r.minHullPct}% deaths ${r.deaths}`).join(" "));
P.check("zero page errors and console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
await P.finish();
