// C8 acceptance probe: tutorial toasts (fresh save), suppression for returning players, help modal via '?' and pause,
// help copy, toast placement.
// Usage: cd tools/playtest && node probes/c8-onboarding.mjs
import { openProbe, sleep } from "./_lib.mjs";
import { chromium } from "playwright";

const P = await openProbe("c8");
const { page } = P;

// ---- Fresh save: lock / finish / release / boss / accuracy tips ----
await P.goto(null);

// Help from the menu via '?'
await P.g(() => { document.activeElement && document.activeElement.blur(); });
await page.keyboard.press("?");
await sleep(350);
const help = await P.g(() => {
  const m = document.getElementById("helpModal");
  const text = m.textContent;
  return {
    open: !m.classList.contains("is-dismissed") && getComputedStyle(m).visibility !== "hidden",
    sections: m.querySelectorAll("details.helpSection").length, focus: document.activeElement.id,
    has: ["10", "25", "50", "100", "Space", "HEAL"].every((k) => text.includes(k)),
    bad: /15 pts|x2 at 15|×2 at 15/.test(text), legacyHelp: document.querySelector(".help") === null,
    summaries: [...m.querySelectorAll("details.helpSection > summary")].map((s) => s.textContent.trim())
  };
});
P.check("'?' on the menu opens #helpModal with 7 sections and focuses #btnHelpClose", help.open && help.sections === 7 && help.focus === "btnHelpClose", JSON.stringify({ open: help.open, sections: help.sections, focus: help.focus, summaries: help.summaries }));
P.check("help copy: contains 10/25/50/100/Space/HEAL, no '15 pts', no legacy .help", help.has && !help.bad && help.legacyHelp, JSON.stringify({ has: help.has, bad: help.bad, legacyHelp: help.legacyHelp }));
await P.shot("help");
await page.keyboard.press("Escape");
await sleep(250);
const helpClosed = await P.g(() => ({ closed: document.getElementById("helpModal").classList.contains("is-dismissed"), focusInside: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#helpModal")), mode: window.game.mode }));
P.check("Escape closes help, focus leaves the modal, still on the menu", helpClosed.closed && !helpClosed.focusInside && helpClosed.mode === "menu", JSON.stringify(helpClosed));

// Toast observer from before the run starts.
await P.g(() => {
  window.__toastLog = [];
  const stack = document.getElementById("toastStack");
  new MutationObserver(() => { for (const t of stack.querySelectorAll(".toast")) { const s = t.textContent; if (!window.__toastLog.includes(s)) window.__toastLog.push(s); } }).observe(stack, { childList: true, subtree: true, characterData: true });
});
await P.startRun("ROOKIE");
await page.waitForFunction(() => window.game && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
const t0 = Date.now();
const lockToast = await page.waitForFunction(() => { const t = document.querySelector("#toastStack .toast"); return t && /LOCK ON/.test(t.textContent) ? t.textContent : false; }, null, { timeout: 2600 }).then(() => true).catch(() => false);
const lockMs = Date.now() - t0;
P.check("fresh save: 'LOCK ON' toast within 2 s of the first wave", lockToast && lockMs <= 2600, `shown=${lockToast} after ${lockMs} ms (wave clock)`);
const place = await P.g(() => {
  const t = document.querySelector("#toastStack .toast"); if (!t) return null;
  const r = t.getBoundingClientRect(), hud = document.getElementById("hud").getBoundingClientRect(), main = document.getElementById("main").getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, hudBottom: hud.bottom, mainBottom: main.bottom, kind: t.className, inMain: r.left >= main.left && r.right <= main.right };
});
P.check("toast sits below the HUD (+40) and above the bottom (-20), kind tip", !!place && place.top > place.hudBottom + 40 && place.bottom < place.mainBottom - 20 && /toast--tip/.test(place.kind) && place.inMain, JSON.stringify(place));
await P.shot("toast-lock");
await sleep(4300);
const gone = await P.g(() => { const t = document.querySelector("#toastStack .toast"); return !t || !/LOCK ON/.test(t.textContent); });
P.check("'LOCK ON' toast gone after ~4 s", gone, `gone=${gone}`);

// First lock on a WORD target -> FINISH toast, tutorialSeen.lock true; kill -> finish true.
await P.g(() => { window.game.invulnT = 1000; });
let locked = false;
for (let i = 0; i < 150 && !locked; i++) {
  const k = await P.g(() => {
    const g = window.game;
    const words = g.enemies.filter((e) => e.alive && !e.dying && e.text.length >= 3 && g.isTargetable(e)).sort((a, b) => a.x - b.x);
    return words.length ? words[0].nextChar() : null;
  });
  if (k && /^[a-z]$/.test(k)) await page.keyboard.press(k);
  await sleep(80);
  locked = await P.g(() => !!window.game.lock);
}
await sleep(150);
const afterLock = await P.g(() => ({ lock: !!window.game.lock, seenLock: window.game.save.tutorialSeen.lock, log: window.__toastLog.slice(), blob: (JSON.parse(localStorage.getItem("typesmup198x.save.v1")) || {}).tutorialSeen }));
P.check("first lock -> 'FINISH' toast and tutorialSeen.lock === true (persisted)", afterLock.seenLock === true && afterLock.log.some((s) => /FINISH/.test(s)) && afterLock.blob && afterLock.blob.lock === true, JSON.stringify(afterLock));
// Lock loss: three wrong keys on the current lock.
for (let i = 0; i < 3; i++) {
  const next = await P.g(() => (window.game.lock && window.game.lock.ref) ? window.game.lock.ref.nextChar() : null);
  if (!next) break;
  const wrong = "abcdefghijklmnopqrstuvwxyz".replace(next, "")[Math.floor(Math.random() * 25)];
  await page.keyboard.press(wrong);
  await sleep(60);
}
await sleep(200);
const afterLoss = await P.g(() => ({ lock: !!window.game.lock, seenRelease: window.game.save.tutorialSeen.release, log: window.__toastLog.slice() }));
P.check("three misses -> 'LOCK LOST' toast and tutorialSeen.release", afterLoss.seenRelease === true && afterLoss.log.some((s) => /LOCK LOST/.test(s)), JSON.stringify(afterLoss));
// Finish a target for the finish flag.
for (let i = 0; i < 120; i++) {
  const done = await P.g(() => (window.game.levelStats.kills | 0) > 0);
  if (done) break;
  const k = await P.nextKey();
  if (k && /^[a-z]$/.test(k)) await page.keyboard.press(k);
  await sleep(55);
}
await sleep(150);
const finish = await P.g(() => ({ kills: window.game.levelStats.kills, seenFinish: window.game.save.tutorialSeen.finish }));
P.check("first kill -> tutorialSeen.finish === true", finish.kills > 0 && finish.seenFinish === true, JSON.stringify(finish));

// Powerup tip: spawn one in view.
await P.g(() => { const g = window.game; g.spawnPowerup({ type: "SHIELD", x: 900, y: 320, fromKill: true }); });
await sleep(300);
const pu = await P.g(() => window.__toastLog.slice());
P.check("first powerup on screen -> 'TYPE SHIELD TO GRAB IT'", pu.some((s) => /TYPE SHIELD TO GRAB IT/.test(s)), JSON.stringify(pu.slice(-3)));

// Boss tip after the intro.
await P.forceBoss();
await page.waitForFunction(() => { const g = window.game; return g.inBoss && !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 15000 }).catch(() => {});
await sleep(250);
const bossTip = await P.g(() => ({ log: window.__toastLog.slice(), seen: window.game.save.tutorialSeen.boss, during: window.__bossIntroToast }));
P.check("boss intro end -> 'BOSS: TYPE THE HIGHLIGHTED WORD' toast + tutorialSeen.boss", bossTip.log.some((s) => /^BOSS: TYPE THE HIGHLIGHTED WORD/.test(s)) && bossTip.seen === true, JSON.stringify(bossTip.log.slice(-2)));

// Accuracy tip: queued by a sector-1 death under 70 %, shown on the next sector start.
await P.g(() => { const g = window.game; g._accuracyTipPending = true; g.restartLevel(); });
await page.waitForFunction(() => window.game.mode === "playing" && !window.game.levelIntro && window.game.levelT >= 0.6, null, { timeout: 10000 }).catch(() => {});
await sleep(200);
const accTip = await P.g(() => ({ log: window.__toastLog.slice(), seen: window.game.save.tutorialSeen.accuracy }));
P.check("accuracy tip shown once on the next sector start", accTip.log.some((s) => /ACCURACY BEATS SPEED/.test(s)) && accTip.seen === true, JSON.stringify(accTip.log.slice(-2)));

// Pause -> Help -> Escape keeps the game paused.
await page.keyboard.press("Escape");
await page.waitForFunction(() => window.game.mode === "paused", null, { timeout: 3000 }).catch(() => {});
await page.click("#btnPauseHelp");
await sleep(300);
const pauseHelp = await P.g(() => ({ open: !document.getElementById("helpModal").classList.contains("is-dismissed"), focus: document.activeElement.id, mode: window.game.mode }));
await page.keyboard.press("Escape");
await sleep(250);
const pauseHelp2 = await P.g(() => ({ closed: document.getElementById("helpModal").classList.contains("is-dismissed"), mode: window.game.mode, focus: document.activeElement.id }));
P.check("pause: #btnPauseHelp opens help (focus #btnHelpClose); Escape closes it and the game stays paused", pauseHelp.open && pauseHelp.focus === "btnHelpClose" && pauseHelp.mode === "paused" && pauseHelp2.closed && pauseHelp2.mode === "paused", JSON.stringify({ pauseHelp, pauseHelp2 }));
const toastsCleared = await P.g(() => document.querySelectorAll("#toastStack .toast").length);
P.check("no tutorial toast while paused", toastsCleared === 0, `toasts=${toastsCleared}`);
P.check("no page errors", P.errors.pageErrors.length === 0, JSON.stringify(P.errors.pageErrors));

// ---- Returning player (lastUnlockedLevel 3): no toast in the first 6 s ----
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const save = { playerName: "VET", selectedShip: "coconut", highScore: 3000, lastUnlockedLevel: 3, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true }, run: null };
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, ["typesmup198x.save.v1", save]);
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await pg.evaluate(() => { window.__toasts = 0; new MutationObserver((l) => { for (const m of l) window.__toasts += m.addedNodes.length; }).observe(document.getElementById("toastStack"), { childList: true }); });
  await pg.click("#btnStart");
  await pg.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
  await pg.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
  await sleep(6000);
  const n = await pg.evaluate(() => window.__toasts);
  P.check("lastUnlockedLevel 3: no toast in the first 6 s of play", n === 0, `toasts added=${n}`);
  await browser.close();
}

await P.finish();
