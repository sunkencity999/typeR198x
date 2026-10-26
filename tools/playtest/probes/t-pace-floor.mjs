// t-pace-floor (PACE, lead ruling Z13: the floor wave). A campaign wave whose paceMul after the step rule (and any
// back-off; a probe pin too) is exactly 1.0 with no escaped carry runs on live a0a3845's wave rule end to end
// (a0a3845 assets/js/game/40-combat.js beginWave 227-242, the spawn tick 195-199, endWave 245-258, the drain 201-213,
// the leak loop 662-667; 20-constants.js DRAIN_MIN_S .4 / DRAIN_MAX_S 6, duration = 3 x cap): the table quota, stream
// and cap (no Z5 extension; the cap ends the wave whatever is on the field, an empty field included), PERFECT WAVE for
// no damage and a kill (at the cap too) with the clear sting, the plates still up at the cap stay in the drain
// (typeable, they leak and hurt, the drain's 6 s end or the boss approach detonates them), no WAVE TIMED OUT, no
// escape ceremony, no carry, no clean-timeout back-off. A carried 1.0 wave, a wave above 1.0, Cadet (0.75) and the
// Daily Sortie keep D3 / Z5 / Z12. Continue (a replayed wave) keeps the floor; a replayed carried wave does not.
// ~45 s. PASS = floor waves behave as live a0a3845's waves.
// Usage: node tools/playtest/probes/t-pace-floor.mjs
import { openProbe, sleep, waitFor, startFresh, jumpTo, errorsCheck, reloadInPlace } from "./pace_lib.mjs";

const P = await openProbe("t-pace-floor");
await startFresh(P, "FLOOR");

// a0a3845's LEVEL_TABLE quota and cap columns (git show a0a3845:assets/js/core/20-constants.js): the floor wave's length
// and quota must be these
const LIVE_CAP = [22, 24, 26, 28, 30, 32, 34, 36, 38, 40];
const LIVE_QUOTA = [[8, 10, 12], [10, 12, 14], [12, 14, 16], [14, 16, 18], [15, 18, 21], [16, 19, 22], [17, 20, 23], [18, 21, 24], [19, 22, 25], [20, 24, 28]];

const titles = () => P.g(() => { const g = window.game; return [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title); });
// Recorders: every banner / callout title shown, dying-plate records by mode (escape / detonate / kill / slam), waveWillEnd
// and waveDrained payloads, explosion sprites.
await P.g(() => {
  const g = window.game;
  const R = window.__fl = { banners: [], modes: {}, ends: [], drains: [] };
  const sb = g.showBanner;
  g.showBanner = function (b) { if (b) R.banners.push(b.title || b.eyebrow || ""); return sb.apply(this, arguments); };
  const np = g.notePlateDeath;
  g.notePlateDeath = function (en, mode) { R.modes[mode] = (R.modes[mode] | 0) + 1; return np.apply(this, arguments); };
  onGameHook("waveWillEnd", function (e) { R.ends.push({ wave: e.wave, level: e.level, byQuota: e.byQuota, floor: e.floor, perfect: e.perfect, clearSfx: e.clearSfx, alive: e.alive, waveT: Math.round(e.waveT * 100) / 100 }); });
  onGameHook("waveDrained", function (e) { R.drains.push({ wave: e.wave, level: e.level, byQuota: e.byQuota, floor: e.floor, detonated: e.detonated }); });
});
const resetRec = () => P.g(() => { const R = window.__fl; R.banners = []; R.modes = {}; R.ends = []; R.drains = []; });

// ---- 1. the floor wave's tuning is a0a3845's: every sector and wave at paceMul 1.0 (no carry) ----
const table = await P.g(({ LIVE_CAP, LIVE_QUOTA }) => {
  const rows = [], bad = [];
  let extended = 0;
  for (let i = 0; i < 10; i++) for (let w = 0; w < 3; w++) {
    const cfg = LEVELS[i];
    const plan = window.game.pacePlan(i, w, 0, 1);   // unknown pilot speed: target 1.0, the step rule from 1.0 stays at 1.0
    const t = plan.tuning;
    const z5 = paceWaveCap(cfg, w, t.quota, 1);
    if (z5 > cfg.cap + 1e-9) extended++;
    const ok = plan.mul === 1 && t.floor === true && t.cap === LIVE_CAP[i] && cfg.cap === LIVE_CAP[i] && cfg.duration === 3 * LIVE_CAP[i] && t.quota === LIVE_QUOTA[i][w] &&
      t.spawnMul === 1 && t.maxEnemiesAdd === 0 && t.speedMul === 1 && t.hungryMinAlive === HUNGRY_MIN_ALIVE && t.pressureCap === pressureCap(cfg);
    rows.push(`S${i + 1}W${w + 1} q${t.quota} cap ${t.cap} (Z5 ${z5})`);
    if (!ok) bad.push({ S: i + 1, W: w + 1, mul: plan.mul, floor: t.floor, cap: t.cap, quota: t.quota, spawnMul: t.spawnMul, add: t.maxEnemiesAdd, speedMul: t.speedMul, hungry: t.hungryMinAlive });
  }
  const above = window.game.pacePlan(4, 1, 8.7, 1.4).tuning;   // 1.75: not a floor wave, the Z5 cap
  return { n: rows.length, bad, extended, sample: rows.filter((r, k) => k % 7 === 0), above: { floor: above.floor, cap: above.cap, z5: paceWaveCap(LEVELS[4], 1, above.quota, above.spawnMul) } };
}, { LIVE_CAP, LIVE_QUOTA });
P.check("1. Z13: all 30 floor waves (S1-10 x W1-3 at paceMul 1.0, no carry) carry a0a3845's quota and cap (22 .. 40 s; duration 3 x cap) with the table stream (spawnMul 1, alive +0, speed x1, empty-field rule 1 alive); a wave at 1.75 keeps its Z5 cap",
  table.n === 30 && table.bad.length === 0 && table.extended >= 1 && table.above.floor === false && table.above.cap === table.above.z5, table);

// ---- 1b. the floor wave's spawn schedule is a0a3845's: the rate the spawner really accumulates ----
// a0a3845's waveSpawnRate (git show a0a3845:assets/js/core/20-constants.js, its mix from 30-content.js's length window;
// a0a3845 had no WORDS waveTextLen) per sector / wave: [rate at 0 kills, kills = floor(quota / 2), the rate there]
const LIVE_RATE = [[[0.653445, 4, 0.72605], [0.568421, 5, 0.631579], [0.446197, 6, 0.495775]], [[0.713472, 5, 0.792746], [0.6375, 6, 0.708333], [0.525938, 7, 0.584375]],
  [[0.69, 6, 0.766667], [0.636923, 7, 0.707692], [0.552, 8, 0.613333]], [[0.792047, 7, 0.880052], [0.692308, 8, 0.769231], [0.581213, 9, 0.645793]],
  [[0.762595, 7, 0.841679], [0.688017, 9, 0.764463], [0.599509, 10, 0.662949]], [[0.814737, 8, 0.905263], [0.744231, 9, 0.822571], [0.662568, 11, 0.736187]],
  [[0.76239, 8, 0.842117], [0.713592, 10, 0.79288], [0.652016, 11, 0.721313]], [[0.760823, 9, 0.845359], [0.722628, 10, 0.799096], [0.67243, 12, 0.747144]],
  [[0.699532, 9, 0.773167], [0.677541, 11, 0.752823], [0.644426, 12, 0.713165]], [[0.690945, 10, 0.767717], [0.676301, 12, 0.751445], [0.651646, 14, 0.724051]]];
const rate = await P.g(({ LIVE_RATE }) => {
  const g = window.game;
  const keep = { li: g.levelIndex, wave: g.wave, wt: g.waveTuning, kills: g.waveKills, acc: g.spawnAcc, hungryT: g.hungryT, enemies: g.enemies };
  // one spawner tick of 10 ms on an empty field with the empty-field timer held: spawnAcc grows by dt x the stream rate
  const measure = (i, w, kills, tuning) => {
    g.levelIndex = i; g.wave = w; g.waveTuning = Object.assign({}, tuning, { levelIndex: i, wave: w });
    g.enemies = []; g.waveKills = kills; g.spawnAcc = 0; g.hungryT = -1e9;
    g.tickSpawner(0.01, LEVELS[i]);
    return g.spawnAcc / 0.01;
  };
  const bad = [];
  let maxDev = 0, minWordsDev = Infinity;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  try {
    for (let i = 0; i < 10; i++) for (let w = 0; w < 3; w++) {
      const t = g.pacePlan(i, w, 0, 1).tuning;
      const [r0, h, rh] = LIVE_RATE[i][w];
      const a = measure(i, w, 0, t), b = measure(i, w, h, t);
      const dev = Math.max(Math.abs(a / r0 - 1), Math.abs(b / rh - 1));
      maxDev = Math.max(maxDev, dev);
      if (!(t.floor === true && dev < 1e-4)) bad.push({ S: i + 1, W: w + 1, floor: t.floor, rate: r6(a), live: r0, devPct: Math.round(dev * 1e4) / 100 });
      const words = waveSpawnRate(LEVELS[i], w, 0, t.quota);   // WORDS' stream (cfg.waveTextLen), what a carried 1.0 wave gets
      minWordsDev = Math.min(minWordsDev, Math.abs(words / r0 - 1));
    }
    // a 1.0 wave with 2 carried plates is not a floor wave: it keeps WORDS' stream (S3 W2: 6.2 % above a0a3845's)
    const ct = paceApplyTuning({ levelIndex: 2, wave: 1, quota: 1, spawnMul: 1, maxEnemiesAdd: 0, speedMul: 1, hungryMinAlive: HUNGRY_MIN_ALIVE, cap: 26, pressureCap: pressureCap(LEVELS[2]) }, LEVELS[2], 1, 1, 2);
    const carried = { floor: ct.floor, rate: r6(measure(2, 1, 0, ct)), words: r6(waveSpawnRate(LEVELS[2], 1, 0, ct.quota)), live: LIVE_RATE[2][1][0] };
    return { bad, maxDevPct: Math.round(maxDev * 1e6) / 1e4, minWordsDevPct: Math.round(minWordsDev * 1e4) / 100, carried };
  } finally {
    g.levelIndex = keep.li; g.wave = keep.wave; g.waveTuning = keep.wt; g.waveKills = keep.kills; g.spawnAcc = keep.acc; g.hungryT = keep.hungryT; g.enemies = keep.enemies;
  }
}, { LIVE_RATE });
P.check("1b. Z13: on all 30 floor waves the spawner accumulates a0a3845's stream rate (its waveSpawnRate at 0 kills and at half the quota, within 0.01 %; WORDS' waveTextLen mix differs from it by >= 0.03 % on every wave); a carried 1.0 wave keeps WORDS' rate",
  rate.bad.length === 0 && rate.maxDevPct < 0.01 && rate.minWordsDevPct >= 0.03 && rate.carried.floor === false &&
  Math.abs(rate.carried.rate / rate.carried.words - 1) < 1e-4 && rate.carried.rate > rate.carried.live * 1.05, rate);

// ---- 2. a fresh pilot's S1 W1 runs as a floor wave ----
const s1 = await P.g(() => { const g = window.game, t = g.waveTuningNow(), s = g.paceSnapshot(); return { level: g.levelIndex + 1, wave: g.wave, floor: t && t.floor, cap: t && t.cap, quota: g.waveQuota(), mul: s.state.applied && s.state.applied.mul, last: s.last }; });
P.check("2. fresh save, Start: S1 W1 at paceMul 1.0 with no carry is a floor wave (waveTuning.floor, _paceLast.floor) with a0a3845's 22 s cap and quota 8",
  s1.level === 1 && s1.wave === 0 && s1.floor === true && s1.cap === 22 && s1.quota === 8 && s1.mul === 1 && s1.last && s1.last.floor === true && s1.last.carry === 0, s1);

// A scripted floor wave reaching its cap: the spawner held, the given plates (x, speed px/s) on lanes 1-3, kills / damage
// before the cap as given, the wave clock one frame short of the table cap.
async function scriptCap(plates, { wave = null, kills = 2, dmg = 0 } = {}) {
  await resetRec();
  await P.g(({ plates, wave, kills, dmg }) => {
    const g = window.game;
    if (wave !== null) g.beginWave(wave);
    g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
    g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveKills = kills; g.waveDmg = dmg; g.powerAcc = -1e9;
    g.levelT = Math.min(g.levelT, LEVELS[g.levelIndex].cap);
    plates.forEach((p, i) => g.enemies.push(new Enemy({ text: p.text, x: p.x, y: LANE_YS[i + 1], speed: p.speed || 0, lane: i + 1 })));
    g.clearBanners();
    g.player.shield = 0; g.invulnT = 0;
    const t = g.waveTuningNow();
    window.__flS = { perfect0: g.levelStats.perfectWaves | 0, score0: g.stats.score, hp0: g.player.hp, cap: t.cap, floor: t.floor, timeouts0: g.paceStats().timeouts, escaped0: g.paceStats().escaped };
    g.waveT = t.cap - 0.001;   // the next frame's tickWaves crosses the cap
  }, { plates, wave, kills, dmg });
  return waitFor(P, () => window.game.wavePhase === "drain", 3000);
}

// ---- 3. S4 W1 (a fresh pilot's 1.0) at its cap with three plates up: live a0a3845's end ----
await jumpTo(P, 3);
await scriptCap([{ text: "neon", x: 760 }, { text: "grid", x: 980 }, { text: "volt", x: 330, speed: 140 }], { wave: 0 });
const atCap = await P.g(() => {
  const g = window.game, R = window.__fl, S = window.__flS, s = g.paceSnapshot();
  return { phase: g.wavePhase, waveT: Math.round(g.waveT * 1000) / 1000, cap: S.cap, floorTuning: S.floor, end: R.ends[R.ends.length - 1], cue: g.sfx.lastCue,
    perfect: (g.levelStats.perfectWaves | 0) - S.perfect0, gained: g.stats.score - S.score0, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title),
    alive: g.enemies.filter((e) => e.alive && !e.dying).map((e) => e.text), modes: { ...R.modes }, timeout: s.timeout, backoffTo: s.state.backoffTo, carryTo: s.state.carryTo };
});
P.check("3a. S4 W1 floor wave at a0a3845's 28 s cap with 3 plates up, 2 kills, no damage: it ends by the cap (byQuota false, floor true) into the drain with the clear sting and PERFECT WAVE +1,000 (live pays a damage-free wave at the cap); the 3 plates stay on the field (no escape), no timeout pending, no back-off",
  atCap.phase === "drain" && atCap.cap === 28 && atCap.floorTuning === true && atCap.end && atCap.end.byQuota === false && atCap.end.floor === true && atCap.end.perfect === true && atCap.end.clearSfx === true &&
  atCap.end.waveT >= 28 && atCap.end.waveT < 28.1 && /^waveClear/.test(String(atCap.cue)) && atCap.perfect === 1 && atCap.gained === 1000 && atCap.titles.includes("PERFECT WAVE") &&
  atCap.alive.length === 3 && !atCap.modes.escape && atCap.timeout === null && atCap.backoffTo === null && atCap.carryTo === null, atCap);
// in the drain: "volt" reaches the ship and hurts (as live), "neon" is typed down, "grid" waits for the 6 s drain end
const t0 = Date.now();
await waitFor(P, () => !window.game.enemies.some((e) => e.text === "volt" && e.alive), 4000);
const leak = await P.g(() => { const g = window.game, S = window.__flS; return { hp: g.player.hp, hp0: S.hp0, waveDmg: g.waveDmg | 0, modes: { ...window.__fl.modes }, phase: g.wavePhase, perfect: (g.levelStats.perfectWaves | 0) - S.perfect0 }; });
await P.g(() => { const g = window.game; for (const c of "neon") g.handleTyped(c); });
await sleep(150);
const typed = await P.g(() => { const g = window.game; return { alive: g.enemies.filter((e) => e.alive && !e.dying).map((e) => e.text), modes: { ...window.__fl.modes }, phase: g.wavePhase }; });
P.check("3b. drain: a leftover plate that reaches the ship leaks and damages the hull (the PERFECT WAVE paid at the cap stands, as live); another is typed down and scores; the field is not cleared at the cap",
  leak.hp < leak.hp0 && leak.waveDmg > 0 && leak.modes.slam === 1 && !leak.modes.escape && leak.phase === "drain" && leak.perfect === 1 &&
  typed.alive.length === 1 && typed.alive[0] === "grid" && typed.modes.kill >= 1 && typed.phase === "drain", { leak, typed });
await waitFor(P, () => window.game.wavePhase !== "drain", 9000);
const drainS = (Date.now() - t0) / 1000;
const after = await P.g(() => {
  const g = window.game, R = window.__fl, S = window.__flS, s = g.paceSnapshot(), st = g.paceStats();
  return { phase: g.wavePhase, banner: g.banner && g.banner.eyebrow, drain: R.drains[R.drains.length - 1], banners: R.banners.slice(), modes: { ...R.modes }, sr: document.getElementById("srAnnounce").textContent,
    carry: s.state.carry, carryTo: s.state.carryTo, backoffTo: s.state.backoffTo, timeouts: st.timeouts - S.timeouts0, escaped: st.escaped - S.escaped0 };
});
P.check("3c. the drain ends at a0a3845's DRAIN_MAX_S (6 s) with the last plate detonated (no escape), then the 'WAVE 2 / 3' banner; no 'WAVE TIMED OUT' callout or announcement at any point, no carry, no back-off, no timeout counted",
  drainS >= 5 && drainS <= 8 && after.phase === "banner" && after.banner === "WAVE 2 / 3" && after.drain && after.drain.byQuota === false && after.drain.floor === true && after.drain.detonated === 1 &&
  after.modes.detonate === 1 && !after.modes.escape && !after.banners.some((t) => /TIMED OUT/.test(t)) && !/timed out/i.test(after.sr) &&
  after.carry === 0 && after.carryTo === null && after.backoffTo === null && after.timeouts === 0 && after.escaped === 0, { drainS, after });
await waitFor(P, () => window.game.wave === 1 && window.game.wavePhase === "spawn", 4000);
const w2 = await P.g(() => { const g = window.game, s = g.paceSnapshot(), t = g.waveTuningNow(); return { quota: g.waveQuota(), mul: s.state.applied.mul, last: s.last, floor: t.floor, cap: t.cap }; });
P.check("3d. the next wave starts with no carry and no back-off: quota round(16 x paceMul), a floor wave again at 1.0 (cap 28)",
  w2.last.carry === 0 && w2.last.backoff === false && w2.quota === Math.round(16 * w2.mul) && (w2.mul !== 1 || (w2.floor === true && w2.cap === 28 && w2.quota === 16)), w2);

// ---- 4. the cap on an empty floor field ends the wave (no Z5 lift): PERFECT WAVE as live; damage or no kill pays none ----
await scriptCap([], { kills: 2 });
const empty = await P.g(() => { const g = window.game, R = window.__fl, S = window.__flS, t = g.waveTuningNow(); return { phase: g.wavePhase, end: R.ends[R.ends.length - 1], capLifted: t.cap === Infinity, perfect: (g.levelStats.perfectWaves | 0) - S.perfect0 }; });
await waitFor(P, () => window.game.wave === 2 && window.game.wavePhase === "spawn", 6000);
await scriptCap([{ text: "neon", x: 760 }], { kills: 3, dmg: 12 });
const hurt = await P.g(() => { const g = window.game, R = window.__fl, S = window.__flS; return { end: R.ends[R.ends.length - 1], perfect: (g.levelStats.perfectWaves | 0) - S.perfect0, titles: [g.callout, ...(g.calloutQueue || [])].filter(Boolean).map((c) => c.title) }; });
await jumpTo(P, 1);
await scriptCap([{ text: "neon", x: 760 }], { wave: 0, kills: 0 });
const nokill = await P.g(() => { const g = window.game, R = window.__fl, S = window.__flS; return { end: R.ends[R.ends.length - 1], perfect: (g.levelStats.perfectWaves | 0) - S.perfect0 }; });
P.check("4. floor waves at the cap: an empty field still ends the wave (the cap does not lift) with PERFECT WAVE for 2 kills and no damage; with 12 damage, or with no kill, no PERFECT WAVE (a0a3845: waveDmg 0 and waveKills > 0)",
  empty.phase === "drain" && empty.end.byQuota === false && empty.end.floor === true && !empty.capLifted && empty.perfect === 1 &&
  hurt.end.floor === true && hurt.end.perfect === false && hurt.perfect === 0 && !hurt.titles.includes("PERFECT WAVE") && nokill.end.floor === true && nokill.end.perfect === false && nokill.perfect === 0,
  { empty, hurt, nokill });

// ---- 5. the sector clock cuts a floor wave-3 drain: the approach detonates the leftovers, no callout ----
await jumpTo(P, 3);
await scriptCap([{ text: "neon", x: 760 }, { text: "grid", x: 980 }], { wave: 2 });
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await waitFor(P, () => window.game.wavePhase === "approach", 3000);
await sleep(200);
const cut = await P.g(() => { const g = window.game, R = window.__fl, s = g.paceSnapshot(); return { phase: g.wavePhase, banners: R.banners.slice(), modes: { ...R.modes }, timeout: s.timeout, carry: s.state.carry }; });
P.check("5. S4 W3 floor wave ends at its cap with 2 plates up, then the sector clock runs out in the drain: the boss approach detonates both (as live), no 'WAVE TIMED OUT', no carry",
  cut.phase === "approach" && cut.modes.detonate === 2 && !cut.modes.escape && !cut.banners.some((t) => /TIMED OUT/.test(t)) && cut.timeout === null && cut.carry === 0, cut);

// ---- 6. not floor waves: a carried 1.0 wave, a wave above 1.0, Cadet (0.75) keep D3 / Z5 ----
await jumpTo(P, 3);
const carried = await P.g(() => {
  const g = window.game, ps = g.paceState(), cfg = LEVELS[3];
  ps.carry = 2; ps.carryTo = { level: 4, wave: 1 };
  g.beginWave(1);
  const t = g.waveTuningNow();
  return { mul: ps.applied.mul, quota: t.quota, cap: t.cap, z5: paceWaveCap(cfg, 1, t.quota, 1), floor: t.floor, last: g.paceSnapshot().last };
});
await scriptCap([{ text: "neon", x: 760 }, { text: "grid", x: 980 }]);
const carriedEnd = await P.g(() => { const g = window.game, R = window.__fl, s = g.paceSnapshot(); return { end: R.ends[R.ends.length - 1], modes: { ...R.modes }, timeout: s.timeout }; });
// S5 W3: the wave whose Z5 cap is furthest above the table's 30 s (43 s at 1.0)
await P.g(() => window.game.pacePin(1.1));
await jumpTo(P, 4);
const pinned = await P.g(() => { const g = window.game; g.beginWave(2); const t = g.waveTuningNow(); return { mul: g.paceSnapshot().state.applied.mul, floor: t.floor, cap: t.cap, table: LEVELS[4].cap, z5: paceWaveCap(LEVELS[4], 2, t.quota, 1.1), last: g.paceSnapshot().last.floor }; });
await P.g(() => window.game.pacePin(null));
const cadet = await P.g(() => {
  const g = window.game, ps = g.paceState();
  ps.cadetLevel = 5;
  ps.applied = null;   // a fresh step for W3 (not the pinned wave's replay)
  g.beginWave(2);
  const t = g.waveTuningNow();
  const out = { mul: ps.applied.mul, floor: t.floor, cap: t.cap, table: LEVELS[4].cap, z5: paceWaveCap(LEVELS[4], 2, t.quota, 0.75), source: g.paceSnapshot().last.source };
  ps.cadetLevel = 0;
  return out;
});
P.check("6. not floor waves: a 1.0 wave with 2 carried plates (Z5 cap, its cap end escapes the plates: the D3 timeout), an S5 W3 pinned at 1.1 and a Cadet S5 W3 (0.75) keep floor false and their Z5 caps (above the table's 30 s)",
  carried.mul === 1 && carried.floor === false && carried.quota === 18 && carried.cap === carried.z5 && carried.last.floor === false && carried.last.carry === 2 &&
  carriedEnd.end.floor === false && carriedEnd.modes.escape === 2 && carriedEnd.timeout && carriedEnd.timeout.n === 2 &&
  pinned.mul === 1.1 && pinned.floor === false && pinned.cap === pinned.z5 && pinned.cap > pinned.table && pinned.last === false &&
  cadet.mul === 0.75 && cadet.source === "cadet" && cadet.floor === false && cadet.cap === cadet.z5 && cadet.cap > cadet.table, { carried, carriedEnd, pinned, cadet });

// ---- 7. Continue: a replayed floor wave stays a floor wave; a replayed carried wave does not ----
await jumpTo(P, 1);
await P.g(() => { const g = window.game; g.saveRun(true); });
await reloadInPlace(P);
await waitFor(P, () => !window.game.levelIntro && window.game.wavePhase === "spawn", 8000);
const replay = await P.g(() => { const g = window.game, t = g.waveTuningNow(), s = g.paceSnapshot(); return { level: g.levelIndex + 1, wave: g.wave, source: s.last.source, floor: t.floor, last: s.last.floor, cap: t.cap }; });
const replayCarry = await P.g(() => {
  const g = window.game, ps = g.paceState(), cfg = LEVELS[g.levelIndex];
  ps.applied = { level: cfg.level, wave: 1, mul: 1, quota: cfg.quota[1] + 2 };   // what a reload mid-wave 2 after a carry of 2 stores
  g.beginWave(1);
  const t = g.waveTuningNow();
  return { source: g.paceSnapshot().last.source, floor: t.floor, quota: t.quota, cap: t.cap, z5: paceWaveCap(cfg, 1, t.quota, 1) };
});
P.check("7. Continue after a reload in S2 W1 replays the wave as a floor wave (source replay, cap 24); a replayed 1.0 wave whose stored quota holds a carry of 2 is not one (Z5 cap)",
  replay.level === 2 && replay.wave === 0 && replay.source === "replay" && replay.floor === true && replay.last === true && replay.cap === 24 &&
  replayCarry.source === "replay" && replayCarry.floor === false && replayCarry.quota === 14 && replayCarry.cap === replayCarry.z5, { replay, replayCarry });

// ---- 8. the Daily Sortie keeps its own rule: a 1.0 daily wave is not a floor wave ----
const daily = await P.g(async () => {
  const g = window.game;
  if (typeof g.beginModeRun !== "function") return { skipped: true };
  g.stopToMenu(true);
  const ok = g.beginModeRun("daily");
  return { ok: !!ok };
});
if (daily.ok) {
  await waitFor(P, () => { const g = window.game; return g.mode === "playing" && !g.levelIntro && g.wavePhase === "spawn"; }, 15000);
  const d = await P.g(() => { const g = window.game, t = g.waveTuningNow(); return { mode: g.runMode(), mul: t.spawnMul, floor: t.floor, cap: t.cap, z5: paceWaveCap(LEVELS[g.levelIndex], g.wave, t.quota, t.spawnMul), table: LEVELS[g.levelIndex].cap }; });
  P.check("8. a Daily Sortie wave at paceMul 1.0 keeps D3 / Z5 (floor false, the Z5 cap)", d.mode === "daily" && d.mul === 1 && d.floor === false && d.cap === d.z5, d);
  await P.g(() => window.game.stopToMenu(true));
} else P.note("8. Daily Sortie", `not started: ${JSON.stringify(daily)}`);

// ---- 9. the help manual says which waves are floor waves: a 1.0 wave that carries escaped plates is not one ----
const help = await P.g(() => {
  const li = [...document.querySelectorAll("#helpModal li")].map((x) => x.textContent.replace(/\s+/g, " "));
  return { perfect: li.find((t) => /A perfect wave is a wave without damage/.test(t)) || "", limit: li.find((t) => /^In a campaign sector at the standard pace/.test(t)) || "" };
});
const perfectRule = (help.perfect.match(/A perfect wave is a wave without damage;[^.]*\./) || [""])[0];
const [floorSentence = "", stakesSentence = ""] = help.limit.split(/(?<=\.) (?=When )/);
P.check("9. help manual (Z13 as check 6 plays it): the standard-pace wave that ends at its time limit is one with nothing carried over, and the perfect-wave quota rule and the escape rule both name the wave that carries escaped targets (with the sped-up pace, Cadet and the daily sortie)",
  /with nothing carried over from a timed-out wave, a wave ends at its time limit/.test(floorSentence) &&
  /carries targets escaped/.test(perfectRule) && /sped the stream up/.test(perfectRule) && /Cadet/.test(perfectRule) && /daily sortie/.test(perfectRule) &&
  /carries escaped targets/.test(stakesSentence) && /sped the stream up/.test(stakesSentence) && /Cadet/.test(stakesSentence) && /daily sortie/.test(stakesSentence) && /WAVE TIMED OUT/.test(stakesSentence),
  { perfectRule, floorSentence, stakesSentence: stakesSentence.slice(0, 220) });

errorsCheck(P);
await P.finish();
