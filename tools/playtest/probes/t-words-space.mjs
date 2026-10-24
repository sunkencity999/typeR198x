// WORDS (D8) acceptance: Space types the gap of a two-word plate when the locked target's next character is a space,
// releases otherwise; Backspace always releases; bosses, the sector card, pause, auto-repeat and the finale unchanged;
// the touch path (#typeInput insertText) and the harness typists type the space; MEASURE (32-typist.js, real on this tree)
// counts the typed gap as a speed interval and never as a key or a bigram. Usage: node probes/t-words-space.mjs
import { devices } from "playwright";
import { openProbe, sleep, state, typeFor, startFresh, jumpTo, clearField, placeEnemy, press, hold, waitFor } from "./b_lib.mjs";
import { harnessFlags } from "./_lib.mjs";

const P = await openProbe("t-words-space");
await startFresh(P, "WORDS");
await hold(P);
await clearField(P);
const snap = () => P.g(() => { const g = window.game; const r = g.lock && g.lock.ref; return { lock: g.lock ? g.lock.kind : null, ref: r ? r.text : null, progress: r ? r.progress : (g.enemies[0] ? g.enemies[0].progress : null), next: r ? r.nextChar() : null,
  total: g.stats.total, correct: g.stats.correct, misses: g.stats.misses, combo: g.stats.combo, chars: g.stats.chars, words: g.stats.words, kills: g.stats.kills, score: g.stats.score, lockMisses: g.lockMisses | 0, cue: g.sfx.lastCue, alive: g.enemies.filter(e => e.alive).length }; });

// MEASURE readings around the two-word kill (sector intervals, letter attempts, the bigrams across the gap)
const typist = () => P.g(() => { const g = window.game; let keys = 0; for (const c of "abcdefghijklmnopqrstuvwxyz") keys += g.typistKeyStats(c).n;
  return { n: g.typistSpeed("sector").n, keys, pc: g.typistBigramStats("pc").n, rp: g.typistBigramStats("rp").n, co: g.typistBigramStats("co").n }; });
const m0 = await typist();

// S1 two-word kill (60 ms between keys: every gap is a qualifying interval for MEASURE)
await placeEnemy(P, "warp core", 900, 2);
for (const k of "warp") { await press(P, k); await sleep(60); }
const s1a = await snap();
await press(P, "Space"); await sleep(60);
const s1b = await snap();
P.check("S1a 'warp' locks the plate, next char is the space", s1a.lock === "enemy" && s1a.ref === "warp core" && s1a.progress === 4 && s1a.next === " ", s1a);
P.check("S1b Space at the gap types it: progress 5, lock kept, total/correct/combo +1, no lockRelease", s1b.lock === "enemy" && s1b.progress === 5 && s1b.total === s1a.total + 1 && s1b.correct === s1a.correct + 1 && s1b.combo === s1a.combo + 1 && s1b.cue !== "lockRelease", { s1a, s1b });
const before = await P.g(() => ({ score: window.game.stats.score, mult: window.game.stats.mult | 0 || 1, diff: (window.game.diff().score || 1) }));
for (const k of "core") { await press(P, k); await sleep(60); }
const s1c = await snap();
const m1 = await typist();
const want = Math.round(Math.round(SCORE_WORD(9) * 1.2 * before.mult) * before.diff);
function SCORE_WORD(len) { return 60 + 12 * len; }
P.check("S1c 'core' kills it; 9 chars counted; one word; score = word(9) x clean x mult", s1c.alive === 0 && s1c.words === s1a.words + 1 && s1c.chars - (s1a.chars - 4) === 9 && Math.abs((s1c.score - before.score) - want) <= 1, { s1c, gained: s1c.score - before.score, want });
P.check("S1d MEASURE: the gap closes and opens intervals (8 for 'warp core'), adds no key attempt (8 letters) and no bigram across it (pc +0; rp, co +1)",
  m1.n - m0.n === 8 && m1.keys - m0.keys === 8 && m1.pc === m0.pc && m1.rp === m0.rp + 1 && m1.co === m0.co + 1, { m0, m1 });

// S2 Space with a letter next -> release
await placeEnemy(P, "warp core", 900, 2);
await press(P, "w"); await press(P, "a");
const s2a = await snap();
await press(P, "Space");
const s2b = await P.g(() => ({ lock: window.game.lock, progress: window.game.enemies.find(e => e.alive).progress, total: window.game.stats.total, cue: window.game.sfx.lastCue }));
P.check("S2 Space when the next char is a letter releases (progress 0, lockRelease, total unchanged)", s2b.lock === null && s2b.progress === 0 && s2b.total === s2a.total && s2b.cue === "lockRelease", { s2a, s2b });

// S3 Backspace at the gap -> release
for (const k of "warp") await press(P, k);
await press(P, "Backspace");
const s3 = await P.g(() => ({ lock: window.game.lock, progress: window.game.enemies.find(e => e.alive).progress }));
P.check("S3 Backspace at the gap releases", s3.lock === null && s3.progress === 0, s3);

// S4 a letter at the gap is a hard miss; Space then recovers
for (const k of "warp") await press(P, k);
const s4a = await snap();
await press(P, "c");
const s4b = await snap();
await press(P, "Space");
const s4c = await snap();
P.check("S4 letter at the gap = hard miss (total+1, misses+1, lock kept, lockMisses 1); Space then types the gap", s4b.total === s4a.total + 1 && s4b.misses === s4a.misses + 1 && s4b.lock === "enemy" && s4b.lockMisses === 1 && s4c.progress === 5, { s4a, s4b, s4c });
await P.g(() => { window.game.releaseLock("manual"); });
await clearField(P);

// S5 Space with no lock and a plate on screen -> nothing
await placeEnemy(P, "neon city", 900, 1);
const s5a = await snap();
await press(P, "Space");
const s5b = await snap();
P.check("S5 Space with no lock: no miss, no lock, stats unchanged", s5b.lock === null && s5b.total === s5a.total && s5b.misses === s5a.misses, { s5a, s5b });

// S6 auto-repeat Space at the gap is swallowed
for (const k of "neon") await press(P, k);
await P.g(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true, cancelable: true })));
await P.g(() => document.getElementById("game").dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true, cancelable: true })));
const s6 = await snap();
P.check("S6 auto-repeat Space at the gap changes nothing", s6.progress === 4 && s6.lock === "enemy", s6);

// S10 pause: Esc, Space, Esc -> unchanged
await press(P, "Escape"); await sleep(150);
await press(P, "Space");
await press(P, "Escape"); await sleep(150);
const s10 = await snap();
P.check("S10 Space while paused changes nothing", s10.progress === 4 && s10.lock === "enemy", s10);
await press(P, "Space");
for (const k of "city") await press(P, k);
await clearField(P);

// S12 typist types the space (b_lib typeFor)
for (let i = 0; i < 6; i++) await placeEnemy(P, ["game over", "high score", "warp core", "neon city", "zero gravity", "time warp"][i], 520 + i * 120, i % 6);
const typed = await typeFor(P, 12, { wpm: 90, accuracy: 1, until: (st) => st.alive === 0 });
const s12 = await state(P);
P.check("S12 b_lib typeFor clears six two-word plates (types the space)", s12.alive === 0, { typed, alive: s12.alive });

// S7 sector card: Space does nothing
await P.g(() => { const g = window.game; g.startLevel(3, { fromMenu: true, fresh: true }); });
await sleep(300);
const s7a = await P.g(() => ({ intro: !!window.game.levelIntro, total: window.game.stats.total, lock: window.game.lock }));
await press(P, "Space");
const s7b = await P.g(() => ({ intro: !!window.game.levelIntro, total: window.game.stats.total, lock: window.game.lock }));
P.check("S7 Space during the sector card: nothing counted", s7a.intro && s7b.total === s7a.total && !s7b.lock, { s7a, s7b });

// S8 boss: Space unchanged (no progress, no stats)
await waitFor(P, () => !window.game.levelIntro, 6000);
await P.g(() => { const g = window.game; g.invulnT = 1e9; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await waitFor(P, () => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
const b0 = await P.g(() => ({ p: window.game.boss.progress, seg: window.game.boss.segmentIndex, total: window.game.stats.total }));
await press(P, "Space");
const b1 = await P.g(() => ({ p: window.game.boss.progress, seg: window.game.boss.segmentIndex, total: window.game.stats.total }));
P.check("S8 Space in a boss changes nothing", b0.p === b1.p && b0.seg === b1.seg && b0.total === b1.total, { b0, b1 });

// S11 touch: iPhone 13 context, #typeInput insertText
{
  const ctx = await P.browser.newContext({ ...devices["iPhone 13"] });
  await harnessFlags(ctx);   // ONBOARD harness default: no Flight Check in this context either
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await ctx.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ playerName: "T", storySeen: true, lastUnlockedLevel: 4, settings: { muted: true } })); } catch {} }, "typesmup198x.save.v1");
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
  await pg.evaluate(() => { const g = window.game; g.startNewRun(); g.startLevel(3, { fromMenu: true, fresh: true }); });
  await pg.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 10000 });
  await pg.evaluate(() => { const g = window.game; g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.enemies.push(new Enemy({ text: "game over", x: 700, y: g.laneYs()[1], speed: 0, lane: 1 })); });
  await pg.locator("#game").tap({ force: true });
  await sleep(200);
  const focused = await pg.evaluate(() => { const el = document.getElementById("typeInput"); try { el.focus({ preventScroll: true }); } catch {} return document.activeElement === el; });
  await pg.keyboard.insertText("game"); await sleep(50);
  const t1 = await pg.evaluate(() => ({ p: window.game.enemies[0].progress, lock: !!window.game.lock }));
  await pg.keyboard.insertText(" "); await sleep(50);
  const t2 = await pg.evaluate(() => ({ p: window.game.enemies[0].progress, lock: !!window.game.lock }));
  await pg.keyboard.insertText("over"); await sleep(80);
  const t3 = await pg.evaluate(() => ({ alive: window.game.enemies.filter(e => e.alive).length }));
  await pg.evaluate(() => { const g = window.game; g.enemies.push(new Enemy({ text: "neon city", x: 700, y: g.laneYs()[2], speed: 0, lane: 2 })); });
  await pg.keyboard.insertText("ne"); await sleep(50);
  await pg.keyboard.insertText(" "); await sleep(50);
  const t4 = await pg.evaluate(() => ({ lock: window.game.lock, p: window.game.enemies.find(e => e.alive).progress }));
  P.check("S11 touch: insertText types the gap of a locked two-word plate and releases otherwise", focused && t1.p === 4 && t2.p === 5 && t2.lock && t3.alive === 0 && t4.lock === null && t4.p === 0 && errs.length === 0, { focused, t1, t2, t3, t4, errs });
  await ctx.close();
}
P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, P.errors);
await P.finish();
