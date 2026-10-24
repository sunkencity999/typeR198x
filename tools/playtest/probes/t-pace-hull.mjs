// t-pace-hull (PACE, D3 hull; CONTRACT 6 PACE): sectors 1-3 refill on a clear; a clear of sector 4-9 repairs half of the
// missing hull and carries the rest (S4 at 220/500 -> S5 at 432/600, "HULL 72% · REPAIRED +28%" on the card, the Level
// Complete suffix and the announcements); a flawless sector stays full ("HULL 100%"); Retry refills; quitting at Level
// Complete is not a free refill; the card line shows once; the legacy fixtures resume as before. Clears are forced
// through the boss (levelT = duration, onBossKill). ~60 s. PASS = the hull carries as D3 states.
// Usage: node tools/playtest/probes/t-pace-hull.mjs
import { openProbe, sleep, waitFor, startFresh, jumpTo, forceClear, dieNow, reloadInPlace, continueRun, errorsCheck } from "./pace_lib.mjs";

const P = await openProbe("t-pace-hull");
await startFresh(P, "HULL");

const lcText = () => P.g(() => document.getElementById("levelCompleteText").textContent);
const next = async () => {
  await P.g(() => document.getElementById("btnNextLevel").click());
  return waitFor(P, () => window.game.mode === "playing", 8000);
};
const cardLines = () => P.g(() => { const b = window.game.banner; return b && b.kind === "sector" ? (b.lines || []).map((l) => l.text) : null; });
const srText = () => P.g(() => document.getElementById("srAnnounce").textContent);

// ---- 1. S3 clear at 150/400 -> S4 refills ----
await jumpTo(P, 2);
const ok1 = await forceClear(P, { hp: 150 });
const lc1 = await lcText();
const run1 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, runHp: window.game.save.run.hp, note: window.game.paceSnapshot().state.hullNote }));
await next();
const s4 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1 }));
const s4lines = await cardLines();
P.check("1. S3 clear at 150/400 -> S4 refills: hp === maxHp === 500, no hull card line, Level Complete text without a hull suffix",
  ok1 && run1.hp === 500 && run1.max === 500 && run1.runHp === 500 && run1.note === null && !/Hull/.test(lc1) && s4.level === 4 && s4.hp === 500 && s4.max === 500 && (s4lines || []).length === 0, { lc1, run1, s4, s4lines });

// ---- 2. S4 clear at 220/500 -> S5 at 432/600 ----
await waitFor(P, () => !window.game.levelIntro, 6000);
const ok2 = await forceClear(P, { hp: 220 });
const lc2 = await lcText();
const sr2 = await srText();
const save2 = await P.g(() => ({ runHp: window.game.save.run.hp, runMax: window.game.save.run.maxHp, stored: JSON.parse(localStorage.getItem(LS_KEY)).run.hp, note: window.game.paceSnapshot().state.hullNote }));
P.check("2a. S4 clear at 220/500: Level Complete text ends '· Hull 72% (+28% repaired)', announced 'Hull 72 percent after repairs.', save.run.hp 432 / 600 (stored)",
  ok2 && / · Hull 72% \(\+28% repaired\)$/.test(lc2) && /^Next: Sector 5 .* · Max HP 600 · Hull 72% \(\+28% repaired\)$/.test(lc2) && /Hull 72 percent after repairs\./.test(sr2) &&
  save2.runHp === 432 && save2.runMax === 600 && save2.stored === 432 && save2.note && save2.note.level === 5 && save2.note.shown === false, { lc2, sr2, save2 });
await next();
const s5 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1 }));
const s5lines = await cardLines();
await sleep(100);
const sr5 = await srText();
P.check("2b. Next -> S5: hp 432, maxHp 600, the sector card's first line 'HULL 72% · REPAIRED +28%', announced 'Hull 72 percent, repaired 28 percent.'",
  s5.level === 5 && s5.hp === 432 && s5.max === 600 && s5lines && s5lines[0] === "HULL 72% · REPAIRED +28%" && /Hull 72 percent, repaired 28 percent\./.test(sr5), { s5, s5lines, sr5 });
await P.shot("s5-card-hull-line");

// ---- 4a. In S5 (carried 432): Retry sector refills ----
await waitFor(P, () => !window.game.levelIntro, 6000);
await dieNow(P);
await P.g(() => document.getElementById("btnTryAgain").click());
await waitFor(P, () => window.game.mode === "playing", 8000);
const retry = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, note: window.game.paceSnapshot().state.hullNote }));
const retryLines = await cardLines();
P.check("4a. a death in S5 and Retry sector: hp 600 / 600 (the checkpoint restore refills), no hull line, hullNote cleared",
  retry.hp === 600 && retry.max === 600 && retry.note === null && !(retryLines || []).some((t) => /^HULL/.test(t)), { retry, retryLines });

// ---- 3. S5 flawless -> S6 at 700/700, 'HULL 100%' ----
await waitFor(P, () => !window.game.levelIntro, 6000);
const ok3 = await forceClear(P, { hp: 600 });
const lc3 = await lcText();
await next();
const s6 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp }));
const s6lines = await cardLines();
P.check("3. S5 flawless (600/600 at the clear) -> S6 hp 700 / 700, card line 'HULL 100%', Level Complete text without a suffix",
  ok3 && !/Hull/.test(lc3) && s6.hp === 700 && s6.max === 700 && s6lines && s6lines[0] === "HULL 100%", { lc3, s6, s6lines });

// ---- 5 / 4b. Stop at Level Complete (S6 clear at 350/700), Continue -> S7 hp 600 / 800, line once; second Continue -> no line ----
await waitFor(P, () => !window.game.levelIntro, 6000);
const ok5 = await forceClear(P, { hp: 350 });
const exp = await P.g(() => paceHullAfterClear(350, 700, 800));
await P.g(() => document.getElementById("btnBackToMenu1").click());
await waitFor(P, () => window.game.mode === "menu", 6000);
await reloadInPlace(P);
const c1 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1 }));
const c1lines = await cardLines();
await sleep(500);
await P.g(() => window.game.saveRun(true));
await P.g(() => { window.game.stopToMenu(true); });
await waitFor(P, () => window.game.mode === "menu", 6000);
await reloadInPlace(P);
const c2 = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1 }));
const c2lines = await cardLines();
P.check("5 / 4b. S6 clear at 350/700, Sector select at Level Complete, reload + Continue -> S7 at 600 / 800 (no free refill) with 'HULL 75% · REPAIRED +25%' once; a second reload + Continue -> hp kept, no line",
  ok5 && exp.hp === 600 && c1.level === 7 && c1.hp === 600 && c1.max === 800 && c1lines && c1lines[0] === "HULL 75% · REPAIRED +25%" &&
  c2.level === 7 && c2.hp === 600 && !(c2lines || []).some((t) => /^HULL/.test(t)), { exp, c1, c1lines, c2, c2lines });

// ---- 6. legacy fixtures resume as today ----
await P.goto("legacy-midwave");
await continueRun(P);
const lm = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1, pace: window.game.paceSnapshot().state }));
await waitFor(P, () => !window.game.levelIntro, 6000);
await sleep(200);
const lmWave = await P.g(() => ({ wave: window.game.wave, mul: window.game.paceSnapshot().state.mul, quota: window.game.waveQuota(), table: LEVELS[2].quota[window.game.wave] }));
await P.goto("legacy-gameover");
await continueRun(P);
const lg = await P.g(() => ({ hp: window.game.player.hp, max: window.game.player.maxHp, level: window.game.levelIndex + 1 }));
P.check("6. legacy-midwave resumes S3 at 260 / 400 with a fresh pace state (paceMul 1.0, table quota); legacy-gameover resumes S5 at 600 / 600",
  lm.level === 3 && lm.hp === 260 && lm.max === 400 && lm.pace && lm.pace.mul === 1 && lmWave.mul === 1 && lmWave.quota === lmWave.table && lg.level === 5 && lg.hp === 600 && lg.max === 600, { lm, lmWave, lg });

errorsCheck(P);
await P.finish();
