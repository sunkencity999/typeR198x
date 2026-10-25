// t-measure-speed (MEASURE, D1 honest speed): qualifying intervals, scopes, HUD WPM, results / rank / records / Best WPM,
// touch bursts. PASS = the feature works. Controlled typing = measure_lib.mjs (frozen spawner, scripted plates,
// handleTyped from an in-page setTimeout chain); harness typing = typeFor (real keyboard events).
// Usage: node tools/playtest/probes/t-measure-speed.mjs [--dpr 1|2]
import {
  openProbe, sleep, typeFor, jumpTo, waitFor, installTypist, holdField, wordSteps, runSteps, speed, dbg,
  freshControlled, clearBoss, dieByLeak, SIGNAL12
} from "./measure_lib.mjs";

const dprAt = process.argv.indexOf("--dpr");
const dpr = dprAt > 0 ? Number(process.argv[dprAt + 1]) || 1 : 1;
const P = await openProbe("t-measure-speed", { dpr });
const seg = async () => (await dbg(P)).seg;
const begin = async () => P.g(() => window.game.typistBeginSegment("probe"));
const within = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi;

// ---- 1. 12 x "signal" at 200 ms/key in sector 1 -> n 60, 57-63 WPM ----
await freshControlled(P, "SPEED");
await begin();
await runSteps(P, wordSteps(SIGNAL12, 200));
const s1 = await speed(P, "sector");
P.check("1. sector 1: 12 x 'signal' at 200 ms/key -> typistSpeed('sector') n === 60, wpm 57-63", s1.n === 60 && within(s1.wpm, 57, 63), s1);

// ---- 2. same in sector 5: sector independence ----
await jumpTo(P, 4);
await installTypist(P);
await holdField(P);
await begin();
await runSteps(P, wordSteps(SIGNAL12, 200));
const s5 = await speed(P, "sector");
P.check("2. sector 5: same typing -> 57-63 WPM and within 5 % of sector 1", s5.n === 60 && within(s5.wpm, 57, 63) && Math.abs(s5.wpm - s1.wpm) / s1.wpm <= 0.05, { s1, s5 });

// ---- 3. one wrong key per word, next correct key 400 ms after the previous -> 47-53 ----
await holdField(P);
await begin();
await runSteps(P, wordSteps(SIGNAL12, 200, { miss: true }));
const s3 = await speed(P, "sector");
const seg3 = await seg();
P.check("3. a wrong key inside each word (next correct key 400 ms later) -> 47-53 WPM (errors cost time)", s3.n === 60 && within(s3.wpm, 47, 53) && seg3.miss === 12, { s3, seg3 });

// ---- 4. single letters add nothing ----
await holdField(P);
const n4a = (await seg()).n;
{
  const steps = [];
  const letters = "abcdefghij";
  for (let i = 0; i < 10; i++) { steps.push({ at: 20 + i * 200, hold: true }); steps.push({ at: 30 + i * 200, plate: letters[i] }); steps.push({ at: 120 + i * 200, ch: letters[i] }); }
  await runSteps(P, steps);
}
const n4b = await seg();
P.check("4. ten single-letter plates typed -> intervals unchanged", n4b.n === n4a && n4b.keys >= 10, { before: n4a, after: n4b });

// ---- 5. first key excluded: one 'signal' -> +5 ----
await holdField(P);
const n5a = (await seg()).n;
await runSteps(P, wordSteps(["signal"], 200));
const n5b = (await seg()).n;
P.check("5. one 'signal' -> exactly +5 intervals (first key of the target excluded)", n5b - n5a === 5, { before: n5a, after: n5b });

// ---- 6. pause resets the chain ----
await holdField(P);
await runSteps(P, [{ at: 0, plate: "signal" }, { at: 20, ch: "s" }, { at: 220, ch: "i" }, { at: 420, ch: "g" }]);
const n6a = (await seg()).n;
await P.page.keyboard.press("Escape");
await sleep(1000);
const paused = await P.g(() => window.game.mode);
await P.page.keyboard.press("Escape");
await waitFor(P, () => window.game.mode === "playing", 3000);
await runSteps(P, [{ at: 0, ch: "n" }]);
const n6b = (await seg()).n;
await runSteps(P, [{ at: 200, ch: "a" }]);
const n6c = (await seg()).n;
P.check("6. 'sig', Esc, 1 s, Esc, 'n' -> +0; 'a' 200 ms later -> +1", paused === "paused" && n6b - n6a === 0 && n6c - n6b === 1, { paused, n6a, n6b, n6c });

// ---- 7. a > 1500 ms gap is dropped ----
await holdField(P);
await runSteps(P, [{ at: 0, plate: "signal" }, { at: 20, ch: "s" }, { at: 220, ch: "i" }]);
const n7a = (await seg()).n;
await runSteps(P, [{ at: 1600, ch: "g" }]);
const n7b = (await seg()).n;
await runSteps(P, [{ at: 200, ch: "n" }]);
const d7 = await dbg(P);
P.check("7. 'si', 1600 ms, 'g' -> +0; 'n' 200 ms later -> +1 (200 +- 20 ms)", n7b - n7a === 0 && d7.seg.n - n7b === 1 && within(d7.last, 180, 220), { n7a, n7b, after: d7.seg.n, last: d7.last });

// ---- 8. burst: three keys in one task -> +0 ----
await holdField(P);
const n8a = (await seg()).n;
await runSteps(P, [{ at: 0, plate: "signal" }, { at: 20, burst: "sig" }]);
const n8b = await seg();
P.check("8. three keys dispatched in one task -> +0 (gaps < 10 ms dropped)", n8b.n === n8a && n8b.keys >= 3, { before: n8a, after: n8b });

// ---- 10. capsule label counts like a word: 'shield' -> +5 ----
await holdField(P);
const n10a = (await seg()).n;
{
  const steps = [{ at: 0, capsule: "SHIELD" }];
  "shield".split("").forEach((c, i) => steps.push({ at: 50 + i * 200, ch: c }));
  await runSteps(P, steps);
}
const n10b = (await seg()).n;
P.check("10. a 'shield' capsule typed at 200 ms/key -> +5", n10b - n10a === 5, { before: n10a, after: n10b });

// ---- 9. boss: intervals = sum(len - 1) per segment; a minion key between two boss keys breaks the chain ----
await holdField(P);
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.wavePhase = "spawn"; g.spawnAcc = 0; });
await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 20000);
await sleep(300);
const bossInfo = await P.g(() => {
  const g = window.game; const b = g.boss;
  g.minionAcc = -1e9; b.surgeTimer = -1e9; if (b.surge && typeof g.cancelSurge === "function") g.cancelSurge(false);
  for (const e of g.enemies) if (e.kind === "bossMinion") { e.alive = false; }
  g.enemies.length = 0;
  return { seg: b.segmentIndex, prog: b.progress, segs: b.segments.slice(b.segmentIndex, b.segmentIndex + 3), phaseStarts: b.phaseStarts.slice() };
});
const n9a = (await seg()).n;
{
  const steps = [];
  let t = 0;
  const [a, b] = bossInfo.segs;
  for (const word of [a, b]) for (const c of word) { steps.push({ at: t, ch: c }); t += 200; }
  await runSteps(P, steps);
}
const n9b = (await seg()).n;
const cseg = bossInfo.segs[2];
const minionRun = await P.g(async (segText) => {
  const g = window.game; const b = g.boss;
  g.minionAcc = -1e9; b.surgeTimer = -1e9;
  const n0 = g.typistDebug().seg.n;
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  g.handleTyped(b.nextChar); await T(200);
  g.handleTyped(b.nextChar); await T(200);           // +1
  const n1 = g.typistDebug().seg.n;
  const used = new Set([...segText, ...g.enemies.map((e) => e.text[0])]);
  const letter = "zqxjkvwy".split("").find((c) => !used.has(c) && c !== b.nextChar) || "z";
  const ys = g.laneYs();
  const m = new Enemy({ text: letter, x: g.w * 0.6, y: ys[1], speed: 0, kind: "bossMinion", lane: 1 });
  g.enemies.push(m);
  g.handleTyped(letter); await T(100);               // minion key between two boss keys
  const killed = !m.alive || m.dying;
  g.handleTyped(b.nextChar); await T(200);           // +0: the chain broke on the minion
  const n2 = g.typistDebug().seg.n;
  g.handleTyped(b.nextChar);                         // +1
  const n3 = g.typistDebug().seg.n;
  return { n0, n1, n2, n3, killed, letter };
}, cseg);
P.check("9. boss: two segments at 200 ms -> intervals === sum(len - 1); a minion key between boss keys -> the next boss key adds 0",
  bossInfo.prog === 0 && n9b - n9a === (bossInfo.segs[0].length - 1) + (bossInfo.segs[1].length - 1) && cseg.length >= 4 &&
  minionRun.n1 - minionRun.n0 === 1 && minionRun.killed && minionRun.n2 === minionRun.n1 && minionRun.n3 === minionRun.n2 + 1,
  { bossInfo, delta: n9b - n9a, expect: (bossInfo.segs[0].length - 1) + (bossInfo.segs[1].length - 1), minionRun });

// ---- 11. HUD: new run -> "--" until 10 intervals, then the live speed; holds after 10 s idle ----
await jumpTo(P, 0);
await installTypist(P);
await holdField(P);
await sleep(300);
const hud0 = await P.g(() => ({ hud: document.getElementById("hudWpm").textContent, run: window.game.typistSpeed("run").n, ring: window.game.typistDebug().ring }));
await runSteps(P, wordSteps(["signal"], 200));
await sleep(350);
const hud1 = await P.g(() => document.getElementById("hudWpm").textContent);
await runSteps(P, wordSteps(["signal"], 200));
await sleep(350);
const hud2 = await P.g(() => ({ hud: document.getElementById("hudWpm").textContent, live: window.game.typistSpeed("live").wpm, n: window.game.typistSpeed("live").n }));
await sleep(10200);
const hud3 = await P.g(() => document.getElementById("hudWpm").textContent);
P.check("11. HUD WPM: new run '--' (ring 0, run n 0), '--' at 5 intervals, then String(round(live)) at 10, unchanged after 10 s idle",
  hud0.hud === "--" && hud0.ring === 0 && hud0.run === 0 && hud1 === "--" && hud2.n === 10 && hud2.hud === String(Math.round(hud2.live)) && hud3 === hud2.hud,
  { hud0, hud1, hud2, hud3 });

// ---- 12 / 13. harness typist 80 WPM / .97 in sector 1 to the card ----
await jumpTo(P, 0);
await typeFor(P, 20, { wpm: 80, accuracy: 0.97 });
const cleared12 = await clearBoss(P, { wpm: 80, accuracy: 0.97 });
await sleep(1500);
const r12 = await P.g(() => {
  const g = window.game; const r = g.lastResults; const ls = g.levelStats;
  const hpPts = (ls.damageTaken | 0) === 0 ? 1 : clamp(1 - (ls.damageTaken | 0) / Math.max(1, g.player.maxHp), 0, 1);
  return { mode: g.mode, wpm: r.wpm, n: r.wpmN, throughput: r.throughput, acc: r.acc, rank: r.rank, level: r.level, hpPts,
    tile: document.querySelector('#resultsLevel [data-stat="wpm"]').textContent, expectRank: rankFor(r.acc, r.wpm, hpPts, r.level) };
});
P.check("12. harness 80 WPM / .97 in sector 1: results.wpm >= 60, throughput < .75 x wpm, WPM tile === String(round(results.wpm))",
  cleared12 && r12.mode === "levelComplete" && r12.wpm >= 60 && r12.throughput < 0.75 * r12.wpm && r12.tile === String(Math.round(r12.wpm)), r12);
P.check("13. the rank's speed term is the hand speed: rank === rankFor(acc, results.wpm, hpPts, L)", r12.rank === r12.expectRank, r12);

// ---- 14. rank window ----
const win = await P.g(() => {
  const rows = [];
  for (let L = 1; L <= 10; L++) { const w = rankSpeedWindow(L); const nominal = LEVELS[L - 1].targetCps * 12; rows.push({ L, floor: w.floor, span: w.span, nominal, s98: rankFor(98, nominal, 1, L) }); }
  return { rows, levelLess: [rankFor(99, 60, 1), rankFor(95, 35, 0.5), rankFor(80, 20, 0)] };
});
const TABLE = [[7.2, 10.4], [10.2, 14.7], [13.8, 19.9], [18.0, 25.9], [20.0, 32.0], [20.0, 37.2], [20.0, 40.0], [20.0, 40.0], [20.0, 40.0], [20.0, 40.0]];
const winOk = win.rows.every((r, i) => Math.abs(r.floor - TABLE[i][0]) <= 0.05 && Math.abs(r.span - TABLE[i][1]) <= 0.05 && r.s98 === "S");
P.check("14. rankSpeedWindow(L) matches the 4.4 table (+-0.05), rankFor(98, nominal, 1, L) === 'S' for L 1-10, level-less S / B / D unchanged",
  winOk && win.levelLess[0] === "S" && win.levelLess[1] === "B" && win.levelLess[2] === "D", win);

// ---- 15. records row: run speed, wpmLegacy false ----
await P.g(() => document.getElementById("btnNextLevel").click());
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 15000);
await typeFor(P, 6, { wpm: 80, accuracy: 0.98 });
const pre15 = await P.g(() => ({ expect: Math.round(window.game.typistScopeWpm("run")), id: window.game.run.id }));
await P.g(() => document.getElementById("btnStop").click());
await sleep(500);
const row15 = await P.g((id) => {
  const s = JSON.parse(localStorage.getItem("typesmup198x.save.v1"));
  return (s.highScores || []).find((h) => h.runId === id) || null;
}, pre15.id);
P.check("15. Save & quit -> the run's highScores row has wpm === round(typistScopeWpm('run')) and wpmLegacy === false",
  !!row15 && row15.wpm === pre15.expect && row15.wpm > 0 && row15.wpmLegacy === false, { pre15, row15 });

// ---- 16. Best WPM ----
await P.goto("fresh");
await P.startRun("BEST");
await waitFor(P, () => !window.game.levelIntro, 6000);
await installTypist(P);
await holdField(P);
const bw0 = await P.g(() => window.game.save.bestWpm);
await runSteps(P, wordSteps(SIGNAL12, 190));
await clearBoss(P, { wpm: 80, accuracy: 0.99 });
await sleep(1500);
const b1 = await P.g(() => {
  const g = window.game; const el = document.querySelector("#resultsLevel .newWpm");
  return { n: g.lastResults.wpmN, wpm: g.lastResults.wpm, newWpm: g.lastResults.newWpm, shown: !el.classList.contains("hidden"), text: el.textContent, best: g.save.profile.bests.speed, bestWpm: g.save.bestWpm };
});
// replay sector 1 slower
await jumpTo(P, 0);
await installTypist(P);
await holdField(P);
await runSteps(P, wordSteps(SIGNAL12, 300));
await clearBoss(P, { wpm: 35, accuracy: 0.99, seconds: 240 });
await sleep(1500);
const b2 = await P.g(() => {
  const g = window.game; const el = document.querySelector("#resultsLevel .newWpm");
  return { mode: g.mode, n: g.lastResults.wpmN, wpm: g.lastResults.wpm, shown: !el.classList.contains("hidden"), best: g.save.profile.bests.speed, bestWpm: g.save.bestWpm };
});
// a Game Over card never shows it
await jumpTo(P, 0);
await installTypist(P);
await holdField(P);
await runSteps(P, wordSteps(SIGNAL12, 150));
await P.g(() => { window.game.player.hp = 1; });
await dieByLeak(P);
await sleep(1200);
const b3 = await P.g(() => {
  const g = window.game; const el = document.querySelector("#resultsOver .newWpm");
  return { mode: g.mode, newWpm: g.lastResults.newWpm, shown: !el.classList.contains("hidden"), best: g.save.profile.bests.speed, bestWpm: g.save.bestWpm };
});
P.check("16. Best WPM: a cleared sector with >= 60 intervals shows 'BEST WPM nn' and bests.speed === nn; a slower replay and a Game Over show no badge; save.bestWpm unchanged",
  b1.n >= 60 && b1.shown && b1.text === `BEST WPM ${Math.round(b1.wpm)}` && b1.best === Math.round(b1.wpm) &&
  b2.mode === "levelComplete" && b2.wpm < b1.wpm && !b2.shown && b2.best === b1.best &&
  b3.mode === "gameOver" && !b3.shown && b3.newWpm === false && b3.best === b1.best &&
  b1.bestWpm === bw0 && b2.bestWpm === bw0 && b3.bestWpm === bw0, { bw0, b1, b2, b3 });

// ---- 17. touch: an insertText burst adds nothing, letter-by-letter at 200 ms counts ----
const ctx2 = await P.browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page2 = await ctx2.newPage();
page2.on("pageerror", (e) => P.errors.pageErrors.push("mobile: " + String(e && e.stack || e)));
page2.on("console", (m) => { if (m.type() === "error") P.errors.consoleErrors.push("mobile: " + m.text()); });
await ctx2.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { flightCheck: "skip" }); }, "typesmup198x.save.v1");
await page2.goto(P.base, { waitUntil: "load" });
await page2.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
const touch = await page2.evaluate(async () => {
  const g = window.game;
  g.startNewRun();
  const T = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100 && (g.mode !== "playing" || g.levelIntro); i++) await T(100);
  if (typeof g.canSkipLevelIntro === "function" && g.levelIntro) g.skipLevelIntro();
  await T(300);
  const hold = () => { g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; g.waveKills = 0; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; };
  hold();
  const ys = g.laneYs();
  const input = document.getElementById("typeInput");
  const send = (data) => input.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data, bubbles: true, cancelable: true }));
  g.enemies.push(new Enemy({ text: "signal", x: g.w - 200, y: ys[2], speed: 0 }));
  const n0 = g.typistDebug().seg.n;
  send("sig");
  await T(300);
  const n1 = g.typistDebug().seg.n;
  const keys1 = g.typistDebug().seg.keys;
  hold();
  g.enemies.push(new Enemy({ text: "signal", x: g.w - 200, y: ys[2], speed: 0 }));
  for (const c of "signal") { send(c); await T(200); }
  const n2 = g.typistDebug().seg.n;
  return { mode: g.mode, n0, n1, keys1, n2, touch: !!g.touchMode };
});
await ctx2.close();
P.check("17. touch (#typeInput beforeinput): insertText 'sig' in one event -> +0 intervals; letter by letter at 200 ms -> +5",
  touch.n1 === touch.n0 && touch.keys1 >= 3 && touch.n2 - touch.n1 === 5, touch);

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
