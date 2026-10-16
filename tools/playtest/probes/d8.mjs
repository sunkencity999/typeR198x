// D8 acceptance: attract mode (PLAN D8 / VIS-11 / PERF-10, amendment C-15).
// Usage: node probes/d8.mjs [--dpr 2]
//   - fresh save: attract.active on the menu, canvas changes, save blob byte-identical over 15 s, no real enemies,
//     frameCount >= 58/s while fresh and <= 22/s after attract.idleT > 90, no ships/*.png before the first key,
//     silent (sfx.lastCue unchanged) and stat-free, ship radio swap + flash, Start / pause-quit round trip
//   - reduce-motion context: wordmark / #pressStart animation none, attract still active, parallax .3x, trauma 0
//   - fixtures legacy-midwave (Continue) and legacy-postvictory (sector 10 tile) still enter play
import { openProbe, sleep, FIXTURES, LS_KEY } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d8-dpr" + argDpr, { dpr: argDpr });
const page = P.page;
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), t: Date.now() }));

const waitOverlayHidden = (pg) => pg.waitForFunction(() => {
  const el = document.getElementById("loadingOverlay");
  return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden";
}, null, { timeout: 120000 });
const waitAttract = (pg, ms = 8000) => pg.waitForFunction(() => !!(window.game && window.game.attract && window.game.attract.active), null, { timeout: ms }).then(() => true).catch(() => false);
const framesPerSec = (pg, ms = 2000) => pg.evaluate((ms) => new Promise((resolve) => {
  const g = window.game; const f0 = g.frameCount; const t0 = performance.now();
  let raf = 0; const tick = () => { raf++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else { const s = (performance.now() - t0) / 1000; resolve({ frames: Math.round((g.frameCount - f0) / s), raf: Math.round(raf / s) }); } };
  requestAnimationFrame(tick);
}), ms);

// ---------------------------------------------------------------- fresh save: the attract on the menu
await P.goto("fresh");
const active = await waitAttract(page);
const st0 = await P.g(() => { const g = window.game, a = g.attract; return { mode: g.mode, active: a.active, ghosts: a.ghosts.length, hooks: window.Game && Game.ATTRACT_HOOKS, warp: g.parallaxWarp, shipId: g.player.shipId, selected: g.getSelectedShipId(), heat: g.player.heat, x: g.player.x, y: g.player.y }; });
P.check("on the menu attract.active === true once the art is ready (ghosts seeded)", active && st0.mode === "menu" && st0.active === true && st0.ghosts >= 1, st0);
P.check("the cruising ship is the selected ship at (160, 360) with heat >= .4 and parallaxWarp .6", st0.shipId === st0.selected && st0.x === 160 && st0.y === 360 && st0.heat >= 0.4 - 1e-6 && Math.abs(st0.warp - 0.6) < 1e-9, st0);
await P.shot("menu-attract-start");

const snapA = await P.g(() => document.getElementById("game").toDataURL("image/png").length + ":" + (() => { const c = document.getElementById("game"); const g = c.getContext("2d"); const d = g.getImageData(0, Math.round(c.height * 0.3), c.width, 4).data; let h = 0; for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; })());
await sleep(500);
const snapB = await P.g(() => document.getElementById("game").toDataURL("image/png").length + ":" + (() => { const c = document.getElementById("game"); const g = c.getContext("2d"); const d = g.getImageData(0, Math.round(c.height * 0.3), c.width, 4).data; let h = 0; for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; })());
P.check("two canvas snapshots 500 ms apart differ", snapA !== snapB, { snapA, snapB });

// 15 s of attract: save blob, stats, cues, enemies, typist activity, frame rate
const blob0 = await P.g((k) => localStorage.getItem(k), LS_KEY);
const stats0 = await P.g(() => JSON.stringify({ s: window.game.stats, l: window.game.levelStats, run: window.game.save.run, hs: window.game.save.highScore, cue: window.game.sfx.lastCue }));
const fps0 = await framesPerSec(page, 2000);
let enemiesSeen = 0, ghostsMax = 0, bulletsSeen = 0, modeOk = true;
const t15 = Date.now();
while (Date.now() - t15 < 15000) {
  const s = await P.g(() => { const g = window.game; return { mode: g.mode, enemies: g.enemies.length, ghosts: g.attract.ghosts.length, bullets: g.bullets.length }; });
  enemiesSeen = Math.max(enemiesSeen, s.enemies); ghostsMax = Math.max(ghostsMax, s.ghosts); bulletsSeen = Math.max(bulletsSeen, s.bullets);
  if (s.mode !== "menu") modeOk = false;
  await sleep(250);
}
const blob1 = await P.g((k) => localStorage.getItem(k), LS_KEY);
const stats1 = await P.g(() => JSON.stringify({ s: window.game.stats, l: window.game.levelStats, run: window.game.save.run, hs: window.game.save.highScore, cue: window.game.sfx.lastCue }));
const act = await P.g(() => { const g = window.game, a = g.attract; return { kills: a.kills, keys: a.keys, t: Math.round(a.t * 10) / 10, idleT: Math.round(a.idleT), ghosts: a.ghosts.length, trauma: g.trauma, explosions: g.explosions.length, particles: g.particles.length }; });
await P.shot("menu-attract-15s");
P.check("fresh save: localStorage unchanged over 15 s of attract (no blob is ever created)", blob0 === blob1, { len0: blob0 && blob0.length, len1: blob1 && blob1.length });
P.check("stats / levelStats / save.run / highScore / sfx.lastCue untouched by the attract", stats0 === stats1, { before: stats0.slice(0, 160), after: stats1.slice(0, 160) });
P.check("game.enemies.length === 0 on the menu while ghosts (<= 4) live only in attract.ghosts", enemiesSeen === 0 && modeOk && ghostsMax >= 1 && ghostsMax <= 4, { enemiesSeen, ghostsMax, modeOk });
P.check("the ghost typist fires (bullets seen) and kills ghosts within 15 s", bulletsSeen > 0 && act.kills >= 1 && act.keys >= 4, { bulletsSeen, ...act });
P.check("frameCount >= 58/s on the fresh menu (rAF ~60)", fps0.frames >= 58, fps0);

// PERF-10: idle drift to 20 fps (simulated by setting idleT), then any input wakes it
await P.g(() => { window.game.attract.idleT = 91; });
await sleep(300);
const fpsIdle = await framesPerSec(page, 2000);
P.check("frameCount <= 22/s after attract.idleT > 90 while rAF keeps running", fpsIdle.frames <= 22 && fpsIdle.frames >= 15 && fpsIdle.raf >= 50, fpsIdle);
await page.mouse.move(400, 400);
await page.mouse.move(420, 410);
await sleep(200);
const woke = await P.g(() => ({ idleT: window.game.attract.idleT, active: window.game.attract.active }));
const fpsWake = await framesPerSec(page, 1500);
P.check("pointer input resets idleT and the menu is back at full rate", woke.idleT < 5 && fpsWake.frames >= 58, { ...woke, ...fpsWake });

// ship radio change: sprite swap + .2 s white flash
await page.click(".shipCard:has(input[value='sofrito'])");
await sleep(40);
const swap = await P.g(() => { const g = window.game, a = g.attract; return { shipId: g.player.shipId, swapFlash: a.swapFlash, hitT: g.player.hitT, active: a.active, selected: g.save.selectedShip }; });
await P.shot("menu-ship-swap");
P.check("ship radio change swaps the cruising sprite (sofrito) with a .2 s white flash", swap.shipId === "sofrito" && swap.selected === "sofrito" && swap.swapFlash > 0 && swap.hitT > 0 && swap.active, swap);
await page.click(".shipCard:has(input[value='coconut'])");

// first keystroke: still on the menu (Escape is harmless), then the request log must not show a ships/*.png
await page.keyboard.press("Escape");
const firstKeyAt = Date.now();
const shipPng = requests.filter((r) => r.t <= firstKeyAt && /assets\/ships\/.*\.png/i.test(r.url)).map((r) => r.url);
P.check("no assets/ships/*.png request before the first keystroke", shipPng.length === 0, shipPng.length ? shipPng : `${requests.length} requests, none for the PNG masters`);

// Start still works: the attract stops, lists are cleared, the run starts clean
await P.startRun("D8");
await sleep(200);
const started = await P.g(() => { const g = window.game, a = g.attract; return { mode: g.mode, active: a.active, ghosts: a.ghosts.length, enemies: g.enemies.length, levelIndex: g.levelIndex, x: g.player.x, y: g.player.y, score: g.stats.score, total: g.stats.total, hooks: Game.ATTRACT_HOOKS }; });
P.check("Start: mode playing, attract inactive, ghosts cleared, stats at zero", started.mode === "playing" && started.active === false && started.ghosts === 0 && started.score === 0 && started.total === 0 && started.x === 160 && started.y === 360, started);
await page.waitForFunction(() => window.game.enemies.length > 0, null, { timeout: 8000 }).catch(() => {});
const warpPlay = await P.g(() => ({ enemies: window.game.enemies.length, warp: window.game.parallaxWarp, levelIntro: !!window.game.levelIntro }));
P.check("real enemies spawn after the sector card and parallaxWarp is back under tickPresentation", warpPlay.enemies > 0 && warpPlay.warp >= 1, warpPlay);

// pause -> quit to menu: the attract restarts (16-menu-after)
await page.keyboard.press("Escape");
await sleep(300);
await page.click("#btnPauseQuit");
await sleep(200);
const back = await waitAttract(page, 5000);
const after = await P.g(() => { const g = window.game, a = g.attract; return { mode: g.mode, active: a.active, ghosts: a.ghosts.length, enemies: g.enemies.length, run: !!g.save.run }; });
await sleep(1200);
await P.shot("menu-after-quit");
P.check("Quit to menu: attract.active again with ghosts, no real enemies", back && after.mode === "menu" && after.active && after.ghosts >= 1 && after.enemies === 0, after);

// Re-read briefing (story modal) and Reset Save (confirm) still work on the attract menu
await page.click("#btnBriefing");
await sleep(450);
const story = await page.locator("#storyModal").isVisible().catch(() => false);
await page.keyboard.press("Escape");
await sleep(450);
const storyClosed = !(await page.locator("#storyModal").isVisible().catch(() => false)) || await P.g(() => getComputedStyle(document.getElementById("storyModal")).visibility === "hidden" || document.getElementById("storyModal").classList.contains("is-dismissed"));
P.check("story modal opens from Re-read briefing and closes on Escape with the attract running", story && storyClosed && (await P.g(() => window.game.attract.active)), { story, storyClosed });
await page.click("#btnResetSave");
await sleep(450);
const confirmVisible = await page.locator("#btnConfirmOk").isVisible().catch(() => false);
if (confirmVisible) await page.click("#btnConfirmOk");
await sleep(400);
const reset = await P.g(() => ({ run: window.game.save.run, high: window.game.save.highScore, active: window.game.attract.active, mode: window.game.mode }));
P.check("Reset Save confirms and erases with the attract still running", confirmVisible && reset.run === null && reset.high === 0 && reset.active && reset.mode === "menu", { confirmVisible, ...reset });

// ---------------------------------------------------------------- reduce-motion context
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr, reducedMotion: "reduce" });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => P.errors.pageErrors.push("[reduce-motion] " + String(e && e.stack || e)));
  await ctx.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, LS_KEY);
  await pg.goto(P.base, { waitUntil: "load" });
  await waitOverlayHidden(pg);
  const rmActive = await waitAttract(pg);
  await sleep(3000);
  const rm = await pg.evaluate(() => {
    const g = window.game, a = g.attract;
    return { reduce: g.reduceMotion, rootClass: document.documentElement.classList.contains("reduce-motion"), active: a.active, ghosts: a.ghosts.length, warp: g.parallaxWarp, trauma: g.trauma,
      wordmark: getComputedStyle(document.querySelector(".wordmark")).animationName, press: getComputedStyle(document.getElementById("pressStart")).animationName, kills: a.kills, keys: a.keys };
  });
  const rmSnapA = await pg.evaluate(() => document.getElementById("game").toDataURL("image/png").length);
  await sleep(500);
  const rmSnapB = await pg.evaluate(() => document.getElementById("game").toDataURL("image/png").length);
  await pg.screenshot({ path: P.out + "/rm-menu.png" });
  P.check("reduce-motion: .wordmark and #pressStart animationName none, attract.active still true", rmActive && rm.reduce && rm.rootClass && rm.active && rm.wordmark === "none" && rm.press === "none", rm);
  P.check("reduce-motion: parallax .3x, trauma stays 0, the attract still animates (snapshots differ)", Math.abs(rm.warp - 0.3) < 1e-9 && rm.trauma === 0 && rmSnapA !== rmSnapB, { ...rm, rmSnapA, rmSnapB });
  await ctx.close();
}

// ---------------------------------------------------------------- fixtures: Continue and the sector tile still enter play
for (const [name, enter] of [["legacy-midwave", "continue"], ["legacy-postvictory", "sector10"]]) {
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: argDpr });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => P.errors.pageErrors.push(`[${name}] ` + String(e && e.stack || e)));
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, FIXTURES[name]]);
  await pg.goto(P.base, { waitUntil: "load" });
  await waitOverlayHidden(pg);
  const menuActive = await waitAttract(pg);
  const fxBlob0 = await pg.evaluate((k) => localStorage.getItem(k), LS_KEY);
  await sleep(name === "legacy-midwave" ? 15000 : 800);
  const fxBlob1 = await pg.evaluate((k) => localStorage.getItem(k), LS_KEY);
  if (name === "legacy-midwave") P.check("legacy-midwave: the saved blob is byte-identical after 15 s of attract on the menu", fxBlob0 === fxBlob1 && typeof fxBlob0 === "string" && fxBlob0.length > 50, { len0: fxBlob0 && fxBlob0.length, len1: fxBlob1 && fxBlob1.length });
  await pg.screenshot({ path: `${P.out}/fixture-${name}-menu.png` });
  if (enter === "continue") await pg.click("#btnContinue");
  else await pg.click('.sectorCard[data-level="10"]');
  const okBtn = pg.locator("#btnConfirmOk");
  try { await okBtn.waitFor({ state: "visible", timeout: 1200 }); await okBtn.click(); } catch {}
  const playing = await pg.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 20000 }).then(() => true).catch(() => false);
  const fx = await pg.evaluate(() => { const g = window.game, a = g.attract; return { mode: g.mode, levelIndex: g.levelIndex, active: a && a.active, ghosts: a ? a.ghosts.length : -1, shipId: g.player.shipId, score: g.stats.score }; });
  const wantLevel = name === "legacy-midwave" ? 2 : 9;
  P.check(`${name}: attract on the menu, then ${enter} enters play at levelIndex ${wantLevel} with the attract stopped`, menuActive && playing && fx.mode === "playing" && fx.levelIndex === wantLevel && fx.active === false && fx.ghosts === 0, fx);
  await ctx.close();
}

await P.finish();
