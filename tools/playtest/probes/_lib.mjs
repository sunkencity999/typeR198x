// Shared helpers for the acceptance probes (tools/playtest/probes/*.mjs).
// Usage from a probe:  const P = await openProbe("a2", { dpr: 2, fixture: {...} }); ... P.check(...); await P.finish();
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const LS_KEY = "typesmup198x.save.v1";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain"
};

export function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "max-age=3600" });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Legacy-shaped fixtures (no schema / run.checkpoint / run.id), as the lead's A1 harness defines them.
export const FIXTURES = {
  fresh: null,
  "legacy-midwave": {
    playerName: "LEGACY", selectedShip: "sofrito", highScore: 1200, lastUnlockedLevel: 3, storySeen: true, keyboardHintSeen: true,
    settings: { muted: true, crt: false },
    run: { levelIndex: 2, levelT: 40, inBoss: false, hp: 260, maxHp: 400, shield: 0, power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
      stats: { score: 6000, combo: 4, mult: 1, correct: 300, total: 320 }, shipId: "sofrito", spawnAcc: 0.3, powerAcc: 2, hazardAcc: 0 }
  },
  "legacy-inboss": {
    playerName: "LEGACY", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 2, storySeen: true, keyboardHintSeen: true,
    settings: { muted: true, crt: true },
    run: { levelIndex: 1, levelT: 200, inBoss: true, hp: 150, maxHp: 300, shield: 0, power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
      stats: { score: 2200, combo: 0, mult: 1, correct: 100, total: 110 }, shipId: "coconut", spawnAcc: 0, powerAcc: 0, hazardAcc: 0.4 }
  },
  "legacy-postvictory": {
    playerName: "LEGEND", selectedShip: "honeybee", highScore: 4200, lastUnlockedLevel: 10, storySeen: true, keyboardHintSeen: true,
    settings: { muted: true, crt: true }, run: null
  },
  "legacy-levelcomplete": {
    playerName: "LEGACY", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 2, storySeen: true, keyboardHintSeen: true,
    settings: { muted: true, crt: true },
    run: { levelIndex: 0, levelT: 130, inBoss: false, hp: 300, maxHp: 300, shield: 0, power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
      stats: { score: 3400, combo: 2, mult: 1, correct: 50, total: 52 }, shipId: "coconut", spawnAcc: 0, powerAcc: 0, hazardAcc: 0 }
  },
  // main's onGameOver() -> buildResumeRun(4, 600, "honeybee"): a zero-progress stub for the sector the pilot died in (review R10).
  "legacy-gameover": {
    playerName: "ACE", selectedShip: "honeybee", highScore: 20000, lastUnlockedLevel: 5, storySeen: true, keyboardHintSeen: true,
    settings: { muted: true, crt: true },
    run: { levelIndex: 4, levelT: 0, inBoss: false, hp: 600, maxHp: 600, shield: 0, power: { spread: 0, pierce: 0, rapid: 0, multiplier: 0 },
      stats: { score: 0, combo: 0, mult: 1, correct: 0, total: 0 }, shipId: "honeybee", spawnAcc: 0, powerAcc: 0, minionAcc: 0, hazardAcc: 0 }
  }
};

export async function openProbe(name, opts = {}) {
  const dpr = Number(opts.dpr || 1);
  const out = path.resolve(HERE, "../out/probe-" + name);
  fs.mkdirSync(out, { recursive: true });
  const { server, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: dpr,
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    ...(opts.isMobile ? { isMobile: true, hasTouch: true } : {})
  });
  const page = await context.newPage();
  let cdpSession = null;
  let perfEnabled = false;
  const errors = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (e) => errors.pageErrors.push(String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.consoleErrors.push(m.text()); });
  const results = [];
  let shots = 0;

  const P = {
    page, context, browser, base, out, errors, results,
    async goto(fixture) {
      const blob = typeof fixture === "string" ? FIXTURES[fixture] : fixture;
      if (blob !== undefined && blob !== null) {
        await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, blob]);
      } else if (blob === null) {
        await context.addInitScript((k) => { try { localStorage.removeItem(k); } catch {} }, LS_KEY);
      }
      await page.goto(base, { waitUntil: "load" });
      await page.waitForFunction(() => {
        const el = document.getElementById("loadingOverlay");
        return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden";
      }, null, { timeout: 120000 });
    },
    async g(fn, arg) { return page.evaluate(fn, arg); },
    // Raw DevTools session (Performance metrics, vision-deficiency emulation).
    async cdp() { if (!cdpSession) cdpSession = await context.newCDPSession(page); return cdpSession; },
    // Performance.getMetrics LayoutCount / RecalcStyleCount with a timestamp; subtract two readings for a rate.
    async metrics() {
      const c = await P.cdp();
      if (!perfEnabled) { await c.send("Performance.enable"); perfEnabled = true; }
      const { metrics } = await c.send("Performance.getMetrics");
      const get = (n) => { const m = metrics.find((x) => x.name === n); return m ? m.value : null; };
      return { t: Date.now(), layout: get("LayoutCount"), recalc: get("RecalcStyleCount") };
    },
    // Rates per 5 s between two metrics() readings (the harness report's layoutCountPer5s shape).
    per5s(m0, m1) {
      const span = Math.max(1, m1.t - m0.t);
      return { layoutPer5s: Math.round((m1.layout - m0.layout) / span * 5000 * 10) / 10, recalcPer5s: Math.round((m1.recalc - m0.recalc) / span * 5000 * 10) / 10, spanMs: span };
    },
    // Chrome's colour-vision simulation: 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'achromatopsia' | 'blurredVision'.
    async vision(type) { const c = await P.cdp(); await c.send("Emulation.setEmulatedVisionDeficiency", { type }); },
    async fps(ms = 2000) {
      return page.evaluate((ms) => new Promise((resolve) => {
        let frames = 0; const t0 = performance.now();
        const tick = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(Math.round(frames / ((performance.now() - t0) / 1000))); };
        requestAnimationFrame(tick);
      }), ms);
    },
    // Canvas budget counters (the harness probe's shape, compact): call BEFORE goto(). window.__e2Probe.mark() /
    // snapshot() give per-frame maxima of shadowBlur sets, globalCompositeOperation sets and render() ms.
    async installCanvasCounters() {
      await context.addInitScript(() => {
        if (window.__e2Probe) return;
        const fresh = () => ({ shadowBlurSets: 0, shadowBlur: 0, composite: 0, renderMs: 0 });
        const acc = () => ({ frames: 0, shadowBlurSetsMax: 0, shadowBlurMax: 0, compositeMax: 0, maxRenderMs: 0, renderSum: 0, renderSamples: 0, renderOver16: 0 });
        const E = window.__e2Probe = { cur: fresh(), win: acc(), wrapped: false };
        const proto = CanvasRenderingContext2D.prototype;
        const wrap = (prop, on) => {
          const d = Object.getOwnPropertyDescriptor(proto, prop);
          if (!d || !d.set) return;
          Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); }, set(v) { try { on(v); } catch (_) {} return d.set.call(this, v); } });
        };
        wrap("shadowBlur", (v) => { E.cur.shadowBlurSets++; if (v > 0) E.cur.shadowBlur++; });
        wrap("globalCompositeOperation", () => { E.cur.composite++; });
        const wrapGame = () => {
          const g = window.game;
          if (!g || typeof g.render !== "function") return;
          const orig = g.render;
          g.render = function () { const t0 = performance.now(); try { return orig.apply(this, arguments); } finally { const ms = performance.now() - t0; if (ms > E.cur.renderMs) E.cur.renderMs = ms; } };
          E.wrapped = true;
        };
        const tick = () => {
          if (!E.wrapped) wrapGame();
          const f = E.cur; E.cur = fresh();
          const a = E.win; a.frames++;
          if (f.shadowBlurSets > a.shadowBlurSetsMax) a.shadowBlurSetsMax = f.shadowBlurSets;
          if (f.shadowBlur > a.shadowBlurMax) a.shadowBlurMax = f.shadowBlur;
          if (f.composite > a.compositeMax) a.compositeMax = f.composite;
          if (f.renderMs > 0) { a.renderSamples++; a.renderSum += f.renderMs; if (f.renderMs > a.maxRenderMs) a.maxRenderMs = f.renderMs; if (f.renderMs > 16) a.renderOver16++; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        E.mark = () => { E.win = acc(); };
        E.snapshot = () => { const a = E.win; return { frames: a.frames, shadowBlurPerFrame: a.shadowBlurMax, shadowBlurSetsPerFrame: a.shadowBlurSetsMax, compositeSetsPerFrame: a.compositeMax, maxRenderMs: Math.round(a.maxRenderMs * 100) / 100, avgRenderMs: a.renderSamples ? Math.round(a.renderSum / a.renderSamples * 100) / 100 : 0, renderFramesOver16ms: a.renderOver16, wrapped: E.wrapped }; };
      });
    },
    async shot(label) {
      const file = path.join(out, `${String(++shots).padStart(2, "0")}-${label}.png`);
      await page.screenshot({ path: file });
      return file;
    },
    check(name, pass, evidence) {
      results.push({ check: name, result: pass ? "pass" : "fail", evidence: typeof evidence === "string" ? evidence : JSON.stringify(evidence) });
      console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}`);
    },
    note(name, evidence) {
      results.push({ check: name, result: "not-run", evidence });
      console.log(`SKIP  ${name}  ${evidence}`);
    },
    // Click Start (handles the story modal) and wait for playing.
    async startRun(name = "PROBE") {
      await page.fill("#playerName", name).catch(() => {});
      await page.click("#btnStart");
      const story = page.locator("#btnStoryLaunch");
      try { await story.waitFor({ state: "visible", timeout: 2500 }); await story.click(); } catch {}
      await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
    },
    async clickContinue() {
      await page.click("#btnContinue");
      const story = page.locator("#btnStoryLaunch");
      try { await story.waitFor({ state: "visible", timeout: 1500 }); await story.click(); } catch {}
      await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
    },
    async state() {
      return page.evaluate(() => {
        const g = window.game;
        return { mode: g.mode, levelIndex: g.levelIndex, levelT: g.levelT, inBoss: g.inBoss, bossClear: !!g.bossClear, hp: g.player.hp, maxHp: g.player.maxHp,
          score: g.stats.score, combo: g.stats.combo, enemies: g.enemies.length };
      });
    },
    async nextKey() {
      return page.evaluate(() => {
        const g = window.game;
        try {
          if (g.inBoss && g.boss) { const nc = g.boss.nextChar; if (nc) return nc; }
          if (g.lock && g.lock.ref && g.lock.ref.alive) { const nc = g.lock.ref.nextChar(); if (nc) return nc; }
          const pool = [...g.enemies, ...g.powerups].filter(e => e && e.alive && e.x < g.w - 10).sort((a, b) => a.x - b.x);
          const c = pool[0];
          return c ? c.nextChar() : null;
        } catch { return null; }
      });
    },
    async autoType(seconds, { accuracy = 0.97, until = null } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < seconds * 1000) {
        const st = await P.state();
        if (until && until(st)) break;
        if (st.mode !== "playing") { await sleep(80); continue; }
        const k = await P.nextKey();
        if (k && /^[a-z]$/.test(k)) {
          const wrong = Math.random() > accuracy;
          const key = wrong ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
          await page.keyboard.press(key);
        }
        await sleep(50 + Math.random() * 30);
      }
    },
    async forceBoss() {
      await page.evaluate(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
      await page.waitForFunction(() => window.game.inBoss, null, { timeout: 15000 }).catch(() => {});
    },
    async saveBlob() {
      return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, LS_KEY);
    },
    async finish() {
      const summary = { probe: name, pass: results.filter(r => r.result === "pass").length, fail: results.filter(r => r.result === "fail").length,
        notRun: results.filter(r => r.result === "not-run").length, pageErrors: errors.pageErrors, consoleErrors: errors.consoleErrors, results };
      fs.writeFileSync(path.join(out, "probe.json"), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify({ probe: name, pass: summary.pass, fail: summary.fail, notRun: summary.notRun, pageErrors: errors.pageErrors.length, consoleErrors: errors.consoleErrors.length, out }, null, 2));
      if (errors.pageErrors.length) console.log("pageErrors:", errors.pageErrors);
      if (errors.consoleErrors.length) console.log("consoleErrors:", errors.consoleErrors);
      await browser.close();
      server.close();
      process.exit(summary.fail || errors.pageErrors.length ? 1 : 0);
    }
  };
  return P;
}
