// ONBOARD (D13) probe: the first-run Flight Check happy path on a fresh save (the game's real eligibility rule).
// Usage (from the repo root or tools/playtest): node tools/playtest/probes/t-onboard-flight.mjs [--dpr 1|2]
// PASS = the feature works. Exit 1 on any failed check or page error (openProbe.finish) and on console errors (last check).
import { openProbe, sleep, harnessFlags, LS_KEY } from "./_lib.mjs";

const argv = process.argv.slice(2);
const dpr = Number(argv[argv.indexOf("--dpr") + 1]) || 1;
const P = await openProbe(`t-onboard-flight-dpr${dpr}`, { dpr, flightCheck: "auto" });
const { page } = P;

// Per-frame sampler (registered before the game's loop) + toast / live-region logs. Samples only while a check runs.
const SAMPLER = () => {
  const S = window.__fc = { frames: 0, maxPowerups: 0, plus: [], hpLoss: 0, mult: [], minXFrac: 9, sectorBanner: false,
    toasts: [], says: [], startAt: null, endAt: null, writes: [] };
  // Every localStorage write with the check state at that moment and the function that called storeSave. The start
  // task's storySeen write (startGameplayFlow) lands while the check exists but before its first frame (active 0);
  // fcFinish clears the check before its own storeSave, and the hand-off's run save follows inside beginRunAt.
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (this === window.localStorage) {
      const fc = window.game && window.game.flightCheck;
      const lines = (new Error().stack || "").split("\n");
      const at = lines.findIndex((l) => /\bstoreSave\b/.test(l));
      const by = at >= 0 && lines[at + 1] ? (lines[at + 1].match(/at (?:Game\.)?([\w$.]+)/) || [])[1] || "?" : "?";
      S.writes.push({ key: k, check: !!fc, active: fc ? fc.active : null, phase: fc ? fc.phase + fc.step : null, by });
    }
    return setItem.call(this, k, v);
  };
  const tick = () => {
    const g = window.game;
    if (g && g.flightCheck) {
      if (S.startAt === null) S.startAt = performance.now();
      S.frames++;
      if (g.powerups.length > S.maxPowerups) S.maxPowerups = g.powerups.length;
      for (const f of g.floaters || []) if (/^\+/.test(f.text) && !S.plus.includes(f.text)) S.plus.push(f.text);
      if (g.player.hp !== g.player.maxHp) S.hpLoss++;
      const c = g.callout;
      if (c && /MULTIPLIER/.test(c.title || "") && !S.mult.includes(c.title)) S.mult.push(c.title);
      if (g.banner && g.banner.kind === "sector") S.sectorBanner = true;
      for (const e of g.enemies) if (e.alive && typeof e.fcHold === "number") S.minXFrac = Math.min(S.minXFrac, e.x / g.w);
    } else if (S.startAt !== null && S.endAt === null) S.endAt = performance.now();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const seen = new WeakMap();
  const logToasts = () => {
    for (const t of document.querySelectorAll("#toastStack .toast")) {
      const text = t.textContent;
      if (seen.get(t) === text) continue;
      seen.set(t, text);
      S.toasts.push({ t: performance.now(), text, kind: t.className, check: !!(window.game && window.game.flightCheck) });
    }
  };
  const slotSeen = new WeakMap();
  const logSays = () => {
    for (const s of document.querySelectorAll("#srAnnounce .srAnnounceSlot")) {
      const text = s.textContent;
      if (!text || slotSeen.get(s) === text) continue;
      slotSeen.set(s, text);
      S.says.push({ t: performance.now(), text });
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    const stack = document.getElementById("toastStack");
    if (stack) new MutationObserver(logToasts).observe(stack, { childList: true, subtree: true, characterData: true });
    const sr = document.getElementById("srAnnounce");
    if (sr) new MutationObserver(logSays).observe(sr, { childList: true, subtree: true, characterData: true });
  });
};
await P.installCanvasCounters();
await P.context.addInitScript(SAMPLER);
await P.goto(null);

const fcState = () => P.g(() => window.game.flightCheckState());
const waitFor = (fn, ms, arg) => page.waitForFunction(fn, arg, { timeout: ms }).then((h) => h.jsonValue()).catch(() => null);
const press = (k) => page.keyboard.press(k === " " ? "Space" : k);

// ---- 1. Start -> briefing -> Launch -> the check (no sector card) ----
await page.fill("#playerName", "ROOKIE").catch(() => {});
await page.click("#btnStart");
const storyOpen = await waitFor(() => { const m = document.getElementById("storyModal"); return m && !m.classList.contains("is-dismissed") ? true : null; }, 4000);
await sleep(300);
await page.click("#btnStoryLaunch");
await waitFor(() => window.game && window.game.mode === "playing" ? true : null, 10000);
await sleep(100);
const s1 = await P.g((key) => {
  const g = window.game;
  const panel = document.getElementById("flightCheck");
  const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility : null; };
  const blob = JSON.parse(localStorage.getItem(key) || "null");
  return {
    mode: g.mode, active: g.isFlightCheckActive(), body: document.body.dataset.flightCheck || null,
    panelShown: !!panel && !panel.classList.contains("hidden") && getComputedStyle(panel).display !== "none",
    stepText: panel ? panel.querySelector(".fcStep").textContent : null, levelIntro: g.levelIntro, sectorBanner: !!(g.banner && g.banner.kind === "sector"),
    wavePhase: g.wavePhase, saveRun: blob ? blob.run : "no blob", run: g.run, scoreVis: cs("#hudScore"), hullVis: cs("#hudHP"),
    pilotVis: cs("#hudName"), says: window.__fc.says.map((s) => s.text)
  };
}, LS_KEY);
const srStart = "Flight check: three quick drills before Sector 1. Nothing can hit you. Press Escape to skip.";
P.check("1 Start -> briefing; Launch -> check active in mode playing, panel FLIGHT CHECK 1/3, no sector card, wavePhase check, saved run null, HUD cells hidden, srStart spoken",
  !!storyOpen && s1.mode === "playing" && s1.active && s1.body === "on" && s1.panelShown && s1.stepText === "FLIGHT CHECK 1/3" && s1.levelIntro === null &&
  !s1.sectorBanner && s1.wavePhase === "check" && s1.saveRun === null && s1.run === null && s1.scoreVis === "hidden" && s1.hullVis === "hidden" &&
  s1.pilotVis === "visible" && s1.says.includes(srStart), JSON.stringify(s1));
await P.shot("check-start");

// ---- 2. Plate j on the middle lane, glides to 0.62 w; TYPE J toast ----
const t2 = Date.now();
const st2 = await waitFor(() => { const s = window.game.flightCheckState(); return s && s.step === 1 && s.plates.length === 1 ? s : null; }, 3000);
const spawnMs = Date.now() - t2;
await P.g(() => window.__e2Probe && window.__e2Probe.mark());
const fps = await P.fps(1500);   // >= 1.2 s after the spawn
const perf = await P.g(() => window.__e2Probe ? window.__e2Probe.snapshot() : null);
const s2 = await P.g(() => {
  const g = window.game; const s = g.flightCheckState(); const ys = g.laneYs(); const mid = Math.floor((ys.length - 1) / 2);
  const t = document.querySelector('#toastStack .toast[data-key="fc"]');
  return { plate: s.plates[0], laneY: ys[mid], w: g.w, toast: t ? t.textContent : null, kind: t ? t.className : null };
});
P.check("2 one plate 'j' within 3 s on the middle lane, |x - 0.62 w| <= 1 after 1.2 s, x > 0.35 w on every frame, toast TYPE J (tip)",
  !!st2 && s2.plate.text === "j" && s2.plate.y === s2.laneY && Math.abs(s2.plate.x - 0.62 * s2.w) <= 1 &&
  (await P.g(() => window.__fc.minXFrac)) > 0.35 && s2.toast === "TYPE J" && /toast--tip/.test(s2.kind || ""),
  JSON.stringify({ spawnMs, ...s2, minXFrac: await P.g(() => window.__fc.minXFrac) }));
await P.shot("step1");
// Direct calls while the check runs: a kill drop of a real type is cancelled by the hook (not by the alive cap or an empty
// roll), and score is cancelled. Reported in check 8, which samples the random drop path frame by frame.
const cancels = await P.g(() => {
  const g = window.game;
  const type = Object.keys(POWERUP_TYPES)[0];
  const before = g.countAlivePowerups();
  const pw = g.spawnPowerup({ type, x: 900, y: 320, fromKill: true });
  const evt = g._evtPowerup || null;
  const score0 = g.stats.score;
  const added = g.addScore(100, {});
  return { type, aliveBefore: before, powerup: pw === null ? null : typeof pw, hookCancel: !!(evt && evt.cancel && evt.type === type),
    powerups: g.powerups.length, added, scoreDelta: g.stats.score - score0 };
});
const blobStep1 = await P.g((k) => localStorage.getItem(k), LS_KEY);

// ---- 3. A miss does nothing to the hull; j kills it; step 2 within 1 s; no save write ----
await press("k");
await sleep(120);
const s3a = await P.g(() => { const g = window.game; const s = g.flightCheckState(); return { hp: g.player.hp, maxHp: g.player.maxHp, alive: s.plates[0].alive, misses: g.stats.misses }; });
await press("j");
const t3 = Date.now();
const step2 = await waitFor(() => { const s = window.game.flightCheckState(); return s && s.step === 2 && s.plates.length ? true : null; }, 1000);
const step2Ms = Date.now() - t3;
const blobStep2 = await P.g((k) => localStorage.getItem(k), LS_KEY);
P.check("3 'k' leaves hp and the plate alone; 'j' kills it and step 2 starts within 1 s; save blob byte-identical since step 1",
  s3a.hp === s3a.maxHp && s3a.alive && s3a.misses === 1 && !!step2 && step2Ms <= 1000 && blobStep1 === blobStep2,
  JSON.stringify({ ...s3a, step2Ms, blobSame: blobStep1 === blobStep2 }));

// ---- 4. spark: FINISH only on the lock ----
await waitFor(() => { const s = window.game.flightCheckState(); return s && s.step === 2 && s.plates[0] && s.plates[0].targetable ? true : null; }, 2000);
await sleep(100);
const finishBefore = await P.g(() => window.__fc.toasts.some((x) => /FINISH/.test(x.text)));
await press("s");
const t4 = Date.now();
const finishToast = await waitFor(() => { const t = document.querySelector('#toastStack .toast[data-key="fc"]'); return t && t.textContent === "KEEP TYPING TO FINISH IT" ? true : null; }, 1000);
const finishMs = Date.now() - t4;
const plate2 = (await fcState()).plates[0];
for (const k of "park") { await press(k); await sleep(60); }
const step3 = await waitFor(() => { const s = window.game.flightCheckState(); return s && s.step === 3 ? true : null; }, 1500);
P.check("4 plate 'spark'; no FINISH toast before the lock; 's' -> KEEP TYPING TO FINISH IT within 200 ms; 'park' -> step 3",
  plate2.text === "spark" && !finishBefore && !!finishToast && finishMs <= 200 && !!step3, JSON.stringify({ text: plate2.text, finishBefore, finishMs, step3: !!step3 }));

// ---- 5. comet far, laser near after the lock, Space releases, laser completes the check ----
await waitFor(() => { const s = window.game.flightCheckState(); return s && s.step === 3 && s.plates[0] && s.plates[0].targetable ? true : null; }, 2000);
await sleep(1300);   // glide
const s5a = await P.g(() => { const g = window.game; const s = g.flightCheckState(); return { far: s.plates[0], w: g.w }; });
await press("c");
const t5 = Date.now();
const nearUp = await waitFor(() => { const s = window.game.flightCheckState(); return s && s.plates.length === 2 ? s : null; }, 1000);
const nearMs = Date.now() - t5;
await sleep(60);
const s5b = await P.g(() => { const g = window.game; const s = g.flightCheckState(); const t = document.querySelector('#toastStack .toast[data-key="fc"]'); return { near: s.plates[1], w: g.w, toast: t ? t.textContent : null, wantRelease: s.wantRelease }; });
await P.shot("release");
await press(" ");
await sleep(80);
const s5c = await P.g(() => { const g = window.game; const s = g.flightCheckState(); return { lock: g.lock ? g.lock.ref.text : null, farProgress: s.plates[0].progress, wantRelease: s.wantRelease, toast: s.toast }; });
await press("l");
await sleep(60);
const s5l = await P.g(() => { const g = window.game; const s = g.flightCheckState(); return { lock: g.lock ? g.lock.ref.text : null, toast: s.toast }; });
for (const k of "ase") { await press(k); await sleep(60); }
await press("r");
const t5d = Date.now();
const doneCallout = await waitFor(() => { const g = window.game; return g.callout && g.callout.title === "FLIGHT CHECK COMPLETE" ? true : null; }, 1000);
const doneMs = Date.now() - t5d;
const s5d = await P.g(() => { const g = window.game; const s = g.flightCheckState(); return s ? { phase: s.phase, far: s.plates[0], near: s.plates[1] } : null; });
await P.shot("complete");
P.check("5 comet at 0.80 w; 'c' -> laser at 0.50 w within 200 ms + the release toast; Space -> no lock, comet progress 0, toast TYPE L; 'l' -> laser locked, no toast; 'aser' -> FLIGHT CHECK COMPLETE within 300 ms, comet detonated",
  s5a.far.text === "comet" && Math.abs(s5a.far.x - 0.8 * s5a.w) <= 1 && !!nearUp && nearMs <= 200 && s5b.near.text === "laser" &&
  Math.abs(s5b.near.x - 0.5 * s5b.w) <= 1 && s5b.toast === "PRESS SPACE TO LET GO, THEN TAKE THE NEARER ONE" && s5b.wantRelease &&
  s5c.lock === null && s5c.farProgress === 0 && s5c.toast === "TYPE L" && s5l.lock === "laser" && s5l.toast === null &&
  !!doneCallout && doneMs <= 300 && !!s5d && s5d.phase === "done" && s5d.far.alive === false,
  JSON.stringify({ farX: s5a.far.x, nearMs, nearX: s5b.near.x, toast: s5b.toast, after: s5c, onLaser: s5l, doneMs, s5d }));

// ---- 6. Sector card within 1.4 + 2.5 s of the last kill, then wave play ----
const card = await waitFor(() => {
  const g = window.game;
  if (g.flightCheck || !g.levelIntro || !(g.banner && g.banner.kind === "sector")) return null;
  return { score: g.stats.score, correct: g.stats.correct, levelIndex: g.run && g.run.levelIndex, runNull: g.run === null };
}, 3900);
const cardMs = Date.now() - t5d;
const spawnPhase = await waitFor(() => window.game.wavePhase === "spawn" ? true : null, 6000);
P.check("6 sector card (levelIntro + sector banner) within 3.9 s of the last kill, then wavePhase spawn", !!card && cardMs <= 3900 && !!spawnPhase,
  JSON.stringify({ cardMs, spawn: !!spawnPhase }));

// ---- 7. Save flags and the result ----
const s7 = await P.g((k) => {
  const g = window.game; const b = JSON.parse(localStorage.getItem(k) || "null");
  return { done: b && b.onboardingDone, seen: b && b.tutorialSeen, records: b && b.highScores.length, mem: g.save.onboardingDone, last: g.flightCheckLastResult() };
}, LS_KEY);
const last = s7.last || {};
const w7 = await P.g(() => { const W = window.__fc.writes; return { inCheck: W.filter((x) => x.check && x.active > 0), finish: W.filter((x) => x.by === "fcFinish").length, all: W.map((x) => `${x.phase || "-"}:${x.by}`) }; });
s7.writes = w7;
P.check("7 onboardingDone stored; tutorialSeen lock/finish true, release false; no records; card stats score 0 / correct 0, run in sector 1; result passed / space / 1 miss / >= 13 keys / 2-60 s; no storage write from the check's first frame to its end (every key, the miss, the release), one storeSave from fcFinish",
  w7.inCheck.length === 0 && w7.finish === 1 &&
  typeof s7.done === "number" && s7.done > 0 && s7.mem === s7.done && s7.seen && s7.seen.lock === true && s7.seen.finish === true && s7.seen.release === false &&
  s7.records === 0 && !!card && card.score === 0 && card.correct === 0 && card.levelIndex === 0 && last.result === "passed" && last.releasedBy === "space" &&
  last.misses === 1 && last.keys >= 13 && last.ms >= 2000 && last.ms <= 60000, JSON.stringify({ ...s7, card }));

// ---- 8. Every frame of the check: no powerups, no + floaters, no hull loss, no multiplier callout; no tutorial toasts ----
const s8 = await P.g(() => { const S = window.__fc; return { frames: S.frames, maxPowerups: S.maxPowerups, plus: S.plus, hpLoss: S.hpLoss, mult: S.mult, sectorBanner: S.sectorBanner,
  toasts: S.toasts.filter((x) => x.check).map((x) => x.text) }; });
P.check("8 sampled every check frame: 0 powerups, no '+' floater, hull full, no multiplier callout, no sector card; no TYPE SHIELD / LOCK ON toast; in step 1 spawnPowerup(kill drop of a real type) -> null by the hook's cancel, addScore(100) -> 0",
  s8.frames > 60 && s8.maxPowerups === 0 && s8.plus.length === 0 && s8.hpLoss === 0 && s8.mult.length === 0 && !s8.sectorBanner &&
  !s8.toasts.some((t) => /TYPE SHIELD|LOCK ON/.test(t)) && !!cancels.type && cancels.aliveBefore === 0 && cancels.powerup === null && cancels.hookCancel &&
  cancels.powerups === 0 && cancels.added === 0 && cancels.scoreDelta === 0, JSON.stringify({ ...s8, cancels }));

// ---- 9. First 6 s of sector 1: neither the lock tip nor FINISH (the check taught both) ----
await P.g(() => { window.game.invulnT = 1000; });
// Wave 1 is ~80 % letters: a scripted word plate (speed 0, nearest of its lead letter) guarantees a word lock in the window.
const scripted = await P.g(() => {
  const g = window.game;
  const near = new Set(g.enemies.filter((e) => e.alive && !e.dying && e.x < 760).map((e) => e.nextChar()));
  const text = ["orbit", "pulse", "vector", "quartz", "zenith"].find((w) => !near.has(w[0])) || "orbit";
  g.enemies.push(new Enemy({ text, x: 760, y: LANE_YS[2], speed: 0, lane: 2 }));
  return text;
});
await sleep(120);
await press(scripted[0]);
let wordLocked = false;
const t9 = Date.now();
while (Date.now() - t9 < 6000) {
  const k = await P.g(() => {
    const g = window.game;
    if (g.mode !== "playing" || g.levelIntro) return null;
    if (g.lock && g.lock.ref && g.lock.ref.alive) return g.lock.ref.nextChar();
    const words = g.enemies.filter((e) => e.alive && !e.dying && e.text.length > 1 && g.isTargetable(e)).sort((a, b) => a.x - b.x);
    return words.length ? words[0].nextChar() : null;
  });
  if (k && /^[a-z]$/.test(k)) await press(k);
  await sleep(90);
  if (!wordLocked) wordLocked = await P.g(() => { const l = window.game.lock; return !!(l && l.ref && l.ref.text.length > 1 && l.ref.progress >= 1); });
}
const s9 = await P.g(() => { const S = window.__fc; return S.toasts.filter((x) => S.endAt !== null && x.t >= S.endAt).map((x) => x.text); });
P.check("9 first 6 s of sector 1 (a word locked): no 'TYPE THE FIRST LETTER' and no FINISH toast", wordLocked && !s9.some((t) => /TYPE THE FIRST LETTER|FINISH/.test(t)),
  JSON.stringify({ scripted, wordLocked, toasts: s9 }));

// ---- 10. Never again: Start in-session, and a new context seeded with the saved blob ----
await P.g(() => window.game.stopToMenu(true));
await sleep(300);
await page.click("#btnStart");
const abandon = page.locator("#btnConfirmOk");
try { await abandon.waitFor({ state: "visible", timeout: 800 }); await abandon.click(); } catch {}
const again = await waitFor(() => { const g = window.game; return g.mode === "playing" && !g.flightCheck && g.levelIntro ? true : null; }, 1000);
const againCheck = await P.g(() => !!window.game.flightCheck);
const blob = await P.g((k) => JSON.parse(localStorage.getItem(k)), LS_KEY);
let seeded = null;
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await harnessFlags(ctx, { flightCheck: "auto" });
  await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem(k, JSON.stringify(v)); } } catch {} }, [LS_KEY, blob]);
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await pg.click("#btnStart");
  try { await pg.locator("#btnConfirmOk").waitFor({ state: "visible", timeout: 800 }); await pg.locator("#btnConfirmOk").click(); } catch {}
  const ok = await pg.waitForFunction(() => { const g = window.game; return g.mode === "playing" && !g.flightCheck && g.levelIntro; }, null, { timeout: 1500 }).then(() => true).catch(() => false);
  seeded = { ok, eligible: await pg.evaluate(() => window.game.flightCheckEligible()), errs };
  await ctx.close();
}
P.check("10 stopToMenu + Start in-session -> sector card within 1 s, no check; a new context seeded with the saved blob -> no check",
  !!again && !againCheck && seeded.ok && seeded.eligible === false && seeded.errs.length === 0, JSON.stringify({ again: !!again, seeded }));

// ---- 11. Budgets over step 1 ----
P.check("11 step 1: maxRenderMs <= 16, shadowBlur 0 per frame, composite sets <= 6, fps >= 58",
  !!perf && perf.maxRenderMs <= 16 && perf.shadowBlurPerFrame === 0 && perf.compositeSetsPerFrame <= 6 && fps >= 58, JSON.stringify({ fps, perf }));

P.check("no page / console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, JSON.stringify(P.errors));
await P.finish();
