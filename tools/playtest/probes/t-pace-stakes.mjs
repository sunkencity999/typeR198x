// t-pace-stakes (PACE, D3 waves; CONTRACT 6 PACE): PERFECT WAVE by quota only; a wave that hits its cap plays no clear
// sting, pays nothing, keeps its plates typable through the drain and at the drain end calls "WAVE TIMED OUT · N
// ESCAPED" (announced), detonating the leftovers harmlessly; N joins the next wave's quota inside the sector, never past
// wave 3; Retry clears a pending carry; the sector clock cutting a wave-3 drain still gets the callout; reduced motion
// fades the callout without the slam. ~60 s. PASS = the stakes behave as D3 (lead ruling Q4: one callout at the drain end).
// Usage: node tools/playtest/probes/t-pace-stakes.mjs
import { openProbe, sleep, waitFor, startFresh, jumpTo, press, hold, errorsCheck } from "./pace_lib.mjs";

const P = await openProbe("t-pace-stakes");
await startFresh(P, "PACE");

const callouts = () => P.g(() => { const g = window.game; return [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title); });
const typeWord = async (w) => { for (const k of w) { await press(P, k); await sleep(25); } };

// A scripted timeout on the current sector: hold the spawner, three static plates, the wave clock at its cap.
async function scriptTimeout(words, wave = null) {
  await P.g(({ words, wave }) => {
    const g = window.game;
    if (wave !== null) g.beginWave(wave);
    g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
    g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveKills = 0; g.waveDmg = 0; g.powerAcc = -1e9;
    g.levelT = Math.min(g.levelT, LEVELS[g.levelIndex].cap);
    const xs = [700, 900, 1100];
    words.forEach((w, i) => g.enemies.push(new Enemy({ text: w, x: xs[i], y: LANE_YS[i + 1], speed: 0, lane: i + 1 })));
    g.clearBanners();
    window.__stk = { perfect0: g.levelStats.perfectWaves | 0, score0: g.stats.score };
    g.waveT = LEVELS[g.levelIndex].cap;   // the next frame's tickWaves ends the wave by its cap
  }, { words, wave });
  return waitFor(P, () => window.game.wavePhase === "drain", 3000);
}

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

// ---- 2. timeout with 2 escaped ----
await jumpTo(P, 3);
await scriptTimeout(["neon", "grid", "volt"], 0);
const cap = await P.g(() => {
  const g = window.game;
  return { phase: g.wavePhase, perfect: g.levelStats.perfectWaves | 0, perfect0: window.__stk.perfect0, cue: g.sfx.lastCue, alive: g.enemies.filter((e) => e.alive && !e.dying).length,
    titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), score: g.stats.score, score0: window.__stk.score0, timeout: g.paceSnapshot().timeout, byQuota: g._waveByQuota };
});
P.check("2a. at the cap (quota unmet, waveDmg 0): drain, no PERFECT WAVE, perfectWaves and score unchanged, no waveClear sting, all 3 plates still alive",
  cap.phase === "drain" && cap.byQuota === false && cap.perfect === cap.perfect0 && !cap.titles.includes("PERFECT WAVE") && cap.score === cap.score0 && !/^waveClear/.test(String(cap.cue)) && cap.alive === 3 && !!cap.timeout, cap);
await typeWord("neon");
await sleep(150);
const mid = await P.g(() => { const g = window.game; return { alive: g.enemies.filter((e) => e.alive && !e.dying).length, hp: g.player.hp, score: g.stats.score, phase: g.wavePhase, kills: g.waveKills }; });
const tDrain = Date.now();
await waitFor(P, () => window.game.wavePhase !== "drain", 8000);
const drainS = (Date.now() - tDrain) / 1000;
const end = await P.g(() => {
  const g = window.game;
  const s = g.paceSnapshot();
  return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), alive: g.enemies.filter((e) => e.alive && !e.dying).length,
    hp: g.player.hp, score: g.stats.score, sr: document.getElementById("srAnnounce").textContent, carry: s.state.carry, carryTo: s.state.carryTo, stats: s.stats, cue: g.sfx.lastCue,
    calloutColor: g.callout && g.callout.color, calloutDur: g.callout && g.callout.dur };
});
P.check("2b. typed one plate in the drain; at the drain end (<= 6.2 s): callout 'WAVE TIMED OUT · 2 ESCAPED' (magenta, 1.6 s), 2 detonated, hp and score unchanged by the detonation, #srAnnounce says 'timed out', carry 2 -> wave 2",
  mid.alive === 2 && drainS <= 6.4 && end.titles.includes("WAVE TIMED OUT · 2 ESCAPED") && end.calloutColor === "magenta" && end.calloutDur === 1.6 && end.alive === 0 && end.hp === mid.hp && end.score === mid.score &&
  /timed out/.test(end.sr) && /2 escaped and join wave 2/.test(end.sr) && end.carry === 2 && end.carryTo && end.carryTo.level === 4 && end.carryTo.wave === 1 && end.cue === "lockLost", { mid, drainS, end });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 4000);
const w2 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { quota: g.waveQuota(), mul: s.state.applied.mul, carry: s.state.carry, last: s.last }; });
P.check("2c. the next wave's quota is round(16 x paceMul) + 2 and the carry is spent", w2.quota === Math.round(16 * w2.mul) + 2 && w2.carry === 0 && w2.last.carry === 2, w2);

// ---- 3. timeout, everything killed in the drain: no carry ----
await scriptTimeout(["neon", "grid", "volt"]);
for (const w of ["neon", "grid", "volt"]) await typeWord(w);
await waitFor(P, () => window.game.wavePhase !== "drain", 8000);
const all = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), carry: s.state.carry, carryTo: s.state.carryTo, sr: document.getElementById("srAnnounce").textContent }; });
await waitFor(P, () => window.game.wave === 2 && window.game.wavePhase === "spawn", 4000);
const w3 = await P.g(() => { const g = window.game; return { quota: g.waveQuota(), mul: g.paceSnapshot().state.applied.mul }; });
P.check("3. a timed-out wave whose plates were all typed in the drain: callout 'WAVE TIMED OUT', 'Wave 2 timed out.' announced, no carry (next quota round(18 x mul))",
  all.titles.includes("WAVE TIMED OUT") && all.carry === 0 && all.carryTo === null && /Wave 2 timed out\./.test(all.sr) && w3.quota === Math.round(18 * w3.mul), { all, w3 });

// ---- 4. wave-3 timeout: callout, approach, no carry ----
await scriptTimeout(["neon", "grid"]);
await waitFor(P, () => window.game.wavePhase !== "drain", 8000);
const w3to = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), banner: g.banner && g.banner.eyebrow, carry: s.state.carry, carryTo: s.state.carryTo }; });
P.check("4. wave 3 times out with 2 alive: 'WAVE TIMED OUT · 2 ESCAPED' over the WARNING approach banner, the approach starts, nothing carries",
  w3to.phase === "approach" && w3to.titles.includes("WAVE TIMED OUT · 2 ESCAPED") && w3to.banner === "WARNING" && w3to.carry === 0 && w3to.carryTo === null, w3to);

// ---- 4b. the sector clock cuts a wave-3 drain: the callout still comes (bossWillApproach) ----
await jumpTo(P, 3);
await scriptTimeout(["neon", "grid", "volt"], 2);
await sleep(200);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await waitFor(P, () => window.game.wavePhase === "approach", 3000);
const cut = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { phase: g.wavePhase, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title), timeout: s.timeout, carry: s.state.carry }; });
await sleep(200);
const cutAfter = await callouts();
P.check("4b. levelT reaches the duration during a timed-out wave-3 drain: the approach detonates the 3 leftovers and the callout reads 'WAVE TIMED OUT · 3 ESCAPED' once, no carry",
  cut.phase === "approach" && cut.titles.filter((t) => /^WAVE TIMED OUT/.test(t)).length === 1 && cut.titles.includes("WAVE TIMED OUT · 3 ESCAPED") && cut.timeout === null && cut.carry === 0 &&
  cutAfter.filter((t) => /^WAVE TIMED OUT/.test(t)).length <= 1, { cut, cutAfter });

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

// ---- 6. reduced motion ----
await P.page.emulateMedia({ reducedMotion: "reduce" });
await sleep(200);
await jumpTo(P, 3);
const rm0 = await P.g(() => window.game.reduceMotion);
await scriptTimeout(["neon", "grid", "volt"], 0);
const seen = await P.g(async () => {
  const g = window.game;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  while (!(g.callout && /^WAVE TIMED OUT/.test(g.callout.title)) && performance.now() - t0 < 9000) await frame();
  const out = [];
  for (let i = 0; i < 14 && g.callout && /^WAVE TIMED OUT/.test(g.callout.title); i++) { await frame(); out.push({ t: Math.round(g.callout.t * 1000) / 1000, scale: g.callout.titleScale }); }
  return out;
});
P.check("6. reduced motion: the same timeout runs; the callout draws at titleScale 1 from its first frames (no slam, fade only)",
  rm0 === true && seen.length >= 6 && seen.some((s) => s.t < 0.24) && seen.every((s) => s.scale === 1), { rm0, seen });
await P.shot("timeout-callout-reduced-motion");

errorsCheck(P);
await P.finish();
