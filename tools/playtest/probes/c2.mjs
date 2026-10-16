// C2 acceptance: playfield fit at the named viewports, top bar by mode, fullscreen combo, immersive landscape,
// rotate hint, icon-only controls at phone width.
// Usage: cd tools/playtest && node probes/c2.mjs
import { devices } from "playwright";
import { openProbe, sleep } from "./_lib.mjs";

const P = await openProbe("c2", { viewport: { width: 1366, height: 768 } });
const overlayGone = (page) => page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });

async function open(opts, label) {
  const ctx = await P.browser.newContext(opts);
  await ctx.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, "typesmup198x.save.v1");
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(P.base, { waitUntil: "load" });
  await overlayGone(page);
  return { ctx, page, errs, label };
}
async function startRun(page) {
  await page.fill("#playerName", "C2").catch(() => {});
  await page.click("#btnStart", { force: true });
  const story = page.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
  await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
}
const rect = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, sel);
const shotTo = async (page, name) => { const f = `${P.out}/${name}.png`; await page.screenshot({ path: f }); return f; };

// --- 1366x768: playfield + chrome fit, no page scroll after 3 s of play --------------------------------
{
  const { ctx, page, errs } = await open({ viewport: { width: 1366, height: 768 } });
  const menuMain = await rect(page, "#main");
  const scrollMenu = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, y: scrollY }));
  P.check("1366x768 menu: #main bottom <= 768 and no page scrollbar", menuMain.bottom <= 768 && scrollMenu.sh <= scrollMenu.ih + 1, JSON.stringify({ bottom: Math.round(menuMain.bottom), ...scrollMenu }));
  const dots = await page.evaluate(() => Array.from(document.querySelectorAll("#topBar .topControls button")).filter((b) => getComputedStyle(b).display !== "none").map((b) => ({ id: b.id, label: b.querySelector(".btnLabel")?.textContent, dot: !!b.querySelector(".dot") })));
  P.check("menu top bar: Sound, CRT, Fullscreen, Settings (three with dots)", dots.map((d) => d.id).join(",") === "btnMute,btnCRT,btnFullscreen,btnSettings" && dots.filter((d) => d.dot).length === 3, JSON.stringify(dots));
  await shotTo(page, "1366-menu");
  await startRun(page);
  await sleep(3000);
  const m = await rect(page, "#main");
  const st = await rect(page, "#btnStop");
  const sc = await page.evaluate(() => ({ y: scrollY, sh: document.documentElement.scrollHeight, ih: innerHeight }));
  P.check("1366x768 play: #main bottom <= 768, #btnStop in view, scrollY 0 after 3 s", m.bottom <= 768 && st && st.bottom <= 768 && st.top >= 0 && sc.y === 0, JSON.stringify({ bottom: Math.round(m.bottom), stop: st && Math.round(st.bottom), ...sc }));
  const playBar = await page.evaluate(() => Array.from(document.querySelectorAll("#topBar .topControls button")).filter((b) => getComputedStyle(b).display !== "none").map((b) => b.id));
  P.check("play top bar: Sound, CRT, Fullscreen, Pause, Save & quit", playBar.join(",") === "btnMute,btnCRT,btnFullscreen,btnPause,btnStop", playBar.join(","));
  // Alt+Enter -> toggleFullscreen (headless cannot enter fullscreen; the call is counted and must not throw)
  const calls0 = await page.evaluate(() => window.game.fullscreenCalls | 0);
  await page.keyboard.press("Alt+Enter");
  await sleep(150);
  const calls1 = await page.evaluate(() => window.game.fullscreenCalls | 0);
  P.check("Alt+Enter calls toggleFullscreen without errors", calls1 === calls0 + 1 && errs.length === 0, JSON.stringify({ calls0, calls1, errs }));
  await page.keyboard.press("F11");
  await sleep(100);
  P.check("F11 calls toggleFullscreen", (await page.evaluate(() => window.game.fullscreenCalls | 0)) === calls1 + 1);
  P.check("#btnFullscreen visible when supported, aria-pressed false", await page.evaluate(() => { const b = document.getElementById("btnFullscreen"); return document.fullscreenEnabled ? (!b.classList.contains("hidden") && b.getAttribute("aria-pressed") === "false") : b.classList.contains("hidden"); }));
  await shotTo(page, "1366-play");
  P.check("1366x768: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- 1280x720: no vertical scrollbar on menu or play; Start inside the viewport -----------------------
{
  const { ctx, page, errs } = await open({ viewport: { width: 1280, height: 720 } });
  const menu = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, start: document.getElementById("btnStart").getBoundingClientRect().bottom }));
  P.check("1280x720 menu: no page scrollbar, Start within the viewport", menu.sh <= menu.ih + 1 && menu.start <= 720 && menu.start > 0, JSON.stringify(menu));
  await shotTo(page, "1280-menu");
  await startRun(page);
  await sleep(1500);
  const play = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, main: document.getElementById("main").getBoundingClientRect().bottom }));
  P.check("1280x720 play: no page scrollbar, #main inside", play.sh <= play.ih + 1 && play.main <= 720, JSON.stringify(play));
  await page.keyboard.press("Escape");
  await sleep(400);
  const pauseFit = await page.evaluate(() => { const m = document.getElementById("main").getBoundingClientRect(); const ids = ["pauseSector", "btnResume", "btnPauseQuit", "settingsPanel", "btnPauseHelp"]; return ids.map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, inside: r.top >= m.top - 1 && r.bottom <= m.bottom + 1 && r.left >= m.left - 1 && r.right <= m.right + 1 }; }); });
  P.check("1280x720 paused: tiles, actions, settings and help line inside #main", pauseFit.every((x) => x.inside), JSON.stringify(pauseFit));
  await shotTo(page, "1280-paused");
  P.check("1280x720: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- 1024x768: HUD overlaid inside #main, <= 64 px tall ------------------------------------------------
{
  const { ctx, page, errs } = await open({ viewport: { width: 1024, height: 768 } });
  await startRun(page);
  await sleep(1500);
  const m = await rect(page, "#main");
  const h = await rect(page, "#hud");
  P.check("1024x768: #hud top inside #main and height <= 64", h.top >= m.top && h.top < m.top + 40 && h.h <= 64, JSON.stringify({ mainTop: Math.round(m.top), hudTop: Math.round(h.top), hudH: Math.round(h.h) }));
  await shotTo(page, "1024-play");
  P.check("1024x768: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- 844x390 (phone landscape, coarse pointer): immersive layout ---------------------------------------
{
  const land = { ...devices["iPhone 13 landscape"], viewport: { width: 844, height: 390 } };
  const { ctx, page, errs } = await open(land);
  await startRun(page);
  await sleep(1500);
  const im = await page.evaluate(() => ({
    topBar: getComputedStyle(document.getElementById("topBar")).display,
    footer: getComputedStyle(document.querySelector(".footer")).display,
    mainH: document.getElementById("main").getBoundingClientRect().height,
    hudPause: (() => { const b = document.getElementById("hudPause"); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && !b.hasAttribute("hidden"); })(),
    hudPauseSize: (() => { const r = document.getElementById("hudPause").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    labelPx: parseFloat(getComputedStyle(document.querySelector(".hudCell .label")).fontSize),
    valuePx: parseFloat(getComputedStyle(document.querySelector(".hudCell .mono")).fontSize)
  }));
  P.check("844x390: #topBar display none, footer hidden, #main height >= 380, #hudPause visible", im.topBar === "none" && im.footer === "none" && im.mainH >= 380 && im.hudPause, JSON.stringify(im));
  P.check("844x390: HUD text >= 10 CSS px", im.labelPx >= 10 && im.valuePx >= 10, JSON.stringify({ labelPx: im.labelPx, valuePx: im.valuePx }));
  await shotTo(page, "844x390-play");
  await page.keyboard.press("Escape");
  await sleep(300);
  P.check("844x390: Escape pauses", await page.evaluate(() => window.game.mode === "paused"));
  await shotTo(page, "844x390-paused");
  await page.keyboard.press("Escape");
  await sleep(200);
  await page.locator("#hudPause").tap({ force: true }).catch(() => page.click("#hudPause", { force: true }).catch(() => {}));
  await sleep(300);
  P.check("844x390: #hudPause tap pauses", await page.evaluate(() => window.game.mode === "paused"), await page.evaluate(() => window.game.mode));
  P.check("844x390: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- iPhone 13 portrait: Start inside the menu panel, no horizontal overflow, rotate hint, 44 px controls --
{
  const { ctx, page, errs } = await open({ ...devices["iPhone 13"] });
  const pr = await page.evaluate(() => {
    const menu = document.getElementById("screenMenu").getBoundingClientRect();
    const start = document.getElementById("btnStart").getBoundingClientRect();
    const hint = document.getElementById("rotateHint");
    const hs = getComputedStyle(hint);
    const controls = Array.from(document.querySelectorAll("#topBar .topControls button")).filter((b) => getComputedStyle(b).display !== "none").map((b) => {
      const r = b.getBoundingClientRect(); const l = b.querySelector(".btnLabel"); const lr = l ? l.getBoundingClientRect() : null;
      return { id: b.id, w: Math.round(r.width), h: Math.round(r.height), labelW: lr ? Math.round(lr.width) : 0, labelText: l ? l.textContent : "", title: b.getAttribute("title") || "" };
    });
    return {
      startInside: start.top >= menu.top && start.bottom <= menu.bottom && start.left >= menu.left && start.right <= menu.right,
      scrollWidth: document.documentElement.scrollWidth, innerWidth,
      hintVisible: !hint.classList.contains("hidden") && hs.display !== "none" && hint.getBoundingClientRect().height > 0,
      coarse: matchMedia("(pointer: coarse)").matches, portrait: matchMedia("(orientation: portrait)").matches,
      touchMode: window.game.touchMode, pressStartTap: getComputedStyle(document.querySelector(".pressStart__tap")).display,
      controls
    };
  });
  P.check("iPhone 13 portrait: #btnStart inside #screenMenu, scrollWidth <= innerWidth", pr.startInside && pr.scrollWidth <= pr.innerWidth, JSON.stringify({ startInside: pr.startInside, scrollWidth: pr.scrollWidth, innerWidth: pr.innerWidth }));
  P.check("iPhone 13 portrait: #rotateHint visible (coarse + portrait)", pr.hintVisible, JSON.stringify({ hintVisible: pr.hintVisible, coarse: pr.coarse, portrait: pr.portrait }));
  P.check("iPhone 13 portrait: touchMode true, 'Tap start' shown", pr.touchMode === true && pr.pressStartTap !== "none", JSON.stringify({ touchMode: pr.touchMode, pressStartTap: pr.pressStartTap }));
  P.check("390 px: each top control >= 44 px wide/tall with a visually hidden label", pr.controls.length >= 4 && pr.controls.every((c) => c.w >= 44 && c.h >= 44 && c.labelW <= 1 && c.labelText.length > 0), JSON.stringify(pr.controls));
  await shotTo(page, "iphone13-menu");
  // dismiss persists for the session
  await page.locator("#rotateHint .rotateHintClose").tap({ force: true }).catch(() => page.click("#rotateHint .rotateHintClose", { force: true }));
  await sleep(100);
  const dismissed = await page.evaluate(() => ({ hidden: document.getElementById("rotateHint").classList.contains("hidden"), key: sessionStorage.getItem("typer.rotateHintDismissed") }));
  P.check("rotate hint: dismiss hides it and writes sessionStorage typer.rotateHintDismissed", dismissed.hidden && dismissed.key === "1", JSON.stringify(dismissed));
  await page.reload({ waitUntil: "load" });
  await overlayGone(page);
  P.check("rotate hint stays dismissed after reload (same session)", await page.evaluate(() => document.getElementById("rotateHint").classList.contains("hidden")));
  await startRun(page);
  await sleep(1200);
  const pm = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, main: document.getElementById("main").getBoundingClientRect().width }));
  P.check("iPhone 13 portrait play: no horizontal overflow", pm.sw <= pm.iw, JSON.stringify(pm));
  await shotTo(page, "iphone13-play");
  P.check("iPhone 13 portrait: no page errors", errs.length === 0, errs.join("; "));
  await ctx.close();
}

// --- soft keyboard: --vvh + body.kb-open follow visualViewport (simulated) -------------------------------
{
  const { ctx, page } = await open({ ...devices["iPhone 13"] });
  const vv = await page.evaluate(() => ({ has: !!window.visualViewport, vvh: getComputedStyle(document.documentElement).getPropertyValue("--vvh").trim(), kb: document.body.classList.contains("kb-open") }));
  P.check("visualViewport: --vvh written, kb-open false with no keyboard", vv.has ? (vv.vvh.endsWith("px") && !vv.kb) : true, JSON.stringify(vv));
  await ctx.close();
}

await P.finish();
