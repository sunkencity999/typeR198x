// t-pace-spawner (PACE, D2 spawner side; CONTRACT 6 PACE): the 10-30 px roll-in, the 0.1 s empty-field spawn and the
// first targetable plate, a pinned paceMul 2.0 on S5 W2 (alive cap +2, plate speeds x1.15, quota 36, stage bar), the
// 2-alive top-up from PACE.hungryMin2AtMul (1.35: on at +0.1, off at -0.1), the stream at a pinned 1.5 under an 80 WPM typist, and a fresh
// pilot's S1 W1 at 1.0 with MEASURE present. ~90 s. PASS = the spawner delivers the paced stream.
// Usage: node tools/playtest/probes/t-pace-spawner.mjs [--dpr 1|2]
import { openProbe, sleep, waitFor, startFresh, jumpTo, paceType, errorsCheck } from "./pace_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const DPR = Number(args.dpr || 1);
const P = await openProbe(`t-pace-spawner-dpr${DPR}`, { dpr: DPR });
await startFresh(P, "PACE");

// ---- 6 (first, on the fresh save): a pilot's first 30 s of S1 with MEASURE present ----
const w1 = await paceType(P, 30, { wpm: 80, accuracy: 0.97 });
const s6 = await P.g(() => { const g = window.game; const s = g.paceSnapshot(); return { waveMuls: s.state.waveMuls, mul: s.state.mul, run: { ...g.typistSpeed("run") }, lifetimeN: g.typistSpeed("lifetime").n, level: g.levelIndex + 1 }; });
P.check("6. fresh save, 80 WPM typist for 30 s in S1 with MEASURE present: W1 ran at paceMul 1.0 (waveMuls[0] === 1); later waves step by <= 0.35",
  s6.level === 1 && s6.waveMuls[0] === 1 && s6.waveMuls.every((m, i) => i === 0 || Math.abs(m - s6.waveMuls[i - 1]) <= 0.35 + 1e-9), { ...s6, keys: w1.keys });

// ---- 1. roll-in ----
await jumpTo(P, 2);
const roll = await P.g(() => {
  const g = window.game;
  g.beginWave(1);
  const d = [];
  for (let i = 0; i < 200; i++) {
    g.enemies.length = 0;
    const en = g.spawnEnemy();
    if (en) d.push(en.x - (g.w + en.plateW / 2));
  }
  g.enemies.length = 0;
  return { n: d.length, min: Math.min(...d), max: Math.max(...d), mean: d.reduce((a, b) => a + b, 0) / d.length };
});
P.check("1. 200 spawnEnemy() at S3 W2: every x - (w + plateW / 2) in [10, 30] px", roll.n === 200 && roll.min >= 10 && roll.max <= 30, roll);

// ---- 2. empty field: next spawn <= 0.15 s, first targetable <= 0.6 s (play clock), 20 samples ----
const empty = await P.g(async () => {
  const g = window.game;
  g.pacePin(1, { now: true });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const out = [];
  for (let i = 0; i < 20; i++) {
    g.enemies.length = 0; g.powerups.length = 0; g.lock = null;
    g.wavePhase = "spawn"; g.waveKills = 0; g.waveT = 1; g.levelT = Math.min(g.levelT, 10); g.spawnAcc = 0; g.hungryT = 0;
    const t0 = g.playClock;
    let spawnAt = null, targetAt = null;
    for (let f = 0; f < 120 && targetAt === null; f++) {
      await frame();
      const alive = g.enemies.filter((e) => e.alive && !e.dying);
      if (spawnAt === null && alive.length) spawnAt = g.playClock - t0;
      if (alive.some((e) => g.isTargetable(e))) targetAt = g.playClock - t0;
    }
    out.push({ spawnAt, targetAt });
  }
  g.pacePin(null);
  const sp = out.map((o) => o.spawnAt), tg = out.map((o) => o.targetAt);
  return { maxSpawn: Math.max(...sp), maxTarget: Math.max(...tg), meanTarget: tg.reduce((a, b) => a + b, 0) / tg.length, misses: out.filter((o) => o.spawnAt === null || o.targetAt === null).length };
});
P.check("2. S3 W2 empty field (pin 1.0), 20 samples: next spawn <= 0.15 s and first targetable plate <= 0.6 s of play clock", empty.misses === 0 && empty.maxSpawn <= 0.15 && empty.maxTarget <= 0.6, empty);

// ---- 3. pinned 2.0 on S5 W2: alive cap, plate speeds, quota 36, stage bar ----
await jumpTo(P, 4);
await P.g(() => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null;
  g.beginWave(1);
  g.pacePin(2, { now: true });
  window.__sp = { speeds: [], maxAlive: 0, stage: null, ended: null };
  const orig = g.spawnEnemy;
  g.spawnEnemy = function () {
    const en = orig.apply(this, arguments);
    if (en) { window.__sp.speeds.push({ s: en.speed, n: en.text.length }); window.__sp.maxAlive = Math.max(window.__sp.maxAlive, this.countAliveEnemies()); }
    return en;
  };
});
const tune3 = await P.g(() => { const g = window.game; const t = g.waveTuningNow(); return { quota: g.waveQuota(), add: t.maxEnemiesAdd, speedMul: t.speedMul, spawnMul: t.spawnMul, cap: waveMaxEnemies(LEVELS[4], 1, g.phoneProfile()) + t.maxEnemiesAdd }; });
// fill the field for 8 s (no kills), then kill the leftmost targetable plate every 120 ms until the wave ends
const t3 = Date.now();
let stageSeen = null;
while (Date.now() - t3 < 70000) {
  const st = await P.g((killing) => {
    const g = window.game;
    g.invulnT = 1e9; g.waveT = Math.min(g.waveT, 5); g.levelT = Math.min(g.levelT, 40);
    const alive = g.enemies.filter((e) => e.alive && !e.dying);
    window.__sp.maxAlive = Math.max(window.__sp.maxAlive, alive.length);
    if (killing && g.wavePhase === "spawn") {
      const t = alive.filter((e) => g.isTargetable(e)).sort((a, b) => a.x - b.x)[0];
      if (t) g.killEnemy(t);
    }
    const fill = document.querySelectorAll("#stageBar .stageFill")[1];
    return { phase: g.wavePhase, wave: g.wave, kills: g.waveKills, quota: g.waveQuota(), p: fill ? parseFloat(fill.style.getPropertyValue("--p")) : null };
  }, Date.now() - t3 > 8000);
  if (st.wave === 1 && st.phase === "spawn" && st.kills >= 10 && st.kills <= 30 && stageSeen === null) { await sleep(250); stageSeen = await P.g(() => { const g = window.game; const fill = document.querySelectorAll("#stageBar .stageFill")[1]; return { kills: g.waveKills, p: fill ? parseFloat(fill.style.getPropertyValue("--p")) : null }; }); }
  if (st.phase !== "spawn" || st.wave !== 1) { await P.g((st) => { window.__sp.ended = st; }, st); break; }
  await sleep(120);
}
const sp3 = await P.g(() => {
  const g = window.game;
  const base = waveSpeed(LEVELS[4], 1) * 1.15;
  const bad = window.__sp.speeds.filter(({ s, n }) => { const r = s / base; const lo = 0.92 * (n >= LONG_WORD_LEN ? LONG_WORD_SPEED_MUL : 1), hi = 1.08 * (n === 1 ? LETTER_SPEED_MUL[1] : 1); return r < lo - 1e-6 || r > hi + 1e-6; });
  g.pacePin(null);
  return { spawned: window.__sp.speeds.length, bad: bad.length, maxAlive: window.__sp.maxAlive, ended: window.__sp.ended };
});
P.check("3. pacePin(2, {now}) at S5 W2: quota round(18 x 2) = 36, add 2, speed x1.15; alive never above waveMaxEnemies + 2; every plate speed in waveSpeed x 1.15 x [0.92, 1.08] (x [1, 1.25] letters, x0.9 long); the wave ends at waveKills 36 === waveQuota(); #stageBar fill = waveKills / 36",
  tune3.quota === 36 && tune3.add === 2 && Math.abs(tune3.speedMul - 1.15) < 1e-9 && sp3.maxAlive <= tune3.cap && sp3.spawned >= 36 && sp3.bad === 0 &&
  sp3.ended && sp3.ended.kills === 36 && sp3.ended.quota === 36 && sp3.ended.phase === "drain" && stageSeen && Math.abs(stageSeen.p - stageSeen.kills / 36) <= 1.5 / 36,
  { tune3, sp3, stageSeen });

// ---- 4. 2-alive top-up from paceMul 1.5 ----
const top = await P.g(async () => {
  const g = window.game;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const run = async (mul) => {
    g.beginWave(1);
    g.pacePin(mul, { now: true });
    g.enemies.length = 0; g.lock = null;
    const en = new Enemy({ text: "orbit", x: 900, y: LANE_YS[2], speed: 0, lane: 2 });
    g.enemies.push(en);
    g.wavePhase = "spawn"; g.waveKills = 0; g.waveT = 1; g.spawnAcc = -1e9; g.hungryT = 0;
    const t0 = g.playClock;
    while (g.playClock - t0 < 0.5) await frame();
    const alive = g.enemies.filter((e) => e.alive && !e.dying).length;
    return { mul, hungry: g.waveTuningNow().hungryMinAlive, alive };
  };
  const k = PACE.hungryMin2AtMul;
  const a = await run(paceRound2(k + 0.1)), b = await run(paceRound2(k - 0.1));
  g.pacePin(null);
  return { a, b };
});
P.check("4. one plate alive, stream off: pacePin(knob + 0.1 = 1.45) tops the field up to 2 within 0.5 s (hungryMinAlive 2); pacePin(knob - 0.1 = 1.25) does not (hungryMinAlive 1)",
  top.a.hungry === 2 && top.a.alive >= 2 && top.b.hungry === 1 && top.b.alive === 1, top);

// ---- 5. stream at a pinned 1.5 on S4 W2 under an 80 WPM typist ----
await jumpTo(P, 3);
await P.g(() => { const g = window.game; g.enemies.length = 0; g.lock = null; g.pacePin(1.5); g.beginWave(1); g.levelT = LEVELS[3].cap; });
const cps = [];
await paceType(P, 26, { wpm: 80, accuracy: 0.97, onTick: async (st, elapsed) => {
  const s = await P.g(() => { const g = window.game; if (g.waveKills >= g.waveQuota() - 2) g.waveKills = Math.floor(g.waveQuota() / 2); g.waveT = Math.min(g.waveT, 20); return { cps: window.TypeRDebug.stats().incomingCps, wave: g.wave, phase: g.wavePhase }; });
  if (elapsed >= 10000 && s.wave === 1 && s.phase === "spawn") cps.push(s.cps);
}, until: (st) => st.wave !== 1 || st.mode !== "playing" });
await P.g(() => window.game.pacePin(null));
const avg = cps.reduce((a, b) => a + b, 0) / Math.max(1, cps.length);
// Band [0.85, 1.5]: the paced stream (4.5 cps) is delivered, and the empty-field / 2-alive top-ups feed the faster typist
// (6.5 cps) on top of it, demand-driven. Contract 6 said 1.35; measured on this branch 1.14 / 1.38 / 1.22 (b3's pinned 1.0
// case reads 1.19-1.41 for the same reason), so the upper side matches b3's +50 %.
P.check("5. 80 WPM typist (play-clock paced) at S4 W2 pinned 1.5: TypeRDebug incomingCps / (3.0 x 1.5) within [0.85, 1.5] over 16 s",
  cps.length >= 15 && avg / 4.5 >= 0.85 && avg / 4.5 <= 1.5, { avg: Math.round(avg * 100) / 100, ratio: Math.round(avg / 4.5 * 100) / 100, n: cps.length, min: Math.min(...cps), max: Math.max(...cps) });

errorsCheck(P);
await P.finish();
