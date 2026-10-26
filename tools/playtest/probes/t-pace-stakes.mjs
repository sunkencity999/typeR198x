// t-pace-stakes (PACE, D3 waves; CONTRACT 6 PACE; lead rulings Q4 and Z5): PERFECT WAVE by quota only; every wave cap is
// computed from its quota and stream (>= delivery x 1.25 + 4 s, never below the table cap) so a pilot who keeps up
// never times out (a real stream at S1 W3, the tightest table cap); the cap times a wave out only with plates alive
// (an empty field lifts it); a timed-out wave plays no clear sting, pays nothing, and its N plates leave the field at
// once (they warp off to the right, no explosion, no damage) and at the drain end "WAVE TIMED OUT · N ESCAPED"
// (announced) counts them into the next wave's quota inside the sector, never past wave 3; Retry clears a pending
// carry; the sector clock cutting a wave-3 drain still gets the callout; reduced motion fades the callout without the
// slam and fades the leaving plates in place. Lead ruling Z12's safety net: a timeout with no leak in the wave lowers
// the next wave's target to stepMax under the slower of that target and the timed-out wave's pace (floor 1.0), so the
// next wave never runs faster than the one that timed out, also while the pace still ramps (release review Z12-B3); a
// timeout with a leak does not; wave 3 sets nothing; a Retry (checkpoint restore) and a sector entry clear a pending
// back-off. Lead ruling Z13: a campaign wave at exactly paceMul 1.0 without a carry is a floor wave on live a0a3845's
// rule (t-pace-floor), so the D3 / Z5 scenarios here run above the floor (pacePin 1.05 / 1.1; 7a-7d step from a stubbed
// pilot) or with a carry. ~110 s. PASS = the stakes behave as D3 / Z5 / Z12.
// Usage: node tools/playtest/probes/t-pace-stakes.mjs
import { openProbe, sleep, waitFor, startFresh, jumpTo, errorsCheck } from "./pace_lib.mjs";

const P = await openProbe("t-pace-stakes");
await startFresh(P, "PACE");

const callouts = () => P.g(() => { const g = window.game; return [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title); });

// Recorders: dying-plate records by mode (escape / detonate) and explosion sprites, from the page.
await P.g(() => {
  const g = window.game;
  const R = window.__stkRec = { modes: {}, sprites: 0 };
  const np = g.notePlateDeath;
  g.notePlateDeath = function (en, mode) { R.modes[mode] = (R.modes[mode] | 0) + 1; return np.apply(this, arguments); };
  const ex = g.addExplosionSprite;
  g.addExplosionSprite = function () { R.sprites++; return ex.apply(this, arguments); };
});
const resetRec = () => P.g(() => { window.__stkRec.modes = {}; window.__stkRec.sprites = 0; });

// A scripted timeout on the current sector: hold the spawner, static plates, the wave clock at the wave's (computed) cap.
async function scriptTimeout(words, wave = null) {
  await resetRec();
  await P.g(({ words, wave }) => {
    const g = window.game;
    if (wave !== null) g.beginWave(wave);
    g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
    // 2 kills and no damage before the cap: the pre-D3 rule (waveDmg 0 && waveKills > 0) would pay PERFECT WAVE here
    g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveKills = 2; g.waveDmg = 0; g.powerAcc = -1e9;
    g.levelT = Math.min(g.levelT, LEVELS[g.levelIndex].cap);
    const xs = [700, 900, 1100];
    words.forEach((w, i) => g.enemies.push(new Enemy({ text: w, x: xs[i], y: LANE_YS[i + 1], speed: 0, lane: i + 1 })));
    g.clearBanners();
    window.__stk = { perfect0: g.levelStats.perfectWaves | 0, score0: g.stats.score, hp0: g.player.hp, cap: g.waveTuningNow().cap };
    g.waveT = g.waveTuningNow().cap;   // the next frame's tickWaves ends the wave by its cap
  }, { words, wave });
  return waitFor(P, () => window.game.wavePhase === "drain", 3000);
}

// ---- 0a. Z5: every wave cap >= max(table cap, stream delivery of its quota x 1.25 + 4 s) ----
// (paceApplyTuning, the D3 / Z5 tuning: at paceMul 1 it is the cap of a carried or Daily Sortie wave; a campaign floor
// wave keeps the table cap, Z13, t-pace-floor 1.) The probe integrates the spawner's accumulator itself (1/240 s steps from SPAWN_ACC_PRIME, the ramp with the kills one
// plate behind the spawns) for every sector, wave and paceMul 0.75 (Cadet) .. 2.5, and reads PACE's tuning.
const caps = await P.g(() => {
  const rows = [];
  for (const cfg of LEVELS) for (let w = 0; w < 3; w++) for (const mul of [0.75, 1, 1.35, 1.7, 2.05, 2.5]) {
    const t = paceApplyTuning({ levelIndex: cfg.level - 1, wave: w, quota: 1, spawnMul: 1, maxEnemiesAdd: 0, speedMul: 1, hungryMinAlive: 1, cap: 0, pressureCap: 0 }, cfg, w, mul, 0);
    let acc = SPAWN_ACC_PRIME, spawned = 0, time = 0;
    const dt = 1 / 240;
    while (spawned < t.quota && time < 600) {
      time += dt;
      acc += dt * waveSpawnRate(cfg, w, Math.max(0, spawned - 1), t.quota) * t.spawnMul;
      while (acc >= 1 && spawned < t.quota) { acc -= 1; spawned++; }
    }
    rows.push({ L: cfg.level, w: w + 1, mul, quota: t.quota, table: cfg.cap, cap: t.cap, delivery: Math.round(time * 100) / 100, want: Math.max(cfg.cap, 1.25 * time + 4) });
  }
  return rows;
});
const capBad = caps.filter((r) => !(r.cap >= r.table && r.cap >= r.want - 0.02 && r.cap <= r.want + 0.1));
const tight = caps.filter((r) => r.delivery > r.table);
P.check("0a. Z5: all 180 wave caps (S1-10 x W1-3 x paceMul .75 / 1 / 1.35 / 1.7 / 2.05 / 2.5) = max(table cap, delivery x 1.25 + 4 s) (+-.02 s), never below the table",
  caps.length === 180 && capBad.length === 0, { bad: capBad.slice(0, 4), deliveryOverTable: tight.length, samples: caps.filter((r) => r.mul === 1 && r.w === 3).map((r) => `S${r.L} W3 d${r.delivery} cap ${r.table}->${r.cap}`) });

// ---- 0b. Z5: a pilot who keeps up never times out: S1 W3 (stream delivery ~23 s > the 22 s table cap) at paceMul 1.05
// (just above the Z13 floor: quota 13, the table's empty-field rule) with a killer that keeps exactly one plate of backlog (kills the oldest plate once a newer one is up and the oldest is
// 0.5 s old, the last one after 0.5 s), so the field is never empty and the stream alone delivers the quota ----
await jumpTo(P, 0);
const keep = await P.g(async () => {
  const g = window.game;
  g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.powerAcc = -1e9;
  g.pacePin(1.05);
  g.beginWave(2);
  g.levelT = 0;
  const t0 = g.playClock, cap = g.waveTuningNow().cap, quota = g.waveQuota();
  let timedOut = false, byQuota = null, maxBacklog = 0, emptyS = 0;
  onGameHook("waveWillEnd", function (e) { if (byQuota === null) { byQuota = e.byQuota; timedOut = !e.byQuota; } });
  onGameHook("tick", function (e) {
    if (byQuota !== null || this.wave !== 2) return;
    const alive = this.enemies.filter((en) => en.alive && !en.dying && en.kind !== "bossMinion");
    if (alive.length === 0) emptyS += e.dt;
    maxBacklog = Math.max(maxBacklog, alive.length);
    alive.sort((a, b) => (b.age || 0) - (a.age || 0));
    const oldest = alive[0];
    const last = this.waveKills + alive.length >= this.waveQuota();
    if (oldest && (oldest.age || 0) >= 0.5 && (alive.length >= 2 || last)) this.killEnemy(oldest);
  });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const w0 = performance.now();
  while (byQuota === null && performance.now() - w0 < 45000) await frame();
  g.pacePin(null);
  return { cap, table: LEVELS[0].cap, quota, byQuota, timedOut, waveT: Math.round(g.waveT * 100) / 100, playS: Math.round((g.playClock - t0) * 100) / 100, kills: g.waveKills, maxBacklog, emptyS: Math.round(emptyS * 100) / 100 };
});
P.check("0b. Z5: S1 W3 at paceMul 1.05, a pilot who kills every plate with one plate of backlog: the wave ends by quota after the 22 s table cap (no timeout), its cap > 1.25 x that time",
  keep.byQuota === true && !keep.timedOut && keep.kills >= keep.quota && keep.waveT > keep.table && keep.cap > keep.waveT && keep.cap > keep.table && keep.maxBacklog >= 1, keep);

// ---- 1. PERFECT WAVE by quota ----
await jumpTo(P, 3);
const pw = await P.g(() => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null;
  g.beginWave(0);
  g.waveKills = g.waveQuota(); g.waveDmg = 0;
  const before = g.stats.score;
  g.clearBanners();
  g.endWave();
  return { gained: g.stats.score - before, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), perfect: g.levelStats.perfectWaves, cue: g.sfx.lastCue };
});
P.check("1. S4 W1 ended by quota with waveDmg 0: +1,000 (250 x 4) and a PERFECT WAVE callout", pw.gained === 1000 && pw.titles.includes("PERFECT WAVE") && pw.perfect >= 1, pw);

// ---- 2. timeout with 3 alive: they leave at once, 3 escaped ----
// Z13: from here to 5 every wave is pinned just above the floor (1.1), where D3 / Z5 apply
const ABOVE = 1.1;
await P.g((m) => window.game.pacePin(m), ABOVE);
await jumpTo(P, 3);
await scriptTimeout(["neon", "grid", "volt"], 0);
const cap = await P.g(() => {
  const g = window.game, R = window.__stkRec;
  return { phase: g.wavePhase, perfect: g.levelStats.perfectWaves | 0, perfect0: window.__stk.perfect0, cue: g.sfx.lastCue, alive: g.enemies.filter((e) => e.alive && !e.dying).length,
    titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), score: g.stats.score, score0: window.__stk.score0, hp: g.player.hp, hp0: window.__stk.hp0,
    timeout: g.paceSnapshot().timeout, byQuota: g._waveByQuota, kills: g.waveKills, dmg: g.waveDmg | 0, modes: { ...R.modes }, sprites: R.sprites, cap: window.__stk.cap, table: LEVELS[g.levelIndex].cap,
    escaping: (g.dyingPlates || []).filter((d) => d.mode === "escape").map((d) => d.text) };
});
P.check("2a. at the (computed, >= table) cap with 3 plates up (quota unmet, 2 kills, waveDmg 0: the old rule would pay): drain, no PERFECT WAVE, score and hp unchanged, no waveClear sting; the 3 plates left at once as 'escape' plates (no detonation, no explosion sprite)",
  cap.phase === "drain" && cap.byQuota === false && cap.kills === 2 && cap.dmg === 0 && cap.perfect === cap.perfect0 && !cap.titles.includes("PERFECT WAVE") && cap.score === cap.score0 && cap.hp === cap.hp0 &&
  !/^waveClear/.test(String(cap.cue)) && cap.alive === 0 && cap.modes.escape === 3 && !cap.modes.detonate && cap.sprites === 0 && cap.escaping.length === 3 && !!cap.timeout && cap.timeout.n === 3 && cap.cap >= cap.table, cap);
// the leaving plates move off to the right and fade (full motion)
const motion = await P.g(async () => {
  const g = window.game, frame = () => new Promise((r) => requestAnimationFrame(r));
  const out = [];
  for (let i = 0; i < 40; i++) { await frame(); const d = (g.dyingPlates || []).find((x) => x.mode === "escape" && x.text === "neon"); if (!d) break; out.push({ t: Math.round(d.t * 1000) / 1000, dx: Math.round((d.drawX || d.x) - d.x) }); }
  return out;
});
P.check("2b. full motion: an escaping plate warps off to the right (drawX grows past +100 px within its .6 s) and is gone by .7 s",
  motion.length >= 4 && motion.length <= 45 && motion[motion.length - 1].dx >= 100 && motion.every((m, i) => i === 0 || m.dx >= motion[i - 1].dx), { frames: motion.length, first: motion[0], last: motion[motion.length - 1] });
const tDrain = Date.now();
await waitFor(P, () => window.game.wavePhase !== "drain", 8000);
const drainS = (Date.now() - tDrain) / 1000;
const end = await P.g(() => {
  const g = window.game;
  const s = g.paceSnapshot();
  return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), alive: g.enemies.filter((e) => e.alive && !e.dying).length,
    hp: g.player.hp, hp0: window.__stk.hp0, sr: document.getElementById("srAnnounce").textContent, carry: s.state.carry, carryTo: s.state.carryTo, stats: s.stats, cue: g.sfx.lastCue,
    calloutColor: g.callout && g.callout.color, calloutDur: g.callout && g.callout.dur };
});
P.check("2c. at the drain end (<= 1.5 s, the field is empty): callout 'WAVE TIMED OUT · 3 ESCAPED' (magenta, 1.6 s), hp unchanged, #srAnnounce says '3 escaped and join wave 2', carry 3 -> wave 2",
  drainS <= 1.5 && end.titles.includes("WAVE TIMED OUT · 3 ESCAPED") && end.calloutColor === "magenta" && end.calloutDur === 1.6 && end.alive === 0 && end.hp === end.hp0 &&
  /timed out/.test(end.sr) && /3 escaped and join wave 2/.test(end.sr) && end.carry === 3 && end.carryTo && end.carryTo.level === 4 && end.carryTo.wave === 1 && end.cue === "lockLost", { drainS, end });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 4000);
const w2 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { quota: g.waveQuota(), mul: s.state.applied.mul, carry: s.state.carry, last: s.last, cap: g.waveTuningNow().cap }; });
P.check("2d. the next wave's quota is round(16 x paceMul) + 3, the carry is spent, and its cap covers the bigger quota (>= table)",
  w2.quota === Math.round(16 * w2.mul) + 3 && w2.carry === 0 && w2.last.carry === 3 && w2.cap >= 28, w2);

// ---- 3. Z5: the cap passes with an empty field (2 kills, quota unmet): no timeout, the cap lifts, the wave ends by quota ----
await P.g(() => {
  const g = window.game;
  g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
  g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveKills = 2; g.waveDmg = 0; g.powerAcc = -1e9;
  g.clearBanners();
  window.__stk = { cap0: g.waveTuningNow().cap, perfect0: g.levelStats.perfectWaves | 0 };
  g.waveT = g.waveTuningNow().cap + 0.5;
});
await sleep(400);
const empty = await P.g(() => { const g = window.game; return { phase: g.wavePhase, wave: g.wave, capLifted: g.waveTuningNow().cap === Infinity, cap0: window.__stk.cap0, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), timeout: g.paceSnapshot().timeout }; });
await P.g(() => { const g = window.game; g.waveKills = g.waveQuota(); });
await waitFor(P, () => window.game.wavePhase !== "spawn", 3000);
const emptyEnd = await P.g(() => { const g = window.game; return { phase: g.wavePhase, byQuota: g._waveByQuota, perfect: (g.levelStats.perfectWaves | 0) - window.__stk.perfect0, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title) }; });
P.check("3. Z5: the cap passes with an empty field (2 kills, quota unmet): no timeout (still spawning, cap lifted, no WAVE TIMED OUT); the quota then ends it by quota with its PERFECT WAVE",
  empty.phase === "spawn" && empty.wave === 1 && empty.capLifted && empty.cap0 > 0 && !empty.titles.some((t) => /^WAVE TIMED OUT/.test(t)) && !empty.timeout &&
  emptyEnd.phase === "drain" && emptyEnd.byQuota === true && emptyEnd.perfect === 1 && emptyEnd.titles.includes("PERFECT WAVE"), { empty, emptyEnd });
await waitFor(P, () => window.game.wave === 2 && window.game.wavePhase === "spawn", 6000);

// ---- 4. wave-3 timeout: callout, approach, no carry ----
await scriptTimeout(["neon", "grid"]);
await waitFor(P, () => window.game.wavePhase !== "drain", 8000);
const w3to = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), banner: g.banner && g.banner.eyebrow, carry: s.state.carry, carryTo: s.state.carryTo, backoffTo: s.state.backoffTo, modes: { ...window.__stkRec.modes } }; });
P.check("4. wave 3 times out with 2 alive: they leave, 'WAVE TIMED OUT · 2 ESCAPED' over the WARNING approach banner, the approach starts, nothing carries (and no Z12 back-off: no next wave in the sector)",
  w3to.phase === "approach" && w3to.titles.includes("WAVE TIMED OUT · 2 ESCAPED") && w3to.banner === "WARNING" && w3to.carry === 0 && w3to.carryTo === null && w3to.backoffTo === null && w3to.modes.escape === 2 && !w3to.modes.detonate, w3to);

// ---- 4b. the sector clock cuts a wave-3 drain: the callout still comes (bossWillApproach) with the plates that left ----
await jumpTo(P, 3);
await scriptTimeout(["neon", "grid", "volt"], 2);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await waitFor(P, () => window.game.wavePhase === "approach", 3000);
const cut = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), timeout: s.timeout, carry: s.state.carry, modes: { ...window.__stkRec.modes } }; });
await sleep(200);
const cutAfter = await callouts();
P.check("4b. levelT reaches the duration during a timed-out wave-3 drain: the callout reads 'WAVE TIMED OUT · 3 ESCAPED' once (the 3 that left at the cap), no carry",
  cut.phase === "approach" && cut.titles.filter((t) => /^WAVE TIMED OUT/.test(t)).length === 1 && cut.titles.includes("WAVE TIMED OUT · 3 ESCAPED") && cut.timeout === null && cut.carry === 0 &&
  cut.modes.escape === 3 && cutAfter.filter((t) => /^WAVE TIMED OUT/.test(t)).length <= 1, { cut, cutAfter });

// ---- 5. Retry sector after a carry ----
await jumpTo(P, 1);
await scriptTimeout(["neon", "grid", "volt"], 0);
await waitFor(P, () => window.game.wavePhase === "banner", 8000);
const pending = await P.g(() => ({ ...window.game.paceSnapshot().state }));
await P.g(() => window.game.restartLevel());
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 6000);
const retry = await P.g(() => { const g = window.game; const s = g.paceSnapshot().state; return { carry: s.carry, carryTo: s.carryTo, cpMul: s.cpMul, mul: s.applied && s.applied.mul, quota: g.waveQuota(), wave: g.wave }; });
P.check("5. S2: a pending carry of 3 for wave 2, then Retry sector: carry 0, pace back to the checkpoint (cpMul), W1 quota round(10 x paceMul) with no carry",
  pending.carry === 3 && pending.carryTo && pending.carryTo.wave === 1 && retry.carry === 0 && retry.carryTo === null && retry.wave === 0 && retry.cpMul === pending.cpMul &&
  Math.abs(retry.mul - retry.cpMul) <= 0.35 + 1e-9 && retry.quota === Math.round(10 * retry.mul), { pending, retry });

// ---- 7. Z12 safety net: a timeout with no leak lowers the next wave's target; cleared by Retry / sector entry ----
// A stubbed pilot (run speed 110 WPM, acquisition 300 ms) on S4: W1 steps 1.0 -> 1.35 and W2's own target is ~1.58. The
// back-off target is stepMax under the slower of that and W1's 1.35 (review Z12-B3; before it, own target - 0.35 ~ 1.23),
// so W2 runs at 1.0.
// (the sector's W1 already started at the table pace: applied is dropped so the probe's beginWave(0) is a fresh step from 1.0)
await P.g(() => window.game.pacePin(null));   // 7a-7d: the step rule from a stubbed pilot (above the floor)
const stubPilot = () => P.g(() => { const g = window.game; g.speedFor = () => ({ wpm: 110, n: 40 }); g.typistAcquireMs = () => 300; const ps = g.paceState(); ps.applied = null; ps.mul = 1; });
const unstubPilot = () => P.g(() => { const g = window.game; delete g.speedFor; delete g.typistAcquireMs; });
const targetS4 = await P.g(() => paceTargetMul(paceEffCps(110 / 12, paceMeanLen(LEVELS[3]), 300), LEVELS[3].targetCps));
await P.page.emulateMedia({ reducedMotion: "no-preference" });
await jumpTo(P, 3);
await stubPilot();
await scriptTimeout(["neon", "grid", "volt"], 0);   // 2 kills, 0 leaks at the cap
const bo1 = await P.g(() => { const s = window.game.paceSnapshot(); return { w1: s.last, backoffTo: s.state.backoffTo, stats: s.stats.backoffs }; });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 8000);
const bo2 = await P.g(() => { const s = window.game.paceSnapshot(); return { w2: s.last, backoffTo: s.state.backoffTo, stats: s.stats.backoffs }; });
const bt2 = Math.max(1, Math.min(targetS4, bo1.w1.mul) - 0.35);   // the back-off target
const want2 = Math.round(Math.min(bo1.w1.mul + 0.35, Math.max(bo1.w1.mul - 0.35, bt2)) * 100) / 100;   // the step rule from W1
P.check("7a. Z12: S4 W1 (1.35) times out with 2 kills and no leak -> backoffTo wave 2; W2's target drops 0.35 under the slower of its own (~1.58) and W1's pace (floor 1.0), so the step rule runs W2 at 1.0: below W1 and below its own target; the back-off is spent",
  bo1.w1.mul === 1.35 && bo1.backoffTo && bo1.backoffTo.level === 4 && bo1.backoffTo.wave === 1 && bo2.w2.backoff === true && Math.abs(bo2.w2.target - Math.round(bt2 * 100) / 100) < 0.011 &&
  bo2.w2.mul === want2 && want2 === 1 && bo2.w2.mul < bo1.w1.mul && bo2.w2.mul < Math.round(Math.min(1.7, targetS4) * 100) / 100 && bo2.backoffTo === null && bo2.stats === bo1.stats + 1, { targetS4, bt2, want2, bo1, bo2 });
// a timeout with a leak in the wave sets nothing
await jumpTo(P, 3);
await stubPilot();
await resetRec();
const leakTo = await P.g(() => {
  const g = window.game;
  g.beginWave(0);
  g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
  g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveKills = 2; g.powerAcc = -1e9;
  const xs = [700, 900, 1100];
  const plates = ["neon", "grid", "volt"].map((w, i) => { const en = new Enemy({ text: w, x: xs[i], y: LANE_YS[i + 1], speed: 0, lane: i + 1 }); g.enemies.push(en); return en; });
  g.player.shield = 0; g.invulnT = 0;
  g.leakEnemy(plates[0]);   // one leak before the cap
  g.clearBanners();
  g.waveT = g.waveTuningNow().cap;
  return { hp: g.player.hp };
});
await waitFor(P, () => window.game.wavePhase === "drain", 3000);
const bo3 = await P.g(() => { const s = window.game.paceSnapshot(); return { backoffTo: s.state.backoffTo, timeout: s.timeout, leaks: window.game._paceWaveLeaks }; });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 8000);
const bo4 = await P.g(() => window.game.paceSnapshot().last);
P.check("7b. Z12: a timeout with a leak in the wave (1 leaked, 2 escaped) sets no back-off; W2 steps toward its own target",
  bo3.backoffTo === null && bo3.leaks === 1 && bo3.timeout && bo3.timeout.n === 2 && bo4.backoff === false && Math.abs(bo4.target - Math.round(targetS4 * 100) / 100) < 0.011, { bo3, bo4, targetS4 });
// Retry (checkpoint restore) clears a pending back-off; so does a sector entry
await jumpTo(P, 3);
await stubPilot();
await scriptTimeout(["neon", "grid"], 0);
const bo5 = await P.g(() => ({ ...window.game.paceSnapshot().state.backoffTo }));
await P.g(() => window.game.restartLevel());
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 6000);
const bo6 = await P.g(() => { const s = window.game.paceSnapshot(); return { backoffTo: s.state.backoffTo, w1: s.last }; });
const bo7 = await P.g(() => {
  const g = window.game;
  g.paceState().backoffTo = { level: 4, wave: 1 };
  g.startLevel(4, { fromMenu: true, fresh: true });   // sector 5 entry
  const s = g.paceSnapshot();
  return { backoffTo: s.state.backoffTo, level: g.levelIndex + 1 };
});
await unstubPilot();
P.check("7c. Z12: a pending back-off (S4 W1 clean timeout) is cleared by Retry sector (W1 starts without it) and by a sector entry (S5)",
  bo5.level === 4 && bo5.wave === 1 && bo6.backoffTo === null && bo6.w1.backoff === false && bo7.backoffTo === null && bo7.level === 5, { bo5, bo6, bo7 });
// 7d. review Z12-B3: the pace still ramping above the floor. Run speed 200 WPM, acquisition 120 ms, S4 W1 stepping from 1.35:
// W1 runs 1.70 toward an own target near 2.5; it times out with no leak. Own target - 0.35 alone (~2.15) would step W2 up
// to 2.05, faster than the wave that timed out; the back-off target 1.70 - 0.35 runs it at 1.35.
const targetS4fast = await P.g(() => paceTargetMul(paceEffCps(200 / 12, paceMeanLen(LEVELS[3]), 120), LEVELS[3].targetCps));
await jumpTo(P, 3);
await P.g(() => { const g = window.game; g.speedFor = () => ({ wpm: 200, n: 40 }); g.typistAcquireMs = () => 120; const ps = g.paceState(); ps.applied = null; ps.mul = 1.35; });
await scriptTimeout(["neon", "grid", "volt"], 0);   // 2 kills, 0 leaks at the cap
const bo8 = await P.g(() => { const s = window.game.paceSnapshot(); return { w1: s.last, backoffTo: s.state.backoffTo }; });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 8000);
const bo9 = await P.g(() => window.game.paceSnapshot().last);
await unstubPilot();
const step = (p, t) => Math.round(Math.min(2.5, Math.max(1, Math.min(p + 0.35, Math.max(p - 0.35, t)))) * 100) / 100;
const oldRule = step(bo8.w1.mul, Math.max(1, targetS4fast - 0.35));
P.check("7d. Z12 (review Z12-B3): while the pace ramps (S4, own target >= 2.05, W1 stepped 1.35 -> 1.70) a clean W1 timeout runs W2 at 1.35 = W1 - 0.35 (target 1.35), not faster than W1 (own target - 0.35 alone would step it to 2.05)",
  bo8.w1.mul === 1.7 && bo8.backoffTo && bo8.backoffTo.level === 4 && bo8.backoffTo.wave === 1 && targetS4fast >= 2.05 && bo9.backoff === true &&
  bo9.mul === 1.35 && Math.abs(bo9.target - 1.35) < 0.011 && bo9.mul < bo8.w1.mul && oldRule > bo8.w1.mul, { targetS4fast, oldRule, bo8, bo9 });

// ---- 6. reduced motion ----
await P.g((m) => window.game.pacePin(m), ABOVE);
await P.page.emulateMedia({ reducedMotion: "reduce" });
await sleep(200);
await jumpTo(P, 3);
const rm0 = await P.g(() => window.game.reduceMotion);
await scriptTimeout(["neon", "grid", "volt"], 0);
const rmEscape = await P.g(async () => {
  const g = window.game, frame = () => new Promise((r) => requestAnimationFrame(r));
  const out = [];
  for (let i = 0; i < 40; i++) { await frame(); const d = (g.dyingPlates || []).find((x) => x.mode === "escape" && x.text === "neon"); if (!d) break; out.push({ t: Math.round(d.t * 1000) / 1000, dx: Math.round((d.drawX === undefined ? d.x : d.drawX) - d.x) }); }
  return out;
});
const seen = await P.g(async () => {
  const g = window.game;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (!(g.callout && /^WAVE TIMED OUT/.test(g.callout.title)) && performance.now() - t0 < 9000) await frame();
  const out = [];
  for (let i = 0; i < 14 && g.callout && /^WAVE TIMED OUT/.test(g.callout.title); i++) { await frame(); out.push({ t: Math.round(g.callout.t * 1000) / 1000, scale: g.callout.titleScale }); }
  return out;
});
P.check("6. reduced motion: the leaving plates fade in place (dx 0 on every frame) and the callout draws at titleScale 1 from its first frames (no slam, fade only)",
  rm0 === true && rmEscape.length >= 4 && rmEscape.every((m) => m.dx === 0) && seen.length >= 6 && seen.some((s) => s.t < 0.24) && seen.every((s) => s.scale === 1), { rm0, rmEscape: rmEscape.slice(-2), frames: rmEscape.length, seen });
await P.shot("timeout-callout-reduced-motion");
await P.g(() => window.game.pacePin(null));

errorsCheck(P);
await P.finish();
