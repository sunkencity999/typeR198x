// C5 acceptance probe: title cabinet — sector grid states, startSector, resume card, Start confirm, records table,
// footer links, fieldset semantics, grid inside the panel at 1440x900 and on an iPhone 13 profile.
// Usage: cd tools/playtest && node probes/c5-menu.mjs
import { openProbe, sleep, LS_KEY } from "./_lib.mjs";
import { chromium, devices } from "playwright";

const P = await openProbe("c5");
const { page } = P;

// A save with four unlocked sectors, two bests, no run.
const SAVE = {
  schema: 2, playerName: "CABINET", selectedShip: "sofrito", highScore: 1234, lastUnlockedLevel: 4, storySeen: true, keyboardHintSeen: true,
  settings: { muted: true, crt: true }, highScores: [], run: null,
  sectorBests: { "1": { score: 5200, rank: "A", wpm: 40, acc: 96, maxCombo: 30, date: 1 }, "2": { score: 12340, rank: "B", wpm: 44, acc: 92, maxCombo: 22, date: 2 } }
};
await P.goto(SAVE);
await sleep(300);

const grid = await P.g(() => {
  const cards = [...document.querySelectorAll("#sectorGrid .sectorCard")];
  const menu = document.getElementById("screenMenu").getBoundingClientRect();
  const g = document.getElementById("sectorGrid").getBoundingClientRect();
  return {
    n: cards.length,
    enabled: cards.map((c) => !c.disabled && c.getAttribute("aria-disabled") !== "true"),
    classes: cards.map((c) => c.className),
    status: cards.map((c) => c.querySelector(".sectorStatus").textContent.trim()),
    accents: cards.map((c) => c.style.getPropertyValue("--sector-accent").trim()),
    tab0: cards.filter((c) => c.getAttribute("tabindex") === "0").map((c) => c.dataset.level),
    inside: g.left >= menu.left && g.right <= menu.right && g.top >= menu.top && g.bottom <= menu.bottom,
    rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    resumeHidden: document.getElementById("resumeCard").classList.contains("hidden"),
    start: document.getElementById("btnStart").textContent.trim(),
    fieldset: document.querySelector(".shipGrid").tagName, legend: !!document.querySelector(".shipGrid > legend"),
    footer: getComputedStyle(document.querySelector(".footer a")).color,
    statUnlocked: document.getElementById("statUnlocked").textContent.trim(),
    pressStart: getComputedStyle(document.getElementById("pressStart")).animationName,
    wordmark: getComputedStyle(document.querySelector(".wordmark")).animationName
  };
});
P.check("10 sector cards: 1-4 enabled, 5-10 aria-disabled", grid.n === 10 && grid.enabled.slice(0, 4).every(Boolean) && grid.enabled.slice(4).every((v) => !v), JSON.stringify(grid.enabled));
P.check("card 4 is-current (NEXT), cards 1-2 is-cleared with rank badges, card 3 CLEARED", /is-current/.test(grid.classes[3]) && grid.status[3] === "NEXT" && /is-cleared/.test(grid.classes[0]) && /is-cleared/.test(grid.classes[1]) && /^A/.test(grid.status[0]) && /12\.3k/.test(grid.status[1]) && grid.status[2] === "CLEARED", JSON.stringify(grid.status));
P.check("number accents follow THEME_ACCENT per level", grid.accents[0] === "var(--neon-cyan)" && grid.accents[1] === "var(--neon-amber)" && grid.accents[2] === "var(--neon-magenta)" && grid.accents[9] === "var(--neon-violet)", JSON.stringify(grid.accents));
P.check("roving tabindex: exactly one card tabbable (the current one)", grid.tab0.length === 1 && grid.tab0[0] === "4", JSON.stringify(grid.tab0));
P.check("grid is 5x2 inside the menu panel at 1440x900", grid.inside && grid.rows === 2, JSON.stringify({ inside: grid.inside, rows: grid.rows }));
P.check("no run -> resume card hidden, Start reads START NEW RUN", grid.resumeHidden && /START NEW RUN/i.test(grid.start), JSON.stringify({ resumeHidden: grid.resumeHidden, start: grid.start }));
P.check(".shipGrid is a FIELDSET with a LEGEND; .footer a is cyan", grid.fieldset === "FIELDSET" && grid.legend && grid.footer === "rgb(57, 245, 255)", JSON.stringify({ fieldset: grid.fieldset, legend: grid.legend, footer: grid.footer }));
P.check("stats row reads Sectors cleared 3/10", grid.statUnlocked === "3/10", grid.statUnlocked);
P.check("wordmark + press-start animate when motion is allowed", grid.pressStart !== "none" && grid.wordmark !== "none", JSON.stringify({ pressStart: grid.pressStart, wordmark: grid.wordmark }));
await P.shot("menu-1440");

// Arrow keys move focus across enabled tiles only.
await page.focus('.sectorCard[data-level="4"]');
await page.keyboard.press("ArrowLeft");
const f1 = await P.g(() => document.activeElement.dataset.level);
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
const f2 = await P.g(() => document.activeElement.dataset.level);
await page.keyboard.press("ArrowUp");
const f3 = await P.g(() => document.activeElement.dataset.level);
P.check("arrow keys: Left 4->3, Right stops at the last unlocked (4), Up from 4 stays (nothing above)", f1 === "3" && f2 === "4" && f3 === "4", JSON.stringify({ f1, f2, f3 }));

// Click card 2 -> playing at levelIndex 1 with run.startLevel 2 and sector-2 HP.
await page.click('.sectorCard[data-level="2"]');
await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 15000 });
const s2 = await P.g(() => ({ mode: window.game.mode, levelIndex: window.game.levelIndex, startLevel: window.game.run.startLevel, maxHp: window.game.player.maxHp, score: window.game.stats.score, cp: !!window.game.run.checkpoint }));
P.check("card 2 -> mode playing, levelIndex 1, run.startLevel 2, maxHp 300, score 0, checkpoint", s2.mode === "playing" && s2.levelIndex === 1 && s2.startLevel === 2 && s2.maxHp === 300 && s2.score === 0 && s2.cp, JSON.stringify(s2));

// startSector(9) run scoring 50k: headline unchanged, row in the table.
await P.g(() => {
  const g = window.game;
  g.stopToMenu(true);
  g.save.lastUnlockedLevel = 10;
  g.startSector(9);
  g.stats.score += 50000;
  g.saveRun(true);
  g.stopToMenu(true);
});
await sleep(300);
const hs = await P.g(() => {
  const g = window.game;
  g.openRecords();
  const rows = [...document.querySelectorAll("#highScoreTable tbody tr.hsRow")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim()));
  const open = !document.getElementById("recordsModal").classList.contains("is-dismissed");
  const focus = document.activeElement && document.activeElement.id;
  return { highScore: g.save.highScore, rows, open, focus, headers: [...document.querySelectorAll("#highScoreTable th")].map((t) => t.textContent.trim()) };
});
P.check("startSector(9) + 50k: save.highScore unchanged (1234)", hs.highScore === 1234, `highScore=${hs.highScore}`);
P.check("records modal opens with the 50k row tagged FROM S10 (sector/wpm/tag columns)", hs.open && hs.rows.some((r) => r[2] === "50,000" && r[3] === "10" && r[5] === "FROM S10") && hs.headers[5] === "Run", JSON.stringify(hs.rows));
await sleep(200);
P.check("records: #btnRecordsClose focused", hs.focus === "btnRecordsClose" || (await P.g(() => document.activeElement.id)) === "btnRecordsClose", String(hs.focus));
await P.shot("records");
await page.keyboard.press("Escape");
await sleep(200);
const afterClose = await P.g(() => ({ open: !document.getElementById("recordsModal").classList.contains("is-dismissed"), focus: document.activeElement && document.activeElement.id }));
P.check("Escape closes records and returns focus to #btnRecords", !afterClose.open && afterClose.focus === "btnRecords", JSON.stringify(afterClose));

// Game over -> menu: resume card with Replay/Resume Sector N, Start reads NEW RUN; Start opens the confirm, Cancel keeps the run.
await P.g(() => { window.game.startSector(0); });
await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 10000 });
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
await P.g(() => { window.game.player.hp = 5; });
await page.waitForFunction(() => window.game.mode === "gameOver", null, { timeout: 60000 }).catch(() => {});
await page.click("#btnBackToMenu2");
await sleep(400);
const rc = await P.g(() => ({
  mode: window.game.mode, hidden: document.getElementById("resumeCard").classList.contains("hidden"),
  cont: document.getElementById("btnContinue").textContent.trim(), start: document.getElementById("btnStart").textContent.trim(),
  state: document.getElementById("resumeCard").dataset.state, ship: document.getElementById("resumeShip").getAttribute("src") || "",
  stats: document.getElementById("resumeStats").textContent.trim(), saved: document.querySelector(".sectorCard.is-saved") && document.querySelector(".sectorCard.is-saved").dataset.level
}));
P.check("after game over: #resumeCard shows /Replay|Resume Sector \\d+/ and Start reads NEW RUN", rc.mode === "menu" && !rc.hidden && /^(Replay|Resume|Retry boss) Sector \d+$/.test(rc.cont) && rc.start === "NEW RUN", JSON.stringify(rc));
P.check("resume card: dead state, ship art from the manifest x1, checkpoint copy, saved tile marked", rc.state === "dead" && /ships\/sofrito/.test(rc.ship) && /Checkpoint/.test(rc.stats) && rc.saved === "1", JSON.stringify({ state: rc.state, ship: rc.ship, stats: rc.stats, saved: rc.saved }));
await P.shot("menu-resume");
await page.click("#btnStart");
await sleep(350);
const cf = await P.g(() => ({ visible: !document.getElementById("confirmModal").classList.contains("is-dismissed") && getComputedStyle(document.getElementById("confirmModal")).visibility !== "hidden", run: !!window.game.save.run, mode: window.game.mode, title: document.getElementById("confirmTitle").textContent }));
P.check("Start with a run opens #confirmModal and keeps save.run meanwhile", cf.visible && cf.run && cf.mode === "menu", JSON.stringify(cf));
await page.click("#btnConfirmCancel");
await sleep(250);
const cancel = await P.g(() => ({ run: !!window.game.save.run, mode: window.game.mode, visible: !document.getElementById("confirmModal").classList.contains("is-dismissed") }));
P.check("Cancel keeps save.run and stays on the menu", cancel.run && cancel.mode === "menu" && !cancel.visible, JSON.stringify(cancel));

// Enter on the menu with body focused resumes (card visible) -> playing.
await P.g(() => { document.activeElement && document.activeElement.blur(); });
await page.keyboard.press("Enter");
const entered = await page.waitForFunction(() => window.game.mode === "playing", null, { timeout: 10000 }).then(() => true).catch(() => false);
P.check("Enter on the menu (body focused) starts / resumes", entered, `playing=${entered}`);
await P.g(() => window.game.stopToMenu(true));
await sleep(200);

// Briefing re-read: read-only modal, Back closes, focus returns.
await page.click("#btnBriefing");
await sleep(300);
const br = await P.g(() => ({ open: !document.getElementById("storyModal").classList.contains("hidden") && !document.getElementById("storyModal").classList.contains("is-dismissed"), launchHidden: document.getElementById("btnStoryLaunch").classList.contains("hidden"), focus: document.activeElement.id }));
P.check("Re-read briefing opens the story read-only (Launch hidden, Back focused)", br.open && br.launchHidden && br.focus === "btnStoryBack", JSON.stringify(br));
await page.click("#btnStoryBack");
await sleep(250);
const br2 = await P.g(() => ({ closed: document.getElementById("storyModal").classList.contains("hidden") || document.getElementById("storyModal").classList.contains("is-dismissed"), launchHidden: document.getElementById("btnStoryLaunch").classList.contains("hidden"), focus: document.activeElement.id }));
P.check("Back closes the briefing, Launch restored, focus back on #btnBriefing", br2.closed && !br2.launchHidden && br2.focus === "btnBriefing", JSON.stringify(br2));

P.check("no page errors", P.errors.pageErrors.length === 0, JSON.stringify(P.errors.pageErrors));

// iPhone 13 profile: 5x2 grid inside the menu panel.
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, SAVE]);
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await sleep(400);
  const m = await pg.evaluate(() => {
    const menu = document.getElementById("screenMenu").getBoundingClientRect();
    const g = document.getElementById("sectorGrid").getBoundingClientRect();
    const cards = [...document.querySelectorAll("#sectorGrid .sectorCard")];
    return { inside: g.left >= menu.left - 0.5 && g.right <= menu.right + 0.5, rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size, cols: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left))).size, w: g.width };
  });
  const file = P.out + "/99-menu-iphone13.png";
  await pg.screenshot({ path: file, fullPage: false });
  P.check("iPhone 13: sector grid 5 columns x 2 rows inside the panel", m.inside && m.rows === 2 && m.cols === 5, JSON.stringify(m) + " " + file);
  await browser.close();
}

await P.finish();
