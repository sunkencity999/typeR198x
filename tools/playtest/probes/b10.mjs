// B10 balance probe: drives ONE typist profile through consecutive sectors from a fresh save (or a direct jump via
// game.startSector) and records, per sector, everything the balance pass judges: play-clock seconds to the boss,
// boss duration, deaths, min HP, leaks per minute (waves and every boss phase separately), incomingCps per wave
// against LEVELS[i].targetCps, damage by source, surges fired / countered, rank (as shipped and with the
// level-aware speed term), gross WPM, accuracy, the tally and the longest idle gap of the typist inside a spawn
// phase (hungry spawner). Exact figures come from hooks installed on the game instance (spawn / leak / damage /
// phase events on the play clock); TypeRDebug.stats() is sampled per tick as a cross-check. Every sector also
// records play seconds vs wall seconds. The typist is paced by the PLAY clock (game.playClock): the loop clamps dt to
// 50 ms, so a renderer below 20 fps (sector 10 in headless Chrome runs at ~.36x real time) slows the game, and a
// wall-clock typist would effectively type 2-3x faster than its profile. Pacing by the play clock keeps the profile
// honest whatever the frame rate; the ratio is still reported (it says how far the run was from real time).
// Writes out/b10/<label>.json (read by b10-report.mjs) and a screenshot per sector.
//
// Usage: node probes/b10.mjs --wpm 55 --accuracy .93 [--sectors 3] [--jump 10] [--minions danger|never|always]
//                           [--expect p35|p55|p80] [--label name] [--seconds 420]
//   --jump L        start at sector L (1-based) through game.startSector(L-1) instead of sector 1
//   --minions       boss-fight policy of the typist: 'never' = boss character first, always (the harness model;
//                   every minion leaks); 'danger' (default) = a minion whose plate has crossed DANGER_X is shot
//                   first, otherwise the boss; 'always' = any targetable minion first
//   --expect        adds the pass/fail lines of that profile's B10 targets (see balance.md)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProbe, sleep, waitFor } from "./b_lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const WPM = Number(args.wpm || 55);
const ACC = Number(args.accuracy || 0.93);
const JUMP = args.jump ? Number(args.jump) : 0;            // 1-based sector to jump to
const SECTORS = Number(args.sectors || (JUMP ? 1 : 3));
const MINIONS = args.minions || "danger";
const EXPECT = args.expect || null;
const SECONDS = Number(args.seconds || 420);               // wall-clock cap per sector (a sector-10 clear takes ~4 min)
const LABEL = args.label || `w${WPM}-a${String(ACC).replace(/^0/, "")}-${JUMP ? "j" + JUMP : "s1-" + SECTORS}-${MINIONS}`;
const OUT_DIR = path.resolve(HERE, "../out/b10");
fs.mkdirSync(OUT_DIR, { recursive: true });

const P = await openProbe(`b10-${LABEL}`);
await P.goto("fresh");

// ---- page-side instrumentation (installed once; wraps instance methods so sector changes keep the hooks) ----
async function installHooks() {
  await P.g(() => {
    const g = window.game;
    if (window.__b10) return;
    const B = window.__b10 = { spawns: [], leaks: [], damage: [], surges: [], phases: [], boss: [], reset() { B.spawns = []; B.leaks = []; B.damage = []; B.surges = []; B.phases = []; B.boss = []; } };
    const ctx = () => ({ t: g.playClock || 0, L: g.levelIndex + 1, wave: g.wave | 0, phase: g.inBoss ? "boss" + (((g.boss && g.boss.phase) | 0) + 1) : g.wavePhase });
    const wrap = (name, after) => {
      const orig = g[name];
      if (typeof orig !== "function") return;
      g[name] = function (...a) { const r = orig.apply(this, a); try { after.call(this, r, ...a); } catch (e) { console.warn("b10 hook", name, e); } return r; };
    };
    // hungry = the spawn came from the hungry rule (hungryT was just reset and fewer than HUNGRY_MIN_ALIVE were alive)
    wrap("spawnEnemy", function (en) { if (en) B.spawns.push({ ...ctx(), n: en.text.length, hungry: this.hungryT === 0 && (this.countAliveEnemies() - 1) < (typeof HUNGRY_MIN_ALIVE === "number" ? HUNGRY_MIN_ALIVE : 2) }); });
    wrap("spawnBossMinion", function (en) { if (en) B.spawns.push({ ...ctx(), n: 1, minion: true }); });
    wrap("leakEnemy", function (_, en) { if (!this.bossClear) B.leaks.push({ ...ctx(), n: en.text.length, minion: en.kind === "bossMinion" }); });
    wrap("takeDamage", function (dmg, amount, source) { B.damage.push({ ...ctx(), dmg: dmg | 0, asked: amount, source: source || "leak", shielded: !dmg && amount > 0 }); });
    wrap("fireSurge", function () { B.surges.push({ ...ctx(), fired: true }); });
    wrap("cancelSurge", function (r, countered) { if (r && countered !== false) B.surges.push({ ...ctx(), countered: true }); });
    wrap("setWavePhase", function (_, phase) { B.phases.push({ ...ctx(), to: phase }); });
    wrap("beginBossFight", function () { B.boss.push({ ...ctx(), ev: "begin" }); });
    wrap("endBossIntro", function () { B.boss.push({ ...ctx(), ev: "unlock" }); });
    wrap("onBossPhaseClear", function () { B.boss.push({ ...ctx(), ev: "phase", phase: this.boss ? this.boss.phase : null }); });
    wrap("onBossKill", function () { B.boss.push({ ...ctx(), ev: "kill" }); });
    wrap("onGameOver", function () { B.boss.push({ ...ctx(), ev: "death" }); });
  });
}
await installHooks();
await P.startRun("B10");
if (JUMP) {
  await P.g((i) => { window.__jumpTo = i; window.game.startSector(i); }, JUMP - 1);
  await waitFor(P, () => window.game && window.game.mode === "playing" && window.game.levelIndex === window.__jumpTo, 8000);
}

// ---- typist ----
function nextKey(policy) {
  return P.page.evaluate((policy) => {
    const g = window.game;
    try {
      if (g.levelIntro) return null;
      if (g.bossIntro && g.bossIntro.locked) return null;
      if (g.bossClear) return null;
      const nc = (o) => { if (!o) return null; const v = typeof o.nextChar === "function" ? o.nextChar() : o.nextChar; return v || null; };
      if (g.inBoss && g.boss) {
        const bossChar = nc(g.boss);
        if (policy !== "never") {
          const minions = g.enemies.filter((e) => e.alive && !e.dying && e.kind === "bossMinion" && g.isTargetable(e)).sort((a, b) => a.x - b.x);
          const line = (typeof DANGER_X === "number" ? DANGER_X : 0.35) * g.w;
          const m = policy === "always" ? minions[0] : minions.find((e) => e.x - (e.plateW || 40) / 2 < line);
          if (m) { const c = nc(m); if (c) return c; }
        }
        if (bossChar) return bossChar;
      }
      if (g.lock && g.lock.ref && g.lock.ref.alive !== false) { const c = nc(g.lock.ref); if (c) return c; }
      const pick = (arr) => {
        const pool = (arr || []).filter((e) => e && e.alive !== false && !e.dying && g.isTargetable(e)).sort((a, b) => a.x - b.x);
        for (const e of pool) { const c = nc(e); if (c) return c; }
        return null;
      };
      return pick(g.enemies) || pick(g.powerups);
    } catch { return null; }
  }, policy);
}

function tick() {
  return P.page.evaluate(() => {
    const g = window.game;
    const dbg = window.TypeRDebug.stats();
    return {
      mode: g.mode, levelIndex: g.levelIndex, levelT: g.levelT, inBoss: g.inBoss, bossClear: !!g.bossClear, wave: g.wave | 0, wavePhase: g.wavePhase,
      levelIntro: !!g.levelIntro, introLocked: !!(g.bossIntro && g.bossIntro.locked), hp: g.player.hp, maxHp: g.player.maxHp, shield: g.player.shield,
      waveT: g.waveT || 0, playClock: g.playClock || 0, bossPhase: g.inBoss && g.boss ? (g.boss.phase | 0) + 1 : 0,
      incomingCps: dbg.incomingCps, leaksPerMin: dbg.leaksPerMin, liveChars: dbg.liveChars, alive: g.countAliveEnemies ? g.countAliveEnemies() : g.enemies.length
    };
  });
}

const interval = 60000 / (Math.max(1, WPM) * 5);
const report = { label: LABEL, wpm: WPM, accuracy: ACC, minions: MINIONS, jump: JUMP, sectors: [] };
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

for (let s = 0; s < SECTORS; s++) {
  await P.g(() => window.__b10.reset());
  const sectorStart = Date.now();
  const playClock0 = await P.g(() => window.game.playClock || 0);
  const rec = { sector: null, level: null, targetCps: null, secondsToBoss: null, wallSecondsToBoss: null, minHp: Infinity, maxHp: null, death: null, keys: 0, wrongKeys: 0,
    idleMaxS: 0, idleByWave: [0, 0, 0], samples: 0 };
  const idle = { since: null, wave: 0 };
  const dbgAcc = {};   // phase label -> { sum, n, max }
  let bossShot = false;
  let lastMode = "playing";

  while (Date.now() - sectorStart < SECONDS * 1000) {
    const loopStart = Date.now();
    const st = await tick();
    if (rec.level === null) { rec.level = st.levelIndex + 1; rec.sector = st.levelIndex + 1; rec.maxHp = st.maxHp; }
    if (st.mode !== "playing") {
      if (st.mode === "levelComplete" || st.mode === "gameOver" || st.mode === "victory") { lastMode = st.mode; break; }
      await sleep(80);
      continue;
    }
    rec.minHp = Math.min(rec.minHp, st.hp);
    if (st.inBoss && rec.secondsToBoss === null) { rec.secondsToBoss = st.playClock - playClock0; rec.wallSecondsToBoss = (Date.now() - sectorStart) / 1000; }
    if (st.inBoss && !st.introLocked && !bossShot && st.bossPhase >= 1) { bossShot = true; await P.shot(`s${rec.level}-boss`); }
    // TypeRDebug cross-check per phase (incomingCps only once the 10 s window sits inside the wave)
    const label = st.inBoss ? `boss${st.bossPhase}` : `w${st.wave + 1}:${st.wavePhase}`;
    const a = dbgAcc[label] || (dbgAcc[label] = { sum: 0, n: 0, max: 0 });
    a.max = Math.max(a.max, st.leaksPerMin);
    if (!st.inBoss && st.wavePhase === "spawn" && st.waveT >= 10) { a.sum += st.incomingCps; a.n++; }
    rec.samples++;

    const k = st.levelIntro || st.introLocked ? null : await nextKey(MINIONS);
    const inSpawn = !st.inBoss && st.wavePhase === "spawn" && !st.levelIntro;
    if (k && /^[a-z]$/.test(k)) {
      if (idle.since !== null) { const gap = st.playClock - idle.since; rec.idleMaxS = Math.max(rec.idleMaxS, gap); rec.idleByWave[idle.wave] = Math.max(rec.idleByWave[idle.wave], gap); idle.since = null; }
      const wrong = Math.random() > ACC;
      const key = wrong ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
      await P.page.keyboard.press(key);
      rec.keys++;
      if (wrong) rec.wrongKeys++;
      // next key when the PLAY clock has advanced one jittered interval (falls back to wall time if the clock stalls)
      const due = st.playClock + (interval * (0.8 + Math.random() * 0.4)) / 1000;
      const wallLimit = Date.now() + interval * 4;
      await sleep(Math.max(5, interval * 0.5 - (Date.now() - loopStart)));
      while (Date.now() < wallLimit) {
        const pc = await P.g(() => (window.game && window.game.playClock) || 0);
        if (pc >= due || pc < st.playClock) break;
        await sleep(Math.min(25, Math.max(5, ((due - pc) * 1000) / 2)));
      }
    } else {
      if (inSpawn) { if (idle.since === null) { idle.since = st.playClock; idle.wave = st.wave; } }
      else idle.since = null;
      await sleep(30);
    }
  }

  // ---- collect the sector ----
  const ev = await P.g(() => {
    const g = window.game;
    const r = g.lastResults;
    const cfg = LEVELS[g.levelIndex];
    const ls = g.levelStats;
    const hpPts = (ls.damageTaken | 0) === 0 ? 1 : Math.max(0, Math.min(1, 1 - (ls.damageTaken | 0) / Math.max(1, g.player.maxHp)));
    const rankLevel = (r && window.TypeRDebug.rankFor.length >= 4) ? window.TypeRDebug.rankFor(r.acc, r.wpm, hpPts, cfg.level) : null;
    return {
      B: JSON.parse(JSON.stringify(window.__b10)), mode: g.mode, levelIndex: g.levelIndex,
      cfg: (({ level, targetCps, quota, cap, duration, speed, wordMin, wordMax, maxEnemies, surgeEvery, minionRate, minionMax, minionSpawnDx }) => ({ level, targetCps, quota, cap, duration, speed, wordMin, wordMax, maxEnemies, surgeEvery, minionRate, minionMax, minionSpawnDx }))(cfg),
      results: r && { rank: r.rank, rankLevelAware: rankLevel, wpm: r.wpm, acc: r.acc, score: r.score, levelScore: r.levelScore, maxCombo: r.maxCombo, words: r.words, kills: r.kills, timeMs: r.timeMs, hpPts: Math.round(hpPts * 100) / 100 },
      tally: g.lastTally && { total: g.lastTally.total, clear: g.lastTally.clear, time: Math.round(g.lastTally.time), flawless: g.lastTally.flawless, accuracy: g.lastTally.accuracy, phases: g.lastTally.phases, surges: g.lastTally.surges, perfectWaves: g.lastTally.perfectWaves, par: g.lastTally.par, elapsed: Math.round((g.lastTally.elapsed || 0) * 10) / 10, retryMul: g.lastTally.retryMul },
      levelStats: (({ damageTaken, waveDamage, bossDamage, surgesCancelled, perfectWaves, retries, bossTimeMs, chars, timeMs, correct, total, kills, words, maxCombo }) => ({ damageTaken, waveDamage, bossDamage, surgesCancelled, perfectWaves, retries, bossTimeMs, chars, timeMs, correct, total, kills, words, maxCombo }))(ls),
      hp: g.player.hp, maxHp: g.player.maxHp, score: g.stats.score, playClock: g.playClock || 0, deaths: window.TypeRDebug.stats().deathsBySector, deathInBoss: !!g.deathInBoss, wave: g.wave, wavePhase: g.wavePhase
    };
  });
  const B = ev.B;
  rec.targetCps = ev.cfg.targetCps;
  rec.nominalWpm = Math.round(ev.cfg.targetCps * 12 * 10) / 10;   // gross WPM a typist gets when typing exactly the incoming stream
  rec.cfg = ev.cfg;
  rec.mode = ev.mode;
  rec.wallSeconds = Math.round((Date.now() - sectorStart) / 100) / 10;
  rec.playSeconds = r1(ev.playClock - playClock0);
  rec.clockRatio = r2(rec.playSeconds / Math.max(0.1, rec.wallSeconds));
  rec.secondsToBoss = r1(rec.secondsToBoss);
  rec.wallSecondsToBoss = r1(rec.wallSecondsToBoss);
  rec.results = ev.results;
  rec.tally = ev.tally;
  rec.levelStats = ev.levelStats;
  rec.score = ev.score;
  rec.minHpPct = rec.maxHp ? Math.round((rec.minHp / rec.maxHp) * 1000) / 10 : null;
  rec.death = ev.mode === "gameOver" ? { inBoss: ev.deathInBoss, wave: ev.wave + 1, phase: ev.wavePhase, bossPhase: (B.boss.filter((b) => b.ev === "phase").length + 1) } : null;

  // phase spans on the play clock: every setWavePhase call opens a span; boss spans come from the boss events
  const spans = [];
  for (let i = 0; i < B.phases.length; i++) {
    const p = B.phases[i];
    const end = i + 1 < B.phases.length ? B.phases[i + 1].t : ev.playClock;
    spans.push({ phase: p.to, wave: p.wave, t0: p.t, t1: end });
  }
  const bossUnlock = B.boss.find((b) => b.ev === "unlock");
  const bossKill = B.boss.find((b) => b.ev === "kill");
  const bossDeath = B.boss.find((b) => b.ev === "death");
  const bossEnd = bossKill ? bossKill.t : bossDeath ? bossDeath.t : ev.playClock;
  const phaseEvents = B.boss.filter((b) => b.ev === "phase");
  const bossPhases = [];
  if (bossUnlock) {
    let t0 = bossUnlock.t;
    phaseEvents.forEach((pe, idx) => { bossPhases.push({ phase: idx + 1, t0, t1: pe.t }); t0 = pe.t; });
    bossPhases.push({ phase: phaseEvents.length + 1, t0, t1: bossEnd, open: !bossKill });
  }
  rec.bossDurationS = bossUnlock ? r1(bossEnd - bossUnlock.t) : null;
  rec.bossCleared = !!bossKill;

  const inSpan = (t, sp) => t >= sp.t0 && t < sp.t1;
  const minutes = (sp) => Math.max(1e-6, (sp.t1 - sp.t0) / 60);
  // waves: everything from the first 'spawn' to the boss unlock (or the end)
  const firstSpawn = spans.find((sp) => sp.phase === "spawn");
  const waveSpan = { t0: firstSpawn ? firstSpawn.t0 : 0, t1: bossUnlock ? bossUnlock.t : bossEnd };
  const waveLeaks = B.leaks.filter((l) => !l.minion && inSpan(l.t, waveSpan));
  rec.waves = { seconds: r1(waveSpan.t1 - waveSpan.t0), leaks: waveLeaks.length, leaksPerMin: r2(waveLeaks.length / minutes(waveSpan)),
    damage: B.damage.filter((d) => inSpan(d.t, waveSpan)).reduce((a, d) => a + d.dmg, 0) };
  rec.perWave = [0, 1, 2].map((w) => {
    const sp = spans.find((x) => x.phase === "spawn" && x.wave === w);
    if (!sp) return null;
    const sps = B.spawns.filter((e) => !e.minion && e.L === rec.level && inSpan(e.t, sp));
    const chars = sps.reduce((a, e) => a + e.n, 0);
    const n = sps.length;
    const hungryN = sps.filter((e) => e.hungry).length;
    const streamChars = sps.filter((e) => !e.hungry).reduce((a, e) => a + e.n, 0);
    const cps = chars / Math.max(1e-6, sp.t1 - sp.t0);
    const streamCps = streamChars / Math.max(1e-6, sp.t1 - sp.t0);
    const next = spans.find((x) => x.phase === "spawn" && x.wave === w + 1);
    const leaks = B.leaks.filter((l) => !l.minion && l.wave === w && inSpan(l.t, { t0: sp.t0, t1: next ? next.t0 : waveSpan.t1 })).length;
    const a = dbgAcc[`w${w + 1}:spawn`];
    return { wave: w + 1, spawnS: r1(sp.t1 - sp.t0), enemies: n, hungrySpawns: hungryN, chars, incomingCps: r2(cps), ratio: r2(cps / rec.targetCps), streamCps: r2(streamCps), streamRatio: r2(streamCps / rec.targetCps), charsPerEnemy: r2(chars / Math.max(1, n)),
      leaks, idleMaxS: r2(rec.idleByWave[w]), dbgIncomingCps: a && a.n ? r2(a.sum / a.n) : null, dbgLeaksPerMinMax: a ? a.max : null };
  });
  rec.boss = bossUnlock ? {
    seconds: rec.bossDurationS, cleared: !!bossKill,
    leaks: B.leaks.filter((l) => l.t >= bossUnlock.t && l.t < bossEnd).length,
    leaksPerMin: r2(B.leaks.filter((l) => l.t >= bossUnlock.t && l.t < bossEnd).length / minutes({ t0: bossUnlock.t, t1: bossEnd })),
    minionsSpawned: B.spawns.filter((e) => e.minion).length,
    damage: B.damage.filter((d) => d.t >= bossUnlock.t).reduce((a, d) => a + d.dmg, 0),
    damageBySource: B.damage.filter((d) => d.t >= bossUnlock.t).reduce((a, d) => { a[d.source] = (a[d.source] || 0) + d.dmg; return a; }, {}),
    surgesFired: B.surges.filter((x) => x.fired).length, surgesCountered: B.surges.filter((x) => x.countered).length,
    phases: bossPhases.map((bp) => {
      const leaks = B.leaks.filter((l) => l.t >= bp.t0 && l.t < bp.t1).length;
      const a = dbgAcc[`boss${bp.phase}`];
      return { phase: bp.phase, seconds: r1(bp.t1 - bp.t0), leaks, leaksPerMin: r2(leaks / minutes(bp)), minions: B.spawns.filter((e) => e.minion && e.t >= bp.t0 && e.t < bp.t1).length, dbgLeaksPerMinMax: a ? a.max : null, open: !!bp.open };
    })
  } : null;
  rec.leaksTotal = B.leaks.length;
  rec.phaseTrail = B.phases.map((p) => p.to).join(">");
  report.sectors.push(rec);
  await P.shot(`s${rec.level}-end`);
  console.log(JSON.stringify({ sector: rec.level, mode: rec.mode, playS: rec.playSeconds, clockRatio: rec.clockRatio, toBoss: rec.secondsToBoss, bossS: rec.bossDurationS, minHpPct: rec.minHpPct,
    waveLpm: rec.waves.leaksPerMin, bossLpm: rec.boss && rec.boss.leaksPerMin, phaseLpm: rec.boss && rec.boss.phases.map((p) => p.leaksPerMin), cps: rec.perWave.map((w) => w && w.ratio), stream: rec.perWave.map((w) => w && w.streamRatio), hungry: rec.perWave.map((w) => w && `${w.hungrySpawns}/${w.enemies}`), idle: rec.perWave.map((w) => w && w.idleMaxS), surges: rec.boss && [rec.boss.surgesFired, rec.boss.surgesCountered],
    rank: rec.results && rec.results.rank, rankL: rec.results && rec.results.rankLevelAware, wpm: rec.results && rec.results.wpm, acc: rec.results && rec.results.acc, dmg: rec.levelStats.damageTaken, score: rec.score, death: rec.death }));

  if (rec.mode !== "levelComplete") break;   // gameOver / victory end the run
  if (s + 1 < SECTORS) {
    await P.page.click("#btnNextLevel");
    const ok = await waitFor(P, () => window.game.mode === "playing", 8000);
    if (!ok) break;
  }
}

const file = path.join(OUT_DIR, `${LABEL}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 1));
console.log("wrote", file);

// ---- target lines ----
const S = report.sectors;
const byLevel = (L) => S.find((r) => r.level === L);
const deaths = S.filter((r) => r.death).map((r) => `S${r.level}`);
const bandOk = (r) => r.perWave.filter(Boolean).every((w) => w.ratio >= 0.85 && w.ratio <= 1.15);
const bossLeakRule = (r) => !r.boss || r.boss.leaksPerMin <= Math.max(2, 1.5 * r.waves.leaksPerMin);
const rankOf = (r) => r.results && (r.results.rankLevelAware || r.results.rank);
P.note("play / wall clock ratio per sector (typist paced by the play clock; < .9 = the page ran in slow motion)", S.map((r) => `S${r.level}:${r.clockRatio}`).join(" "));
if (EXPECT === "p55") {
  const s1 = byLevel(1);
  if (s1) P.check("55/.93 reaches the sector-1 boss in 25-70 s (play clock)", s1.secondsToBoss !== null && s1.secondsToBoss >= 25 && s1.secondsToBoss <= 70, { secondsToBoss: s1.secondsToBoss });
  if (!JUMP) {
    P.check("55/.93 clears sectors 1-3 without dying", S.length === 3 && deaths.length === 0 && S.every((r) => r.mode === "levelComplete"), { deaths, modes: S.map((r) => r.mode) });
    P.check("55/.93 min HP > 25 % in every sector", S.every((r) => r.minHpPct > 25), S.map((r) => `S${r.level}:${r.minHpPct}%`));
  }
  P.check("55/.93 every wave's incomingCps within +-15 % of targetCps", S.every(bandOk), S.map((r) => `S${r.level}:` + r.perWave.map((w) => w && w.ratio).join("/")));
  const surges = S.reduce((a, r) => { if (r.boss) { a.f += r.boss.surgesFired; a.c += r.boss.surgesCountered; } return a; }, { f: 0, c: 0 });
  if (surges.f + surges.c > 0) P.check("55/.93 counters >= 70 % of surges", surges.c / (surges.f + surges.c) >= 0.7, surges); else P.note("surge counter rate", "no surge started in this run");
}
if (EXPECT === "p35") {
  const s1 = byLevel(1);
  P.check("35/.90 clears sector 1 without dying", !!s1 && s1.mode === "levelComplete", s1 && { mode: s1.mode, minHpPct: s1.minHpPct, death: s1.death });
  if (!JUMP) { const s2 = byLevel(2); P.check("35/.90 reaches the sector-2 boss", !!s2 && s2.secondsToBoss !== null, s2 && { secondsToBoss: s2.secondsToBoss, mode: s2.mode }); }
}
if (EXPECT === "p80") {
  P.check("80/.97 never idle > 2 s inside a spawn phase", S.every((r) => r.perWave.filter(Boolean).every((w) => w.idleMaxS <= 2)), S.map((r) => `S${r.level}:` + r.perWave.map((w) => w && w.idleMaxS).join("/")));
  for (const r of S) {
    const want = r.level >= 4 ? ["S"] : ["S", "A"];
    P.check(`80/.97 rank ${want.join("/")} at sector ${r.level} (level-aware speed term when available)`, r.results && want.includes(rankOf(r)), r.results && { rank: r.results.rank, rankLevelAware: r.results.rankLevelAware, wpm: r.results.wpm, nominalWpm: r.nominalWpm, acc: r.results.acc, damage: r.levelStats.damageTaken });
  }
}
P.check("boss leaksPerMin <= max(2, 1.5 x wave leaksPerMin) in every sector with a boss", S.every(bossLeakRule), S.map((r) => `S${r.level}: waves ${r.waves.leaksPerMin}/min boss ${r.boss ? r.boss.leaksPerMin : "-"}/min`));
P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
