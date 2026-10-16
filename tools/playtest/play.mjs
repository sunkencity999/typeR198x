// Headless play-test harness for Type-R 198X (web build).
// Usage:
//   node play.mjs --root /path/to/typeR198x --out /path/to/outdir [--seconds 12] [--dpr 1|2]
//                 [--accuracy 0.93] [--scenario all|smoke] [--mobile] [--headed]
// Produces: <out>/report.json + PNG screenshots. Exit code 1 if page errors occurred.
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true";
    acc.push([k, v]);
  }
  return acc;
}, []));

const ROOT = path.resolve(args.root || ".");
const OUT = path.resolve(args.out || "./out");
const SECONDS = Number(args.seconds || 12);
const DPR = Number(args.dpr || 1);
const ACCURACY = Number(args.accuracy || 0.93);
const SCENARIO = args.scenario || "all";
const MOBILE = args.mobile === "true";
const HEADED = args.headed === "true";
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json", ".txt": "text/plain"
};

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const report = { root: ROOT, scenario: SCENARIO, dpr: DPR, mobile: MOBILE, consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], screenshots: [], timings: {}, fps: {}, notes: [] };

const { server, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctxOpts = MOBILE
  ? { ...devices["iPhone 13"], deviceScaleFactor: DPR }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR };
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();
page.on("console", (m) => {
  const t = m.type();
  const text = m.text();
  if (t === "error") report.consoleErrors.push(text);
  else if (t === "warning") report.consoleWarnings.push(text);
});
page.on("pageerror", (e) => report.pageErrors.push(String(e && e.stack || e)));
page.on("requestfailed", (r) => report.requestFailures.push(`${r.url()} :: ${r.failure()?.errorText}`));

async function shot(name) {
  const file = path.join(OUT, `${String(report.screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
  return file;
}

async function measureFps(ms = 2000) {
  return page.evaluate((ms) => new Promise((resolve) => {
    let frames = 0; const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(Math.round(frames / ((performance.now() - t0) / 1000))); };
    requestAnimationFrame(tick);
  }), ms);
}

// Pulls what a competent player would type next. Tolerant of internal refactors: tries several shapes.
async function nextKey() {
  return page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    if (!g) return null;
    try {
      if (g.inBoss && g.boss) {
        const nc = typeof g.boss.nextChar === "function" ? g.boss.nextChar() : g.boss.nextChar;
        if (nc) return nc;
      }
      if (g.lock && g.lock.ref && g.lock.ref.alive) {
        const r = g.lock.ref;
        const nc = typeof r.nextChar === "function" ? r.nextChar() : r.nextChar;
        if (nc) return nc;
      }
      const pool = [...(g.powerups || []), ...(g.enemies || [])].filter(e => e && e.alive && e.x < (g.w || 1280) - 10);
      pool.sort((a, b) => a.x - b.x);
      const cand = pool[0];
      if (!cand) return null;
      return typeof cand.nextChar === "function" ? cand.nextChar() : cand.nextChar;
    } catch (e) { return null; }
  });
}

async function state() {
  return page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    if (!g) return null;
    return {
      mode: g.mode, levelIndex: g.levelIndex, levelT: Math.round((g.levelT || 0) * 10) / 10, inBoss: !!g.inBoss,
      bossClear: !!g.bossClear, hp: g.player && g.player.hp, score: g.stats && g.stats.score, combo: g.stats && g.stats.combo,
      enemies: (g.enemies || []).length, powerups: (g.powerups || []).length, particles: (g.particles || []).length
    };
  });
}

async function autoType(seconds, { accuracy = ACCURACY, until = null } = {}) {
  const t0 = Date.now();
  let typed = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const st = await state();
    if (until && st && until(st)) break;
    if (!st || st.mode !== "playing") { await sleep(80); continue; }
    const k = await nextKey();
    if (k) {
      const wrong = Math.random() > accuracy;
      const key = wrong ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
      await page.keyboard.press(key === " " ? "Space" : key);
      typed++;
    }
    await sleep(55 + Math.random() * 40);
  }
  return typed;
}

async function forceBoss() {
  await page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    const L = (typeof LEVELS !== "undefined" && LEVELS) || (window.TypeR && window.TypeR.LEVELS);
    if (g && L) g.levelT = L[g.levelIndex].duration + 0.01;
    else if (g && typeof g.beginBossFight === "function") g.beginBossFight();
  });
}

try {
  const tNav = Date.now();
  await page.goto(base, { waitUntil: "load" });
  report.timings.loadEventMs = Date.now() - tNav;
  await shot("boot");
  // Wait for loading overlay to hide (or disappear)
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById("loadingOverlay");
      return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden" || getComputedStyle(el).display === "none";
    }, null, { timeout: 120000 });
  } catch { report.notes.push("loading overlay never hid within 120s"); }
  report.timings.assetsReadyMs = Date.now() - tNav;
  // Dismiss keyboard hint if present
  const kb = page.locator("#btnKeyboardHint");
  if (await kb.isVisible().catch(() => false)) await kb.click();
  await shot("menu");
  report.fps.menu = await measureFps(1500);

  await page.fill("#playerName", "HARNESS").catch(() => {});
  const tStart = Date.now();
  await page.click("#btnStart");
  // Story modal
  const story = page.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 4000 }); await shot("story"); await story.click(); } catch {}
  await page.waitForFunction(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    return g && g.mode === "playing";
  }, null, { timeout: 60000 }).catch(() => report.notes.push("never entered playing mode"));
  report.timings.startToPlayingMs = Date.now() - tStart;

  await sleep(2500);
  await shot("gameplay-early");
  const typed1 = await autoType(SECONDS);
  report.typedWave = typed1;
  report.stateAfterWave = await state();
  await shot("gameplay-mid");
  report.fps.gameplay = await measureFps(2000);

  if (SCENARIO === "all") {
    // Pause overlay
    await page.keyboard.press("Escape"); await sleep(400); await shot("paused"); await page.keyboard.press("Escape"); await sleep(300);

    // Boss
    await forceBoss();
    await sleep(1200);
    await shot("boss-intro");
    await sleep(1800);
    await shot("boss-fight");
    report.fps.boss = await measureFps(1500);
    await autoType(90, { until: (s) => s.bossClear || s.mode !== "playing" });
    report.stateAfterBoss = await state();
    await sleep(1500);
    await shot("boss-finale");
    await page.waitForFunction(() => {
      const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
      return g && g.mode !== "playing";
    }, null, { timeout: 20000 }).catch(() => report.notes.push("boss finale did not end within 20s"));
    await sleep(600);
    report.stateAfterFinale = await state();
    await shot("level-complete");

    // Next level, then game over
    const next = page.locator("#btnNextLevel");
    if (await next.isVisible().catch(() => false)) { await next.click(); await sleep(1500); await shot("level2-start"); }
    await page.evaluate(() => { const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game); if (g && g.player) g.player.hp = 5; });
    await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game); return g && g.mode === "gameOver"; }, null, { timeout: 60000 }).catch(() => report.notes.push("game over not reached in 60s"));
    await sleep(500);
    await shot("game-over");

    // Victory: jump to level 10 boss
    await page.evaluate(() => {
      const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
      if (!g) return;
      if (typeof g.startNewRun === "function") g.startNewRun();
      if (typeof g.startLevel === "function") g.startLevel(9, true);
    });
    await sleep(800);
    await forceBoss();
    await sleep(2500);
    await shot("final-boss");
    await autoType(240, { accuracy: 0.995, until: (s) => s.bossClear || s.mode !== "playing" });
    await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game); return g && g.mode === "victory"; }, null, { timeout: 30000 }).catch(() => report.notes.push("victory not reached"));
    await sleep(600);
    await shot("victory");
    const adv = page.locator("#btnEndingNext");
    for (let i = 0; i < 3 && await adv.isVisible().catch(() => false); i++) { await adv.click(); await sleep(250); }
    await shot("victory-dialogue");
    // Back to menu
    const back = page.locator("#btnBackToMenu3");
    if (await back.isVisible().catch(() => false)) { await back.click(); await sleep(500); await shot("menu-after"); }
  }
  report.finalState = await state();
  report.saveBlob = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("typesmup198x.save.v1")); } catch { return null; } });
} catch (e) {
  report.harnessError = String(e && e.stack || e);
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
const bad = report.pageErrors.length + report.consoleErrors.length;
console.log(JSON.stringify({ out: OUT, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, warnings: report.consoleWarnings.length, requestFailures: report.requestFailures.length, fps: report.fps, timings: report.timings, notes: report.notes, screenshots: report.screenshots.length, harnessError: report.harnessError || null }, null, 2));
process.exit(bad ? 1 : 0);
