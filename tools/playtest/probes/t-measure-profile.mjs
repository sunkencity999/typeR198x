// t-measure-profile (MEASURE, D6 pilot profile data): schema 2 -> 3 migration, lazy blank profile and Reset save, key /
// bigram EMAs, the 200-bigram cap, the 16 KB budget, no new storage writes while typing, weak keys / bigram formulas,
// sessions, speedEma, sector bests, practice sessions and mode bests (R17), the goal line, blocked storage and the
// hot-path allocation scan. PASS = the feature works.
// Usage: node tools/playtest/probes/t-measure-profile.mjs
import { openProbe, sleep, waitFor, installTypist, holdField, startFresh, jumpTo, clearBoss, typeFor, wordSteps, runSteps, dieByLeak, SIGNAL12 } from "./measure_lib.mjs";

const P = await openProbe("t-measure-profile");
const LS = "typesmup198x.save.v1";

// ---- 1. migration 2 -> 3 ----
const SAVE2 = {
  schema: 2, playerName: "CABINET", selectedShip: "sofrito", highScore: 1234, lastUnlockedLevel: 4, storySeen: true, keyboardHintSeen: true,
  settings: { muted: true, crt: true }, run: null, bestWpm: 44,
  highScores: [
    { runId: "aaaa1111", name: "CABINET", score: 1234, levelReached: 3, startLevel: 1, wpm: 38, acc: 95, maxCombo: 20, ship: "sofrito", difficulty: "standard", date: 2 },
    { runId: "bbbb2222", name: "CABINET", score: 900, levelReached: 2, startLevel: 1, wpm: 31, acc: 92, maxCombo: 12, ship: "sofrito", difficulty: "standard", date: 1 }
  ],
  sectorBests: { "1": { score: 5200, rank: "A", wpm: 40, acc: 96, maxCombo: 30, date: 1 }, "2": { score: 12340, rank: "B", wpm: 44, acc: 92, maxCombo: 22, date: 2 } }
};
await P.goto(SAVE2);
await sleep(300);
const mig = await P.g((src) => {
  const g = window.game, s = g.save;
  const p = s.profile;
  const shape = p && p.v === 1 && p.keys && typeof p.keys === "object" && p.bigrams && Array.isArray(p.sessions) && p.sessions.length === 0 &&
    p.bests && p.bests.speed === 0 && p.bests.ceiling === 0 && p.bests.drill && p.days && p.days.n === 0 && p.speedEma === 0 && p.thrEma === 0 && p.speedN === 0 && p.sectorBest;
  const clean = (x) => { const c = JSON.parse(JSON.stringify(x)); for (const h of c.highScores || []) if (h.runId === "legacy") delete h.date; return JSON.stringify(c); };
  const a = migrateSave(JSON.parse(JSON.stringify(src)));
  const b = migrateSave(JSON.parse(JSON.stringify(a)));
  const seededSrc = { ...JSON.parse(JSON.stringify(src)), highScores: [], legacySeeded: false };
  const sa = migrateSave(JSON.parse(JSON.stringify(seededSrc)));
  const sb = migrateSave(JSON.parse(JSON.stringify(sa)));
  // a hand-edited profile: junk keys, long decimals, an object session row, an invalid row
  const junk = { ...JSON.parse(JSON.stringify(src)), profile: { v: 1, extra: 1, keys: { a: { n: 5.7, err: 0.123456, ms: 210.6 }, A: { n: 3 }, "1": { n: 2 } },
    bigrams: { th: { n: 9, ms: 330.4 }, tH: { n: 1, ms: 1 } }, speedEma: 41.27, sessions: [[1790000000, "campaign", 2, 41, 95.55, "A", 3000, 4, 80, "kp"], [1, "bogus"], { t: 1790000100000, mode: "drill", sector: 0, speed: 50, acc: 97, rank: null, score: 0, misses: 2, steady: null, weak: "" }] } };
  const ja = migrateSave(JSON.parse(JSON.stringify(junk)));
  const jb = migrateSave(JSON.parse(JSON.stringify(ja)));
  return {
    schema: s.schema, shape, rows: s.highScores.map((h) => h.wpmLegacy), bests: Object.values(s.sectorBests).map((e) => e.wpmLegacy), bestWpm: s.bestWpm,
    idem: clean(a) === clean(b), idemSeeded: clean(sa) === clean(sb), seededLegacy: sa.highScores.length === 1 && sa.highScores[0].wpmLegacy === true,
    idemJunk: JSON.stringify(ja) === JSON.stringify(jb), junk: ja.profile, secondPassMarksNothing: b.highScores.every((h) => h.wpmLegacy === true)
  };
}, SAVE2);
P.check("1. schema 2 blob -> schema 3, blank profile shape, highScores and sectorBests flagged wpmLegacy, bestWpm 44 kept; migrateSave is a fixed point (also seeded / hand-edited profiles)",
  mig.schema === 3 && mig.shape && mig.rows.length === 2 && mig.rows.every((v) => v === true) && mig.bests.every((v) => v === true) && mig.bestWpm === 44 &&
  mig.idem && mig.idemSeeded && mig.seededLegacy && mig.idemJunk && Object.keys(mig.junk.keys).join() === "a" && mig.junk.keys.a.n === 5 && mig.junk.keys.a.err === 0.1235 &&
  mig.junk.sessions.length === 2 && mig.junk.sessions[1][1] === "drill" && mig.junk.sessions[1][0] === 1790000100 && !("extra" in mig.junk) && Object.keys(mig.junk.bigrams).join() === "th", mig);

// ---- 2. fresh save: profile null until the first key; Reset save ----
await startFresh(P, "PROFILE");
await installTypist(P);
await holdField(P);
const fresh0 = await P.g(() => ({ profile: window.game.save.profile, goal: window.game.typistGoal().text }));
await runSteps(P, [{ at: 0, plate: "alpha" }, { at: 30, ch: "a" }]);
const fresh1 = await P.g(() => { const p = window.game.save.profile; return { v: p && p.v, sessions: p && p.sessions.length, a: window.game.typistKeyStats("a").n }; });
await P.g(() => window.game.stopToMenu(true));
await sleep(300);
await P.page.click("#btnResetSave");
await P.page.locator("#btnConfirmOk").click();
await sleep(400);
const reset = await P.g(() => ({ profile: window.game.save.profile, a: window.game.typistKeyStats("a").n, weak: window.game.typistWeakKeys().length }));
P.check("2. fresh save: profile null until the first key, then a blank profile; Reset save -> blank again, typistKeyStats('a').n === 0",
  fresh0.profile === null && fresh1.v === 1 && fresh1.sessions === 0 && fresh1.a === 1 && (reset.profile === null || (reset.profile.v === 1 && Object.keys(reset.profile.keys).length === 0)) && reset.a === 0 && reset.weak === 0,
  { fresh0, fresh1, reset });
P.check("12a. goal on a fresh save: 'NEXT GOAL · CLEAR SECTOR 1 AT 90%'", fresh0.goal === "NEXT GOAL · CLEAR SECTOR 1 AT 90%", fresh0);

// ---- 3. per-key and bigram EMAs ----
await P.startRun("PROFILE");
await waitFor(P, () => !window.game.levelIntro, 6000);
await installTypist(P);
await holdField(P);
const ema = await P.g(async () => {
  const g = window.game, ty = g.typistState();
  if (!window.__iv) { window.__iv = null; onGameHook("typistInterval", function (e) { if (window.__iv) window.__iv.push(e.ms); }); }
  const before = { n: ty.kN[0], err: ty.kErr[0], ms: ty.kMs[0], bn: ty.bN[0], bms: ty.bMs[0] };
  window.__ty.plate("a".repeat(18), 2, 800);
  window.__iv = [];
  const seq = "aaaaaaaaaaxaaaaxaaaa";
  for (const c of seq) { g.handleTyped(c); await new Promise((r) => setTimeout(r, 120 + Math.random() * 80)); }
  const ivs = window.__iv; window.__iv = null;
  let n = before.n, err = before.err, ms = before.ms, bn = before.bn, bms = before.bms;
  for (const c of seq) { n++; err = err * 0.95 + (c === "x" ? 0.05 : 0); }
  for (const iv of ivs) { ms = ms > 0 ? ms + 0.15 * (iv - ms) : iv; bn++; bms = bn > 1 ? bms + 0.15 * (iv - bms) : iv; }
  return { before, ivs: ivs.length, expect: { n, err, ms, bn, bms }, got: { n: ty.kN[0], err: ty.kErr[0], ms: ty.kMs[0], bn: ty.bN[0], bms: ty.bMs[0] } };
});
const close = (a, b) => Math.abs(a - b) <= 1e-9;
P.check("3. 20 attempts on 'a' with 2 misses: n and err follow the .05 EMA recurrence; ms and the 'aa' bigram follow the .15 EMA of the measured intervals (17)",
  ema.ivs === 17 && close(ema.got.n, ema.expect.n) && close(ema.got.err, ema.expect.err) && close(ema.got.ms, ema.expect.ms) && close(ema.got.bn, ema.expect.bn) && close(ema.got.bms, ema.expect.bms), ema);

// ---- 4. 300 bigrams -> 200 persisted, the highest n kept ----
const big = await P.g(() => {
  const g = window.game, ty = g.typistState();
  ty.bN.fill(0); ty.bMs.fill(0);
  for (let i = 0; i < 300; i++) {
    const idx = i * 2, a = (idx / 26) | 0, b = idx % 26;
    const reps = 1 + (i % 10);
    for (let k = 0; k < reps; k++) g.typistAddInterval(ty, 100 + (i % 7), a, b, nowMs(), "probe");
  }
  storeSave(g.save);
  const keys = Object.keys(g.save.profile.bigrams);
  const kept = new Set(keys);
  let minKept = Infinity, maxDropped = 0;
  for (let i = 0; i < 300; i++) { const k = TYPIST_BIGRAM_KEYS[i * 2]; const n = ty.bN[i * 2]; if (kept.has(k)) minKept = Math.min(minKept, n); else maxDropped = Math.max(maxDropped, n); }
  const stored = JSON.parse(localStorage.getItem("typesmup198x.save.v1")).profile.bigrams;
  return { count: keys.length, storedCount: Object.keys(stored).length, minKept, maxDropped, sample: stored[keys[0]] };
});
P.check("4. 300 distinct bigrams fed -> the flushed profile.bigrams holds 200, every kept n >= every dropped n", big.count === 200 && big.storedCount === 200 && big.minKept >= big.maxDropped, big);

// ---- 5. worst-case size and the 101st session ----
const size = await P.g(() => {
  const g = window.game;
  const L = "abcdefghijklmnopqrstuvwxyz";
  const keys = {}; for (const c of L) keys[c] = { n: 123456, err: 0.0425, ms: 1234 };
  const bigrams = {}; let k = 0; for (const a of L) for (const b of L) if (k++ < 200) bigrams[a + b] = { n: 12345, ms: 1234 };
  const sessions = []; for (let i = 0; i < 100; i++) sessions.push([1761234567 + i, "campaign", 10, 123, 96.5, "A", 123456, 123, 78, "kpt"]);
  const sectorBest = {}; for (let i = 1; i <= 10; i++) sectorBest[String(i)] = { speed: 123, acc: 99.5, t: 1761234567 };
  g.save.profile = { v: 1, keys, bigrams, speedEma: 123.4, thrEma: 123.4, speedN: 123456, sessions, sectorBest, bests: { speed: 123, ceiling: 123, drill: { speed: 123, acc: 99.5 } }, days: { n: 1234, last: 20261023 } };
  g._ty.saveRef = null;                    // re-hydrate the typed tables from the injected profile
  g.typistState();
  storeSave(g.save);
  const len0 = JSON.stringify(g.save.profile).length;
  const first0 = g.save.profile.sessions[0][0];
  const out = g.typistEndSession({ mode: "drill" });
  const p = g.save.profile;
  return { len0, len1: JSON.stringify(p).length, count: p.sessions.length, first0, first1: p.sessions[0][0], lastMode: p.sessions[p.sessions.length - 1][1], out };
});
P.check("5. worst-case profile (26 keys, 200 bigrams, 100 max rows, 10 sector bests) <= 16,384 B; a 101st session drops the oldest",
  size.len0 <= 16384 && size.len1 <= 16384 && size.count === 100 && size.first1 === size.first0 + 1 && size.lastMode === "drill", size);

// ---- 6. typing adds no storage writes ----
await P.goto("fresh");
await P.startRun("WRITES");
await waitFor(P, () => !window.game.levelIntro, 6000);
await P.g(() => {
  // The first word lock on a fresh save writes the one-time LOCK and FINISH tips (markTutorial -> storeSave): mark them
  // seen so the two windows count the autosave cadence only (release finding R6: 6 vs 4 in 2 of 3 runs).
  Object.assign(window.game.save.tutorialSeen, { lock: true, finish: true });
  window.__writes = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === "typesmup198x.save.v1") window.__writes++; return orig.call(this, k, v); };
});
// Both windows play on a held field (no spawns, no leaks, no deaths), so only the autosave cadence can write.
await installTypist(P);
await holdField(P);
await P.g(() => { window.__writes = 0; });
await sleep(6000);
const idleWrites = await P.g(() => window.__writes);
await holdField(P);
await P.g(() => { window.__writes = 0; window.__keys0 = window.game.typistDebug().seg.keys; });
await runSteps(P, wordSteps(Array.from({ length: 10 }, () => "signal"), 100));   // 60 keys in 6 s = 120 WPM
const typeWrites = await P.g(() => window.__writes);
const typed6 = await P.g(() => window.game.typistDebug().seg.keys - window.__keys0);
P.check("6. setItem count: 6 s typing at 120 WPM vs 6 s idle play differ by <= 1 and neither exceeds 6", Math.abs(typeWrites - idleWrites) <= 1 && typeWrites <= 6 && idleWrites <= 6 && typed6 > 20, { idleWrites, typeWrites, typed6 });

// ---- 7. weak keys ----
const weak = await P.g(() => {
  const g = window.game, ty = g.typistState();
  ty.kN.fill(0); ty.kErr.fill(0); ty.kMs.fill(0);
  const set = (c, n, err, ms) => { const i = c.charCodeAt(0) - 97; ty.kN[i] = n; ty.kErr[i] = err; ty.kMs[i] = ms; };
  set("a", 20, 0.10, 300); set("b", 14, 0.5, 900); set("c", 30, 0.0625, 200); set("d", 30, 0.02, 400); set("e", 20, 0.2, 200);
  for (const c of "fghij") set(c, 30, 0.01, 200);
  ty.wStale = true; ty.wAt = -1e9;
  const got = g.typistWeakKeys();
  return { got: got.slice(), frozen: Object.isFrozen(got), stats: [..."abcdefghij"].map((c) => [c, ty.kN[c.charCodeAt(0) - 97], ty.kErr[c.charCodeAt(0) - 97], ty.kMs[c.charCodeAt(0) - 97]]) };
});
// independent reference implementation of D6: n >= 15, score = 4 x err + max(0, ms / median_ms - 1), keep > .25, top 3
const ref = (() => {
  const el = weak.stats.filter(([, n]) => n >= 15);
  const ms = el.map(([, , , m]) => m).filter((m) => m > 0).sort((a, b) => a - b);
  const med = ms.length >= 3 ? (ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2) : 0;
  return el.map(([c, , err, m]) => [c, 4 * err + (med > 0 && m > 0 ? Math.max(0, m / med - 1) : 0)]).filter(([, s]) => s > 0.25).sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1)).slice(0, 3).map(([c]) => c);
})();
P.check("7. typistWeakKeys() === the D6 formula on injected stats (n 14 excluded, score exactly .25 excluded, top 3 weakest first), frozen",
  JSON.stringify(weak.got) === JSON.stringify(ref) && JSON.stringify(ref) === JSON.stringify(["d", "a", "e"]) && weak.frozen, { got: weak.got, ref });

// ---- 8. weak bigram ----
const wb = await P.g(() => {
  const g = window.game, ty = g.typistState();
  const idx = (s) => (s.charCodeAt(0) - 97) * 26 + (s.charCodeAt(1) - 97);
  ty.bN.fill(0); ty.bMs.fill(0);
  for (const [b, n, ms] of [["th", 9, 100], ["he", 9, 100], ["in", 9, 100], ["er", 9, 100], ["an", 12, 100], ["re", 8, 140], ["qz", 7, 999]]) { ty.bN[idx(b)] = n; ty.bMs[idx(b)] = ms; }
  ty.wStale = true; ty.wAt = -1e9;
  const slow = g.typistWeakBigram();
  ty.bMs[idx("re")] = 130; ty.wStale = true; ty.wAt = -1e9;
  const notSlow = g.typistWeakBigram();
  ty.kN.fill(0); ty.kErr.fill(0); ty.kMs.fill(0); ty.wStale = true; ty.wAt = -1e9;
  const none = g.typistWeakKeys();
  return { slow, notSlow, none: { len: none.length, frozen: Object.isFrozen(none), shared: none === g.typistWeakKeys() } };
});
P.check("8. weak bigram: the slowest with n >= 8 and ms >= 1.35 x median ('re'; n 7 excluded), null below; weak keys none -> the shared frozen []",
  wb.slow === "re" && wb.notSlow === null && wb.none.len === 0 && wb.none.frozen && wb.none.shared, wb);

// ---- 9 / 10. sessions, speedEma, days, sector bests ----
await P.goto("fresh");
await P.startRun("SESSION");
await waitFor(P, () => !window.game.levelIntro, 6000);
await installTypist(P);
await holdField(P);
await runSteps(P, wordSteps(SIGNAL12, 180));
const pre9 = await P.g(() => { const p = window.game.save.profile; return { sessions: p.sessions.length, ema: p.speedEma, thr: p.thrEma }; });
await clearBoss(P, { wpm: 80, accuracy: 0.99 });
await sleep(400);
const s9 = await P.g(() => {
  const g = window.game, p = g.save.profile, r = g.lastResults, row = p.sessions[p.sessions.length - 1];
  return { mode: g.mode, n: r.wpmN, speed: r.wpm, rank: r.rank, total: g.levelStats.total, correct: g.levelStats.correct, row, sessions: p.sessions.length, ema: p.speedEma, sectorBest: p.sectorBest["1"], obj: g.typistSessions(1)[0] };
});
const w9 = s9.n / (s9.n + 300);
const ema9 = Math.round((pre9.ema > 0 ? pre9.ema + w9 * (s9.speed - pre9.ema) : s9.speed) * 10) / 10;
// acc (r[4]) is a number, or null for a segment with under 10 keys (review fix: no 100 % for no typing)
const rowOk = (r) => Array.isArray(r) && r.length === 10 && Number.isInteger(r[0]) && typeof r[1] === "string" && Number.isInteger(r[2]) && Number.isInteger(r[3]) && (r[4] === null || typeof r[4] === "number") &&
  (r[5] === null || /^[SABCD]$/.test(r[5])) && Number.isInteger(r[6]) && Number.isInteger(r[7]) && (r[8] === null || Number.isInteger(r[8])) && typeof r[9] === "string";
// death in sector 2, from a different local day
await P.g(() => { window.game.advanceLevel(); });
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 15000);
await installTypist(P);
await holdField(P);
await P.g(() => { const p = window.game.save.profile; p.days.last = 20000101; window.__days0 = p.days.n; window.game.player.hp = 1; });
await dieByLeak(P);
await sleep(300);
const d9 = await P.g(() => {
  const g = window.game, p = g.save.profile, row = p.sessions[p.sessions.length - 1];
  const daysAfterDeath = { n: p.days.n, last: p.days.last, before: window.__days0 };
  const drillOut = g.typistEndSession({ mode: "drill" });
  const norm = [typistNormaliseRow([1790000000, "campaign", 2, 0, null, null, 0, 0, null, ""]), typistNormaliseRow([1790000000, "campaign", 2, 0, "x", null, 0, 0, null, ""]),
    typistNormaliseRow({ t: 1790000000, mode: "drill", sector: 0, speed: 0, acc: null, rank: null, score: 0, misses: 0, steady: null, weak: "" })];
  const fixed = JSON.stringify(typistMigrateProfile(typistMigrateProfile(p)).sessions) === JSON.stringify(typistMigrateProfile(p).sessions);
  return { row, sessions: p.sessions.length, daysAfterDeath, daysSameDay: p.days.n, sectorBest2: p.sectorBest["2"] || null, keys: g.typistDebug().seg.keys, drillAcc: drillOut.acc, norm, fixed, obj: g.typistSessions(2)[0] };
});
const today = (() => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
P.check("9. session on clear: +1 row, typed per 7.1, rank letter, speedEma per w = n / (n + 300); death row rank null; days.n +1 on a new local day only",
  s9.mode === "levelComplete" && s9.sessions === pre9.sessions + 1 && rowOk(s9.row) && s9.row[1] === "campaign" && s9.row[2] === 1 && s9.row[5] === s9.rank && s9.row[3] === Math.round(s9.speed) &&
  Math.abs(s9.ema - ema9) <= 0.05 && s9.obj.rank === s9.rank && s9.obj.sector === 1 &&
  rowOk(d9.row) && d9.row[5] === null && d9.row[2] === 2 && d9.daysAfterDeath.n === d9.daysAfterDeath.before + 1 && d9.daysAfterDeath.last === today && d9.daysSameDay === d9.daysAfterDeath.n,
  { pre9, s9, ema9, d9 });
P.check("9b. a segment with under 10 keys logs acc null, not 100 (the zero-key death row, typistSessions, a keyless typistEndSession); the clear row keeps its number; rows keep null through normalisation (fixed point), a non-number acc is still rejected",
  typeof s9.row[4] === "number" && s9.row[4] > 50 && d9.keys < 10 && d9.row[4] === null && d9.obj.acc === null && d9.drillAcc === null &&
  d9.norm[0] && d9.norm[0][4] === null && d9.norm[1] === null && d9.norm[2] && d9.norm[2][4] === null && d9.fixed,
  { clearAcc: s9.row[4], keys: d9.keys, deathAcc: d9.row[4], obj: d9.obj, drillAcc: d9.drillAcc, norm: d9.norm, fixed: d9.fixed });
// sector-best rules on controlled segments
const sb = await P.g(() => {
  const g = window.game, ty = g.typistState(), p = g.save.profile;
  const seg = (n, msPer, keys, miss) => { g.typistBeginSegment("probe"); ty.sN = n; ty.sMs = n * msPer; ty.sSq = n * msPer * msPer; ty.sKeys = keys; ty.sMiss = miss; g.levelStats.total = keys; g.levelStats.correct = keys - miss; };
  seg(30, 200, 100, 2);
  g.typistOnSectorEnd({ results: { rank: "A", levelScore: 10 }, outcome: "clear", level: 5, levelIndex: 4, handled: false });
  const s5 = p.sectorBest["5"] ? { ...p.sectorBest["5"] } : null;
  seg(80, 150, 40, 0);
  g.typistOnSectorEnd({ results: { rank: "S", levelScore: 10 }, outcome: "clear", level: 6, levelIndex: 5, handled: false });
  const s6 = p.sectorBest["6"] ? { ...p.sectorBest["6"] } : null;
  seg(80, 100, 100, 0);
  g.typistOnSectorEnd({ results: { rank: null, levelScore: 10 }, outcome: "death", level: 7, levelIndex: 6, handled: false });
  return { s5, s6, s7: p.sectorBest["7"] || null };
});
P.check("10. sector bests: a campaign clear sets speed (>= 60 intervals) and acc (>= 50 keys) independently of score; a death never does",
  s9.sectorBest && s9.sectorBest.speed === Math.round(s9.speed) && s9.n >= 60 && s9.sectorBest.acc > 0 && d9.sectorBest2 === null &&
  sb.s5 && sb.s5.speed === 0 && sb.s5.acc === 98 && sb.s6 && sb.s6.speed === 80 && sb.s6.acc === 0 && sb.s7 === null, { s1: s9.sectorBest, sb, d9: d9.sectorBest2 });

// ---- 11. practice session (drill / endless) ----
await P.goto("fresh");
await P.startRun("DRILL");
await waitFor(P, () => !window.game.levelIntro, 6000);
await installTypist(P);
await holdField(P);
await P.g(() => window.game.typistBeginSegment("drill"));
await runSteps(P, wordSteps(SIGNAL12.slice(0, 4), 200));
const pr = await P.g(() => {
  const g = window.game, p = g.save.profile;
  const snap = () => JSON.stringify({ run: g.save.run, sectorBests: g.save.sectorBests, sectorBest: p.sectorBest, speed: p.bests.speed, high: g.save.highScore, hs: g.save.highScores });
  const before = snap();
  const out = g.typistEndSession({ mode: "drill", sector: 0, score: 0 });
  const drill = { ...p.bests.drill };
  const e1 = g.typistEndSession({ mode: "endless", ceiling: 64 });
  const c1 = p.bests.ceiling;
  g.typistEndSession({ mode: "endless", ceiling: 50 });
  const after = snap();
  const last3 = p.sessions.slice(-3).map((r) => r[1]);
  return { out, drill, c1, c2: p.bests.ceiling, same: before === after, last3, e1 };
});
P.check("11. typistEndSession: drill / endless rows; bests.drill = the best-rated pair, bests.ceiling 64 (kept over 50); save.run, sectorBests, profile.sectorBest, bests.speed and records untouched",
  pr.out.mode === "drill" && pr.out.n === 20 && Math.abs(pr.out.speed - 60) <= 3 && pr.drill.speed === pr.out.speed && pr.drill.acc === 100 && pr.c1 === 64 && pr.c2 === 64 &&
  pr.same && JSON.stringify(pr.last3) === JSON.stringify(["drill", "endless", "endless"]), pr);

// ---- 12. goal line ----
const goal = await P.g(() => {
  const g = window.game, p = g.save.profile;
  g.save.lastUnlockedLevel = 5;
  const row = (speed, acc, rank, sector) => [1790000000, "campaign", sector, speed, acc, rank, 1000, 3, 70, ""];
  p.sessions = [row(40, 92, "A", 2), row(42, 93, "A", 2), row(44, 94, "A", 3), row(46, 93, "B", 3), row(48, 92, "A", 3), [1790000001, "drill", 0, 99, 99, null, 0, 0, 90, ""]];
  const a = g.typistGoal().text;
  p.sessions = [row(40, 96, "A", 2), row(42, 97, "A", 2), row(44, 98, "A", 3), row(46, 97, "B", 3), row(48, 96, null, 3)];
  const b = g.typistGoal().text;
  return { a, b };
});
P.check("12. goal from the last five campaign sessions: acc < 95 holds speed (44 WPM AT 95%, next sector 4); else pushes speed x1.05 (47 WPM AT 97%) in the death sector 3",
  goal.a === "NEXT GOAL · 44 WPM AT 95% IN SECTOR 4" && goal.b === "NEXT GOAL · 47 WPM AT 97% IN SECTOR 3", goal);

// ---- 13. storage blocked ----
await P.goto("fresh");
await P.startRun("BLOCKED");
await waitFor(P, () => !window.game.levelIntro, 6000);
await P.g(() => { window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("QuotaExceeded (stubbed)"); }; });
const err0 = P.errors.pageErrors.length;
await jumpTo(P, 2);   // sector 3: enough word plates in 20 s for a live WPM
await typeFor(P, 20, { wpm: 90, accuracy: 0.95 });
const hud13 = await P.g(() => ({ wpm: document.getElementById("hudWpm").textContent, acc: document.getElementById("hudAcc").textContent, n: window.game.typistSpeed("run").n }));
await installTypist(P);
await P.g(() => { window.game.player.hp = 1; });
await dieByLeak(P);
await sleep(500);
const card13 = await P.g(() => ({ mode: window.game.mode, why: document.querySelector("#resultsOver .rankWhy").textContent, persist: window.game.persistUnavailable }));
await P.g(() => { Storage.prototype.setItem = window.__origSet; });
P.check("13. storage blocked (setItem throws): 20 s of play without page errors, HUD WPM / ACC live, the Game Over card carries its cause line",
  P.errors.pageErrors.length === err0 && /^\d+$/.test(hud13.wpm) && /^\d+%$/.test(hud13.acc) && hud13.n > 10 && card13.mode === "gameOver" && /^SIGNAL LOST · /.test(card13.why), { hud13, card13 });

// ---- 14. hot-path allocation scan ----
const scan = await P.g(() => {
  const names = ["typistOnCorrect", "typistOnMiss", "typistHudAcc", "typistHudWpm", "typistDrawOverlay", "typistAttempt", "typistAddInterval", "typistNearest", "typistPopBlocked"];
  const rules = [[/\bnew\s/, "new"], [/\.map\(/, ".map("], [/\.filter\(/, ".filter("], [/\.slice\(/, ".slice("], [/\.concat\(/, ".concat("], [/JSON\./, "JSON."], [/`/, "template literal"],
    [/(^|[=(,:?!&|;{]|return)\s*\[/m, "array literal"], [/(^|[=(,:?!&|;]|return)\s*\{/m, "object literal"], [/\.\.\./, "spread"]];
  const hits = [];
  for (const n of names) {
    const fn = Game.prototype[n];
    if (typeof fn !== "function") { hits.push(`${n}: missing`); continue; }
    const src = fn.toString().replace(/\/\/[^\n]*/g, "").replace(/^[^{]*\{/, "");   // drop comments and the signature
    for (const [re, label] of rules) if (re.test(src)) hits.push(`${n}: ${label}`);
  }
  return { names: names.length, hits };
});
P.check("14. hot path (typistOnCorrect / OnMiss / HudAcc / HudWpm / DrawOverlay + helpers): no new, .map / .filter / .slice / .concat, JSON, template, array or object literals", scan.hits.length === 0, scan);

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
