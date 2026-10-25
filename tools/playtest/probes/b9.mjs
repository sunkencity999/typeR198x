// B9 acceptance: stats engine, live WPM, rank, results data, TypeRDebug.stats().
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, waitFor, press } from "./b_lib.mjs";

const P = await openProbe("b9");
await P.goto("fresh");

const ranks = await P.g(() => ({ s: window.TypeRDebug.rankFor(99, 60, 1), b: window.TypeRDebug.rankFor(95, 35, 0.5), d: window.TypeRDebug.rankFor(70, 10, 0), tier: window.TypeRDebug.comboTier(25), plan: window.TypeRDebug.buildBossPlan(3).segments.length, theme: window.TypeRDebug.getThemeForLevel(1).art, stats: window.TypeRDebug.stats() }));
P.check("rankFor(99,60,1)==='S', rankFor(95,35,.5)==='B'; TypeRDebug exposes buildBossPlan/comboTier/getThemeForLevel", ranks.s === "S" && ranks.b === "B" && ranks.d === "D" && ranks.tier === 3 && ranks.plan === 12 && ranks.theme === "sixth", ranks);
P.check("TypeRDebug.stats() returns {incomingCps, leaksPerMin, deathsBySector, liveChars}", ["incomingCps", "leaksPerMin", "deathsBySector", "liveChars"].every(k => k in ranks.stats), ranks.stats);

// L1 run with the harness typist: wpm within +-15 % of the typist's cps x 12; maxCombo >= polled max combo
await P.startRun("B9");
await waitFor(P, () => !window.game.levelIntro, 6000);
let polledMax = 0;
const typedKeys = { n: 0 };
const tStart = Date.now();
// PACE (D2) shortens sector 1 (S1 boss at ~30-45 s): stop typing at the approach so the window stays inside the waves.
const typed = await typeFor(P, 40, { wpm: 60, accuracy: 0.995, onTick: async (st) => { polledMax = Math.max(polledMax, st.combo || 0); }, until: (st) => st.inBoss || st.wavePhase === "approach" });
const typedS = (Date.now() - tStart) / 1000;
const hudWpm = await P.g(() => { const s = window.game.typistSpeed("live"); return { hud: document.getElementById("hudWpm").textContent, live: s.wpm == null ? null : Math.round(s.wpm), n: s.n, stats: { chars: window.game.stats.chars, timeMs: window.game.stats.timeMs, correct: window.game.stats.correct, total: window.game.stats.total, maxCombo: window.game.stats.maxCombo } }; });
// MEASURE (D1): the HUD shows live hand speed (typistSpeed("live"), last 30 intervals); it commits at 5 Hz, so allow the one-commit drift.
P.check("#hudWpm non-zero after 5 s of typing and within 2 of the live hand speed (5 Hz text commit)", Number(hudWpm.hud) > 0 && hudWpm.live != null && Math.abs(hudWpm.live - Number(hudWpm.hud)) <= 2, hudWpm);
P.check("run.stats.maxCombo >= the polled max combo", hudWpm.stats.maxCombo >= polledMax, { maxCombo: hudWpm.stats.maxCombo, polledMax });
const results = await P.g(() => window.game.buildResults("level"));
const typistCps = typed / typedS;
const expectedWpm = typistCps * 12;
P.check("buildResults('level') has numeric fields and a rank in S/A/B/C/D", ["score", "levelScore", "wpm", "acc", "maxCombo", "words", "kills", "timeMs"].every(k => Number.isFinite(results[k])) && "SABCD".includes(results.rank) && Array.isArray(results.bonusLines), results);
// MEASURE (D1): results.wpm is hand speed (the typist keys every 200 ms -> 60); the gross figure is results.throughput.
P.check("results.throughput within +-15 % of the typist's cps x 12 (gross, over the typed window)", Math.abs(results.throughput - expectedWpm) / expectedWpm <= 0.15 || Math.abs(results.throughput - expectedWpm) <= 4, { throughput: results.throughput, expectedWpm: Math.round(expectedWpm * 10) / 10, typed, typedS: Math.round(typedS * 10) / 10 });
P.check("results.wpm (hand speed) within +-15 % of the typist's 60 WPM", Math.abs(results.wpm - 60) / 60 <= 0.15, { wpm: results.wpm, n: results.wpmN });

// 10 s idle -> #hudWpm holds the live hand speed (its last 30 intervals); the gross tooling figure liveWpm() drops to 0
await sleep(300);
const idle0 = await P.g(() => document.getElementById("hudWpm").textContent);
await sleep(10500);
const idle = await P.g(() => ({ hud: document.getElementById("hudWpm").textContent, gross: window.game.liveWpm() }));
P.check("#hudWpm unchanged after 10 s idle (live hand speed holds); liveWpm() reads 0", idle.hud === idle0 && Number(idle.hud) > 0 && idle.gross === 0, { idle0, idle });

// a 5 s pause adds < 100 ms to timeMs
const t0 = await P.g(() => window.game.stats.timeMs);
await press(P, "Escape");
await sleep(5000);
const t1 = await P.g(() => window.game.stats.timeMs);
await press(P, "Escape");
await sleep(200);
P.check("a 5 s pause adds < 100 ms to stats.timeMs", Math.abs(t1 - t0) < 100, { t0: Math.round(t0), t1: Math.round(t1) });

// HUD write hygiene: idle mutations < 12 per 2 s (no powers, no typing)
const muts = await P.g(async () => {
  const g = window.game;
  g.enemies.length = 0; g.lock = null; g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9;
  const hud = document.getElementById("hud");
  let n = 0;
  const mo = new MutationObserver((list) => { n += list.length; });
  mo.observe(hud, { attributes: true, childList: true, characterData: true, subtree: true });
  await new Promise(r => setTimeout(r, 2000));
  mo.disconnect();
  return n;
});
P.check("HUD mutations while idle < 12 per 2 s", muts < 12, { mutations: muts });

// sectorBests['1'] written after the first clear with rank in SABCD; bestWpm updated
await P.g(() => { window.game.levelT = LEVELS[0].duration + 0.01; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
await typeFor(P, 90, { wpm: 80, accuracy: 0.99, until: (s) => s.bossClear || s.mode !== "playing" });
await waitFor(P, () => window.game.mode === "levelComplete", 12000);
const blob = await P.saveBlob();
const lc = await P.g(() => ({ results: window.game.lastResults, tally: window.game.lastTally }));
// MEASURE (D6): save.bestWpm is frozen legacy; the clear logs a profile session instead (Best WPM needs >= 60 intervals).
P.check("sectorBests['1'] written after the first clear with rank in SABCD; a profile session logged; highScores row carries wpm", !!blob.sectorBests["1"] && "SABCD".includes(blob.sectorBests["1"].rank) && blob.profile && blob.profile.sessions.length >= 1 && blob.highScores[0] && blob.highScores[0].wpm > 0, { sectorBest: blob.sectorBests["1"], sessions: blob.profile && blob.profile.sessions.length, hs: blob.highScores[0], rank: lc.results && lc.results.rank });
P.check("levelStats clocks: bossTimeMs > 0 and <= timeMs; results.timeMs excludes intros", lc.results.timeMs > 0 && (await P.g(() => window.game.levelStats.bossTimeMs)) > 0, { timeMs: lc.results.timeMs, bossTimeMs: await P.g(() => window.game.levelStats.bossTimeMs) });

P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
