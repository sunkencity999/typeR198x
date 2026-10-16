// Headless play-test harness for Type-R 198X (web build) — v2.
//
// Usage:
//   node play.mjs --root /path/to/typeR198x --out /path/to/outdir [--scenario all|smoke] [--seconds 12]
//                 [--dpr 1|2] [--wpm 80] [--accuracy 0.93] [--reduced-motion] [--mobile]
//                 [--ua native|"<string>"] [--cpu 4] [--fixture <name>] [--entry auto|start|continue]
//                 [--fail-webp] [--delay-opt <ms>] [--expect-resource-errors] [--ignore-errors <regex>]
//                 [--file] [--headed]
//
// Produces <out>/report.json plus numbered PNG screenshots (fixed numbering, see SHOT_INDEX).
// Exit code 1 when page errors or non-resource console errors occurred (or the harness itself failed);
// resource-load errors (404s, injected failures) are reported separately and never fail the run.
// See README.md in this directory for every flag and report field.
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOL_FLAGS = new Set(["mobile", "headed", "reduced-motion", "fail-webp", "expect-resource-errors", "file", "help"]);

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const next = arr[i + 1];
    const v = (!BOOL_FLAGS.has(k) && next !== undefined && !next.startsWith("--")) ? next : "true";
    acc.push([k, v]);
  }
  return acc;
}, []));

if (args.help === "true") {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 13).join("\n"));
  process.exit(0);
}

const ROOT = path.resolve(args.root || ".");
const OUT = path.resolve(args.out || "./out");
const SECONDS = Number(args.seconds || 12);
const DPR = Number(args.dpr || 1);
const ACCURACY = Number(args.accuracy || 0.93);
const WPM = Number(args.wpm || 80);
const SCENARIO = args.scenario || "all";
const MOBILE = args.mobile === "true";
const HEADED = args.headed === "true";
const REDUCED_MOTION = args["reduced-motion"] === "true";
const UA = args.ua === "native" ? "TypeR198X-macOS" : (args.ua || null);
const CPU = Number(args.cpu || 0);
const FIXTURE = args.fixture || null;
const ENTRY = args.entry || "auto";
const FAIL_WEBP = args["fail-webp"] === "true";
const DELAY_OPT = Number(args["delay-opt"] || 0);
const EXPECT_RESOURCE_ERRORS = args["expect-resource-errors"] === "true";
const IGNORE_ERRORS = args["ignore-errors"] ? new RegExp(args["ignore-errors"]) : null;
const FILE_MODE = args.file === "true";
const LS_KEY = "typesmup198x.save.v1";

fs.mkdirSync(OUT, { recursive: true });
// Drop stale output from a previous run so a skipped screenshot cannot masquerade as a fresh one.
for (const f of fs.readdirSync(OUT)) {
  if (/^\d\d-[\w-]+\.png$/.test(f) || f === "report.json") fs.unlinkSync(path.join(OUT, f));
}

// ----------------------------- Static server -----------------------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json"
};
const NO_STORE_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest"]);

// Cache policy mirrors what the acceptance tests assume of production (amendment C-4):
// code and documents are never cached between runs, everything else under /assets/ is cacheable
// for an hour so the browser can dedupe repeat fetches (A/B music elements, ship cards, prefetch).
function cacheControlFor(urlPath, ext) {
  if (NO_STORE_EXT.has(ext)) return "no-store";
  if (urlPath.startsWith("/assets/")) return "max-age=3600";
  return "no-store";
}

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
        const stat = fs.statSync(fp);
        const ext = path.extname(fp).toLowerCase();
        const total = stat.size;
        let start = 0, end = total - 1, status = 200;
        const range = req.headers.range;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m && (m[1] !== "" || m[2] !== "")) {
            if (m[1] === "") start = Math.max(0, total - Number(m[2]));
            else { start = Number(m[1]); if (m[2] !== "") end = Math.min(total - 1, Number(m[2])); }
            if (start > end || start >= total) {
              res.writeHead(416, { "Content-Range": `bytes */${total}` });
              return res.end();
            }
            status = 206;
          }
        }
        const headers = {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControlFor(urlPath, ext),
          "Last-Modified": stat.mtime.toUTCString()
        };
        if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
        res.writeHead(status, headers);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(fp, { start, end }).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// ----------------------------- Fixtures -----------------------------
function loadFixture(name) {
  const file = path.join(HERE, "fixtures", `${name}.json`);
  if (!fs.existsSync(file)) {
    const have = fs.existsSync(path.join(HERE, "fixtures")) ? fs.readdirSync(path.join(HERE, "fixtures")).map(f => f.replace(/\.json$/, "")).join(", ") : "(none)";
    throw new Error(`unknown fixture "${name}"; available: ${have}`);
  }
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!("save" in fx)) throw new Error(`fixture ${name} has no "save" member`);
  return { name, file, description: fx.description || "", entry: fx.entry || null, expect: fx.expect || {}, save: fx.save };
}

// ----------------------------- Canvas / render instrumentation -----------------------------
// Installed with addInitScript, so it runs before any game script. Per-frame counters are
// collected by a requestAnimationFrame loop registered before the game's own loop; each probe
// callback therefore sees the counts of the previous frame's game work.
function installProbe() {
  if (window.__typerProbe) return;
  const fresh = () => ({ shadowBlur: 0, shadowBlurSets: 0, composite: 0, compositeNonDefault: 0, fullFrame: 0, fullFrameOpaque: 0,
    fullFrameUnknown: 0, fullFrameMaxAlpha: 0, fullFrameAbove12: 0, getImageData: 0, renderMs: 0, updateMs: 0 });
  const acc = () => ({ frames: 0, shadowBlurMax: 0, shadowBlurSum: 0, shadowBlurSetsMax: 0, compositeMax: 0, compositeNonDefaultMax: 0,
    fullFrameMax: 0, fullFrameOpaqueMax: 0, fullFrameUnknown: 0, fullFrameMaxAlpha: 0, fullFrameFramesAbove12: 0, getImageData: 0,
    maxRenderMs: 0, renderSum: 0, renderSamples: 0, renderOver16: 0, maxUpdateMs: 0 });
  const P = window.__typerProbe = { cur: fresh(), win: acc(), all: acc(), wrapped: false, longTasks: { count: 0, maxMs: 0, totalMs: 0 }, canvasFills: 0 };

  const parseAlpha = (s) => {
    if (typeof s !== "string") return null; // gradients / patterns
    s = s.trim().toLowerCase();
    if (s === "transparent") return 0;
    let m = s.match(/^(?:rgba?|hsla?)\(([^)]+)\)$/);
    if (m) {
      const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length >= 4) { const a = parts[3]; return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a); }
      return 1;
    }
    m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      const h = m[1];
      if (h.length === 4) return parseInt(h[3] + h[3], 16) / 255;
      if (h.length === 8) return parseInt(h.slice(6, 8), 16) / 255;
      return 1;
    }
    return 1; // named colours
  };

  const proto = CanvasRenderingContext2D.prototype;
  const wrapSetter = (prop, onSet) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) { try { onSet(v, this); } catch {} return d.set.call(this, v); }
    });
  };
  wrapSetter("shadowBlur", (v) => { P.cur.shadowBlurSets++; if (v > 0) P.cur.shadowBlur++; });
  wrapSetter("globalCompositeOperation", (v) => { P.cur.composite++; if (v !== "source-over") P.cur.compositeNonDefault++; });

  const origFillRect = proto.fillRect;
  proto.fillRect = function (x, y, w, h) {
    try {
      const c = this.canvas;
      if (c && c.id === "game" && w > 0 && h > 0) {
        const m = this.getTransform();
        const xs = [], ys = [];
        for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
          xs.push(m.a * px + m.c * py + m.e); ys.push(m.b * px + m.d * py + m.f);
        }
        const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(c.width, Math.max(...xs));
        const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(c.height, Math.max(...ys));
        const cov = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (c.width * c.height);
        if (cov >= 0.9) {
          const a0 = parseAlpha(this.fillStyle);
          const a = a0 == null ? null : Math.min(1, a0 * this.globalAlpha);
          P.cur.fullFrame++;
          if (a === null) P.cur.fullFrameUnknown++;
          else if (a >= 0.999) P.cur.fullFrameOpaque++;
          else {
            if (a > P.cur.fullFrameMaxAlpha) P.cur.fullFrameMaxAlpha = a;
            if (a > 0.12) P.cur.fullFrameAbove12++;
          }
        }
      }
    } catch {}
    return origFillRect.apply(this, arguments);
  };
  const origGetImageData = proto.getImageData;
  proto.getImageData = function () { P.cur.getImageData++; return origGetImageData.apply(this, arguments); };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { P.longTasks.count++; P.longTasks.totalMs += e.duration; if (e.duration > P.longTasks.maxMs) P.longTasks.maxMs = e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch {}

  const wrapGame = () => {
    const g = window.game;
    if (!g || typeof g.render !== "function") return;
    const origRender = g.render;
    g.render = function () {
      const t0 = performance.now();
      try { return origRender.apply(this, arguments); }
      finally { const ms = performance.now() - t0; if (ms > P.cur.renderMs) P.cur.renderMs = ms; }
    };
    if (typeof g.update === "function") {
      const origUpdate = g.update;
      g.update = function () {
        const t0 = performance.now();
        try { return origUpdate.apply(this, arguments); }
        finally { const ms = performance.now() - t0; if (ms > P.cur.updateMs) P.cur.updateMs = ms; }
      };
    }
    P.wrapped = true;
  };

  const fold = (a, f) => {
    a.frames++;
    a.shadowBlurSum += f.shadowBlur;
    if (f.shadowBlur > a.shadowBlurMax) a.shadowBlurMax = f.shadowBlur;
    if (f.shadowBlurSets > a.shadowBlurSetsMax) a.shadowBlurSetsMax = f.shadowBlurSets;
    if (f.composite > a.compositeMax) a.compositeMax = f.composite;
    if (f.compositeNonDefault > a.compositeNonDefaultMax) a.compositeNonDefaultMax = f.compositeNonDefault;
    if (f.fullFrame > a.fullFrameMax) a.fullFrameMax = f.fullFrame;
    if (f.fullFrameOpaque > a.fullFrameOpaqueMax) a.fullFrameOpaqueMax = f.fullFrameOpaque;
    a.fullFrameUnknown += f.fullFrameUnknown;
    if (f.fullFrameMaxAlpha > a.fullFrameMaxAlpha) a.fullFrameMaxAlpha = f.fullFrameMaxAlpha;
    if (f.fullFrameAbove12 > 0) a.fullFrameFramesAbove12++;
    a.getImageData += f.getImageData;
    if (f.renderMs > 0) { a.renderSamples++; a.renderSum += f.renderMs; if (f.renderMs > a.maxRenderMs) a.maxRenderMs = f.renderMs; if (f.renderMs > 16) a.renderOver16++; }
    if (f.updateMs > a.maxUpdateMs) a.maxUpdateMs = f.updateMs;
  };
  const tick = () => {
    if (!P.wrapped) wrapGame();
    const f = P.cur; P.cur = fresh();
    fold(P.win, f); fold(P.all, f);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const summarize = (a) => ({
    frames: a.frames,
    shadowBlurPerFrame: a.shadowBlurMax,
    shadowBlurAvgPerFrame: a.frames ? Math.round(a.shadowBlurSum / a.frames * 100) / 100 : 0,
    shadowBlurSetsPerFrame: a.shadowBlurSetsMax,
    compositeSetsPerFrame: a.compositeMax,
    compositeNonDefaultPerFrame: a.compositeNonDefaultMax,
    fullFrameFillsPerFrame: a.fullFrameMax,
    fullFrameOpaqueFillsPerFrame: a.fullFrameOpaqueMax,
    fullFrameGradientFills: a.fullFrameUnknown,
    fullFrameFillMaxAlpha: Math.round(a.fullFrameMaxAlpha * 1000) / 1000,
    fullFrameFillFramesAbove12: a.fullFrameFramesAbove12,
    getImageDataCalls: a.getImageData,
    maxRenderMs: Math.round(a.maxRenderMs * 100) / 100,
    avgRenderMs: a.renderSamples ? Math.round(a.renderSum / a.renderSamples * 100) / 100 : 0,
    renderFramesOver16ms: a.renderOver16,
    maxUpdateMs: Math.round(a.maxUpdateMs * 100) / 100
  });
  P.mark = () => { P.win = acc(); };
  P.snapshot = () => summarize(P.win);
  P.total = () => ({ ...summarize(P.all), wrapped: P.wrapped, longTasks: { ...P.longTasks, maxMs: Math.round(P.longTasks.maxMs), totalMs: Math.round(P.longTasks.totalMs) } });
}

// ----------------------------- Harness state -----------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const report = {
  root: ROOT, scenario: SCENARIO, dpr: DPR, mobile: MOBILE,
  config: { seconds: SECONDS, wpm: WPM, accuracy: ACCURACY, reducedMotion: REDUCED_MOTION, ua: UA, cpu: CPU || null, fixture: FIXTURE, entry: ENTRY,
    failWebp: FAIL_WEBP, delayOptMs: DELAY_OPT || null, expectResourceErrors: EXPECT_RESOURCE_ERRORS, ignoreErrors: IGNORE_ERRORS ? String(IGNORE_ERRORS) : null, fileMode: FILE_MODE },
  consoleErrors: [], consoleWarnings: [], pageErrors: [], resourceErrors: [], ignoredErrors: [], requestFailures: [], httpErrors: [],
  screenshots: [], timings: {}, fps: {}, perf: {}, network: [], networkTotals: null, notes: []
};
const SHOT_INDEX = { boot: 1, menu: 2, story: 3, "gameplay-early": 4, "gameplay-mid": 5, paused: 6, "boss-intro": 7, "boss-fight": 8,
  "boss-finale": 9, "level-complete": 10, "level2-start": 11, "game-over": 12, "final-boss": 13, victory: 14, "victory-dialogue": 15, "menu-after": 16 };
let extraShot = 16;

let fixture = null;
if (FIXTURE) {
  fixture = loadFixture(FIXTURE);
  console.log(`[fixture] ${fixture.name}: ${fixture.description}`);
  console.log(`[fixture] ${LS_KEY} = ${fixture.save === null ? "(removed)" : JSON.stringify(fixture.save)}`);
  report.fixture = { name: fixture.name, description: fixture.description, entry: fixture.entry, expect: fixture.expect, save: fixture.save, check: null };
}

let server = null, port = 0, base;
if (FILE_MODE) {
  base = "file://" + path.join(ROOT, "index.html");
} else {
  ({ server, port } = await startServer(ROOT));
  base = `http://127.0.0.1:${port}/index.html`;
}
report.base = base;

const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--mute-audio"];
if (FILE_MODE) launchArgs.push("--allow-file-access-from-files");
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: launchArgs });
const ctxOpts = MOBILE
  ? { ...devices["iPhone 13"], deviceScaleFactor: DPR }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR };
if (UA) ctxOpts.userAgent = UA;
const context = await browser.newContext(ctxOpts);
await context.addInitScript(installProbe);
if (fixture) {
  await context.addInitScript(({ key, blob }) => {
    try {
      if (sessionStorage.getItem("__typerFixtureApplied")) return;
      sessionStorage.setItem("__typerFixtureApplied", "1");
      if (blob === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(blob));
    } catch {}
  }, { key: LS_KEY, blob: fixture.save });
}
const page = await context.newPage();
if (REDUCED_MOTION) await page.emulateMedia({ reducedMotion: "reduce" });

let cdp = null;
try {
  cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
} catch (e) { report.notes.push(`CDP unavailable: ${e.message}`); cdp = null; }

// Fault injection. Playwright evaluates routes last-registered-first, so the 404 route wins over the delay.
if (DELAY_OPT > 0) await page.route(/\/assets\/opt\//, async (route) => { await sleep(DELAY_OPT); await route.continue().catch(() => {}); });
if (FAIL_WEBP) await page.route(/\.webp(\?.*)?$/, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "injected 404" }));

const isResourceMessage = (m) => {
  const text = m.text();
  const loc = (typeof m.location === "function" && m.location()) || {};
  const url = loc.url || "";
  if (/Failed to load resource|net::ERR_|the server responded with a status of/i.test(text)) return true;
  return !!url && /\.(webp|png|jpe?g|gif|svg|ico|wav|mp3|m4a|ogg|woff2?|ttf)(\?|$)/i.test(url);
};
page.on("console", (m) => {
  const t = m.type();
  const loc = (typeof m.location === "function" && m.location()) || {};
  const text = loc.url ? `${m.text()} @ ${loc.url}` : m.text();
  if (t === "error") {
    if (isResourceMessage(m)) report.resourceErrors.push(text);
    else if (IGNORE_ERRORS && IGNORE_ERRORS.test(text)) report.ignoredErrors.push(text);
    else report.consoleErrors.push(text);
  } else if (t === "warning") report.consoleWarnings.push(text);
});
page.on("pageerror", (e) => {
  const text = String(e && e.stack || e);
  if (IGNORE_ERRORS && IGNORE_ERRORS.test(text)) report.ignoredErrors.push(text); else report.pageErrors.push(text);
});
page.on("requestfailed", (r) => report.requestFailures.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) report.httpErrors.push({ url: r.url(), status: r.status() }); });

let navEpoch = Date.now();
const originPrefix = FILE_MODE ? "" : `http://127.0.0.1:${port}`;
page.on("requestfinished", async (req) => {
  try {
    const sizes = await req.sizes();
    const timing = req.timing();
    const resp = await req.response();
    const url = req.url().startsWith(originPrefix) && originPrefix ? req.url().slice(originPrefix.length) : req.url();
    report.network.push({
      url,
      bytes: (sizes.responseBodySize || 0) + (sizes.responseHeadersSize || 0),
      start: Math.round(timing.startTime - navEpoch),
      end: Math.round(timing.startTime + Math.max(0, timing.responseEnd) - navEpoch),
      status: resp ? resp.status() : null,
      type: req.resourceType()
    });
  } catch {}
});

const G = () => (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);

async function shot(name) {
  const idx = SHOT_INDEX[name] || ++extraShot;
  const file = path.join(OUT, `${String(idx).padStart(2, "0")}-${name}.png`);
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

async function probeMark() { await page.evaluate(() => window.__typerProbe && window.__typerProbe.mark()).catch(() => {}); }
async function probeSnapshot() { return page.evaluate(() => window.__typerProbe ? window.__typerProbe.snapshot() : null).catch(() => null); }
async function probeTotal() { return page.evaluate(() => window.__typerProbe ? window.__typerProbe.total() : null).catch(() => null); }

// fps + canvas counters over the same window, keyed by scene name.
async function measureScene(name, ms) {
  await probeMark();
  report.fps[name] = await measureFps(ms);
  report.perf[name] = await probeSnapshot();
}

async function cdpMetrics() {
  if (!cdp) return null;
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (n) => { const m = metrics.find(x => x.name === n); return m ? m.value : null; };
    return { t: Date.now(), layout: get("LayoutCount"), recalc: get("RecalcStyleCount"), heap: get("JSHeapUsedSize"), taskDuration: get("TaskDuration") };
  } catch { return null; }
}

// What a competent player would type next (amendment C-14 priority order).
async function nextKey() {
  return page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    if (!g) return null;
    try {
      if (g.levelIntro) return null;
      if (g.bossIntro && g.bossIntro.locked) return null;
      const nc = (o) => { if (!o) return null; const v = typeof o.nextChar === "function" ? o.nextChar() : o.nextChar; return v || null; };
      if (g.inBoss && g.boss) {
        let c = nc(g.boss);
        if (!c && Array.isArray(g.boss.segments) && typeof g.boss.segmentIndex === "number") {
          const seg = g.boss.segments[g.boss.segmentIndex];
          if (seg) c = seg[g.boss.progress || 0] || null;
        }
        if (c) return c;
      }
      if (g.lock && g.lock.ref && g.lock.ref.alive !== false) { const c = nc(g.lock.ref); if (c) return c; }
      const w = g.w || 1280;
      const targetable = (e) => (typeof g.isTargetable === "function") ? g.isTargetable(e) : (e.x < w - 10);
      const pick = (arr) => {
        const pool = (arr || []).filter(e => e && e.alive !== false && !e.dying && targetable(e));
        pool.sort((a, b) => a.x - b.x);
        for (const e of pool) { const c = nc(e); if (c) return c; }
        return null;
      };
      return pick(g.enemies) || pick(g.powerups);
    } catch { return null; }
  });
}

async function state() {
  return page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    if (!g) return null;
    return {
      mode: g.mode, levelIndex: g.levelIndex, levelT: Math.round((g.levelT || 0) * 10) / 10, inBoss: !!g.inBoss,
      bossClear: !!g.bossClear, hp: g.player && g.player.hp, score: g.stats && g.stats.score, combo: g.stats && g.stats.combo,
      enemies: (g.enemies || []).length, powerups: (g.powerups || []).length, particles: (g.particles || []).length,
      wave: g.wave, wavePhase: g.wavePhase, levelIntro: !!g.levelIntro, bossIntroLocked: !!(g.bossIntro && g.bossIntro.locked),
      reduceMotion: g.reduceMotion, renderScale: g.renderScale, touchMode: g.touchMode
    };
  });
}

let firstKeyAt = null;
let tappedCanvas = false;
async function pressKey(k) {
  if (MOBILE) {
    if (!tappedCanvas) {
      tappedCanvas = true;
      await page.locator("#game").tap({ force: true }).catch(() => page.click("#game", { force: true }).catch(() => {}));
      await sleep(150);
    }
    const viaInput = await page.evaluate(() => {
      const el = document.getElementById("typeInput");
      if (!el) return false;
      if (document.activeElement !== el) { try { el.focus({ preventScroll: true }); } catch {} }
      return document.activeElement === el;
    }).catch(() => false);
    if (viaInput) { await page.keyboard.insertText(k); return; }
  }
  await page.keyboard.press(k === " " ? "Space" : k);
}

async function autoType(seconds, { accuracy = ACCURACY, wpm = WPM, until = null } = {}) {
  const t0 = Date.now();
  const interval = 60000 / (Math.max(1, wpm) * 5);
  let typed = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const loopStart = Date.now();
    const st = await state();
    if (until && st && until(st)) break;
    if (!st || st.mode !== "playing") { await sleep(80); continue; }
    const k = await nextKey();
    if (k) {
      const wrong = Math.random() > accuracy;
      const key = wrong ? "abcdefghijklmnopqrstuvwxyz".replace(k, "")[Math.floor(Math.random() * 25)] : k;
      await pressKey(key);
      if (firstKeyAt === null) { firstKeyAt = Date.now(); report.timings.firstKeystrokeMs = firstKeyAt - navEpoch; }
      typed++;
      const jitter = interval * (0.8 + Math.random() * 0.4);
      await sleep(Math.max(5, jitter - (Date.now() - loopStart)));
    } else {
      await sleep(60);
    }
  }
  return typed;
}

async function waitNoIntro(ms = 4000) {
  await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && !g.levelIntro; }, null, { timeout: ms }).catch(() => {});
}

async function forceBoss() {
  await waitNoIntro();
  await page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
    const L = (typeof LEVELS !== "undefined" && LEVELS) || (window.TypeRDebug && window.TypeRDebug.LEVELS) || (window.TypeR && window.TypeR.LEVELS);
    if (g && L && L[g.levelIndex]) g.levelT = L[g.levelIndex].duration + 0.01;
    else if (g && typeof g.beginBossFight === "function") g.beginBossFight();
  });
  const typeable = () => { const g = (typeof game !== "undefined" && game) || window.game; return !!(g && g.inBoss && !(g.bossIntro && g.bossIntro.locked)); };
  const ok = await page.waitForFunction(typeable, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (ok) return true;
  report.notes.push("forceBoss: boss not typeable 15 s after levelT = duration; calling beginBossFight() directly");
  await page.evaluate(() => { const g = (typeof game !== "undefined" && game) || window.game; if (g && typeof g.beginBossFight === "function" && !g.inBoss) g.beginBossFight(); });
  return page.waitForFunction(typeable, null, { timeout: 8000 }).then(() => true).catch(() => { report.notes.push("forceBoss: boss never became typeable"); return false; });
}

async function waitPlaying(ms = 60000) {
  return page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && g.mode === "playing"; }, null, { timeout: ms }).then(() => true).catch(() => false);
}

async function visible(sel) {
  const loc = page.locator(sel);
  return (await loc.count().catch(() => 0)) > 0 && await loc.first().isVisible().catch(() => false);
}

async function enabled(sel) {
  return page.locator(sel).first().isEnabled().catch(() => false);
}

// Menu → playing. Fixture runs press Continue (or the saved sector's card) unless told otherwise.
async function enterGame() {
  let entry = ENTRY;
  if (entry === "auto") {
    if (fixture && fixture.entry) entry = fixture.entry;
    else if (fixture && fixture.save && (fixture.save.run || (fixture.save.lastUnlockedLevel || 1) > 1)) entry = "continue";
    else entry = "start";
  }
  let used = entry;
  if (entry === "continue") {
    if (await visible("#btnContinue") && await enabled("#btnContinue")) {
      await page.click("#btnContinue");
    } else {
      const lvl = fixture && fixture.expect && fixture.expect.levelIndex != null ? fixture.expect.levelIndex + 1 : null;
      const card = lvl ? `.sectorCard[data-level="${lvl}"]` : null;
      if (card && await visible(card) && await enabled(card)) { await page.click(card); used = `sector:${lvl}`; }
      else { report.notes.push("entry: Continue unavailable, used Start"); await page.click("#btnStart"); used = "start"; }
    }
  } else {
    await page.click("#btnStart");
  }
  report.entryUsed = used;
  // Story modal (first run only): wait up to 4 s for either the modal or playing mode.
  const story = page.locator("#btnStoryLaunch");
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if (await story.isVisible().catch(() => false)) { await shot("story"); await story.click(); break; }
    const st = await state();
    if (st && st.mode === "playing") break;
    await sleep(100);
  }
}

async function checkFixture() {
  if (!fixture) return;
  const exp = fixture.expect || {};
  const details = [];
  let pass = true;
  const note = (ok, text) => { details.push(`${ok ? "ok" : "FAIL"}: ${text}`); if (!ok) pass = false; };
  const snap = await page.evaluate(() => {
    const g = (typeof game !== "undefined" && game) || window.game;
    const L = (typeof LEVELS !== "undefined" && LEVELS) || (window.TypeRDebug && window.TypeRDebug.LEVELS) || [];
    if (!g) return null;
    const cfg = L[g.levelIndex] || {};
    return { mode: g.mode, levelIndex: g.levelIndex, levelT: g.levelT, duration: cfg.duration, inBoss: !!g.inBoss, score: g.stats && g.stats.score,
      highScore: g.save && g.save.highScore, lastUnlockedLevel: g.save && g.save.lastUnlockedLevel, schema: g.save && g.save.schema,
      runId: g.save && g.save.run && g.save.run.id, hasCheckpoint: !!(g.save && g.save.run && g.save.run.checkpoint), playerName: g.save && g.save.playerName };
  });
  if (!snap) { report.fixture.check = { pass: false, details: ["game object missing"] }; return; }
  if (exp.levelIndex != null) note(snap.levelIndex === exp.levelIndex, `levelIndex ${snap.levelIndex} (expected ${exp.levelIndex})`);
  if (exp.scoreMin != null) note((snap.score || 0) >= exp.scoreMin, `score ${snap.score} (expected >= ${exp.scoreMin})`);
  if (exp.highScore != null) note(snap.highScore === exp.highScore, `highScore ${snap.highScore} (expected ${exp.highScore})`);
  if (exp.lastUnlockedLevel != null) note(snap.lastUnlockedLevel === exp.lastUnlockedLevel, `lastUnlockedLevel ${snap.lastUnlockedLevel} (expected ${exp.lastUnlockedLevel})`);
  if (exp.playerName != null) note(snap.playerName === exp.playerName, `playerName "${snap.playerName}" (expected "${exp.playerName}")`);
  if (exp.levelTBelowDuration) note(snap.duration == null || snap.levelT < snap.duration, `levelT ${Math.round(snap.levelT * 10) / 10} < duration ${snap.duration}`);
  if (exp.inBossWithinS != null) {
    const t0 = Date.now();
    const ok = await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && g.inBoss; }, null, { timeout: exp.inBossWithinS * 1000 }).then(() => true).catch(() => false);
    note(ok, `inBoss after ${Math.round((Date.now() - t0) / 100) / 10} s (expected within ${exp.inBossWithinS} s)`);
  }
  if (exp.notInBossForS != null) {
    await sleep(exp.notInBossForS * 1000);
    const st = await state();
    note(!(st && st.inBoss), `still in wave play ${exp.notInBossForS} s after Continue (inBoss=${st && st.inBoss})`);
  }
  report.fixture.check = { pass, details, snapshot: snap };
  console.log(`[fixture] check ${pass ? "PASS" : "FAIL"}: ${details.join("; ")}`);
}

// ----------------------------- Scenario -----------------------------
try {
  navEpoch = Date.now();
  await page.goto(base, { waitUntil: "load" });
  report.timings.loadEventMs = Date.now() - navEpoch;
  await shot("boot");
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById("loadingOverlay");
      return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden" || getComputedStyle(el).display === "none";
    }, null, { timeout: 120000 });
  } catch { report.notes.push("loading overlay never hid within 120s"); }
  report.timings.assetsReadyMs = Date.now() - navEpoch;
  const kb = page.locator("#btnKeyboardHint");
  if (await kb.isVisible().catch(() => false)) await kb.click();
  await shot("menu");
  await measureScene("menu", 1500);

  if (!(fixture && fixture.save && fixture.save.playerName)) await page.fill("#playerName", "HARNESS").catch(() => {});
  const tStart = Date.now();
  await enterGame();
  if (!(await waitPlaying(15000))) {
    // The click path stalled (today: unlock() awaiting music elements under the native UA). Enter play
    // directly so the rest of the scenario still runs, and say so loudly; startToPlayingMs keeps the truth.
    report.notes.push("entry: Start/Continue did not reach playing within 15 s; forced the run start directly (check the audio unlock path)");
    await page.evaluate((entry) => {
      const g = (typeof game !== "undefined" && game) || window.game;
      if (!g || g.mode === "playing") return;
      if (entry === "continue" && typeof g.continueRun === "function" && g.save && g.save.run) g.continueRun();
      else if (typeof g.startNewRun === "function") g.startNewRun();
      if (typeof g.hideStoryModal === "function") g.hideStoryModal();
    }, report.entryUsed).catch(() => {});
    if (!(await waitPlaying(30000))) report.notes.push("never entered playing mode");
  }
  report.timings.startToPlayingMs = Date.now() - tStart;
  await checkFixture();

  await sleep(2500);
  await shot("gameplay-early");
  const m0 = await cdpMetrics();
  await probeMark();
  const typed1 = await autoType(SECONDS);
  const m1 = await cdpMetrics();
  if (m0 && m1 && m1.t > m0.t) {
    const span = m1.t - m0.t;
    report.layoutCountPer5s = Math.round((m1.layout - m0.layout) / span * 5000 * 10) / 10;
    report.recalcStyleCountPer5s = Math.round((m1.recalc - m0.recalc) / span * 5000 * 10) / 10;
    report.jsHeapUsedMB = Math.round(m1.heap / 1048576 * 10) / 10;
  }
  report.perf.typing = await probeSnapshot();
  report.typedWave = typed1;
  report.stateAfterWave = await state();
  await shot("gameplay-mid");
  await measureScene("gameplay", 2000);

  if (SCENARIO === "all") {
    await page.keyboard.press("Escape"); await sleep(400); await shot("paused"); await page.keyboard.press("Escape"); await sleep(300);

    // Boss
    await forceBoss();
    await sleep(1200);
    await shot("boss-intro");
    await sleep(1800);
    await shot("boss-fight");
    await measureScene("boss", 1500);
    await autoType(90, { until: (s) => s.bossClear || s.mode !== "playing" });
    report.stateAfterBoss = await state();
    if (report.stateAfterBoss && report.stateAfterBoss.bossClear) await measureScene("finale", 1200);
    else await sleep(1200);
    await shot("boss-finale");
    await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && g.mode !== "playing"; }, null, { timeout: 20000 })
      .catch(() => report.notes.push("boss finale did not end within 20s"));
    await sleep(600);
    report.stateAfterFinale = await state();
    await shot("level-complete");

    // Next level, then game over
    if (await visible("#btnNextLevel")) await page.click("#btnNextLevel");
    else { report.notes.push("#btnNextLevel not visible; called advanceLevel()"); await page.evaluate(() => { const g = window.game; if (g && typeof g.advanceLevel === "function") g.advanceLevel(); }); }
    await sleep(1500);
    await shot("level2-start");
    report.stateLevel2 = await state();
    await page.evaluate(() => { const g = (typeof game !== "undefined" && game) || window.game; if (g && g.player) g.player.hp = 5; });
    await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && g.mode === "gameOver"; }, null, { timeout: 60000 })
      .catch(() => report.notes.push("game over not reached in 60s"));
    await sleep(500);
    await shot("game-over");

    // Victory: jump to sector 10 and force its boss (amendment B-5). This path exists to exercise the
    // ending, not to measure balance, so the typist is fast and the hull is what a real sector-10 run has.
    await page.evaluate(() => {
      const g = (typeof game !== "undefined" && game) || window.game || (window.TypeR && window.TypeR.game);
      if (!g) return;
      if (typeof g.startSector === "function") g.startSector(9);
      else {
        if (typeof g.startNewRun === "function") g.startNewRun();
        if (typeof g.startLevel === "function") g.startLevel(9, { fromMenu: true, fresh: true });
      }
      if (g.player && typeof getHpBonusForLevel === "function") {
        const full = getHpBonusForLevel(10);
        if (g.player.maxHp < full) { g.player.maxHp = full; g.player.hp = full; }
      }
    });
    await sleep(800);
    await forceBoss();
    await sleep(2500);
    await shot("final-boss");
    report.stateFinalBoss = await state();
    await autoType(240, { accuracy: 0.995, wpm: Math.max(WPM, 160), until: (s) => s.bossClear || s.mode !== "playing" });
    if (!report.fps.finale) {
      const s = await state();
      if (s && s.bossClear) await measureScene("finale", 1200);
    }
    await page.waitForFunction(() => { const g = (typeof game !== "undefined" && game) || window.game; return g && g.mode === "victory"; }, null, { timeout: 30000 })
      .catch(() => report.notes.push("victory not reached"));
    await sleep(600);
    await shot("victory");
    const adv = page.locator("#btnEndingNext");
    for (let i = 0; i < 3 && await adv.isVisible().catch(() => false); i++) { await adv.click(); await sleep(250); }
    await shot("victory-dialogue");
    if (await visible("#btnBackToMenu3")) await page.click("#btnBackToMenu3");
    else { report.notes.push("#btnBackToMenu3 not visible; called stopToMenu()"); await page.evaluate(() => { const g = window.game; if (g && typeof g.stopToMenu === "function") g.stopToMenu(true); }); }
    await sleep(500);
    await shot("menu-after");
  }
  report.finalState = await state();
  report.saveBlob = await page.evaluate((key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, LS_KEY);
  report.debugStats = await page.evaluate(() => { try { return (window.TypeRDebug && typeof window.TypeRDebug.stats === "function") ? window.TypeRDebug.stats() : null; } catch (e) { return { error: String(e) }; } });
  report.reduceMotion = await page.evaluate(() => ({
    rootClass: document.documentElement.classList.contains("reduce-motion"),
    gameFlag: !!(window.game && window.game.reduceMotion),
    mediaQuery: matchMedia("(prefers-reduced-motion: reduce)").matches
  })).catch(() => null);
  report.canvas = await page.evaluate(() => {
    const c = document.getElementById("game");
    return c ? { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight, dpr: devicePixelRatio } : null;
  }).catch(() => null);
} catch (e) {
  report.harnessError = String(e && e.stack || e);
} finally {
  await sleep(250); // let pending requestfinished handlers settle
  report.probe = await probeTotal();
  if (report.probe) {
    report.maxRenderMs = report.probe.maxRenderMs;
    const scenes = ["gameplay", "boss", "finale", "typing"].map(k => report.perf[k]).filter(Boolean);
    report.shadowBlurPerFrame = scenes.length ? Math.max(...scenes.map(s => s.shadowBlurPerFrame)) : report.probe.shadowBlurPerFrame;
    report.fullFrameFillMaxAlpha = scenes.length ? Math.max(...scenes.map(s => s.fullFrameFillMaxAlpha)) : report.probe.fullFrameFillMaxAlpha;
    report.getImageDataCalls = report.probe.getImageDataCalls;
  }
  const fk = firstKeyAt ? firstKeyAt - navEpoch : null;
  const byType = {}; const byUrl = {};
  let overall = 0, startedBefore = 0, finishedBefore = 0;
  for (const n of report.network) {
    overall += n.bytes;
    byType[n.type] = (byType[n.type] || 0) + n.bytes;
    const key = n.url.split("?")[0];
    byUrl[key] = (byUrl[key] || 0) + n.bytes;
    if (fk !== null && n.start <= fk) startedBefore += n.bytes;
    if (fk !== null && n.end <= fk) finishedBefore += n.bytes;
  }
  report.network.sort((a, b) => a.start - b.start);
  report.networkTotals = {
    requests: report.network.length,
    overallBytes: overall,
    firstKeystrokeMs: fk,
    bytesStartedBeforeFirstKeystroke: fk !== null ? startedBefore : null,
    bytesFinishedBeforeFirstKeystroke: fk !== null ? finishedBefore : null,
    byType,
    topUrls: Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([url, bytes]) => ({ url, bytes }))
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close().catch(() => {});
  if (server) server.close();
}

const bad = report.pageErrors.length + report.consoleErrors.length + (report.harnessError ? 1 : 0);
const mb = (b) => (b == null ? null : Math.round(b / 1048576 * 100) / 100);
console.log(JSON.stringify({
  out: OUT,
  pageErrors: report.pageErrors.length,
  consoleErrors: report.consoleErrors.length,
  resourceErrors: report.resourceErrors.length,
  resourceErrorsExpected: EXPECT_RESOURCE_ERRORS,
  ignoredErrors: report.ignoredErrors.length,
  warnings: report.consoleWarnings.length,
  requestFailures: report.requestFailures.length,
  httpErrors: report.httpErrors.length,
  fps: report.fps,
  maxRenderMs: report.maxRenderMs ?? null,
  shadowBlurPerFrame: report.shadowBlurPerFrame ?? null,
  fullFrameFillMaxAlpha: report.fullFrameFillMaxAlpha ?? null,
  layoutCountPer5s: report.layoutCountPer5s ?? null,
  networkMB: { toFirstKeystroke: mb(report.networkTotals.bytesFinishedBeforeFirstKeystroke), overall: mb(report.networkTotals.overallBytes) },
  timings: report.timings,
  fixture: report.fixture ? { name: report.fixture.name, check: report.fixture.check && report.fixture.check.pass } : null,
  notes: report.notes,
  screenshots: report.screenshots.length,
  harnessError: report.harnessError || null
}, null, 2));
if (report.resourceErrors.length && !EXPECT_RESOURCE_ERRORS) console.log(`note: ${report.resourceErrors.length} resource-load error(s) recorded in report.resourceErrors (not counted in the exit code)`);
process.exit(bad ? 1 : 0);
