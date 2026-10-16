// A2 acceptance: crash-proof loop, effects clock, lifecycle saves, ending dialogue.
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("a2");
await P.goto("fresh");
await P.startRun("A2");

// --- frameCount rate in play (>= 58/s) ---
await sleep(600);
const playRate = await P.g(async () => { const g = window.game; const a = g.frameCount; await new Promise(r => setTimeout(r, 1000)); return g.frameCount - a; });
P.check("frameCount >= 58/s while playing", playRate >= 58, { playRate });

// --- pause screen: <= 22/s, zero shake on entry ---
await P.g(() => window.game.screenShake(14));
await P.page.keyboard.press("Escape");
await sleep(100);
const pauseInfo = await P.g(async () => { const g = window.game; const a = g.frameCount; const tr = g.trauma; await new Promise(r => setTimeout(r, 1000)); return { rate: g.frameCount - a, trauma: tr, mode: g.mode, bodyMode: document.body.dataset.mode, active: document.querySelector("#screenPaused").classList.contains("is-active") }; });
P.check("frameCount <= 22/s on pause screen", pauseInfo.rate <= 22 && pauseInfo.rate >= 10, pauseInfo);
P.check("setMode('paused') zeroes trauma; body[data-mode] + .is-active set", pauseInfo.trauma === 0 && pauseInfo.bodyMode === "paused" && pauseInfo.active, pauseInfo);
await P.shot("paused");
await P.page.keyboard.press("Escape");
await sleep(200);

// --- screenShake maps to trauma (C-8) ---
const tr = await P.g(() => { const g = window.game; g.trauma = 0; g.screenShake(14); return g.trauma; });
P.check("screenShake(14) -> trauma === 1", Math.abs(tr - 1) < 1e-9, { trauma: tr });

// --- visibilitychange hidden: rafId null + save write within 100 ms ---
const vis = await P.g(async () => {
  const g = window.game;
  const writes = [];
  const orig = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => { writes.push(performance.now()); return orig(k, v); };
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  const t0 = performance.now();
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise(r => setTimeout(r, 100));
  const res = { rafId: g.rafId, mode: g.mode, writeMs: writes.length ? Math.round(writes[0] - t0) : null, pauseReason: g.pauseReason };
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
  localStorage.setItem = orig;
  await new Promise(r => setTimeout(r, 200));
  res.rafAfter = g.rafId;
  return res;
});
P.check("hidden -> rafId===null, paused, save within 100 ms; visible re-arms", vis.rafId === null && vis.mode === "paused" && vis.writeMs !== null && vis.writeMs <= 100 && vis.rafAfter !== null, vis);
await P.page.keyboard.press("Escape");
await sleep(200);

// --- game over: still frame (two captures 1.5 s apart identical) ---
await P.g(() => { window.game.player.hp = 5; });
await P.page.waitForFunction(() => window.game.mode === "gameOver", null, { timeout: 60000 });
await sleep(400);
const cap1 = await P.g(() => window.game.canvas.toDataURL());
await sleep(1500);
const cap2 = await P.g(() => window.game.canvas.toDataURL());
P.check("gameOver canvas pixel-identical 1.5 s apart", cap1 === cap2, { len: cap1.length, same: cap1 === cap2 });
await P.shot("game-over");

// --- Try Again after death: clean transient state ---
await P.page.click("#btnTryAgain");
const fresh = await P.g(() => { const g = window.game; return { shake: g.shake, trauma: g.trauma, bossIntro: g.bossIntro, flash: g.flash, damagePulse: g.damagePulse, mode: g.mode }; });
P.check("Try Again starts with shake===0 && bossIntro===null", fresh.shake === 0 && fresh.bossIntro === null && fresh.trauma === 0, fresh);

// --- victory path (harness shape) ---
await P.g(() => { const g = window.game; g.startNewRun(); g.startLevel(9, true); });
await sleep(500);
await P.forceBoss();
await sleep(2800);
await P.autoType(240, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
await P.page.waitForFunction(() => window.game.mode === "victory", null, { timeout: 30000 }).catch(() => {});
await sleep(500);
const v1 = await P.g(() => ({ mode: window.game.mode, score: window.game.stats.score, highScore: window.game.save.highScore, stage: document.getElementById("endingStage").textContent, newRunVisible: !document.getElementById("btnNewRun").classList.contains("hidden") }));
P.check("victory reached, dialogue shows TRANSMISSION 1/n, high score banked", v1.mode === "victory" && /TRANSMISSION 1\//.test(v1.stage) && v1.highScore === v1.score && v1.score > 0, v1);
await P.shot("victory");
const next = P.page.locator("#btnEndingNext");
let clicks = 0;
while (clicks < 40 && await next.isVisible().catch(() => false)) { await next.click(); clicks++; await sleep(30); }
const v2 = await P.g(() => ({ newRunVisible: !document.getElementById("btnNewRun").classList.contains("hidden"), credits: !document.getElementById("creditsLine").classList.contains("hidden"), stage: document.getElementById("endingStage").textContent }));
P.check("#btnNewRun visible after advancing the dialogue", v2.newRunVisible && v2.credits, { clicks, ...v2 });
await P.shot("victory-end");
await P.page.click("#btnBackToMenu3");
await sleep(300);
const blob = await P.saveBlob();
P.check("save blob highScore === victory score, run null", blob && blob.highScore === v1.score && blob.run === null, { highScore: blob && blob.highScore, score: v1.score, run: blob && blob.run });
P.check("zero pageErrors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
