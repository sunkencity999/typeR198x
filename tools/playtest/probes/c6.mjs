// C6 acceptance: pause screen, settings panel (single node), volumes, mute, CRT, motion resolver, defaults for old saves.
// Usage: cd tools/playtest && node probes/c6.mjs
import { openProbe, sleep, FIXTURES } from "./_lib.mjs";

const P = await openProbe("c6");
const { page } = P;
const g = (fn, arg) => page.evaluate(fn, arg);
const overlayGone = (pg) => pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });

// --- old save: defaults merged ------------------------------------------------------------------------
await P.goto("legacy-midwave");
const legacy = await g(() => ({ ...window.game.save.settings }));
P.check("old save loads with musicVolume .7 / sfxVolume .8 / crtIntensity .75 / reduceMotion null (muted + crt kept)", legacy.musicVolume === 0.7 && legacy.sfxVolume === 0.8 && legacy.crtIntensity === 0.75 && legacy.reduceMotion === null && legacy.muted === true && legacy.crt === false, JSON.stringify(legacy));
P.check("old save: CRT off -> :root[data-crt=off], #btnCRT aria-pressed false, #btnMute aria-pressed false (muted)", await g(() => document.documentElement.dataset.crt === "off" && document.getElementById("btnCRT").getAttribute("aria-pressed") === "false" && document.getElementById("btnMute").getAttribute("aria-pressed") === "false"));

// --- menu: #btnSettings opens the modal with the single panel ------------------------------------------
await page.click("#btnSettings");
await sleep(120);
P.check("#btnSettings opens #settingsModal containing #settingsPanel", await g(() => { const m = document.getElementById("settingsModal"); return !m.classList.contains("is-dismissed") && !!m.querySelector("#settingsPanel") && document.getElementById("menuSettingsHost").contains(document.getElementById("settingsPanel")); }));
P.check("settings modal: focus inside, first slider focused", await g(() => document.getElementById("settingsModal").contains(document.activeElement)), await g(() => document.activeElement.id));
await P.shot("settings-modal");
// slider -> setting -> applySettings; debounced store (300 ms)
await page.locator("#setMusic").fill("20");
await page.locator("#setMusic").dispatchEvent("input");
await sleep(50);
const v1 = await g(() => ({ setting: window.game.save.settings.musicVolume, out: document.getElementById("setMusicOut").textContent, val: document.getElementById("setMusic").style.getPropertyValue("--val") }));
P.check("#setMusic 20 -> settings.musicVolume 0.2, output 20%, --val 20%", v1.setting === 0.2 && v1.out === "20%" && v1.val === "20%", JSON.stringify(v1));
const blobEarly = await P.saveBlob();
await sleep(400);
const blobLate = await P.saveBlob();
P.check("store is debounced: not written at 50 ms, written by 450 ms", blobEarly.settings.musicVolume !== 0.2 && blobLate.settings.musicVolume === 0.2, JSON.stringify({ early: blobEarly.settings.musicVolume, late: blobLate.settings.musicVolume }));
// motion select
await page.selectOption("#setMotion", "reduced");
await sleep(50);
P.check("#setMotion reduced -> settings.reduceMotion true + :root.reduce-motion + game.reduceMotion", await g(() => window.game.save.settings.reduceMotion === true && document.documentElement.classList.contains("reduce-motion") && window.game.reduceMotion === true));
await page.selectOption("#setMotion", "system");
await sleep(50);
P.check("#setMotion system -> reduceMotion null, class follows the OS (false here)", await g(() => window.game.save.settings.reduceMotion === null && !document.documentElement.classList.contains("reduce-motion")));
// CRT toggles
await page.locator("#setCRT").check();
await sleep(50);
P.check("#setCRT on -> data-crt on, #btnCRT pressed, intensity slider enabled", await g(() => document.documentElement.dataset.crt === "on" && document.getElementById("btnCRT").getAttribute("aria-pressed") === "true" && !document.getElementById("setCRTIntensity").disabled));
await page.locator("#setCRTIntensity").fill("50");
await page.locator("#setCRTIntensity").dispatchEvent("input");
await sleep(50);
P.check("#setCRTIntensity 50 -> crtIntensity .5 and --crt-k 0.5", await g(() => window.game.save.settings.crtIntensity === 0.5 && document.documentElement.style.getPropertyValue("--crt-k").trim() === "0.5" && document.getElementById("setCRTIntensityOut").textContent === "50%"));
// mute mirrors
await page.locator("#setMute").uncheck();
await sleep(50);
P.check("#setMute off -> #btnMute aria-pressed true", await g(() => window.game.save.settings.muted === false && document.getElementById("btnMute").getAttribute("aria-pressed") === "true"));
await page.keyboard.press("Escape");
await sleep(80);
P.check("Escape closes the settings modal and flushes the save", await g(() => document.getElementById("settingsModal").classList.contains("is-dismissed")) && (await P.saveBlob()).settings.crtIntensity === 0.5);
// 'm' toggles mute on the menu
await g(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("m");
await sleep(50);
P.check("'m' on the menu toggles mute", await g(() => window.game.save.settings.muted === true));
await page.keyboard.press("m");
await sleep(50);

// --- persistence across reload (clean context: the fixture init script would rewrite the blob on reload) ------
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 } }); // fresh storage, no init script
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await overlayGone(pg);
  await pg.evaluate(() => window.game.setSetting("musicVolume", 0.2));
  await sleep(450);
  await pg.reload({ waitUntil: "load" });
  await overlayGone(pg);
  const after = await pg.evaluate(() => ({ setting: window.game.save.settings.musicVolume, slider: Number(document.getElementById("setMusic").value), out: document.getElementById("setMusicOut").textContent }));
  P.check("musicVolume .2 persisted after reload (slider 20, output 20%)", after.setting === 0.2 && after.slider === 20 && after.out === "20%", JSON.stringify(after));
  await ctx.close();
}

// --- in play: music gain, pause screen, panel moves, restart confirm, quit -----------------------------
await P.clickContinue();
await sleep(1500);
await g(() => window.game.setSetting("musicVolume", 0.2));
await sleep(300);
const gain = await g(() => { const s = window.game.sfx; return { ctx: !!s.ctx, state: s.musicState, vol: s.musicVol, gain: s.musicGain ? s.musicGain.gain.value : null }; });
const expected = 0.8 * 0.2 * 0.2 * (gain.state === "boss" ? 0.55 : 1);
P.check("musicGain ~= 0.8 * 0.04 (within 5%) while playing", gain.ctx && gain.gain !== null && Math.abs(gain.gain - expected) <= expected * 0.05 + 1e-4, JSON.stringify({ ...gain, expected }));
// mute on then off: master back to its unmuted value, music element still playing (start unmuted)
await g(() => window.game.setSetting("muted", false));
await sleep(250);
const m0 = await g(() => window.game.sfx.master ? window.game.sfx.master.gain.value : null);
await page.click("#btnMute"); await sleep(250);
const mMuted = await g(() => window.game.sfx.master ? window.game.sfx.master.gain.value : null);
await page.click("#btnMute"); await sleep(250);
const m1 = await g(() => ({ master: window.game.sfx.master ? window.game.sfx.master.gain.value : null, music: window.game.sfx.music !== null, muted: window.game.save.settings.muted }));
P.check("mute on then off: master restored, music still playing (F053)", m0 !== null && mMuted < m0 * 0.1 && Math.abs(m1.master - m0) < 0.02 && m1.music === true && m1.muted === false, JSON.stringify({ m0, mMuted, ...m1 }));

await P.autoType(8, { accuracy: 0.99 });
await page.keyboard.press("Escape");
await sleep(400);
const pauseInfo = await g(() => ({
  panelInPause: document.getElementById("pauseSettingsHost").contains(document.getElementById("settingsPanel")),
  tiles: ["pauseSector", "pauseWave", "pauseScore", "pauseAcc"].map((id) => document.getElementById(id).textContent),
  eyebrow: document.getElementById("pauseEyebrow").textContent,
  reason: document.getElementById("pauseReason").textContent,
  inside: (() => { const m = document.getElementById("main").getBoundingClientRect(); return ["pauseSector", "pauseAcc", "btnResume", "btnRestart", "btnPauseQuit", "settingsPanel", "btnPauseHelp"].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.top >= m.top && r.bottom <= m.bottom && r.left >= m.left && r.right <= m.right; }); })(),
  blur: getComputedStyle(document.getElementById("screenPaused")).backdropFilter
}));
P.check("paused: #settingsPanel moved into #pauseSettingsHost (single node)", pauseInfo.panelInPause && (await g(() => document.querySelectorAll("#settingsPanel").length === 1)));
P.check("paused: four meta tiles filled (Sector/Wave/Score/Accuracy)", pauseInfo.tiles.every((t) => t && t !== "—"), JSON.stringify(pauseInfo.tiles));
P.check("paused: tiles, three actions, settings and help inside #main at 1440x900", pauseInfo.inside, JSON.stringify({ eyebrow: pauseInfo.eyebrow, reason: pauseInfo.reason }));
P.check("paused: scrim blur active under full motion", /blur/.test(pauseInfo.blur), pauseInfo.blur);
await P.shot("paused-1440");
// #setSfx change plays uiTick('tick')
await page.locator("#setSfx").fill("60");
await page.locator("#setSfx").dispatchEvent("input");
await page.locator("#setSfx").dispatchEvent("change");
await sleep(50);
P.check("#setSfx change -> sfxVolume .6 and uiTick('tick')", await g(() => window.game.save.settings.sfxVolume === 0.6 && window.game.sfx.lastCue === "uiTick:tick"), await g(() => window.game.sfx.lastCue));
// Restart with score > checkpoint opens the confirm
await page.click("#btnRestart");
await sleep(100);
const restartConfirm = await g(() => !document.getElementById("confirmModal").classList.contains("is-dismissed"));
P.check("#btnRestart with score > checkpoint opens #confirmModal", restartConfirm, await g(() => ({ score: window.game.stats.score, cp: window.game.run && window.game.run.checkpoint && window.game.run.checkpoint.score })));
await page.click("#btnConfirmCancel");
await sleep(80);
P.check("restart cancel: still paused", await g(() => window.game.mode === "paused"));
// 'm' toggles mute while paused
await g(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("m"); await sleep(50);
P.check("'m' while paused toggles mute", await g(() => window.game.save.settings.muted === true));
await page.keyboard.press("m"); await sleep(50);
// Pause music state
P.check("paused: music state 'pause' (uiTick pause fired)", await g(() => window.game.sfx.musicState === "pause"));
await page.click("#btnResume");
await sleep(200);
P.check("resume: music state restored to wave", await g(() => window.game.sfx.musicState === "wave" && window.game.mode === "playing"));
await page.keyboard.press("Escape");
await sleep(300);
await page.click("#btnPauseQuit");
await sleep(300);
P.check("#btnPauseQuit -> menu with save.run present (levelIndex kept)", await g(() => window.game.mode === "menu" && !!window.game.save.run && window.game.save.run.levelIndex === 2), await g(() => JSON.stringify({ mode: window.game.mode, li: window.game.save.run && window.game.save.run.levelIndex })));
P.check("#settingsPanel stays a single node after the round trip", await g(() => document.querySelectorAll("#settingsPanel").length === 1));

// --- 1366x768 pause screenshot fits inside #main -----------------------------------------------------
{
  const ctx = await P.browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await overlayGone(pg);
  await pg.fill("#playerName", "C6");
  await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  await pg.waitForFunction(() => window.game.mode === "playing", null, { timeout: 30000 });
  await sleep(1200);
  await pg.keyboard.press("Escape");
  await sleep(400);
  const fit = await pg.evaluate(() => { const m = document.getElementById("main").getBoundingClientRect(); return ["pauseSector", "pauseAcc", "btnResume", "btnRestart", "btnPauseQuit", "settingsPanel", "btnPauseHelp"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, inside: r.top >= m.top && r.bottom <= m.bottom && r.left >= m.left && r.right <= m.right }; }); });
  P.check("1366x768 paused: everything inside #main", fit.every((f) => f.inside), JSON.stringify(fit));
  await pg.screenshot({ path: `${P.out}/paused-1366.png` });
  await ctx.close();
}

// --- reduced motion: OS query, override, restore -------------------------------------------------------
{
  const ctx = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await overlayGone(pg);
  const rm0 = await pg.evaluate(() => ({ cls: document.documentElement.classList.contains("reduce-motion"), flag: window.game.reduceMotion, noise: getComputedStyle(document.getElementById("crtNoise")).animationName, blur: getComputedStyle(document.getElementById("screenPaused")).backdropFilter }));
  P.check("OS reduce + no setting: :root.reduce-motion, game.reduceMotion, #crtNoise animation none, pause blur off", rm0.cls && rm0.flag && rm0.noise === "none" && rm0.blur === "none", JSON.stringify(rm0));
  await pg.fill("#playerName", "RM");
  await pg.click("#btnStart");
  const story = pg.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  await pg.waitForFunction(() => window.game.mode === "playing", null, { timeout: 30000 });
  await sleep(500);
  const tr = await pg.evaluate(() => { const gm = window.game; gm.trauma = 0; gm.screenShake(14); return { trauma: gm.trauma, shake: gm.shake, motion: gm.motion() }; });
  P.check("reduce: trauma stays 0 after screenShake(14); motion() = {shake:0, flash:.3, anim:0}", tr.trauma === 0 && tr.shake === 0 && tr.motion.shake === 0 && tr.motion.flash === 0.3 && tr.motion.anim === 0, JSON.stringify(tr));
  await pg.evaluate(() => window.game.setSetting("reduceMotion", false));
  await sleep(50);
  const full = await pg.evaluate(() => { const gm = window.game; gm.trauma = 0; gm.screenShake(14); return { trauma: gm.trauma, cls: document.documentElement.classList.contains("reduce-motion"), setting: gm.save.settings.reduceMotion, select: document.getElementById("setMotion").value }; });
  P.check("'full' under OS reduce: shake > 0, class off, setting false, select 'full'", full.trauma > 0 && !full.cls && full.setting === false && full.select === "full", JSON.stringify(full));
  await sleep(400);
  const blob = await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), "typesmup198x.save.v1");
  P.check("blob stores reduceMotion false", blob && blob.settings.reduceMotion === false, JSON.stringify(blob && blob.settings));
  await pg.evaluate(() => window.game.setSetting("reduceMotion", null));
  await sleep(50);
  const sys = await pg.evaluate(() => { const gm = window.game; gm.trauma = 0; gm.screenShake(14); return { trauma: gm.trauma, cls: document.documentElement.classList.contains("reduce-motion"), setting: gm.save.settings.reduceMotion }; });
  P.check("'system' restores the OS behaviour (reduce)", sys.trauma === 0 && sys.cls && sys.setting === null, JSON.stringify(sys));
  await ctx.close();
}

await P.finish();
