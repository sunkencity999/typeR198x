// B3/B10 balance smoke: a 60 WPM / .95 typist clears sector 1 and sector 2 from a fresh save without dying;
// records per-sector timings, leaks, damage and the results data. Usage: node probes/b-run.mjs [--wpm 60] [--accuracy .95] [--sectors 2]
import { openProbe, sleep, state, typeFor, waitFor } from "./b_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const WPM = Number(args.wpm || 60);
const ACC = Number(args.accuracy || 0.95);
const SECTORS = Number(args.sectors || 2);

const P = await openProbe("b-run");
await P.goto("fresh");
await P.startRun("RUN");
const log = [];
let died = false;
for (let s = 0; s < SECTORS; s++) {
  const t0 = Date.now();
  let bossAt = null, minHp = Infinity, leaks = 0;
  await typeFor(P, 400, { wpm: WPM, accuracy: ACC, onTick: async (st) => {
    if (st.inBoss && bossAt === null) bossAt = (Date.now() - t0) / 1000;
    minHp = Math.min(minHp, st.hp);
  }, until: (st) => st.mode !== "playing" });
  const st = await state(P);
  const extra = await P.g(() => ({ results: window.game.lastResults, tally: window.game.lastTally, dbg: window.TypeRDebug.stats(), damage: window.game.levelStats.damageTaken }));
  log.push({ sector: s + 1, mode: st.mode, seconds: Math.round((Date.now() - t0) / 10) / 100, bossAt, minHp, score: st.score, rank: extra.results && extra.results.rank, wpm: extra.results && extra.results.wpm, acc: extra.results && extra.results.acc, damage: extra.damage, leaksPerMin: extra.dbg.leaksPerMin, tally: extra.tally && { total: extra.tally.total, time: Math.round(extra.tally.time), flawless: extra.tally.flawless, accuracy: extra.tally.accuracy } });
  await P.shot(`sector${s + 1}-end`);
  if (st.mode !== "levelComplete") { died = st.mode === "gameOver"; break; }
  if (s + 1 < SECTORS) { await P.page.click("#btnNextLevel"); await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 8000); }
}
console.log(JSON.stringify(log, null, 1));
P.check(`${WPM} WPM / ${ACC} typist clears ${SECTORS} sector(s) from a fresh save without dying`, !died && log.length === SECTORS && log.every(l => l.mode === "levelComplete"), log);
P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
