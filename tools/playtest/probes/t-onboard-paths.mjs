// ONBOARD (D13) probe: every way into, through and out of the Flight Check other than the happy path. One fresh browser
// context per case, the game's real eligibility rule unless a case says otherwise.
// Usage (from the repo root or tools/playtest): node tools/playtest/probes/t-onboard-paths.mjs
// PASS = the feature works. Exit 1 on any failed check or page / console error.
import { devices } from "playwright";
import { openProbe, sleep, harnessFlags, FIXTURES, LS_KEY } from "./_lib.mjs";

const P = await openProbe("t-onboard-paths", {});
const allErrors = [];

// rAF sampler: the first frame each check plate exists (x vs its hold) and the toast log; registered before the game.
const SAMPLER = () => {
  const S = window.__fc = { first: {}, toasts: [] };
  const tick = () => {
    const g = window.game;
    if (g && g.flightCheck) for (const e of g.enemies) if (typeof e.fcHold === "number" && !(e.text in S.first)) S.first[e.text] = { x: e.x, hold: e.fcHold * g.w };
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const seen = new WeakMap();
  document.addEventListener("DOMContentLoaded", () => {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    new MutationObserver(() => {
      for (const t of stack.querySelectorAll(".toast")) { const s = t.textContent; if (seen.get(t) !== s) { seen.set(t, s); S.toasts.push(s); } }
    }).observe(stack, { childList: true, subtree: true, characterData: true });
  });
};
const BLOCK_STORAGE = () => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (this === window.localStorage) throw new DOMException("blocked by the probe", "SecurityError");
    return orig.call(this, k, v);
  };
};

async function openCase(name, { flightCheck = "auto", save = undefined, mobile = false, reducedMotion = false, blockStorage = false } = {}) {
  const ctxOpts = mobile ? { ...devices["iPhone 13 landscape"], deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: reducedMotion ? "reduce" : "no-preference" };
  const ctx = await P.browser.newContext(ctxOpts);
  await harnessFlags(ctx, { flightCheck });
  if (blockStorage) await ctx.addInitScript(BLOCK_STORAGE);
  if (save !== undefined) {
    await ctx.addInitScript(([k, v]) => {
      try {
        if (sessionStorage.getItem("__seeded")) return;
        sessionStorage.setItem("__seeded", "1");
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    }, [LS_KEY, save]);
  }
  await ctx.addInitScript(SAMPLER);
  const page = await ctx.newPage();
  const errs = { name, pageErrors: [], consoleErrors: [] };
  allErrors.push(errs);
  page.on("pageerror", (e) => errs.pageErrors.push(String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.consoleErrors.push(m.text()); });
  await page.goto(P.base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  const c = {
    page, ctx, errs,
    g: (fn, arg) => page.evaluate(fn, arg),
    waitFor: (fn, ms, arg) => page.waitForFunction(fn, arg, { timeout: ms }).then((h) => h.jsonValue()).catch(() => null),
    press: (k) => page.keyboard.press(k === " " ? "Space" : k),
    state: () => page.evaluate(() => window.game.flightCheckState()),
    last: () => page.evaluate(() => window.game.flightCheckLastResult()),
    blob: () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, LS_KEY),
    async start(name = "PROBE") {
      await page.fill("#playerName", name).catch(() => {});
      await page.click("#btnStart");
      try { await page.locator("#btnConfirmOk").waitFor({ state: "visible", timeout: 700 }); await page.click("#btnConfirmOk"); } catch {}
      try { await page.locator("#btnStoryLaunch").waitFor({ state: "visible", timeout: 2000 }); await sleep(250); await page.click("#btnStoryLaunch"); } catch {}
      await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 15000 });
    },
    // Wait until step n's plate (step 3: the far one) is targetable.
    async atStep(n, ms = 4000) {
      return c.waitFor((n) => { const s = window.game.flightCheckState(); return s && s.phase === "step" && s.step === n && s.plates[0] && s.plates[0].targetable ? true : null; }, ms, n);
    },
    async close() { await ctx.close(); }
  };
  return c;
}

// Types through the check. how: "space" (release then laser), "finish" (type comet out), "novice" (types l a s on the
// comet lock, loses it, then laser). send(k) defaults to a hardware key press.
async function drive(c, how = "space", send = null) {
  const key = send || ((k) => c.press(k));
  for (const k of "j") { await c.atStep(1); await key(k); }
  await c.atStep(2);
  for (const k of "spark") { await key(k); await sleep(60); }
  await c.atStep(3);
  if (how === "finish") { for (const k of "comet") { await key(k); await sleep(60); } }
  else {
    await key("c");
    await c.waitFor(() => { const s = window.game.flightCheckState(); return s && s.plates.length === 2 ? true : null; }, 1000);
    await sleep(60);
    const seq = how === "novice" ? "laslaser" : " laser";
    for (const k of seq) { await key(k); await sleep(70); }
  }
  return c.waitFor(() => { const g = window.game; return !g.flightCheck && g.levelIntro ? true : null; }, 4500);
}

// ---- 1. Esc in step 1 ----
{
  const c = await openCase("esc", { save: null });
  await c.start();
  await c.atStep(1);
  await c.press("Escape");
  const t0 = Date.now();
  const r = await c.waitFor(() => { const g = window.game; return !g.flightCheck && g.levelIntro && g.mode === "playing" ? true : null; }, 300);
  const ms = Date.now() - t0;
  const b = await c.blob(); const last = await c.last();
  P.check("1 Esc in step 1 -> within 300 ms: no check, sector card, still playing; onboardingDone set, tutorialSeen.lock false; skipped / esc",
    !!r && b && b.onboardingDone > 0 && b.tutorialSeen.lock === false && last && last.result === "skipped" && last.reason === "esc",
    JSON.stringify({ ms, done: b && b.onboardingDone, lock: b && b.tutorialSeen.lock, last }));
  await c.close();
}

// ---- 2. Skip button ----
{
  const c = await openCase("button", { save: null });
  await c.start();
  await c.atStep(1);
  const box = await c.g(() => { const b = document.getElementById("btnFlightSkip"); const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, tabIndex: b.tabIndex, label: b.getAttribute("aria-label"), keys: b.getAttribute("aria-keyshortcuts"), text: b.textContent }; });
  await c.page.click("#btnFlightSkip");
  const r = await c.waitFor(() => { const g = window.game; return !g.flightCheck && g.levelIntro && g.mode === "playing" ? true : null; }, 300);
  const b = await c.blob(); const last = await c.last();
  P.check("2 Skip button -> sector card, skipped / button, onboardingDone set; button >= 44x44 CSS px, tabIndex -1, aria-label + Escape shortcut",
    !!r && last && last.result === "skipped" && last.reason === "button" && b.onboardingDone > 0 && box.w >= 44 && box.h >= 44 && box.tabIndex === -1 &&
    box.label === "Skip flight check" && box.keys === "Escape", JSON.stringify({ box, last }));
  await c.close();
}

// ---- 3. Finishing the far plate also passes ----
{
  const c = await openCase("finish", { save: null });
  await c.start();
  const ok = await drive(c, "finish");
  const last = await c.last();
  const s = await c.g(() => ({ score: window.game.stats.score, laserFirst: window.__fc.first.laser || null }));
  P.check("3 step 3 by finishing 'comet' -> passed, releasedBy finish, laser detonated (it appeared on the lock), no score",
    !!ok && last.result === "passed" && last.releasedBy === "finish" && !!s.laserFirst && s.score === 0, JSON.stringify({ last, ...s }));
  await c.close();
}

// ---- 4. Novice: types the near word without Space ----
{
  const c = await openCase("novice", { save: null });
  await c.start();
  const ok = await drive(c, "novice");
  const last = await c.last();
  const toasts = await c.g(() => window.__fc.toasts.slice());
  P.check("4 novice types 'las' on the comet lock -> lock lost, then 'laser' -> passed, releasedBy lost", !!ok && last.result === "passed" && last.releasedBy === "lost" && last.misses >= 3,
    JSON.stringify({ last, toasts }));
  await c.close();
}

// ---- 5. Pause in step 2 ----
{
  const c = await openCase("pause", { save: null });
  await c.start();
  await c.atStep(1);
  await c.press("j");
  await c.atStep(2);
  await c.press("s");
  await c.waitFor(() => { const t = document.querySelector('#toastStack .toast[data-key="fc"]'); return t && /FINISH/.test(t.textContent) ? true : null; }, 1000);
  // The plate is still gliding here: two reads 350 ms apart while paused prove it is frozen.
  await c.page.click("#btnPause");
  await c.waitFor(() => window.game.mode === "paused" ? true : null, 1000);
  const x0 = (await c.state()).plates[0].x;
  await sleep(350);
  const paused = await c.g(() => ({ mode: window.game.mode, eyebrow: document.getElementById("pauseEyebrow").textContent, wave: document.getElementById("pauseWave").textContent,
    sector: document.getElementById("pauseSector").textContent, score: document.getElementById("pauseScore").textContent,
    restartHidden: document.getElementById("btnRestart").classList.contains("hidden"), toasts: document.querySelectorAll("#toastStack .toast").length,
    x: window.game.flightCheckState().plates[0].x }));
  await sleep(200);
  await c.press("Escape");
  const t0 = Date.now();
  const back = await c.waitFor(() => { const t = document.querySelector('#toastStack .toast[data-key="fc"]'); return window.game.mode === "playing" && t && /FINISH/.test(t.textContent) && !t.classList.contains("is-leaving") ? true : null; }, 1000);
  const backMs = Date.now() - t0;
  const xPaused = paused.x;
  const after = await c.state();
  // Finish the check, then a normal pause shows Restart again.
  for (const k of "park") { await c.press(k); await sleep(60); }
  await c.g(() => window.game.skipFlightCheck("api"));
  await c.waitFor(() => !window.game.levelIntro && window.game.mode === "playing" ? true : null, 6000);
  await sleep(500);
  await c.page.click("#btnPause");
  await c.waitFor(() => window.game.mode === "paused" ? true : null, 1000);
  const normal = await c.g(() => ({ restartHidden: document.getElementById("btnRestart").classList.contains("hidden"), eyebrow: document.getElementById("pauseEyebrow").textContent }));
  P.check("5 pause in step 2: Paused // Flight check, CHECK 2/3, Restart hidden, no toast; Esc resumes, the toast is back within 200 ms, plate unmoved, check active; a later pause shows Restart",
    paused.mode === "paused" && /Flight check/.test(paused.eyebrow) && paused.wave === "CHECK 2/3" && paused.restartHidden && paused.toasts === 0 &&
    !!back && backMs <= 200 && xPaused === x0 && !!after && after.step === 2 && !normal.restartHidden && !/Flight check/.test(normal.eyebrow),
    JSON.stringify({ paused, backMs, x0, xPaused, normal }));
  await c.close();
}

// ---- 6. Save & quit mid-check ----
{
  const c = await openCase("quit", { save: null });
  await c.start();
  await c.atStep(1);
  await c.page.click("#btnPause");
  await c.waitFor(() => window.game.mode === "paused" ? true : null, 1000);
  await sleep(250);
  await c.page.click("#btnPauseQuit");
  await c.waitFor(() => window.game.mode === "menu" ? true : null, 2000);
  await sleep(300);
  const s = await c.g(() => ({ mode: window.game.mode, active: window.game.isFlightCheckActive(), resumeHidden: document.getElementById("resumeCard").classList.contains("hidden"), last: window.game.flightCheckLastResult() }));
  const b = await c.blob();
  await c.page.click("#btnStart");
  const again = await c.waitFor(() => window.game.flightCheck ? true : null, 3000);
  P.check("6 Save & quit mid-check -> menu, check inactive (aborted), onboardingDone absent, saved run null, resume card hidden; Start again -> check active",
    s.mode === "menu" && !s.active && s.last && s.last.result === "aborted" && b && !b.onboardingDone && b.run === null && s.resumeHidden && !!again,
    JSON.stringify({ ...s, done: b && b.onboardingDone, run: b && b.run, again: !!again }));
  await c.close();
}

// ---- 7. Ineligible saves never see it ----
{
  const out = {};
  const noCheck = async (c, how) => {
    if (how === "continue") {
      await c.g(() => document.getElementById("btnContinue").click());
      await c.waitFor(() => window.game.mode === "playing" ? true : null, 10000);
    } else await c.start();
    const t0 = Date.now();
    const card = await c.waitFor(() => { const g = window.game; return !g.flightCheck && (g.levelIntro || g.inBoss || g.wavePhase === "spawn") ? true : null; }, 1000);
    return { card: !!card, ms: Date.now() - t0, active: await c.g(() => !!window.game.flightCheck), last: await c.last() };
  };
  let c = await openCase("legacy-midwave", { save: FIXTURES["legacy-midwave"] });
  out.midwave = await noCheck(c, "continue"); await c.close();
  c = await openCase("records", { save: { playerName: "REC", lastUnlockedLevel: 1, storySeen: true, highScores: [{ runId: "r1", name: "REC", score: 900, levelReached: 1, startLevel: 1, wpm: 40, acc: 95, maxCombo: 9, ship: "coconut", difficulty: "standard", date: 1 }] } });
  out.records = await noCheck(c); await c.close();
  c = await openCase("lock-seen", { save: { playerName: "LOCK", lastUnlockedLevel: 1, storySeen: true, tutorialSeen: { lock: true } } });
  out.lockSeen = await noCheck(c); await c.close();
  c = await openCase("skip-flag", { flightCheck: "skip", save: null });
  out.skipFlag = await noCheck(c); await c.close();
  // Rule 5 (R20): a MEASURE session makes the save a returning pilot's. Real typistSessions with a seeded profile when
  // MEASURE is merged; a stub on the instance when it is absent (or when the seeded row does not read back).
  const sessionSave = { playerName: "PRAC", lastUnlockedLevel: 1, storySeen: true,
    profile: { v: 1, keys: {}, bigrams: {}, speedEma: 41, thrEma: 44, speedN: 120, sessions: [[1792800000, "drill", 1, 41, 95.5, "-", 0, 3, 81, ""]], sectorBest: {}, bests: { speed: 0, ceiling: 0, drill: { speed: 41, acc: 95.5 } }, days: { n: 1, last: 20261023 } } };
  c = await openCase("session", { save: sessionSave });
  const pre = await c.g(() => {
    const g = window.game;
    const real = typeof g.typistSessions === "function";
    const n = real ? g.typistSessions(100).length : 0;
    let path = real && n > 0 ? "measure" : "stub";
    if (path === "stub") {
      const saved = g.typistSessions;
      g.typistSessions = () => [];
      const control = g.flightCheckEligible();
      g.typistSessions = (k) => [{ t: 1792800000, mode: "drill", sector: 1, speed: 41, acc: 95.5, rank: "-", score: 0, misses: 3, steady: 81, weak: [] }];
      return { path, real, n, control, eligible: g.flightCheckEligible(), hadReal: typeof saved === "function" };
    }
    return { path, real, n, control: null, eligible: g.flightCheckEligible() };
  });
  out.session = { ...pre, ...(await noCheck(c)) };
  await c.close();
  const okAll = Object.values(out).every((o) => o.card && !o.active && o.ms <= 1000) && out.session.eligible === false && (out.session.control === null || out.session.control === true);
  P.check("7 ineligible -> no check, sector card within 1 s: legacy-midwave Continue, a records row, tutorialSeen.lock, the skip flag, a typistSessions session (rule 5)",
    okAll, JSON.stringify(out));
}

// ---- 8. Sector tile 1 (storySeen) ----
{
  const c = await openCase("tile", { save: { playerName: "TILE", lastUnlockedLevel: 1, storySeen: true } });
  await c.page.click('.sectorCard[data-level="1"]');
  const r = await c.waitFor(() => window.game.flightCheck && window.game.mode === "playing" ? true : null, 4000);
  P.check("8 sector tile 1 on a fresh save with storySeen -> check active (startSector(0) path)", !!r, JSON.stringify({ active: !!r }));
  await c.close();
}

// ---- 9. The play flag forces it once ----
{
  const c = await openCase("play-flag", { flightCheck: "play", save: FIXTURES["legacy-postvictory"] });
  await c.start();
  const r = await c.waitFor(() => window.game.flightCheck ? true : null, 3000);
  await c.atStep(1);
  await c.press("Escape");
  await c.waitFor(() => !window.game.flightCheck ? true : null, 1000);
  await c.g(() => { const g = window.game; g.stopToMenu(true); g.startNewRun(); });
  const second = await c.waitFor(() => { const g = window.game; return !g.flightCheck && g.levelIntro ? true : null; }, 1000);
  P.check("9 flightCheck play on legacy-postvictory -> the check runs once; a second startNewRun() in-session -> no check", !!r && !!second,
    JSON.stringify({ first: !!r, second: !!second }));
  await c.close();
}

// ---- 10. Reduced motion: no glide ----
{
  const c = await openCase("reduced-motion", { save: null, reducedMotion: true });
  await c.start();
  const ok = await drive(c, "space");
  const s = await c.g(() => ({ rm: window.game.reduceMotion, first: window.__fc.first }));
  const last = await c.last();
  const exact = ["j", "spark", "comet", "laser"].every((t) => s.first[t] && Math.abs(s.first[t].x - s.first[t].hold) < 0.01);
  P.check("10 reduced motion: every check plate's first frame is at its hold x; the check passes", s.rm === true && exact && !!ok && last.result === "passed", JSON.stringify({ ...s, last }));
  await c.close();
}

// ---- 11. Phone (iPhone 13 landscape): phone lanes, #typeInput, insertText(" ") releases, toast above the pill ----
{
  const c = await openCase("mobile", { save: null, mobile: true });
  await c.page.fill("#playerName", "THUMB").catch(() => {});
  await c.page.tap("#btnStart");
  try { await c.page.locator("#btnStoryLaunch").waitFor({ state: "visible", timeout: 2000 }); await sleep(250); await c.page.tap("#btnStoryLaunch"); } catch {}
  await c.waitFor(() => window.game.mode === "playing" ? true : null, 15000);
  await c.atStep(1);
  const pill = await c.waitFor(() => { const p = document.getElementById("tapToType"); return p && !p.classList.contains("hidden") ? true : null; }, 4000);
  await sleep(250);
  const geo = await c.g(() => {
    const p = document.getElementById("tapToType").getBoundingClientRect();
    const t = document.querySelector('#toastStack .toast[data-key="fc"]');
    const tr = t ? t.getBoundingClientRect() : null;
    const g = window.game;
    return { pillTop: p.top, toastBottom: tr ? tr.bottom : null, phone: g.phoneProfile(), ys: g.laneYs().slice(), plateY: g.flightCheckState().plates[0].y, touch: g.touchMode, skipText: document.getElementById("btnFlightSkip").textContent };
  });
  await c.page.tap("#game");
  await sleep(200);
  const focused = await c.g(() => document.activeElement && document.activeElement.id);
  const ok = await drive(c, "space", (k) => c.page.keyboard.insertText(k));
  const last = await c.last();
  P.check("11 phone landscape: phone lanes (j on 300), typing through #typeInput, insertText(' ') releases, passes; toast bottom above the pill top; Skip label 'Skip'",
    geo.phone && geo.plateY === geo.ys[Math.floor((geo.ys.length - 1) / 2)] && geo.plateY === 300 && !!pill && geo.toastBottom !== null && geo.toastBottom <= geo.pillTop &&
    focused === "typeInput" && !!ok && last.result === "passed" && last.releasedBy === "space" && geo.skipText === "Skip",
    JSON.stringify({ geo, pill: !!pill, focused, last }));
  await c.close();
}

// ---- 12. An external level start aborts it ----
{
  const c = await openCase("external", { save: null });
  await c.start();
  await c.atStep(2);
  await c.g(() => window.game.startSector(9));
  await sleep(300);
  const s = await c.g(() => ({ active: window.game.isFlightCheckActive(), levelIndex: window.game.levelIndex, mode: window.game.mode, last: window.game.flightCheckLastResult(), body: document.body.dataset.flightCheck || null }));
  const b = await c.blob();
  P.check("12 startSector(9) during the check -> check inactive (aborted), sector 10, onboardingDone set, no errors",
    !s.active && s.levelIndex === 9 && s.mode === "playing" && s.last && s.last.result === "aborted" && b.onboardingDone > 0 && !s.body &&
    c.errs.pageErrors.length === 0 && c.errs.consoleErrors.length === 0, JSON.stringify({ ...s, done: b.onboardingDone, errs: c.errs }));
  await c.close();
}

// ---- 13. Storage blocked ----
{
  const c = await openCase("blocked", { blockStorage: true });
  await c.start();
  const ok = await drive(c, "space");
  const last = await c.last();
  await c.g(() => window.game.stopToMenu(true));
  await sleep(300);
  await c.start();
  // c.start() may wait out the (absent) briefing, so accept the card or wave play; no new check result may exist.
  const second = await c.waitFor(() => { const g = window.game; return !g.flightCheck && !!g.run && (g.levelIntro || g.wavePhase === "spawn") ? true : null; }, 1000);
  const s = await c.g(() => ({ done: window.game.save.onboardingDone, persist: window.game.persistUnavailable === true, lastMs: window.game.flightCheckLastResult().ms }));
  P.check("13 storage blocked: the check passes; a second Start in-session -> no check (in-memory onboardingDone)", !!ok && last.result === "passed" && !!second && s.done > 0 &&
    s.lastMs === last.ms, JSON.stringify({ last, second: !!second, ...s }));
  await c.close();
}

const pageErrors = allErrors.flatMap((e) => e.pageErrors.map((x) => `${e.name}: ${x}`));
const consoleErrors = allErrors.flatMap((e) => e.consoleErrors.map((x) => `${e.name}: ${x}`));
P.check("no page / console errors in any case", pageErrors.length === 0 && consoleErrors.length === 0 && P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0,
  JSON.stringify({ pageErrors, consoleErrors }));
await P.finish();
