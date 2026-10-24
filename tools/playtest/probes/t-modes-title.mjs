// t-modes-title (MODES, D9 title entry + mode results screen): deck placement and Tab order, layouts at 1440x900 /
// 1280x720 / 390x844 / 844x390 (touch targets), the menu save blob untouched while the deck renders, results-card keys
// (350 ms settle, Enter, Esc, Tab trap), reduced motion, the results-card slots other probes rely on, no tutorial toast
// in a drill, campaign chrome restored after a mode run. PASS = the feature works.
// Usage: node tools/playtest/probes/t-modes-title.mjs
import { openProbe, sleep, LS_KEY, harnessFlags, F5, startMode, waitMode, waitFor, card, checkErrors } from "./modes_lib.mjs";

const P = await openProbe("t-modes-title");
const { page } = P;
await P.goto(F5());
await sleep(400);

// T8 slots at boot (before any mode run)
const t8 = await P.g(() => ({ badge: !!document.querySelector("#resultsMode .rankBadge"), sub: !!document.querySelector("#resultsMode .resultsSub"), hidden: document.getElementById("screenModeResults").classList.contains("hidden"),
  tiles: document.querySelectorAll("#resultsMode .statTile__value[data-stat]").length }));
P.check("T8 #resultsMode has .rankBadge and .resultsSub (ui-screens writes them), six data-stat tiles, #screenModeResults carries no .hidden at boot", t8.badge && t8.sub && !t8.hidden && t8.tiles === 6, t8);

// T1 placement
const t1 = await P.g(() => {
  const deck = document.getElementById("modeDeck"), start = document.getElementById("btnStart"), sel = document.getElementById("sectorSelect");
  const r = (el) => el.getBoundingClientRect();
  const order = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { inLeft: !!deck.closest(".menuCol--left"), afterStart: order(start, deck) && r(deck).top >= r(start).bottom, beforeGrid: order(deck, sel) && r(deck).bottom <= r(sel).top,
    types: [...deck.querySelectorAll("button")].map((b) => b.type), ids: [...deck.querySelectorAll("button")].map((b) => b.id), h: Math.round(r(deck).height) };
});
P.check("T1 #modeDeck inside .menuCol--left, after #btnStart and before #sectorSelect (DOM and layout); three type=button tiles (Daily, Drill, Endless)",
  t1.inLeft && t1.afterStart && t1.beforeGrid && t1.types.join() === "button,button,button" && t1.ids.join() === "btnDaily,btnDrill,btnEndless", t1);

// T2 Tab order
await page.focus("#btnStart");
const tabs = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Tab");
  tabs.push(await P.g(() => { const a = document.activeElement; return a.id || (a.classList.contains("sectorCard") ? "sector" + a.dataset.level : a.tagName); }));
}
P.check("T2 Tab from #btnStart: #btnDaily -> #btnDrill -> #btnEndless -> the sector grid's tab stop", tabs.slice(0, 3).join() === "btnDaily,btnDrill,btnEndless" && /^sector\d+$/.test(tabs[3]), tabs);

// T3 desktop layouts
const layout = async () => P.g(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const deck = r("modeDeck"), menu = r("screenMenu"), grid = r("sectorGrid");
  const m = document.getElementById("screenMenu");
  const cards = [...document.querySelectorAll("#sectorGrid .sectorCard")];
  return { deckIn: deck.top >= 0 && deck.bottom <= innerHeight && deck.left >= menu.left && deck.right <= menu.right && deck.top >= menu.top && deck.bottom <= menu.bottom,
    gridIn: grid.left >= menu.left && grid.right <= menu.right && grid.bottom <= menu.top + m.scrollHeight + 1, rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    cols: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size, sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth,
    deckH: Math.round(deck.height), deckBottom: Math.round(deck.bottom) };
});
const t3 = {};
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(400);
  t3[`${w}x${h}`] = await layout();
}
await page.setViewportSize({ width: 1440, height: 900 });
P.check("T3 1440x900 and 1280x720: deck inside the viewport and #screenMenu; sector grid 5 x 2 inside #screenMenu; no page scroll either way",
  Object.values(t3).every((l) => l.deckIn && l.gridIn && l.rows === 2 && l.cols === 5 && l.sh <= l.ih && l.sw <= l.iw), t3);

// T4 phones (touch)
const t4 = {};
for (const [w, h] of [[390, 844], [844, 390]]) {
  const ctx = await P.browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await harnessFlags(ctx);
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }, [LS_KEY, F5()]);
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => P.errors.pageErrors.push(String(e)));
  pg.on("console", (m) => { if (m.type() === "error") P.errors.consoleErrors.push(m.text()); });
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await sleep(400);
  t4[`${w}x${h}`] = await pg.evaluate(() => ({
    sizes: [...document.querySelectorAll("#modeDeck button")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
    sw: document.documentElement.scrollWidth, iw: innerWidth, menuSw: document.getElementById("screenMenu").scrollWidth, menuCw: document.getElementById("screenMenu").clientWidth
  }));
  await pg.screenshot({ path: `${P.out}/t4-menu-${w}x${h}.png` });
  await ctx.close();
}
P.check("T4 390x844 and 844x390 (touch): every deck button >= 44 x 44, no horizontal overflow (page or menu panel)",
  Object.values(t4).every((l) => l.sizes.length === 3 && l.sizes.every(([bw, bh]) => bw >= 44 && bh >= 44) && l.sw <= l.iw && l.menuSw <= l.menuCw + 1), t4);

// T5 menu blob byte-identical for 10 s with the deck rendered
await P.g(() => window.game.refreshMenu());
const blob0 = await P.g((k) => localStorage.getItem(k), LS_KEY);
await sleep(10000);
await P.g(() => window.game.refreshMenu());
const blob1 = await P.g((k) => localStorage.getItem(k), LS_KEY);
P.check("T5 F5 menu: the save blob is byte-identical over 10 s while the deck renders (refreshMenu twice)", blob0 === blob1 && typeof blob0 === "string", { len0: blob0 && blob0.length, len1: blob1 && blob1.length });

// T6 card keys
await page.click("#btnDrill");
await waitFor(P, () => window.game.mode === "playing" && !window.game.levelIntro, 10000);
await P.g(() => window.game.modesDebug().finish("time"));
await waitMode(P, "modeResults", 2500);
await page.keyboard.press("Enter");
const early = await P.g(() => ({ mode: window.game.mode, dt: Math.round(nowMs() - window.game._modeAt) }));
await sleep(450);
const tabTrap = [];
for (let i = 0; i < 10; i++) {
  await page.keyboard.press("Tab");
  tabTrap.push(await P.g(() => { const a = document.activeElement; return { id: a.id || a.tagName, ok: !!(a.closest("#screenModeResults") || a.closest("#topBar") || a.closest(".footer")) }; }));
}
await P.g(() => document.getElementById("btnModeAgain").focus());
await page.keyboard.press("Enter");
const again = await waitFor(P, () => window.game.mode === "playing" && window.game.runMode() === "drill", 3000);
await waitFor(P, () => !window.game.levelIntro, 8000);
await P.g(() => window.game.modesDebug().finish("time"));
await waitMode(P, "modeResults", 2500);
await sleep(450);
await page.keyboard.press("Escape");
const esc = await waitMode(P, "menu", 2000);
P.check("T6 results keys: Enter inside 350 ms ignored; Tab stays in #screenModeResults + the top bar (+ the footer links, as on every screen); Enter on Drill again -> playing (drill); Esc on the card -> menu",
  early.mode === "modeResults" && early.dt < 350 && tabTrap.every((t) => t.ok) && tabTrap.some((t) => t.id === "btnModeMenu") && again && esc, { early, tabTrap: tabTrap.map((t) => t.id), again, esc });

// T7 reduced motion: final values on the first frame after setMode
await P.g(() => window.game.setSetting("reduceMotion", true));
await startMode(P, "endless");
await P.g(() => { const g = window.game; g.stats.score = 1234; g.levelStats.maxCombo = 17; });
const t7 = await P.g(() => new Promise((resolve) => {
  const g = window.game;
  g.modesDebug().finish("leak");
  const wait = () => {
    if (g.mode !== "modeResults") { requestAnimationFrame(wait); return; }
    const vals = [...document.querySelectorAll("#resultsMode .statTile__value")].map((e) => e.textContent);
    resolve({ vals, counting: document.querySelectorAll("#resultsMode .is-counting").length, r: { score: g._modes.result.score, combo: g._modes.result.maxCombo, ceiling: g._modes.result.ceiling } });
  };
  wait();
}));
await P.g(() => window.game.setSetting("reduceMotion", null));
P.check("T7 reduced motion: on the first frame of the card every tile shows its final value (score 1,234, combo x17, ceiling), nothing counting",
  t7.counting === 0 && t7.vals[4] === "1,234" && t7.vals[5] === "x17" && t7.vals[1] === String(t7.r.ceiling), t7);
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 2000);

// T9 no tutorial toast in a drill. A U1 save unlocked by tutorialSeen.lock (spec fixture) and one unlocked by
// onboardingDone with no tip seen yet (the lock tip would fire in sector 1); control: the campaign sector 1 shows it.
const U1 = (extra) => ({ playerName: "TUT", lastUnlockedLevel: 1, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: true }, highScores: [], sectorBests: {}, run: null, ...extra });
await P.goto(U1({ tutorialSeen: { lock: true } }));
await sleep(300);
const unlockedA = await P.g(() => window.game.modesUnlocked() && document.getElementById("btnDrill").getAttribute("aria-disabled") === "false");
await P.goto(U1({ onboardingDone: 1, tutorialSeen: {} }));
await sleep(300);
const unlockedB = await P.g(() => window.game.modesUnlocked());
await page.click("#btnDrill");
await waitFor(P, () => window.game.mode === "playing", 8000);
const watchTut = async (ms) => { let seen = false; for (let t = 0; t < ms; t += 200) { if (await P.g(() => !!document.querySelector('.toast[data-key="tut"]'))) seen = true; await sleep(200); } return seen; };
const toastDrill = await watchTut(5000);
const t9 = await P.g(() => ({ mode: window.game.runMode(), enabled: window.game.tutorialEnabled(), enemies: window.game.enemies.length }));
await P.g(() => { window.game.stopToMenu(false); window.game.startSector(0); });
const toastCampaign = await watchTut(6000);
P.check("T9 U1 saves unlocked (tutorialSeen.lock / onboardingDone); a 5 s drill with plates on screen shows no toast[data-key=tut] (tutorialEnabled false); control: campaign sector 1 shows the lock tip",
  unlockedA && unlockedB && !toastDrill && t9.mode === "drill" && t9.enabled === false && t9.enemies > 0 && toastCampaign, { unlockedA, unlockedB, toastDrill, t9, toastCampaign });
await P.g(() => window.game.stopToMenu(false));

// T10 campaign chrome restored after a drill
await P.goto(F5());
await sleep(300);
await startMode(P, "drill");
await P.g(() => window.game.stopToMenu(false));
await waitMode(P, "menu", 2000);
await P.startRun("T10");
await waitFor(P, () => !window.game.levelIntro, 8000);
const t10a = await P.g(() => {
  const d = (sel) => getComputedStyle(document.querySelector(sel)).display;
  return { label: document.getElementById("hudLevel").previousElementSibling.textContent, stop: document.querySelector("#btnStop .btnLabel").textContent, quit: document.getElementById("btnPauseQuit").textContent,
    runMode: document.body.dataset.runMode, mode: window.game.runMode(), cells: [d("#hudScore"), d("#hudMult"), d(".hudCell--hull"), d("#stageBar"), d(".stageSeg--boss")], hidden: document.querySelectorAll(".modesHidden").length,
    hud: document.getElementById("hudLevel").textContent };
});
await page.keyboard.press("Escape");
await waitMode(P, "paused", 2000);
const t10b = await P.g(() => ({ restart: document.getElementById("btnRestart").textContent, quit: document.getElementById("btnPauseQuit").textContent, eyebrow: document.getElementById("pauseEyebrow").textContent,
  labels: ["pauseSector", "pauseWave", "pauseScore"].map((id) => document.getElementById(id).previousElementSibling.textContent) }));
P.check("T10 drill -> menu -> Start campaign: HUD label Sector (1/10), #btnStop and #btnPauseQuit 'Save & quit', no body[data-run-mode], every HUD cell displayed; pause: Restart sector, Sector / Wave / Score labels, the sector eyebrow",
  t10a.label === "Sector" && t10a.stop === "Save & quit" && t10a.quit === "Save & quit" && t10a.runMode === undefined && t10a.mode === "campaign" && t10a.cells.every((c) => c !== "none") && t10a.hidden === 0 &&
  t10a.hud === "1/10" && t10b.restart === "Restart sector" && t10b.quit === "Save & quit" && t10b.labels.join() === "Sector,Wave,Score" && /^Paused \/\/ Sector 01/.test(t10b.eyebrow), { t10a, t10b });

checkErrors(P);
await P.finish();
