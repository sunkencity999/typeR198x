// ONBOARD (D13) probe: the FINISH tip shows on the first multi-letter lock and is marked seen only when displayed
// (it used to be marked by any kill, so it never showed). Flight Check skipped except in check 6.
// Usage (from the repo root or tools/playtest): node tools/playtest/probes/t-onboard-finish.mjs
// PASS = the feature works. Exit 1 on any failed check or page / console error.
import { openProbe, sleep, harnessFlags, LS_KEY } from "./_lib.mjs";
import { startFresh, clearField, hold, placeEnemy, waitFor } from "./b_lib.mjs";

const FINISH = "KEEP TYPING TO FINISH IT";
const extraErrors = [];
// Every showToast call is logged (a same-key re-show replaces the text in place, so the DOM alone cannot tell).
const logToasts = (P) => P.g(() => {
  const g = window.game;
  if (g.__toastWrapped) return;
  g.__toastWrapped = true;
  window.__toastCalls = [];
  const orig = g.showToast;
  g.showToast = function (text, opts) { window.__toastCalls.push({ text: String(text), t: performance.now(), check: !!g.flightCheck }); return orig.call(this, text, opts); };
});
const calls = (P) => P.g(() => window.__toastCalls.slice());
const finishCount = (list) => list.filter((c) => c.text === FINISH).length;

const P = await openProbe("t-onboard-finish", { flightCheck: "skip" });
const { page } = P;

// ---- 1-3 on one fresh sector-1 run ----
await startFresh(P, "FINISH");   // goto("fresh") + Start + past the sector card
await logToasts(P);
await hold(P);
await clearField(P);
await P.g(() => { window.game.invulnT = 1000; });
await placeEnemy(P, "a", 700, 2);
await sleep(150);
await page.keyboard.press("a");
await sleep(300);
const s1 = await P.g((k) => ({ kills: window.game.levelStats.kills, finish: window.game.save.tutorialSeen.finish, stored: (JSON.parse(localStorage.getItem(k)) || {}).tutorialSeen }), LS_KEY);
const c1 = await calls(P);
P.check("1 fresh sector 1: a letter kill leaves tutorialSeen.finish false and shows no FINISH toast (regression)",
  s1.kills === 1 && s1.finish === false && !(s1.stored && s1.stored.finish) && finishCount(c1) === 0, JSON.stringify({ ...s1, toasts: c1.map((c) => c.text) }));

await clearField(P);
await placeEnemy(P, "orbit", 760, 2);
await sleep(150);
await page.keyboard.press("o");
const t2 = Date.now();
const shown = await waitFor(P, (txt) => { const t = document.querySelector("#toastStack .toast"); return !!t && [...document.querySelectorAll("#toastStack .toast")].some((x) => x.textContent === txt); }, 1000, FINISH);
const ms2 = Date.now() - t2;
const s2 = await P.g((k) => ({ finish: window.game.save.tutorialSeen.finish, stored: (JSON.parse(localStorage.getItem(k)) || {}).tutorialSeen, lock: window.game.lock && window.game.lock.ref.text }), LS_KEY);
P.check("2 'o' on 'orbit' -> KEEP TYPING TO FINISH IT within 200 ms; tutorialSeen.finish true in memory and in localStorage",
  shown && ms2 <= 200 && s2.lock === "orbit" && s2.finish === true && !!(s2.stored && s2.stored.finish === true), JSON.stringify({ ms2, ...s2 }));

await page.keyboard.press("Backspace");
await sleep(100);
await clearField(P);
await placeEnemy(P, "neon", 760, 3);
await sleep(150);
await page.keyboard.press("n");
await sleep(400);
const c3 = await calls(P);
const lock3 = await P.g(() => window.game.lock && window.game.lock.ref.text);
P.check("3 release, then 'n' on 'neon' -> no second FINISH toast", lock3 === "neon" && finishCount(c3) === 1, JSON.stringify({ lock3, finishCalls: finishCount(c3) }));

// Helper for the separate contexts (4-6).
async function openCtx(name, { flightCheck = "skip", save = undefined } = {}) {
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await harnessFlags(ctx, { flightCheck });
  if (save !== undefined) await ctx.addInitScript(([k, v]) => { try { if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } } catch {} }, [LS_KEY, save]);
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => extraErrors.push(`${name}: ${e}`));
  pg.on("console", (m) => { if (m.type() === "error") extraErrors.push(`${name}: ${m.text()}`); });
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  const Q = { page: pg, ctx, g: (fn, arg) => pg.evaluate(fn, arg) };
  await logToasts(Q);
  return Q;
}
async function startIn(Q) {
  await Q.page.fill("#playerName", "PROBE").catch(() => {});
  await Q.page.click("#btnStart");
  try { await Q.page.locator("#btnStoryLaunch").waitFor({ state: "visible", timeout: 2000 }); await sleep(250); await Q.page.click("#btnStoryLaunch"); } catch {}
  await Q.page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 15000 });
}
async function wordLockIn(Q, text, lane = 2) {
  await Q.g(() => { const g = window.game; g.wavePhase = "spawn"; g.spawnAcc = -1e9; g.hungryT = -1e9; g.waveT = 0; g.enemies.length = 0; g.powerups.length = 0; g.lock = null; g.invulnT = 1000; });
  await Q.g(({ text, lane }) => { window.game.enemies.push(new Enemy({ text, x: 760, y: LANE_YS[lane], speed: 0, lane })); }, { text, lane });
  await sleep(150);
  await Q.page.keyboard.press(text[0]);
  await sleep(400);
  return Q.g(() => window.game.lock && window.game.lock.ref.text);
}

// ---- 4. Returning save: no FINISH ----
{
  const Q = await openCtx("returning", { save: { playerName: "VET", lastUnlockedLevel: 3, storySeen: true, highScore: 3000 } });
  await startIn(Q);
  await Q.page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
  const lock = await wordLockIn(Q, "orbit");
  const c = await Q.g(() => window.__toastCalls.slice());
  P.check("4 returning save (lastUnlockedLevel 3): the first word lock shows no FINISH toast", lock === "orbit" && finishCount(c) === 0, JSON.stringify({ lock, toasts: c.map((x) => x.text) }));
  await Q.ctx.close();
}

// ---- 5. A boss minion is never a FINISH lesson ----
{
  const Q = await openCtx("minion", { save: null });
  await startIn(Q);
  await Q.page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
  await Q.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; g.invulnT = 1e6; });
  const inBoss = await Q.page.waitForFunction(() => { const g = window.game; return g.inBoss && g.boss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  const text = await Q.g(() => {
    const g = window.game;
    const used = new Set(g.enemies.filter((e) => e.alive).map((e) => e.nextChar()));
    const t = ["zap", "qix", "vex", "jot", "kip"].find((w) => w[0] !== g.boss.nextChar && !used.has(w[0]));
    g.enemies.push(new Enemy({ text: t, x: 760, y: LANE_YS[2], speed: 0, lane: 2, kind: "bossMinion" }));
    return t;
  });
  await sleep(150);
  await Q.page.keyboard.press(text[0]);
  await sleep(400);
  const s = await Q.g((t) => ({ progress: (window.game.enemies.find((e) => e.text === t) || {}).progress, finish: window.game.save.tutorialSeen.finish, calls: window.__toastCalls.map((c) => c.text) }), text);
  P.check("5 fresh save, no word locked, forced boss: the first minion key shows no FINISH toast and tutorialSeen.finish stays false",
    inBoss && s.progress === 1 && s.finish === false && !s.calls.includes(FINISH), JSON.stringify({ inBoss, text, ...s }));
  await Q.ctx.close();
}

// ---- 6. After a passed Flight Check, sector 1 shows no FINISH ----
{
  const Q = await openCtx("after-check", { flightCheck: "auto", save: null });
  await startIn(Q);
  const at = (n) => Q.page.waitForFunction((n) => { const s = window.game.flightCheckState(); return s && s.phase === "step" && s.step === n && s.plates[0] && s.plates[0].targetable; }, n, { timeout: 5000 }).catch(() => {});
  const press = (k) => Q.page.keyboard.press(k === " " ? "Space" : k);
  await at(1); await press("j");
  await at(2); for (const k of "spark") { await press(k); await sleep(60); }
  await at(3); await press("c");
  await Q.page.waitForFunction(() => { const s = window.game.flightCheckState(); return s && s.plates.length === 2; }, null, { timeout: 2000 }).catch(() => {});
  for (const k of " laser") { await press(k); await sleep(70); }
  await Q.page.waitForFunction(() => !window.game.flightCheck && !window.game.levelIntro && window.game.mode === "playing", null, { timeout: 9000 }).catch(() => {});
  const last = await Q.g(() => window.game.flightCheckLastResult());
  const lock = await wordLockIn(Q, "orbit");
  const c = await Q.g(() => window.__toastCalls.slice());
  const after = c.filter((x) => !x.check);
  P.check("6 after a passed Flight Check (FINISH taught in it): the first word lock in sector 1 shows no FINISH toast",
    !!last && last.result === "passed" && lock === "orbit" && finishCount(c.filter((x) => x.check)) === 1 && finishCount(after) === 0,
    JSON.stringify({ last: last && last.result, lock, inCheck: c.filter((x) => x.check).map((x) => x.text), after: after.map((x) => x.text) }));
  await Q.ctx.close();
}

P.check("no page / console errors", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0 && extraErrors.length === 0, JSON.stringify({ ...P.errors, extraErrors }));
await P.finish();
