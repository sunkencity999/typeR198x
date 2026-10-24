// t-arcade-counter (ARCADE D10 Counter-Signal, ~2.5 min, DPR 1 + a DPR 2 budget context): the table and window
// numbers, sector 1 never surging, the first surge of a sector-2 fight at 6.0 s at a segment start with the whole
// segment (slow widen for an unknown speed), the pending start on the keystroke that opens the next segment, the
// telegraph (DOM charge bar, meter class, art glow and slab outline draws), the fail (damage 8 + 2L, the word starts
// over with a scramble, the bolt from the boss's aim point), the counter (+150L bonus exactly, COUNTERED, the bolt
// reflects), the per-phase cap, pause, Retry boss, the sector-scaled par, the card note, a legacy in-boss save and the
// frame budget during a surge. PASS = the feature works; exits 1 on any fail or page / console error.
import { openProbe, sleep, startFresh, jumpTo, waitFor, continueRun } from "./b_lib.mjs";
import { harnessFlags } from "./_lib.mjs";

const P = await openProbe("t-arcade-counter");
await startFresh(P, "COUNTER");

// ---- page-side recorders (counterSignal / bossSegmentReset events, announcements, text draws) ----
async function installRecorders() {
  await P.g(() => {
    if (window.__cs) return;
    const g = window.game;
    const C = window.__cs = { events: [], resets: 0, ann: [], texts: Object.create(null), watch: new Set(["NO SURGE", "SURGE", "SIGNAL SURGE"]), unlockAt: null };
    onGameHook("counterSignal", function (e) {
      const b = this.boss;
      const bolt = this.bolts && this.bolts.length ? this.bolts[this.bolts.length - 1] : null;
      const rec = { result: e.result, level: e.level, phase: e.phase, seg: e.segmentIndex, chars: e.chars, dur: e.dur, t: e.t, slow: e.slow, playClock: this.playClock,
        progress: b ? b.progress : null, segment: b ? b.segment : null, aim: this.bossAimPoint(), bolt: bolt && { x1: bolt.x1, y1: bolt.y1, x2: bolt.x2, y2: bolt.y2, color: bolt.color } };
      if (e.result === "fired" && b && b.segment) { const t = this.counterSignalSlabText(b, "", b.segment); rec.slab = { rem: t.rem, remColor: t.remColor }; rec.scrambleT = b.scrambleT; }
      C.events.push(rec);
    });
    onGameHook("bossSegmentReset", function () { C.resets++; });
    const ann = g.announce;
    g.announce = function (t) { C.ann.push(String(t)); if (C.ann.length > 200) C.ann.shift(); return ann.apply(this, arguments); };
    const eb = g.endBossIntro;
    g.endBossIntro = function () { if (this.bossIntro && this.bossIntro.locked) C.unlockAt = this.playClock; return eb.apply(this, arguments); };
    const ft = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s) { if (C.watch.has(s)) C.texts[s] = (C.texts[s] | 0) + 1; return ft.apply(this, arguments); };
  });
}
await installRecorders();
const lastEvent = (result) => P.g((r) => { const ev = window.__cs.events.filter((e) => !r || e.result === r); return ev.length ? ev[ev.length - 1] : null; }, result);
const nEvents = (result) => P.g((r) => window.__cs.events.filter((e) => e.result === r).length, result);

// Forced boss of sector li + 1 (fresh sector via startLevel), intro unlocked, minions frozen, field cleared.
async function forcedBoss(li) {
  await jumpTo(P, li);
  await P.g(() => { window.__cs.unlockAt = null; window.game.levelT = LEVELS[window.game.levelIndex].duration + 0.01; });
  const ok = await waitFor(P, () => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), 15000);
  await P.g(() => { const g = window.game; g.minionAcc = -1e9; g.enemies.length = 0; g.lock = null; g.player.shield = 0; g.invulnT = 0; });
  return ok;
}
const armNow = () => P.g(() => { const b = window.game.boss; b.surgeTimer = 99; });

// 1. Table / perChar / window / par
const t1 = await P.g(() => ({
  every: LEVELS.map((c) => c.surgeEvery), pc: [2, 6, 10].map((L) => counterSignalPerChar(L)),
  d: [surgeDuration(6, 2), surgeDuration(6, 10), surgeDuration(6, 10, true)], par: SCORE.par(100, 5), par2: SCORE.par(100, 2),
  cs: { fromLevel: COUNTER_SIGNAL.fromLevel, firstAtS: COUNTER_SIGNAL.firstAtS, maxFiredPerPhase: COUNTER_SIGNAL.maxFiredPerPhase, slowWpm: COUNTER_SIGNAL.slowWpm, slowWiden: COUNTER_SIGNAL.slowWiden }
}));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
P.check("1. surgeEvery [null,20,20,14,13,12,11,10,9,8]; perChar(2/6/10) .30/.21/.12; surgeDuration(6,2) 2.4, (6,10) 1.32, (6,10,slow) 1.584; SCORE.par(100,5) = 100/(0.9 x 3.7)",
  JSON.stringify(t1.every) === JSON.stringify([null, 20, 20, 14, 13, 12, 11, 10, 9, 8]) && near(t1.pc[0], 0.30) && near(t1.pc[1], 0.21) && near(t1.pc[2], 0.12)
  && near(t1.d[0], 2.4) && near(t1.d[1], 1.32) && near(t1.d[2], 1.584) && near(t1.par, 100 / 3.33) && near(t1.par2, 100 / (0.9 * 1.7))
  && t1.cs.fromLevel === 2 && t1.cs.firstAtS === 6 && t1.cs.maxFiredPerPhase === 2 && t1.cs.slowWpm === 35 && t1.cs.slowWiden === 1.2, t1);

// 2. Sector 1: 15 s idle, never a surge; the hazard cell draws NO SURGE
await forcedBoss(0);
await P.g(() => { window.__cs.texts = Object.create(null); });
let s1Surged = false;
for (const t0 = Date.now(); Date.now() - t0 < 15000;) { if (await P.g(() => !!(window.game.boss && (window.game.boss.surge || window.game.boss.surgePending)))) { s1Surged = true; break; } await sleep(250); }
const t2 = await P.g(() => ({ texts: { ...window.__cs.texts }, starts: window.__cs.events.filter((e) => e.result === "start").length, armed: window.game.counterSignalArmed(LEVELS[0]) }));
P.check("2. sector 1 forced boss, 15 s idle: no surge, never armed, hazard cell draws NO SURGE (never SURGE / SIGNAL SURGE)", !s1Surged && t2.starts === 0 && !t2.armed && t2.texts["NO SURGE"] > 0 && !t2.texts["SURGE"] && !t2.texts["SIGNAL SURGE"], t2);

// 3. Sector 2: the first surge 6.0 +- 0.3 s (play clock) after the intro unlock, at a segment start, the whole segment, slow
await forcedBoss(1);
await waitFor(P, () => window.__cs.events.some((e) => e.result === "start" && e.level === 2), 10000);
const t3 = await P.g(() => {
  const C = window.__cs, e = C.events.find((x) => x.result === "start" && x.level === 2);
  const s = window.game.boss.surge;
  return { dt: e ? e.playClock - C.unlockAt : null, e, surge: s && { ...s }, expDur: e ? surgeDuration(e.chars, 2, true) : null, segLen: e && e.segment ? e.segment.length : null, liveWpm: window.game.pilotWpm("window") };
});
P.check("3. sector 2: first surge 6.0 +- 0.3 s after the unlock, progress 0, chars === segment length, slow (no speed yet), dur === surgeDuration(chars, 2, true)",
  t3.e && Math.abs(t3.dt - 6.0) <= 0.3 && t3.e.progress === 0 && t3.e.chars === t3.segLen && t3.e.slow === true && t3.surge && near(t3.surge.dur, t3.expDur) && t3.liveWpm === null,
  { dt: t3.dt && Math.round(t3.dt * 1000) / 1000, chars: t3.e && t3.e.chars, segLen: t3.segLen, slow: t3.e && t3.e.slow, dur: t3.surge && t3.surge.dur, expDur: t3.expDur, pilotWindow: t3.liveWpm });

// 4. Pending: armed mid-segment -> waits; the keystroke that opens the next segment starts it with that segment's length
await P.g(() => { const g = window.game; g.cancelSurge(false); g.boss.progress = 1; g.boss.surgeTimer = 99; });
await sleep(120);
const t4a = await P.g(() => { const b = window.game.boss; return { pending: !!b.surgePending, surge: !!b.surge, seg: b.segmentIndex, rest: b.remaining }; });
for (const ch of t4a.rest) { await P.page.keyboard.press(ch); await sleep(40); }
const t4b = await P.g(() => { const b = window.game.boss; return { surge: b.surge && { ...b.surge }, seg: b.segmentIndex, segLen: b.segment ? b.segment.length : 0, progress: b.progress, pending: !!b.surgePending }; });
P.check("4. armed mid-segment -> surgePending without a surge; finishing the word by key presses starts it at once on the next segment (chars = its length)",
  t4a.pending && !t4a.surge && !!t4b.surge && t4b.seg === t4a.seg + 1 && t4b.surge.seg === t4b.seg && t4b.surge.chars === t4b.segLen && t4b.progress === 0 && !t4b.pending, { before: t4a, after: t4b });

// 5. Telegraph (sector 4) 0.6 s into a surge
await forcedBoss(3);
await armNow();
await waitFor(P, () => window.game.boss.surge && window.game.boss.surge.t >= 0.6, 5000);
const t5a = await P.g(() => {
  const g = window.game, s = g.boss.surge;
  const fill = document.getElementById("bossChargeFill").style.transform;
  return { t: s.t, dur: s.dur, fill: Number((/scaleX\(([\d.]+)\)/.exec(fill) || [])[1]), bar: document.getElementById("bossCharge").className, meter: document.getElementById("bossMeter").classList.contains("isCharging"),
    glow: g._csGlowDraws | 0, border: g._csBorderDraws | 0, art: !!(g.getBossSprite(g.boss.artLevel) || {}).img };
});
await P.shot("surge-telegraph");
await sleep(500);
const t5b = await P.g(() => ({ glow: window.game._csGlowDraws | 0, border: window.game._csBorderDraws | 0, alpha: window.game._csGlowAlpha }));
const want5 = (t5a.t + 0.2) / t5a.dur;
P.check("5. telegraph 0.6 s in: #bossCharge.isCharging, fill scaleX within +-.15 of (t+.2)/dur, #bossMeter.isCharging, art glow and slab outline drawn >= 20 times in 0.5 s",
  /isCharging/.test(t5a.bar) && Math.abs(t5a.fill - want5) <= 0.15 && t5a.meter && t5a.art && t5b.glow - t5a.glow >= 20 && t5b.border - t5a.border >= 20 && t5b.alpha >= 0.25,
  { ...t5a, want: Math.round(want5 * 1000) / 1000, glowDraws: t5b.glow - t5a.glow, borderDraws: t5b.border - t5a.border, glowAlpha: t5b.alpha });

// 6. Fail: shield 0, progress 2, the window runs out
const t6pre = await P.g(() => { const g = window.game, b = g.boss; g.player.shield = 0; g.invulnT = 0; b.progress = 2; b.surge.t = b.surge.dur - 0.01; window.__cs.resets = 0; return { hp: g.player.hp, fired: g.levelStats.surgesFired | 0, annN: window.__cs.ann.length }; });
await sleep(300);
const t6 = await P.g((n) => { const g = window.game, b = g.boss; return { hp: g.player.hp, progress: b.progress, scrambleT: b.scrambleT, fired: g.levelStats.surgesFired | 0, resets: window.__cs.resets, ann: window.__cs.ann.slice(n), cue: g.sfx.lastCue, csFired: g.stats.csFired | 0 }; }, t6pre.annN);
const e6 = await lastEvent("fired");
const boltOk6 = !!(e6 && e6.bolt && e6.bolt.color === "danger" && Math.hypot(e6.bolt.x1 - e6.aim.x, e6.bolt.y1 - e6.aim.y) <= 2);
P.check("6. fail at L4: hp -16, the word starts over (progress 0) with a scramble, the bolt leaves the boss's aim point (danger), surgesFired 1, bossSegmentReset, announce, cue",
  t6pre.hp - t6.hp === 16 && t6.progress === 0 && e6 && e6.scrambleT > 0 && boltOk6 && t6.fired === t6pre.fired + 1 && t6.resets === 1 && t6.ann.includes("Surge hit. The word starts over.") && (t6.cue === "damage" || t6.cue === "surgeFire"),
  { hp: [t6pre.hp, t6.hp], progress: t6.progress, scrambleT: e6 && e6.scrambleT, bolt: e6 && e6.bolt, aim: e6 && e6.aim, fired: t6.fired, resets: t6.resets, ann: t6.ann, cue: t6.cue });

// 7. Scramble: glyph 0 at once, red; resolved after .35 s (reduced motion: static red word, below)
await sleep(360);
const t7 = await P.g(() => { const b = window.game.boss; const t = window.game.counterSignalSlabText(b, "", b.segment); return { rem: t.rem, remColor: t.remColor, seg: b.segment }; });
P.check("7. scramble right after the fail: rem[0] === seg[0], same length, danger; after .35 s the real word, no colour override",
  e6 && e6.slab && e6.slab.rem[0] === e6.segment[0] && e6.slab.rem.length === e6.segment.length && e6.slab.remColor === "danger" && t7.rem === t7.seg && t7.remColor === null,
  { atFail: e6 && e6.slab, word: e6 && e6.segment, after: t7 });

// 8. Counter: the whole word at 30 ms -> +600 exactly (bonus), COUNTERED, the bolt reflects into the boss, cyan bar flash
await P.g(() => {
  const g = window.game;
  g.setOverdriveEnabled(false);
  window.__scoreLog = [];
  if (!g.__scoreWrapped) { const o = g.addScore; g.addScore = function (a, opts) { const r = o.apply(this, arguments); window.__scoreLog && window.__scoreLog.push({ amount: a, kind: opts && opts.kind, gained: r }); return r; }; g.__scoreWrapped = true; }
  g.boss.surgeTimer = 99;
});
await waitFor(P, () => !!window.game.boss.surge, 3000);
const t8pre = await P.g(() => { const g = window.game; window.__scoreLog = []; return { cancelled: g.levelStats.surgesCancelled | 0, word: g.boss.remaining, seg: g.boss.segmentIndex }; });
for (const ch of t8pre.word) { await P.page.keyboard.press(ch); await sleep(30); }
const t8 = await P.g(() => {
  const g = window.game;
  const titles = [g.callout && g.callout.title, ...(g.calloutQueue || []).map((c) => c.title)];
  return { cancelled: g.levelStats.surgesCancelled | 0, bonus: window.__scoreLog.filter((s) => s.kind === "bonus"), titles, bar: document.getElementById("bossCharge").className, surge: !!g.boss.surge, csCountered: g.stats.csCountered | 0 };
});
const e8 = await lastEvent("countered");
const boltOk8 = !!(e8 && e8.bolt && e8.bolt.color === "cyan" && Math.hypot(e8.bolt.x2 - e8.aim.x, e8.bolt.y2 - e8.aim.y) <= 2);
P.check("8. counter at L4: surgesCancelled +1, exactly one bonus of +600 (150 x 4), COUNTERED callout, the reflected cyan bolt ends at the aim point, #bossCharge.isCountered",
  t8.cancelled === t8pre.cancelled + 1 && t8.bonus.length === 1 && t8.bonus[0].gained === 600 && t8.titles.includes("COUNTERED") && boltOk8 && /isCountered/.test(t8.bar) && !t8.surge,
  { cancelled: [t8pre.cancelled, t8.cancelled], bonus: t8.bonus, titles: t8.titles, bolt: e8 && e8.bolt, aim: e8 && e8.aim, bar: t8.bar });
await P.g(() => window.game.setOverdriveEnabled(true));

// 9. Cap (L5): two fires in phase 1 -> no third surge in the phase; the phase clear resets it, the next one comes on cadence
await forcedBoss(4);
for (let i = 0; i < 2; i++) {
  await armNow();
  await waitFor(P, () => !!window.game.boss.surge, 3000);
  await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.boss.surge.t = g.boss.surge.dur - 0.01; });
  await waitFor(P, () => !window.game.boss.surge, 2000);
  await sleep(150);
}
await P.g(() => { window.__cs.texts = Object.create(null); window.game.boss.surgeTimer = 99; });
await sleep(2500);
const t9a = await P.g(() => { const g = window.game, b = g.boss; return { firedInPhase: b.firedInPhase, phase: b.phase, surge: !!b.surge, pending: !!b.surgePending, armed: g.counterSignalArmed(LEVELS[4]), noSurgeText: window.__cs.texts["NO SURGE"] | 0, timer: b.surgeTimer }; });
await P.g(() => { const g = window.game, b = g.boss; b.segmentIndex = b.phaseStarts[1] - 1; b.progress = 0; for (const ch of b.segment) g.handleTyped(ch); });
const t9b = await P.g(() => { const b = window.game.boss; return { phase: b.phase, firedInPhase: b.firedInPhase, timer: b.surgeTimer, pending: !!b.surgePending }; });
const t9t0 = Date.now();
const surgedAgain = await waitFor(P, () => !!window.game.boss.surge, 14500);
const t9wait = (Date.now() - t9t0) / 1000;
P.check("9. cap at L5: firedInPhase 2 -> not armed, no surge for 2.5 s with the timer forced, hazard cell NO SURGE; the phase clear resets firedInPhase / timer and a surge starts within 13 + 1 s",
  t9a.firedInPhase === 2 && t9a.phase === 0 && !t9a.surge && !t9a.pending && !t9a.armed && t9a.noSurgeText > 0 && t9b.phase === 1 && t9b.firedInPhase === 0 && !t9b.pending && surgedAgain && t9wait <= 14.2,
  { capped: t9a, afterPhase: t9b, nextSurgeAfterS: Math.round(t9wait * 10) / 10 });

// 10. Pause 1.5 s mid-surge: the window holds, the riser is cut, resume restarts it for what is left
await P.g(() => { const g = window.game; g.player.shield = 0; g.boss.surge.dur = 30; });   // keep it charging across the pause
await sleep(200);
await P.page.keyboard.press("Escape");
await waitFor(P, () => window.game.mode === "paused", 2000);
const t10a = await P.g(() => ({ t: window.game.boss.surge.t, riser: window.game.sfx._surge }));
await sleep(1500);
const t10b = await P.g(() => ({ t: window.game.boss.surge.t, mode: window.game.mode }));
await P.page.keyboard.press("Escape");
await waitFor(P, () => window.game.mode === "playing", 2000);
await sleep(50);
const t10c = await P.g(() => ({ cue: window.game.sfx.lastCue, mode: window.game.mode, surge: !!window.game.boss.surge }));
P.check("10. pause 1.5 s mid-surge: surge.t unchanged (+-.02), riser cut (sfx._surge null); after resume sfx.lastCue === surgeCharge",
  t10b.mode === "paused" && Math.abs(t10b.t - t10a.t) <= 0.02 && t10a.riser == null && t10c.cue === "surgeCharge" && t10c.surge, { t10a, t10b, t10c });

// 11. Retry boss: one fire in phase 2, then die -> Retry boss restores surgesFired to the boss checkpoint, fresh fight state
await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.boss.surge.t = g.boss.surge.dur - 0.01; });
await waitFor(P, () => !window.game.boss.surge, 2000);
await sleep(200);
const t11a = await P.g(() => { const g = window.game; return { fired: g.levelStats.surgesFired | 0, cp: g.run.bossCheckpoint && g.run.bossCheckpoint.lvSurgesFired, phase: g.boss.phase }; });
await P.g(() => { const g = window.game; g.player.hp = 1; g.player.shield = 0; g.invulnT = 0; g.boss.surgeTimer = 99; });
await waitFor(P, () => !!window.game.boss && !!window.game.boss.surge, 3000);
await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.boss.surge.t = g.boss.surge.dur - 0.01; });
const died = await waitFor(P, () => window.game.mode === "gameOver", 6000);
await sleep(700);
await P.g(() => document.getElementById("btnRetryBoss").click());
await waitFor(P, () => window.game.mode === "playing" && window.game.inBoss && !!window.game.boss, 8000);
const t11 = await P.g(() => { const g = window.game, b = g.boss; return { fired: g.levelStats.surgesFired | 0, cp: g.run.bossCheckpoint && g.run.bossCheckpoint.lvSurgesFired, firedInPhase: b.firedInPhase, surgeCount: b.surgeCount, surge: b.surge, pending: b.surgePending, phase: b.phase }; });
P.check("11. one fire in phase 2 then death; Retry boss: levelStats.surgesFired === the boss checkpoint's lvSurgesFired (2), firedInPhase 0, surgeCount 0, no surge",
  died && t11a.fired === 3 && t11a.cp === 2 && t11.fired === t11.cp && t11.cp === 2 && t11.firedInPhase === 0 && t11.surgeCount === 0 && !t11.surge && !t11.pending, { before: t11a, died, after: t11 });

// 12. Par: forced L5 kill -> the time bonus from SCORE.par(totalChars, 5)
await waitFor(P, () => !(window.game.bossIntro && window.game.bossIntro.locked), 6000);
const t12 = await P.g(() => {
  const g = window.game, b = g.boss;
  g.enemies.length = 0; g.minionAcc = -1e9;
  b.segmentIndex = b.segments.length - 1; b.progress = 0;
  for (const ch of b.segment) g.handleTyped(ch);
  const info = g.bossClear;
  return info && { time: info.tally.time, par: info.tally.par, elapsed: info.elapsed, totalChars: info.totalChars, want: Math.max(0, SCORE.par(info.totalChars, 5) - info.elapsed) * 25 * 5, wantPar: info.totalChars / (0.9 * LEVELS[4].targetCps) };
});
P.check("12. par at L5: tally.time === max(0, SCORE.par(totalChars, 5) - elapsed) x 25 x 5 and par === totalChars / (0.9 x 3.7)", !!t12 && near(t12.time, t12.want, 1e-6) && near(t12.par, t12.wantPar, 1e-9), t12);
await waitFor(P, () => window.game.mode === "levelComplete", 8000);

// 13. Card: forced L3 clear with 1 countered + 1 fired -> note COUNTER-SIGNALS 1/2 (data and DOM), banked label
await forcedBoss(2);
await armNow();
await waitFor(P, () => !!window.game.boss.surge, 3000);
await P.g(() => { const g = window.game; g.player.shield = 0; g.invulnT = 0; g.boss.surge.t = g.boss.surge.dur - 0.01; });
await waitFor(P, () => !window.game.boss.surge, 2000);
await sleep(400);
await armNow();
await waitFor(P, () => !!window.game.boss.surge, 3000);
await P.g(() => { const g = window.game; for (const ch of g.boss.remaining) g.handleTyped(ch); });
await P.g(() => { const g = window.game, b = g.boss; b.segmentIndex = b.segments.length - 1; b.progress = 0; for (const ch of b.segment) g.handleTyped(ch); });
await waitFor(P, () => window.game.bossClear && window.game.bossClear.t >= 2.1, 5000);
await P.page.keyboard.press("Enter");
await waitFor(P, () => window.game.mode === "levelComplete", 4000);
await sleep(400);
const t13 = await P.g(() => {
  const r = window.game.lastResults;
  const li = document.querySelector('#resultsLevel .resultsNote[data-note="counterSignals"]');
  const banked = [...document.querySelectorAll("#resultsLevel .bonusRow--banked .bonusLabel")].map((x) => x.textContent);
  return { notes: r.notes, cs: r.counterSignals, dom: li && li.textContent, banked, ann: window.__cs.ann.slice(-3) };
});
const note13 = (t13.notes || []).find((n) => n.id === "counterSignals");
P.check("13. L3 clear with 1 countered + 1 fired: results.notes COUNTER-SIGNALS 1/2 (+aria), counterSignals {1, 1}, DOM .resultsNote[data-note=counterSignals], banked 'Counter-signal bonus', announced",
  !!note13 && note13.text === "COUNTER-SIGNALS 1/2" && note13.aria === "Counter-signals: 1 of 2 countered." && t13.cs && t13.cs.countered === 1 && t13.cs.fired === 1 && t13.dom === "COUNTER-SIGNALS 1/2" && t13.banked.includes("Counter-signal bonus") && t13.ann.some((a) => a.includes("Counter-signals: 1 of 2 countered.")),
  t13);

// 13c. Scope: a sector card reads the sector, the Game Over card ("over", a RUN REPORT whose tiles are run totals) and the
//      run card read the run, for both ARCADE notes (review fix: "over" used to read the sector's numbers).
const t13c = await P.g(() => {
  const g = window.game, st = g.stats, ls = g.levelStats, keep = [st.csCountered, st.csFired, st.overdriveMs, ls.surgesCancelled, ls.surgesFired, ls.overdriveMs];
  st.csCountered = 5; st.csFired = 2; st.overdriveMs = 21400; ls.surgesCancelled = 1; ls.surgesFired = 1; ls.overdriveMs = 3000;
  const txt = (s) => g.buildResults(s).notes.map((n) => n.text).join(" | ");
  const out = { level: txt("level"), over: txt("over"), run: txt("run") };
  [st.csCountered, st.csFired, st.overdriveMs, ls.surgesCancelled, ls.surgesFired, ls.overdriveMs] = keep;
  return out;
});
P.check("13c. notes scope: sector card COUNTER-SIGNALS 1/2 | OVERDRIVE 3 S (levelStats); Game Over and run cards COUNTER-SIGNALS 5/7 | OVERDRIVE 21 S (run stats, like their tiles)",
  t13c.level === "COUNTER-SIGNALS 1/2 | OVERDRIVE 3 S" && t13c.over === "COUNTER-SIGNALS 5/7 | OVERDRIVE 21 S" && t13c.run === t13c.over, t13c);

// 7b. Reduced-motion context: the scramble is the static red word
{
  const ctx = await P.browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await harnessFlags(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => P.errors.pageErrors.push("rm: " + String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") P.errors.consoleErrors.push("rm: " + m.text()); });
  await page.goto(P.base, { waitUntil: "load" });
  await page.waitForFunction(() => window.game && window.game.ready !== false && typeof window.game.counterSignalSlabText === "function", null, { timeout: 60000 });
  const r = await page.evaluate(() => { const g = window.game; const b = { scrambleT: 0.25, scrambleSeed: 12345, _scrStep: -1, _scrSrc: null, _scrText: "" }; const t = g.counterSignalSlabText(b, "", "plasma"); return { rm: g.reduceMotion, rem: t.rem, remColor: t.remColor }; });
  P.check("7b. reduced motion: the scramble is the static red word (rem === seg, remColor danger)", r.rm === true && r.rem === "plasma" && r.remColor === "danger", r);
  await ctx.close();
}

// 15. Budget during a surge at DPR 2 (canvas counters): composite sets <= 6, shadowBlur 0, maxRenderMs <= 16
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await harnessFlags(ctx);
  await ctx.addInitScript(() => {
    const E = window.__bud = { comp: 0, blur: 0, compMax: 0, blurMax: 0, renderMax: 0, frames: 0, on: false };
    const proto = CanvasRenderingContext2D.prototype;
    const wrap = (prop, fn) => { const d = Object.getOwnPropertyDescriptor(proto, prop); Object.defineProperty(proto, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { fn(v); d.set.call(this, v); } }); };
    wrap("globalCompositeOperation", () => { E.comp++; });
    wrap("shadowBlur", (v) => { if (v > 0) E.blur++; });
    const tick = () => {
      const g = window.game;
      if (g && !g.__budWrapped && typeof g.render === "function") { const o = g.render; g.render = function () { const t0 = performance.now(); try { return o.apply(this, arguments); } finally { if (E.on) E.renderMax = Math.max(E.renderMax, performance.now() - t0); } }; g.__budWrapped = true; }
      if (E.on) { E.frames++; E.compMax = Math.max(E.compMax, E.comp); E.blurMax = Math.max(E.blurMax, E.blur); }
      E.comp = 0; E.blur = 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => P.errors.pageErrors.push("dpr2: " + String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") P.errors.consoleErrors.push("dpr2: " + m.text()); });
  const Q = { page, g: (fn, a) => page.evaluate(fn, a) };
  await page.goto(P.base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
  await page.fill("#playerName", "BUDGET").catch(() => {});
  await page.click("#btnStart");
  try { const s = page.locator("#btnStoryLaunch"); await s.waitFor({ state: "visible", timeout: 2500 }); await s.click(); } catch {}
  await page.waitForFunction(() => window.game && window.game.mode === "playing" && !window.game.levelIntro, null, { timeout: 30000 });
  await Q.g(() => { const g = window.game; g.stopToMenu(true); g.startNewRun(); g.startLevel(3, { fromMenu: true, fresh: true }); });
  await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 });
  await Q.g(() => { window.game.levelT = LEVELS[3].duration + 0.01; });
  await page.waitForFunction(() => window.game.inBoss && window.game.boss && !(window.game.bossIntro && window.game.bossIntro.locked), null, { timeout: 15000 });
  await Q.g(() => { const g = window.game; g.player.shield = 0; g.boss.surgeTimer = 99; });
  await page.waitForFunction(() => !!window.game.boss.surge, null, { timeout: 3000 });
  await Q.g(() => { const g = window.game; g.boss.surge.dur = 8; window.__bud.on = true; });
  await sleep(2000);
  const b = await Q.g(() => { const E = window.__bud; E.on = false; return { frames: E.frames, compMax: E.compMax, blurMax: E.blurMax, renderMax: Math.round(E.renderMax * 100) / 100, glow: window.game._csGlowDraws | 0, surge: !!window.game.boss.surge }; });
  P.check("15. DPR 2, sector 4 boss with a surge charging (2 s): compositeSetsPerFrame <= 6, shadowBlur 0, maxRenderMs <= 16 (glow drawn)", b.frames > 30 && b.compMax <= 6 && b.blurMax === 0 && b.renderMax <= 16 && b.glow > 30 && b.surge, b);
  await ctx.close();
}

// 14. Fixture legacy-inboss -> Continue -> the boss fight with fresh Counter-Signal state
await P.goto("legacy-inboss");
await continueRun(P);
await waitFor(P, () => window.game.inBoss && !!window.game.boss, 10000);
const t14 = await P.g(() => { const g = window.game, b = g.boss; return { level: LEVELS[g.levelIndex].level, surgeCount: b.surgeCount, firedInPhase: b.firedInPhase, surgesFired: g.levelStats.surgesFired | 0, surge: b.surge, typeofFired: typeof g.levelStats.surgesFired }; });
P.check("14. legacy-inboss save -> Continue: sector 2 boss fight, surgeCount 0, firedInPhase 0, levelStats.surgesFired | 0 === 0", t14.level === 2 && t14.surgeCount === 0 && t14.firedInPhase === 0 && t14.surgesFired === 0 && !t14.surge, t14);

// 5b. Layout (review fix): the charge bar sits 0-2 px under the hull meter, full meter width, at 1440 x 900, phone
//     portrait 390 x 844 and phone landscape 844 x 390, and the HUD is no taller for it (it used to add a grid row:
//     +6 px desktop, +10 px phone landscape).
const t5c = [];
for (const [w, h] of [[1440, 900], [390, 844], [844, 390]]) {
  await P.page.setViewportSize({ width: w, height: h });
  await sleep(400);
  t5c.push(await P.g(([w, h]) => {
    const m = document.getElementById("bossMeter").getBoundingClientRect(), c = document.getElementById("bossCharge").getBoundingClientRect();
    const el = document.getElementById("bossCharge"), hud = document.getElementById("hud"), h1 = hud.getBoundingClientRect().height;
    el.style.display = "none";
    const h0 = hud.getBoundingClientRect().height;
    el.style.display = "";
    return { vp: `${w}x${h}`, gap: Math.round((c.top - m.bottom) * 10) / 10, dx: Math.round(Math.abs(c.left - m.left) + Math.abs(c.width - m.width)), h: Math.round(c.height * 10) / 10, hudGrowth: Math.round((h1 - h0) * 10) / 10 };
  }, [w, h]));
}
await P.page.setViewportSize({ width: 1440, height: 900 });
P.check("5b. #bossCharge 0-2 px under #bossMeter at the same left / width in every layout; the HUD is no taller for it", t5c.every((r) => r.gap >= 0 && r.gap <= 2 && r.dx <= 2 && r.h >= 2 && Math.abs(r.hudGrowth) <= 0.5), t5c);

P.check("zero pageErrors / consoleErrors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, { pageErrors: P.errors.pageErrors.slice(0, 3), consoleErrors: P.errors.consoleErrors.slice(0, 3) });
await P.finish();
