// C1 acceptance: screen state machine, focus routing, announcer, modal system, screen design language.
// Usage: cd tools/playtest && node probes/c1.mjs
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("c1");
const { page } = P;
const g = (fn, arg) => page.evaluate(fn, arg);
const active = () => g(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
const frame = () => g(() => new Promise((r) => requestAnimationFrame(() => r())));

// --- menu, screen transitions, reset-save confirm, story modal -----------------------------------------
await P.goto(null);
P.check("menu: body[data-mode] and #screenMenu.is-active", await g(() => document.body.dataset.mode === "menu" && document.getElementById("screenMenu").classList.contains("is-active")), await g(() => document.body.dataset.mode));
P.check("menu: no screen carries .hidden", await g(() => document.querySelectorAll(".screen.hidden").length === 0));
P.check("#screenPaused transition includes opacity", (await g(() => getComputedStyle(document.getElementById("screenPaused")).transition)).includes("opacity"), await g(() => getComputedStyle(document.getElementById("screenPaused")).transition));

// Reset Save goes through confirm(): nothing changes until OK; Escape restores focus to the trigger.
await g(() => { const s = window.game.save; s.highScore = 777; storeSave(s); });
await page.focus("#btnResetSave");
await page.click("#btnResetSave");
await sleep(80);
const confirmVisible = await g(() => { const m = document.getElementById("confirmModal"); return !m.classList.contains("is-dismissed") && getComputedStyle(m).visibility !== "hidden"; });
P.check("reset save opens #confirmModal", confirmVisible);
P.check("confirm: focus lands on Cancel for a danger question", (await active()) === "btnConfirmCancel", await active());
P.check("confirm: #main is inert while open", await g(() => document.getElementById("main").hasAttribute("inert")));
let blob = await P.saveBlob();
P.check("reset save: blob unchanged before OK", blob && blob.highScore === 777, JSON.stringify({ highScore: blob && blob.highScore }));
await page.keyboard.press("Escape");
await sleep(60);
blob = await P.saveBlob();
P.check("confirm Escape: blob unchanged, modal closed", blob && blob.highScore === 777 && await g(() => document.getElementById("confirmModal").classList.contains("is-dismissed")));
P.check("confirm Escape: focus restored to #btnResetSave", (await active()) === "btnResetSave", await active());
P.check("confirm Escape: #main no longer inert", await g(() => !document.getElementById("main").hasAttribute("inert")));
await page.click("#btnResetSave");
await sleep(60);
await page.click("#btnConfirmOk");
await sleep(60);
blob = await P.saveBlob();
P.check("confirm OK: save reset (highScore 0)", blob && blob.highScore === 0, JSON.stringify({ highScore: blob && blob.highScore }));

// Story modal from Start: Tab stays inside, Escape destroys nothing, Back returns to the menu.
await g(() => { const gm = window.game; gm.save.run = buildResumeRun(2, getHpBonusForLevel(3), "coconut"); gm.save.run.stats.score = 1234; gm.save.storySeen = false; storeSave(gm.save); gm.refreshMenu(); });
await page.click("#btnStart");
await sleep(80);
P.check("start with a run opens the abandon confirm", await g(() => !document.getElementById("confirmModal").classList.contains("is-dismissed")));
await page.click("#btnConfirmCancel");
await sleep(60);
P.check("abandon cancel keeps save.run", await g(() => !!window.game.save.run && window.game.save.run.stats.score === 1234));
await page.click("#btnStart");
await sleep(60);
await page.click("#btnConfirmOk");
await sleep(120);
P.check("story modal shown after confirming", await g(() => !document.getElementById("storyModal").classList.contains("is-dismissed")));
await sleep(450); // the 350 ms fade settles before the shot (the harness's 03-story fires mid-fade)
await P.shot("story-modal");
P.check("story modal: scroll affordance state written on .modalScroll", await g(() => { const w = document.querySelector("#storyModal .modalScroll"); const b = w.querySelector(".modalBody"); const scrollable = b.scrollHeight > b.clientHeight + 2; return w.classList.contains("is-scrollable") === scrollable && (scrollable ? !w.classList.contains("at-bottom") : w.classList.contains("at-bottom")); }));
P.check("story modal: #main inert", await g(() => document.getElementById("main").hasAttribute("inert")));
let inside = true;
const seen = new Set();
for (let i = 0; i < 12; i++) {
  await page.keyboard.press("Tab");
  const ok = await g(() => document.getElementById("storyModal").contains(document.activeElement));
  seen.add(await active());
  if (!ok) inside = false;
}
P.check("12 Tabs stay inside #storyModal", inside, [...seen].join(","));
await page.keyboard.press("Escape");
await sleep(80);
P.check("story Escape: mode menu, save.run intact, modal dismissed", await g(() => window.game.mode === "menu" && !!window.game.save.run && window.game.save.run.stats.score === 1234 && document.getElementById("storyModal").classList.contains("is-dismissed")));
P.check("story Escape: #main not inert", await g(() => !document.getElementById("main").hasAttribute("inert")));
// Re-read briefing: Launch relabelled Close, Back hidden.
await page.click("#btnBriefing");
await sleep(80);
P.check("#btnBriefing reopens the story with Launch relabelled Close", await g(() => !document.getElementById("storyModal").classList.contains("is-dismissed") && document.getElementById("btnStoryLaunch").textContent.trim() === "Close" && document.getElementById("btnStoryBack").classList.contains("hidden")), await g(() => document.getElementById("btnStoryLaunch").textContent));
await page.click("#btnStoryLaunch");
await sleep(60);
P.check("briefing Close: still menu, storySeen untouched", await g(() => window.game.mode === "menu" && window.game.save.storySeen === false));
await P.shot("menu-after-modals");

// Enter on the menu with body focused starts (no run: the primary is Start -> story -> launch).
await g(() => { const gm = window.game; gm.save.run = null; storeSave(gm.save); gm.refreshMenu(); });
await g(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("Enter");
await sleep(120);
P.check("Enter on the menu opens the story (primary action)", await g(() => !document.getElementById("storyModal").classList.contains("is-dismissed")));
await page.keyboard.press("Enter"); // Launch is focused: native click starts the run
await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 15000 });
P.check("Launch: mode playing, storySeen true, run reset to sector 1", await g(() => window.game.mode === "playing" && window.game.save.storySeen === true && window.game.levelIndex === 0));
await sleep(300);
P.check("playing: canvas focused", (await active()) === "game", await active());
P.check("playing: every #topBar button tabindex -1", await g(() => Array.from(document.querySelectorAll("#topBar button")).every((b) => b.tabIndex === -1)));
P.check("playing: no screen is visible", await g(() => Array.from(document.querySelectorAll(".screen")).every((s) => getComputedStyle(s).opacity === "0" || getComputedStyle(s).visibility === "hidden")));
P.check("playing: #btnSettings hidden, Pause + Save&quit shown", await g(() => getComputedStyle(document.getElementById("btnSettings")).display === "none" && getComputedStyle(document.getElementById("btnPause")).display !== "none" && getComputedStyle(document.getElementById("btnStop")).display !== "none"));

// Mute from the top bar never keeps focus; a following Enter changes nothing.
const mutedBefore = await g(() => window.game.save.settings.muted);
await page.click("#btnMute");
await sleep(40);
P.check("#btnMute toggles aria-pressed and focus returns to the canvas", (await active()) === "game" && (await g(() => window.game.save.settings.muted)) !== mutedBefore, await active());
P.check("#btnMute label stays 'Sound' (written into .btnLabel)", await g(() => document.querySelector("#btnMute .btnLabel").textContent === "Sound" && !!document.querySelector("#btnMute .dot")));
const modeBefore = await g(() => window.game.mode);
await page.keyboard.press("Enter");
await sleep(40);
P.check("Enter after mute changes nothing", await g((m) => window.game.mode === m, modeBefore));
await page.click("#btnMute");

// Escape -> paused with #btnResume focused within one frame; announcer; Enter resumes with the canvas focused.
await page.keyboard.press("Escape");
await frame();
P.check("Escape in play: mode paused + #btnResume focused within a frame", (await active()) === "btnResume" && (await g(() => document.body.dataset.mode === "paused")), await active());
await sleep(80);
P.check("#srAnnounce contains 'Paused' within 100 ms", (await g(() => document.getElementById("srAnnounce").textContent)).includes("Paused"), await g(() => document.getElementById("srAnnounce").textContent));
P.check("#btnPause reads Resume + aria-pressed true", await g(() => document.querySelector("#btnPause .btnLabel").textContent === "Resume" && document.getElementById("btnPause").getAttribute("aria-pressed") === "true"));
P.check("paused: #pauseReason 'Paused'", await g(() => document.getElementById("pauseReason").textContent.trim() === "Paused"));
await sleep(260);
P.check("320 ms after pausing #screenPaused opacity is 1", await g(() => getComputedStyle(document.getElementById("screenPaused")).opacity === "1"));
await P.shot("paused");
await page.keyboard.press("Enter");
await frame();
P.check("Enter resumes with the canvas focused", (await active()) === "game" && (await g(() => window.game.mode === "playing")), await active());
await sleep(200);
P.check("resumed: #screenPaused faded out (160 ms)", await g(() => getComputedStyle(document.getElementById("screenPaused")).visibility === "hidden" && getComputedStyle(document.getElementById("screenPaused")).opacity === "0"), await g(() => getComputedStyle(document.getElementById("screenPaused")).opacity));

// Level complete: beat the sector-1 boss, then Enter advances.
await P.autoType(20, { until: (s) => s.enemies > 0 && s.levelT > 2 });
await P.forceBoss();
await P.autoType(120, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
await page.waitForFunction(() => window.game.mode === "levelComplete", null, { timeout: 25000 }).catch(() => {});
await frame();
P.check("levelComplete: #btnNextLevel focused", (await g(() => window.game.mode)) === "levelComplete" && (await active()) === "btnNextLevel", await active());
await sleep(80);
P.check("#srAnnounce contains 'cleared' after a clear", (await g(() => document.getElementById("srAnnounce").textContent)).includes("cleared"), await g(() => document.getElementById("srAnnounce").textContent));
P.check("levelComplete: amber accent on .screen--clear", await g(() => getComputedStyle(document.getElementById("screenLevelComplete")).getPropertyValue("--panel-accent").trim().length > 0 && getComputedStyle(document.getElementById("screenLevelComplete")).borderColor === "rgba(255, 193, 74, 0.55)"), await g(() => getComputedStyle(document.getElementById("screenLevelComplete")).borderColor));
await P.shot("level-complete");
const li0 = await g(() => window.game.levelIndex);
await sleep(400); // the results screen ignores a trusted Enter / Space for its first 350 ms (review R26)
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 10000 });
P.check("Enter on levelComplete advances levelIndex", (await g(() => window.game.levelIndex)) === li0 + 1, `${li0} -> ${await g(() => window.game.levelIndex)}`);

// Game over: focus, danger accent, freeze, Escape -> menu.
await sleep(2500);
await g(() => { const gm = window.game; gm.player.hp = 1; gm.player.shield = 0; gm.invulnT = 0; gm.takeDamage(50, "probe"); });
await page.waitForFunction(() => window.game.mode === "gameOver", null, { timeout: 10000 });
await frame();
P.check("gameOver: #btnTryAgain focused", (await active()) === "btnTryAgain", await active());
P.check("gameOver: danger border on .screen--over", await g(() => getComputedStyle(document.getElementById("screenGameOver")).borderColor === "rgba(255, 77, 109, 0.65)"), await g(() => getComputedStyle(document.getElementById("screenGameOver")).borderColor));
P.check("gameOver: #main.crtOff one-shot fired", await g(() => document.getElementById("main").classList.contains("crtOff")));
await sleep(750);
P.check("gameOver: #game.freeze 600 ms after death (desaturated filter)", await g(() => document.getElementById("game").classList.contains("freeze") && getComputedStyle(document.getElementById("game")).filter.includes("saturate")), await g(() => getComputedStyle(document.getElementById("game")).filter));
await P.shot("game-over");
await page.keyboard.press("Escape");
await sleep(200);
P.check("Escape on gameOver -> menu, freeze cleared", await g(() => window.game.mode === "menu" && !document.getElementById("game").classList.contains("freeze")));
P.check("menu after game over: primary (Continue) focused", ["btnContinue", "btnStart"].includes(await active()), await active());

// Victory screen accent (direct mode check; the harness all run covers the real path).
P.check("victory: violet border on .screen--victory", await g(() => getComputedStyle(document.getElementById("screenVictory")).borderColor === "rgba(184, 107, 255, 0.6)"), await g(() => getComputedStyle(document.getElementById("screenVictory")).borderColor));

// Primary buttons + link buttons.
P.check("#btnStart.primary min-height >= 52 and outlined cyan", await g(() => { const b = document.getElementById("btnStart"); const cs = getComputedStyle(b); return b.classList.contains("primary") && parseFloat(cs.minHeight) >= 52 && cs.borderTopColor === "rgb(57, 245, 255)"; }));
P.check("#btnResetSave is .btn-link.danger", await g(() => document.getElementById("btnResetSave").className.includes("btn-link") && document.getElementById("btnResetSave").classList.contains("danger")));
P.check(":focus-visible ring is cyan", await g(() => { for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if (r.selectorText === ":focus-visible") return /57,\s*245,\s*255|#39F5FF|--neon-cyan/i.test(r.style.outline || r.cssText); } catch (_) {} } return false; }));

// Reduced motion: opacity-only transitions, no transforms on staggered children.
const ctx2 = await P.browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const p2 = await ctx2.newPage();
await p2.goto(P.base, { waitUntil: "load" });
await p2.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 60000 });
await p2.evaluate(() => window.game.setMode("paused"));
await sleep(50);
const rm = await p2.evaluate(() => ({
  rootClass: document.documentElement.classList.contains("reduce-motion"),
  activeChildTransform: getComputedStyle(document.querySelector("#screenPaused .screenInner > *")).transform,
  inactiveChildTransform: getComputedStyle(document.querySelector("#screenMenu .screenInner > *")).transform,
  screenTransition: getComputedStyle(document.getElementById("screenPaused")).transition
}));
P.check("reduce-motion: .screenInner > * transform none in both states", rm.rootClass && rm.activeChildTransform === "none" && rm.inactiveChildTransform === "none", JSON.stringify(rm));
await ctx2.close();

await P.finish();
