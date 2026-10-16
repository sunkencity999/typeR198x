// UI shell probe: screenshots every screen at several viewports and runs the CSS/markup acceptance checks
// that need no gameplay (CONTRACT sections 2/3, PLAN C1/C2/C3/C4/C5/C6/C8/C9/D9 markup lines).
// Usage: node probes/ui-screens.mjs --root ../.. --out ./out/ui-probe [--viewports 1440x900,390x844]
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Minimal PNG reader (8-bit RGB/RGBA, non-interlaced) so CRT on/off pixels can be compared without a dependency.
function decodePng(buf) {
  let off = 8, w = 0, h = 0, colorType = 6; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride); const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += Math.floor((a + b) / 2);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  const lum = (x, y) => { const i = (y * w + x) * bpp; return 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]; };
  const avg = (x0, y0, n) => { let s = 0; for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) s += lum(x, y); return s / (n * n); };
  return { w, h, lum, avg };
}

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
const ROOT = path.resolve(args.root || "../..");
const OUT = path.resolve(args.out || "./out/ui-probe");
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2" };

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const VIEWPORTS = (args.viewports || "1440x900,1366x768,1280x720,1024x768,390x844,844x390").split(",").map((v) => {
  const [w, h] = v.split("x").map(Number);
  return { name: v, w, h };
});
const SCREENS = ["menu", "paused", "levelComplete", "gameOver", "victory"];
const SCREEN_ID = { menu: "screenMenu", paused: "screenPaused", levelComplete: "screenLevelComplete", gameOver: "screenGameOver", victory: "screenVictory" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { checks: [], shots: [], errors: [] };
const check = (name, ok, evidence) => { results.checks.push({ name, ok: !!ok, evidence }); };

const { server, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });

// Show a screen the way the C1 state machine will (body[data-mode] + .is-active); legacy .hidden is cleared.
async function showScreen(page, mode) {
  await page.evaluate(({ mode, ids }) => {
    document.body.dataset.mode = mode;
    for (const [m, id] of Object.entries(ids)) {
      const el = document.getElementById(id);
      el.classList.remove("hidden");
      el.classList.toggle("is-active", m === mode);
    }
    // Representative copy so the layout is realistic
    const t = (id, s) => { const el = document.getElementById(id); if (el) el.textContent = s; };
    t("levelCompleteText", "Next: Sector 2 — VECTOR OGRE · Max HP 300");
    t("gameOverText", "Sector 2 · wave 2/3");
    t("victoryText", "You beat all 10 levels! Score: 184,220 · Accuracy: 96%");
    t("pauseSector", "03"); t("pauseWave", "2/3"); t("pauseScore", "42,180"); t("pauseAcc", "96%");
    t("endingLine", "The TypeGrid hums back to life. Every lane you cleared is a sentence the city can read again.");
    t("endingProgress", "1 / 23");
    const sp = document.getElementById("endingSpeaker"); if (sp) { sp.textContent = "TYPEGRID"; sp.classList.remove("hidden"); }
    document.querySelectorAll(".resultsCard").forEach((card) => {
      const badge = card.querySelector(".rankBadge"); badge.dataset.rank = "A"; badge.textContent = "A";
      const vals = { wpm: "62", acc: "96%", maxCombo: "x41", words: "38", time: "1:24", bonus: "+4,250", score: "42,180" };
      card.querySelectorAll("[data-stat]").forEach((el) => { el.textContent = vals[el.dataset.stat] || "0"; });
      card.querySelector(".resultsSub").textContent = "Sector 1 · THE S.S. SOFRITO";
      if (card.id === "resultsLevel") {
        // Level Complete list as renderResultsCard builds it (review R2): the rows under the Bonus tile add up to it
        // (+ the retry penalty line), then a caption and the three rows banked live during the sector.
        const row = (l, v, mod) => `<li class="bonusRow${mod ? ` ${mod}` : ""}"><span class="bonusLabel">${l}</span><span class="bonusValue mono">${v}</span></li>`;
        card.querySelector(".bonusList").innerHTML =
          row("Clear", "+2,450") + row("Time", "+900") + row("Accuracy", "+400") + row("Flawless boss", "+500") + row("Retry penalty", "x0.75", "bonusRow--penalty") +
          `<li class="bonusCaption">Banked during the sector</li>` +
          row("Perfect waves", "+250", "bonusRow--banked") + row("Boss phases", "+600", "bonusRow--banked") + row("Surges countered", "+0", "bonusRow--banked");
        card.querySelector(".newBest").classList.remove("hidden");
      }
    });
    document.getElementById("resultsRun").classList.toggle("hidden", mode !== "victory");
    if (mode === "victory") document.getElementById("resultsRun").classList.remove("hidden");
    window.scrollTo(0, 0);
  }, { mode, ids: SCREEN_ID });
  await sleep(450);
}

async function showHud(page, { boss = false } = {}) {
  await page.evaluate(({ boss, ids }) => {
    document.body.dataset.mode = "playing";
    for (const id of Object.values(ids)) document.getElementById(id).classList.remove("is-active");
    const t = (id, s) => { const el = document.getElementById(id); if (el) el.textContent = s; };
    t("hudName", "HARNESS"); t("hudLevel", "3/10"); t("hudScore", "42,180"); t("hudCombo", "27"); t("hudAcc", "96%"); t("hudWpm", "64"); t("hudHP", "212");
    document.getElementById("hudMult").dataset.tier = "3"; t("hudMult", "x3");
    document.getElementById("hud").dataset.hp = "warn";
    document.getElementById("hudHPFill").style.transform = "scaleX(0.48)";
    document.getElementById("hudHPGhost").style.transform = "scaleX(0.6)";
    document.querySelectorAll(".stageSeg .stageFill").forEach((f, i) => { f.style.setProperty("--p", i === 0 ? 1 : i === 1 ? 0.55 : 0); });
    document.querySelector(".stageSeg").classList.add("isDone");
    document.getElementById("hudChips").innerHTML =
      `<div class="chip" data-type="shield" style="--p:.72;--accent:var(--neon-violet)"><i class="chipIcon"></i><span class="chipLabel">SHIELD</span><span class="chipTime mono">6.5</span></div>` +
      `<div class="chip expiring" data-type="multi" style="--p:.15;--accent:var(--neon-amber)"><i class="chipIcon"></i><span class="chipLabel">MULTI</span><span class="chipTime mono">1.8</span></div>`;
    const bar = document.getElementById("bossBar");
    bar.classList.toggle("hidden", !boss);
    if (boss) { t("bossName", "PLASMA SHOGUN"); t("bossPhase", "PHASE 2/3"); t("bossSegment", "SEG 7/12"); document.getElementById("bossMeter").style.setProperty("--segments", "12"); document.getElementById("bossMeter").dataset.state = "p2"; document.getElementById("bossFill").style.transform = "scaleX(0.46)"; }
    const toast = document.createElement("div"); toast.className = "toast toast--tip"; toast.textContent = "TYPE THE FIRST LETTER OF A TARGET TO LOCK ON";
    document.getElementById("toastStack").replaceChildren(toast);
  }, { boss, ids: SCREEN_ID });
  await sleep(300);
}

async function showModal(page, id) {
  await page.evaluate((id) => {
    document.querySelectorAll(".modalOverlay").forEach((m) => { m.classList.add("is-dismissed"); });
    const m = document.getElementById(id); m.classList.remove("hidden"); m.classList.remove("is-dismissed");
    const scroll = m.querySelector(".modalScroll"); const body = m.querySelector(".modalBody");
    if (scroll && body) { scroll.classList.toggle("is-scrollable", body.scrollHeight > body.clientHeight + 2); scroll.classList.remove("at-bottom"); }
  }, id);
  await sleep(400);
}

async function hideModals(page) {
  await page.evaluate(() => document.querySelectorAll(".modalOverlay").forEach((m) => m.classList.add("is-dismissed")));
}

async function shot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  results.shots.push(file);
  return file;
}

const rect = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height }; }, sel);
const css = (page, sel, prop) => page.evaluate(([s, p]) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] || getComputedStyle(el).getPropertyValue(p) : null; }, [sel, prop]);

try {
  for (const vp of VIEWPORTS) {
    const isPhonePortrait = vp.name === "390x844";
    const isPhoneLandscape = vp.name === "844x390";
    const ctxOpts = isPhonePortrait ? { ...devices["iPhone 13"] }
      : isPhoneLandscape ? { ...devices["iPhone 13 landscape"], viewport: { width: 844, height: 390 } }
      : { viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 };
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });
    const dir = path.join(OUT, vp.name);
    fs.mkdirSync(dir, { recursive: true });
    await page.goto(base, { waitUntil: "load" });
    await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 }).catch(() => results.errors.push(`${vp.name}: loading overlay never hid`));
    await sleep(300);

    // Legacy regime (current JS): menu visible via .hidden toggles
    await shot(page, dir, "00-menu-legacy");
    const win = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, scrollY }));
    const mainR = await rect(page, "#main");
    check(`${vp.name} #main bottom <= innerHeight`, mainR.bottom <= win.ih + 0.5, `bottom=${mainR.bottom.toFixed(1)} ih=${win.ih}`);
    check(`${vp.name} no horizontal overflow`, win.sw <= win.iw, `scrollWidth=${win.sw} innerWidth=${win.iw}`);
    if (!isPhonePortrait) check(`${vp.name} no vertical page scrollbar`, win.sh <= win.ih + 1, `scrollHeight=${win.sh} innerHeight=${win.ih}`);
    const startR = await rect(page, "#btnStart");
    const menuR = await rect(page, "#screenMenu");
    check(`${vp.name} #btnStart inside #screenMenu box`, startR && menuR && startR.top >= menuR.top - 0.5 && startR.bottom <= menuR.bottom + 0.5 && startR.left >= menuR.left - 0.5 && startR.right <= menuR.right + 0.5, JSON.stringify({ start: startR, menu: menuR }));
    if (!isPhonePortrait) check(`${vp.name} #btnStart inside viewport`, startR && startR.bottom <= win.ih && startR.top >= 0, `start.bottom=${startR && startR.bottom}`);

    if (vp.name === "1024x768") {
      const hudR = await rect(page, "#hud");
      check("1024x768 #hud inside #main and height <= 64", hudR.top >= mainR.top && hudR.height <= 64, JSON.stringify(hudR));
    }
    if (isPhoneLandscape) {
      check("844x390 #topBar display none", (await css(page, "#topBar", "display")) === "none", await css(page, "#topBar", "display"));
      check("844x390 #main height >= 380", mainR.height >= 380, `height=${mainR.height}`);
      check("844x390 #hudPause displayed", (await css(page, "#hudPause", "display")) !== "none", await css(page, "#hudPause", "display"));
    }
    if (vp.name === "390x844") {
      await page.evaluate(() => document.getElementById("rotateHint").classList.remove("hidden"));
      check("390x844 #rotateHint displays once un-hidden (coarse + portrait)", (await css(page, "#rotateHint", "display")) === "flex", await css(page, "#rotateHint", "display"));
      const tc = await page.evaluate(() => [...document.querySelectorAll(".topControls .btn-arcade")].map((b) => ({ id: b.id, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, label: b.querySelector(".btnLabel") ? b.querySelector(".btnLabel").offsetWidth : -1 })));
      check("390 px top controls >= 44 px wide", tc.every((b) => b.w >= 44 && b.h >= 44), JSON.stringify(tc));
    }

    // New regime: data-mode + is-active per screen
    for (const mode of SCREENS) {
      await showScreen(page, mode);
      await shot(page, dir, `${SCREENS.indexOf(mode) + 1}0-${mode}`);
      if (mode === "paused") {
        check(`${vp.name} paused opacity 1 after 320 ms`, (await css(page, "#screenPaused", "opacity")) === "1", await css(page, "#screenPaused", "opacity"));
        const inner = await page.evaluate(() => { const el = document.querySelector("#screenPaused .screenInner"); const r = el.getBoundingClientRect(); const m = document.getElementById("main").getBoundingClientRect(); return { innerH: r.height, mainH: m.height, scroll: document.getElementById("screenPaused").scrollHeight, client: document.getElementById("screenPaused").clientHeight }; });
        check(`${vp.name} pause panel fits (or scrolls inside the screen)`, inner.scroll <= inner.client + 1 || isPhonePortrait || isPhoneLandscape, JSON.stringify(inner));
      }
    }

    // HUD during play and boss
    await showHud(page);
    await shot(page, dir, "60-hud-play");
    const toastR = await rect(page, "#toastStack .toast"); const hudR2 = await rect(page, "#hud"); const mainR2 = await rect(page, "#main");
    check(`${vp.name} toast below HUD and above the bottom`, toastR && toastR.top > hudR2.bottom + 40 && toastR.bottom < mainR2.bottom - 20, JSON.stringify({ toastR, hudBottom: hudR2.bottom, mainBottom: mainR2.bottom }));
    await showHud(page, { boss: true });
    await shot(page, dir, "61-hud-boss");

    // Modals
    await page.evaluate(() => { document.body.dataset.mode = "menu"; document.getElementById("screenMenu").classList.add("is-active"); });
    await showModal(page, "storyModal"); await shot(page, dir, "70-story");
    const storyFit = await page.evaluate(() => { const b = document.querySelector("#storyModal .modalBody"); return { scroll: b.scrollHeight, client: b.clientHeight }; });
    if (vp.name === "1440x900") check("1440x900 story body shows last paragraph without scrolling", storyFit.scroll <= storyFit.client + 1, JSON.stringify(storyFit));
    await showModal(page, "helpModal"); await shot(page, dir, "71-help");
    await showModal(page, "confirmModal");
    await page.evaluate(() => { document.getElementById("confirmTitle").textContent = "Erase everything?"; document.getElementById("confirmBody").textContent = "High score 42,180 · 3/10 sectors unlocked · saved run in Sector 3. This cannot be undone."; document.getElementById("btnConfirmOk").textContent = "Erase everything"; document.getElementById("btnConfirmOk").classList.add("danger"); });
    await shot(page, dir, "72-confirm");
    await showModal(page, "recordsModal"); await shot(page, dir, "73-records");
    await showModal(page, "settingsModal");
    await page.evaluate(() => document.getElementById("menuSettingsHost").appendChild(document.getElementById("settingsPanel")));
    await shot(page, dir, "74-settings-modal");
    await hideModals(page);

    // Loading overlay look (re-show it)
    await page.evaluate(() => { const o = document.getElementById("loadingOverlay"); o.classList.remove("hidden"); document.getElementById("loadingBar").setAttribute("aria-valuenow", "40"); document.getElementById("loadingBarFill").style.width = "40%"; document.getElementById("loadingLabel").textContent = "Spooling hyperspace lanes… 3 / 7"; document.getElementById("loadingDetail").textContent = "sector 1 skyline"; });
    await sleep(200);
    await shot(page, dir, "80-loading");
    await page.evaluate(() => { document.getElementById("loadingOverlay").classList.add("hidden"); });

    if (pageErrors.length) results.errors.push(`${vp.name}: ${pageErrors.join(" | ")}`);
    await context.close();
  }

  // Static / DOM checks at the default viewport
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return el.classList.contains("hidden"); }, null, { timeout: 60000 }).catch(() => {});
  const dom = await page.evaluate(async () => {
    const q = (s) => document.querySelector(s);
    const root = getComputedStyle(document.documentElement);
    const help = q("#helpModal") ? q("#helpModal").textContent : "";
    const img = new Image(); img.src = "./assets/ui/mark.svg";
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    const paused = q("#screenPaused"); document.body.dataset.mode = "paused"; paused.classList.add("is-active");
    const transition = getComputedStyle(paused).transition;
    document.documentElement.classList.add("reduce-motion");
    const rmTransform = getComputedStyle(q("#screenPaused .screenInner > *")).transform;
    document.documentElement.classList.remove("reduce-motion");
    delete document.body.dataset.mode; paused.classList.remove("is-active");
    return {
      descLen: (q("meta[name=description]") || {}).content?.length,
      ogImage: (q('meta[property="og:image"]') || {}).content,
      canonical: q("link[rel=canonical]") && q("link[rel=canonical]").href,
      icon32: !!q('link[rel=icon][sizes="32x32"]'),
      touchIcon: !!q("link[rel=apple-touch-icon]"),
      logoIcon: !!q('link[rel=icon][href*="logo.svg"]'),
      themeColor: (q("meta[name=theme-color]") || {}).content,
      colorScheme: root.colorScheme,
      dur3: root.getPropertyValue("--dur-3").trim(),
      fontDisplay: root.getPropertyValue("--font-display"),
      orbitron: document.fonts.check("800 52px Orbitron"),
      footerLink: getComputedStyle(q(".footer a")).color,
      startMinH: parseFloat(getComputedStyle(q("#btnStart")).minHeight),
      startPrimary: q("#btnStart").classList.contains("primary"),
      shipFieldset: q(".shipGrid").tagName + (q(".shipGrid legend") ? "+LEGEND" : ""),
      helpSections: document.querySelectorAll("#helpModal .helpSection").length,
      helpCopy: ["10", "25", "50", "100", "Space", "HEAL"].every((s) => help.includes(s)) && !help.includes("15 pts") && !help.includes("x2 at 15"),
      oldHelp: q(".help"), kbHint: q("#keyboardHint"), tipsRow: [...document.querySelectorAll(".statRow .label")].some((l) => /tips/i.test(l.textContent)),
      crtShade: getComputedStyle(q("#crtShade")).mixBlendMode, crtLines: getComputedStyle(q("#crtLines")).mixBlendMode, crtFilter: getComputedStyle(q("#crtOverlay")).filter,
      crtNoiseBg: getComputedStyle(q("#crtNoise")).backgroundImage,
      markSquare: img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight,
      pausedTransition: transition,
      rmTransform,
      typeInputDisplay: getComputedStyle(q("#typeInput")).display, typeInputFont: getComputedStyle(q("#typeInput")).fontSize,
      sectorCards: document.querySelectorAll("#sectorGrid .sectorCard").length,
      settingsInPause: !!q("#pauseSettingsHost #settingsPanel"),
      loadingOverlayAttrs: q("#loadingOverlay").getAttributeNames(),
      bossTicks: document.querySelectorAll("#bossMeter .bossPhaseTick").length,
      hudCells: document.querySelectorAll("#hud .hudCell").length,
      hudPauseHidden: q("#hudPause").hasAttribute("hidden"),
    };
  });
  check("meta description 50-160 chars", dom.descLen >= 50 && dom.descLen <= 160, String(dom.descLen));
  check("og:image absolute https", /^https:\/\//.test(dom.ogImage || ""), dom.ogImage);
  check("canonical exact", dom.canonical === "https://typer198x.com/", dom.canonical);
  check("icon 32x32 + apple-touch-icon present, none on logo.svg", dom.icon32 && dom.touchIcon && !dom.logoIcon, JSON.stringify({ icon32: dom.icon32, touch: dom.touchIcon, logo: dom.logoIcon }));
  check("theme-color #0B1030", dom.themeColor === "#0B1030", dom.themeColor);
  check("colorScheme dark", dom.colorScheme === "dark", dom.colorScheme);
  check("--dur-3 280ms", dom.dur3 === "280ms", dom.dur3);
  check("--font-display contains Orbitron", /Orbitron/.test(dom.fontDisplay), dom.fontDisplay);
  check("fonts.check 800 52px Orbitron", dom.orbitron === true, String(dom.orbitron));
  check(".footer a colour rgb(57, 245, 255)", dom.footerLink === "rgb(57, 245, 255)", dom.footerLink);
  check("#btnStart primary with min-height >= 52", dom.startPrimary && dom.startMinH >= 52, `${dom.startPrimary} ${dom.startMinH}`);
  check(".shipGrid is FIELDSET with LEGEND", dom.shipFieldset === "FIELDSET+LEGEND", dom.shipFieldset);
  check("help has 7 sections with final copy", dom.helpSections === 7 && dom.helpCopy, `${dom.helpSections} copyOk=${dom.helpCopy}`);
  check("legacy .help / #keyboardHint / Tips row removed", !dom.oldHelp && !dom.kbHint && !dom.tipsRow, JSON.stringify({ oldHelp: !!dom.oldHelp, kb: !!dom.kbHint, tips: dom.tipsRow }));
  check("#crtShade normal, #crtLines screen, #crtOverlay filter none", dom.crtShade === "normal" && dom.crtLines === "screen" && dom.crtFilter === "none", `${dom.crtShade} ${dom.crtLines} ${dom.crtFilter}`);
  check("#crtNoise has a background image", /url\(/.test(dom.crtNoiseBg), dom.crtNoiseBg.slice(0, 60));
  check("mark.svg loads square", dom.markSquare, String(dom.markSquare));
  check("#screenPaused transition includes opacity", /opacity/.test(dom.pausedTransition), dom.pausedTransition);
  check("reduce-motion: .screenInner > * transform none", dom.rmTransform === "none", dom.rmTransform);
  check("#typeInput never display:none and 16px", dom.typeInputDisplay !== "none" && dom.typeInputFont === "16px", `${dom.typeInputDisplay} ${dom.typeInputFont}`);
  check("10 sector cards", dom.sectorCards === 10, String(dom.sectorCards));
  check("#settingsPanel initially inside #pauseSettingsHost", dom.settingsInPause, String(dom.settingsInPause));
  check("#loadingOverlay first attribute is id (runtime)", dom.loadingOverlayAttrs[0] === "id", dom.loadingOverlayAttrs.join(","));
  check("#hud has 7 cells, boss meter has 2 ticks, #hudPause without [hidden]", dom.hudCells === 7 && dom.bossTicks === 2 && !dom.hudPauseHidden, `${dom.hudCells} ${dom.bossTicks} ${dom.hudPauseHidden}`);

  // Mode-aware chrome under body[data-mode]
  const readMode = (mode) => page.evaluate((mode) => {
    const d = (s) => getComputedStyle(document.querySelector(s)).display;
    const o = (s) => getComputedStyle(document.querySelector(s)).opacity;
    if (mode) document.body.dataset.mode = mode; else delete document.body.dataset.mode;
    return new Promise((resolve) => setTimeout(() => resolve({
      pause: d("#btnPause"), stop: d("#btnStop"), settings: d("#btnSettings"), mute: d("#btnMute"), crt: d("#btnCRT"), fs: d("#btnFullscreen"), hud: o("#hud"),
      hudBg: getComputedStyle(document.getElementById("hud")).backgroundColor, panelBlur: getComputedStyle(document.getElementById("hud")).backdropFilter
    }), 260)); // past the 160 ms opacity transition
  }, mode);
  const modeVis = { menu: await readMode("menu"), playing: await readMode("playing"), paused: await readMode("paused") };
  await readMode(null);
  check("menu: Pause/Save&quit hidden, Sound/CRT/Fullscreen/Settings shown, #hud opacity 0", modeVis.menu.pause === "none" && modeVis.menu.stop === "none" && modeVis.menu.settings !== "none" && modeVis.menu.mute !== "none" && modeVis.menu.crt !== "none" && modeVis.menu.fs !== "none" && modeVis.menu.hud === "0", JSON.stringify(modeVis.menu));
  check("playing: Pause/Save&quit shown, Settings hidden, #hud solid rgba(5,6,11,.74), no backdrop blur", modeVis.playing.pause !== "none" && modeVis.playing.stop !== "none" && modeVis.playing.settings === "none" && modeVis.playing.hud === "1" && /rgba\(5, 6, 11, 0\.74\)/.test(modeVis.playing.hudBg) && modeVis.playing.panelBlur === "none", JSON.stringify(modeVis.playing));
  check("paused: Pause button shown and #hud visible", modeVis.paused.pause !== "none" && modeVis.paused.hud === "1", JSON.stringify(modeVis.paused));

  // Icon / og assets answer 200
  const assetStatus = await page.evaluate(async () => {
    const urls = ["./assets/ui/mark.svg", "./assets/icons/generated/macos/Icon-App-32.png", "./assets/icons/generated/macos/Icon-App-16.png", "./assets/icons/generated/ios/Icon-App-60@3x.png", "./assets/ui/og-card.jpg", "./assets/ui/noise.png", "./assets/fonts/Orbitron-Variable.woff2", "./privacy-policy.html", "./privacy.html"];
    const out = {};
    for (const u of urls) { try { const r = await fetch(u); out[u] = r.status; } catch (e) { out[u] = String(e); } }
    return out;
  });
  check("icon stack, og-card, noise tile, font and privacy pages return 200", Object.values(assetStatus).every((s) => s === 200), JSON.stringify(assetStatus));

  // CRT on/off: corner darker, centre nearly unchanged (same paused frame)
  await page.evaluate(() => { document.body.dataset.mode = "paused"; document.getElementById("screenPaused").classList.remove("hidden"); document.getElementById("screenPaused").classList.add("is-active"); document.getElementById("screenMenu").classList.add("hidden"); });
  await sleep(400);
  const mainBox = await rect(page, "#main");
  const clip = { x: Math.round(mainBox.left), y: Math.round(mainBox.top), width: Math.round(mainBox.width), height: Math.round(mainBox.height) };
  const onPng = decodePng(await page.screenshot({ clip }));
  await page.evaluate(() => { document.documentElement.dataset.crt = "off"; });
  await sleep(200);
  const crtDisplay = await css(page, "#crtOverlay", "display");
  const offPng = decodePng(await page.screenshot({ clip }));
  await page.evaluate(() => { delete document.documentElement.dataset.crt; });
  const cornerOn = onPng.avg(6, 6, 4), cornerOff = offPng.avg(6, 6, 4);
  const cx = Math.floor(clip.width / 2) - 3, cy = Math.floor(clip.height / 2) - 3;
  const centreOn = onPng.avg(cx, cy, 6), centreOff = offPng.avg(cx, cy, 6);
  check("data-crt=off hides #crtOverlay", crtDisplay === "none", crtDisplay);
  check("CRT on: corner >= 25% darker than off", cornerOn <= cornerOff * 0.75, `on=${cornerOn.toFixed(1)} off=${cornerOff.toFixed(1)}`);
  check("CRT on: centre differs < 6%", Math.abs(centreOn - centreOff) / 255 < 0.06, `on=${centreOn.toFixed(1)} off=${centreOff.toFixed(1)}`);

  // Source-level checks
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const cssText = fs.readFileSync(path.join(ROOT, "style.css"), "utf8") + fs.readFileSync(path.join(ROOT, "assets/style/tokens.css"), "utf8");
  const decls = [...cssText.matchAll(/(-webkit-)?backdrop-filter\s*:/g)];
  let prefixedOk = true;
  for (let i = 0; i < decls.length; i++) {
    if (!decls[i][1]) { const prev = decls[i - 1]; if (!prev || !prev[1]) prefixedOk = false; }
  }
  check("-webkit-backdrop-filter precedes every backdrop-filter", prefixedOk, `${decls.length} declarations`);
  check("source: <div id=\"loadingOverlay\" ... with no class attr", /<div id="loadingOverlay"(?![^>]*\sclass=)/.test(html), "regex");
  check("source: no bg/fg preloads, one font preload", (html.match(/rel="preload"/g) || []).length === 1 && /as="font"/.test(html), String((html.match(/rel="preload"/g) || []).length));
  check("source: 17 external script tags unchanged order", (html.match(/<script src=/g) || []).length === 17 && html.indexOf("sfx.js?v=") < html.indexOf("00-util.js?v=") && html.indexOf("80-fx.js") < html.indexOf("99-boot.js"), String((html.match(/<script src=/g) || []).length));
  await context.close();
} catch (e) {
  results.errors.push(String(e && e.stack || e));
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
}
const failed = results.checks.filter((c) => !c.ok);
console.log(JSON.stringify({ out: OUT, shots: results.shots.length, checks: results.checks.length, failed: failed.map((c) => `${c.name} :: ${c.evidence}`), errors: results.errors }, null, 2));
process.exit(failed.length || results.errors.length ? 1 : 0);
