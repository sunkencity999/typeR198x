// Probe for assets/js/core/50-assets.js (the `Assets` loader, CONTRACT §5 + amendments B-1/B-17/C-2/C-4).
// Usage (from tools/playtest):
//   node probes/assets-loader.mjs [--root ../..] [--out ./out/assets-loader] [--headed]
// Serves the repository root over HTTP (Cache-Control: max-age=3600, like production), opens
// probes/assets-loader.html (manifest.js + 00-util + 20-constants + 30-content + 50-assets only) and checks:
//   - every manifest key resolves to files that exist (HEAD on each x1/x2/src/fallback URL)
//   - load() of a key whose .webp is routed to 404 falls back to the PNG master; a key whose PNG also 404s
//     resolves null and emits exactly one 'error'
//   - sprite('ships/coconut',150) matches the manifest crop (B-1); the PNG-fallback path reports the full box
//   - loadLevel(0) resolves with three drawables; gc keeps the pin set; stats() has the contract shape
//   - prepare() yields an ImageBitmap of the requested device size at renderScale 2 (+ the canvas fallback)
//   - levelKeys(i) for i=0..9 never names seventh/eighth/ninth under the LEVEL_THEMES mapping (stubbed if the
//     content track has not landed) and Assets.url() returns bare paths under the native shell UA (B-17)
// Exit code 1 if any check fails. Writes <out>/report.json and <out>/preview.png.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
const ROOT = path.resolve(args.root || path.join(HERE, "..", "..", ".."));
const OUT = path.resolve(args.out || path.join(HERE, "..", "out", "assets-loader"));
const HEADED = args.headed === "true";
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2"
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
        const st = fs.statSync(fp);
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream",
          "Content-Length": st.size,
          "Cache-Control": urlPath.startsWith("/assets/") ? "public, max-age=3600" : "no-cache"
        });
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const report = { root: ROOT, checks: [], consoleErrors: [], resourceErrors: [], pageErrors: [], requests: {}, notes: [] };
const check = (name, pass, evidence) => {
  report.checks.push({ name, pass: !!pass, evidence: evidence === undefined ? "" : String(evidence) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${evidence !== undefined ? "  -- " + String(evidence) : ""}`);
};
const stripQuery = (u) => u.replace(/[?#].*$/, "");
const EXPECTED_ARTS = ["first", "sixth", "third", "fourth", "fifth", "third", "second", "fourth", "fifth", "tenth"];
const LEVEL_THEMES_STUB = `
const LEVEL_THEMES = [{art:"first"},{art:"sixth"},{art:"third"},{art:"fourth"},{art:"fifth"},{art:"third",storm:true},{art:"second"},{art:"fourth",storm:true},{art:"fifth",storm:true},{art:"tenth"}];
const getThemeForLevel = (index) => {
  const m = LEVEL_THEMES[Math.max(0, Math.min(LEVEL_THEMES.length - 1, index | 0))];
  const base = PARALLAX_THEMES.find((t) => t.id === m.art) || PARALLAX_THEMES[0];
  return { ...base, art: m.art, storm: !!m.storm };
};`;

const { server, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}`;
const probeUrl = `${base}/tools/playtest/probes/assets-loader.html`;

// ------------------------------------------------------------------ 1. manifest files exist (HEAD)
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/opt/manifest.json"), "utf8"));
const manifestKeys = Object.keys(manifest.images);
{
  const urls = new Set();
  for (const e of Object.values(manifest.images)) for (const s of [e.src, e.x1 && e.x1.src, e.x2 && e.x2.src, e.fallback]) if (s) urls.add(s);
  for (const m of manifest.music) urls.add(m);
  for (const s of Object.values(manifest.sfx)) urls.add(s);
  const missing = [];
  for (const u of urls) {
    const res = await fetch(`${base}/${u.replace(/^\.\//, "")}`, { method: "HEAD" });
    if (res.status !== 200) missing.push(`${u} -> ${res.status}`);
  }
  check("manifest: every referenced file answers HEAD 200", missing.length === 0, missing.length ? missing.join(", ") : `${urls.size} urls`);
  const dup = manifestKeys.filter((k) => /^(bg|fg)\/(seventh|eighth|ninth)$/.test(k));
  check("manifest: no seventh/eighth/ninth keys", dup.length === 0, dup.join(",") || `${manifestKeys.length} keys`);
  const stale = ["bg", "fg"].flatMap((k) => ["seventh", "eighth", "ninth"].flatMap((t) => [1, 2].map((s) => `assets/opt/${k}/${t}@${s}x.webp`))).filter((f) => fs.existsSync(path.join(ROOT, f)));
  check("opt tree: duplicate theme files removed", stale.length === 0, stale.join(",") || "none present");
}

// ------------------------------------------------------------------ browser
let browser;
try { browser = await chromium.launch({ channel: "chrome", headless: !HEADED }); }
catch { browser = await chromium.launch({ headless: !HEADED }); }

function wirePage(page, tag) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource/.test(text)) report.resourceErrors.push(`${tag}: ${text} ${m.location()?.url || ""}`);
    else report.consoleErrors.push(`${tag}: ${text}`);
  });
  page.on("pageerror", (e) => report.pageErrors.push(`${tag}: ${String(e && e.stack || e)}`));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.includes("/assets/")) return;
    const k = stripQuery(u).replace(base, "");
    (report.requests[k] = report.requests[k] || []).push(u.replace(base, ""));
  });
}

async function fail404(page, globs) {
  for (const g of globs) await page.route(g, (route) => route.fulfill({ status: 404, body: "probe 404" }));
}

try {
  // ---------------------------------------------------------------- 2. main context (DPR 1)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  wirePage(page, "main");
  await fail404(page, [
    "**/assets/opt/bg/sixth@*.webp*",            // webp 404 -> PNG master works
    "**/assets/opt/ships/honeybee@*.webp*",      // trimmed sprite falling back to the untrimmed master
    "**/assets/opt/bosses/9@*.webp*",            // webp AND png 404 -> one 'error'
    "**/assets/boss_ships/ninthlevelboss.png*"
  ]);
  await page.goto(probeUrl, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.TypeRAssets, null, { timeout: 15000 });

  const boot = await page.evaluate((keyCount) => {
    window.__assetEvents = { error: [], progress: [], ready: [] };
    for (const ev of ["error", "progress", "ready"]) Assets.on(ev, (p) => window.__assetEvents[ev].push(p));
    Assets.init({ renderScale: 1 });
    const st = Assets.stats();
    return {
      bootReason: st.bootReason, totalCount: st.totalCount, keyCount, variant: Assets.variant,
      sameObject: window.TypeRAssets === Assets, version: Assets.version,
      urlBg: Assets.url("bg/first"), urlShipX1: Assets.url("ships/coconut", "x1"), urlShipDefault: Assets.url("ships/coconut"),
      urlFallback: Assets.url("bosses/1", "fallback"), urlUnknown: Assets.url("nope/none")
    };
  }, manifestKeys.length);
  check("init: reads window.TYPER_ASSET_MANIFEST", boot.bootReason === "manifest" && boot.totalCount === boot.keyCount, JSON.stringify({ bootReason: boot.bootReason, totalCount: boot.totalCount }));
  check("init: window.TypeRAssets === Assets", boot.sameObject);
  check("variant: x1 at renderScale 1", boot.variant === "x1", boot.variant);
  check("url: opt files carry ?v=<manifest.version>", boot.urlBg === `./assets/opt/bg/first@1x.webp?v=${manifest.version}`, boot.urlBg);
  check("url: ships resolve to x1 by default (C-2)", boot.urlShipDefault === boot.urlShipX1 && /ships\/coconut@1x\.webp\?v=/.test(boot.urlShipX1), boot.urlShipDefault);
  check("url: fallback variant is the PNG master with ?v=", /\/assets\/boss_ships\/firstlevelBoss\.png\?v=/.test(boot.urlFallback), boot.urlFallback);
  check("url: unknown key -> null", boot.urlUnknown === null);

  // sprite math before anything is loaded (B-1)
  const entry = manifest.images["ships/coconut"];
  const k = 150 / entry.orig.w;
  const expected = { x: entry.crop.x * k, y: entry.crop.y * k, w: entry.crop.w * k, h: entry.crop.h * k };
  const spriteBefore = await page.evaluate(() => Assets.sprite("ships/coconut", 150));
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check("sprite: ships/coconut@150 matches crop*k before load (img null)", spriteBefore.img === null && near(spriteBefore.x, expected.x) && near(spriteBefore.y, expected.y) && near(spriteBefore.w, expected.w) && near(spriteBefore.h, expected.h), JSON.stringify(spriteBefore) + " expected " + JSON.stringify(expected));

  // memoisation + one request per URL
  const memo = await page.evaluate(async () => {
    const [a, b] = await Promise.all([Assets.load("ships/coconut", { priority: "high" }), Assets.load("ships/coconut")]);
    const c = await Assets.load("ships/coconut");
    const s = Assets.sprite("ships/coconut", 150);
    return { same: a === b && b === c && !!a, kind: a && a.constructor && a.constructor.name, w: a && a.width, h: a && a.height, sprite: { x: s.x, y: s.y, w: s.w, h: s.h, hasImg: !!s.img } };
  });
  check("load: memoised (three calls, one drawable)", memo.same, `${memo.kind} ${memo.w}x${memo.h}`);
  check("sprite: same box after load, img present", memo.sprite.hasImg && near(memo.sprite.x, expected.x) && near(memo.sprite.w, expected.w), JSON.stringify(memo.sprite));
  const shipBox = { w: Math.round(expected.w / 150 * 168 * 1.5), h: Math.round(expected.h / 150 * 168 * 1.5) };
  check("prepare: ship auto-prepared at sprite(key,168) box x1.5 (renderScale 1)", memo.kind === "ImageBitmap" && memo.w === shipBox.w && memo.h === shipBox.h, `${memo.w}x${memo.h} expected ${shipBox.w}x${shipBox.h}`);

  // fallback paths
  const fb = await page.evaluate(async () => {
    const bg = await Assets.load("bg/sixth", { priority: "high" });
    const hb = await Assets.load("ships/honeybee", { priority: "high" });
    const s = Assets.sprite("ships/honeybee", 150);
    const meta = Assets.meta("ships/honeybee");
    return { bgOk: !!bg, bgW: bg && bg.width, hbOk: !!hb, sprite: { x: s.x, y: s.y, w: s.w, h: s.h }, metaHasCrop: !!(meta && meta.crop), errors: Assets.stats().errors.length, errorEvents: window.__assetEvents.error.length };
  });
  check("load: webp 404 -> PNG master fallback resolves a drawable, no error", fb.bgOk && fb.hbOk && fb.errors === 0 && fb.errorEvents === 0, JSON.stringify(fb));
  const hbEntry = manifest.images["ships/honeybee"];
  check("sprite: PNG-fallback of a trimmed key reports the full untrimmed box", fb.metaHasCrop && near(fb.sprite.x, 0) && near(fb.sprite.y, 0) && near(fb.sprite.w, 150) && near(fb.sprite.h, 150 * hbEntry.orig.h / hbEntry.orig.w), JSON.stringify(fb.sprite));

  const err = await page.evaluate(async () => {
    const a = await Assets.load("bosses/9", { priority: "high" });
    const b = await Assets.load("bosses/9");
    const st = Assets.stats();
    return { a, b, errors: st.errors, errorEvents: window.__assetEvents.error.map((e) => e.key), get: Assets.get("bosses/9") };
  });
  check("load: webp+png 404 -> resolves null, exactly one 'error' event, memoised", err.a === null && err.b === null && err.errorEvents.length === 1 && err.errorEvents[0] === "bosses/9" && err.errors.length === 1 && err.get === null, JSON.stringify(err.errors));

  // loadLevel / loadMany progress
  const lvl = await page.evaluate(async () => {
    const keys = Assets.levelKeys(0);
    const progress = [];
    const many = await Assets.loadMany(keys, (p) => progress.push(p));
    const direct = await Assets.loadLevel(0);
    return { keys, manyOk: many.length === 3 && many.every(Boolean), directOk: direct.length === 3 && direct.every(Boolean), progress, kinds: direct.map((d) => d && d.constructor.name), sizes: direct.map((d) => d && [d.width, d.height]) };
  });
  check("loadLevel(0): resolves with three drawables", lvl.manyOk && lvl.directOk, `${lvl.keys.join(",")} -> ${lvl.kinds.join(",")} ${JSON.stringify(lvl.sizes)}`);
  check("loadMany: onProgress once per key ending at loaded===total", lvl.progress.length === 3 && lvl.progress[2].loaded === 3 && lvl.progress[2].total === 3, JSON.stringify(lvl.progress));
  const bgEntry = manifest.images[lvl.keys[0]];
  const bgH = 720 + 2 * 20, bgW = Math.round(bgEntry.orig.w * bgH / bgEntry.orig.h);
  check("prepare: bg auto-prepared at (720+2*SHAKE_PAD) tall", lvl.sizes[0] && lvl.sizes[0][0] === bgW && lvl.sizes[0][1] === bgH, `${JSON.stringify(lvl.sizes[0])} expected ${bgW}x${bgH}`);

  // preview screenshot (ship + boss + fx placement)
  await page.evaluate(async () => { await Assets.loadMany(["fx/explosions"]); window.probeDrawPreview(); });
  const previewFile = path.join(OUT, "preview.png");
  await page.locator("#preview").screenshot({ path: previewFile });
  report.notes.push(`preview: ${previewFile}`);

  // gc keeps the pin set
  const gc = await page.evaluate(async () => {
    await Assets.loadMany(["ships/little-dark-one", "ships/sofrito"]);
    const l1 = Assets.levelKeys(1);
    await Assets.loadLevel(1);
    const before = Assets.stats().resident.slice().sort();
    Assets.gc(l1);
    const after = Assets.stats().resident.slice().sort();
    return { l0: Assets.levelKeys(0), l1, before, after, pinned: Assets.pinned };
  });
  const expectKeep = new Set([...gc.pinned, ...gc.l1]);
  const kept = gc.after.every((k) => expectKeep.has(k)) && [...expectKeep].filter((k) => k !== "bosses/9").every((k) => gc.after.includes(k));
  const dropped = gc.l0.every((k) => !gc.after.includes(k));
  check("gc: keeps pins (4 ships + fx) and keepKeys, releases level 0", kept && dropped, `before=${gc.before.length} after=[${gc.after.join(",")}]`);
  const fxReq = (report.requests["/assets/opt/fx/explosions.webp"] || []).length;
  check("gc: pinned key stays resident (fx/explosions)", gc.after.includes("fx/explosions") && fxReq === 1, `requests=${fxReq}`);

  // stats shape
  const st = await page.evaluate(() => Assets.stats());
  const shapeOk = Array.isArray(st.resident) && typeof st.decodedPx === "number" && typeof st.loadedCount === "number" && typeof st.totalCount === "number" && Array.isArray(st.errors) && typeof st.bootReason === "string";
  check("stats: {resident,decodedPx,loadedCount,totalCount,errors,bootReason}", shapeOk, JSON.stringify({ ...st, resident: st.resident.length + " keys" }));

  // prepare at renderScale 2
  const prep = await page.evaluate(async () => {
    const v = Assets.setRenderScale(2);
    const bm = await Assets.prepare("bosses/2", { w: 400, h: 215 });
    const bmSize = [bm && bm.constructor.name, bm && bm.width, bm && bm.height];
    const again = await Assets.prepare("bosses/2", { w: 410, h: 220 }); // within 10%: same bitmap
    const same = bm === again && Assets.get("bosses/2") === again;
    const bigger = await Assets.prepare("bosses/2", { w: 300, h: 161 }); // >10%: new bitmap
    const urlNow = Assets.url("bosses/2");
    await new Promise((r) => setTimeout(r, 400)); // background re-prepares after the flip settle
    const fx = Assets.get("fx/explosions");
    // canvas fallback path: hide createImageBitmap, prepare a fresh size in idle slices
    const saved = window.createImageBitmap;
    window.createImageBitmap = undefined;
    const cv = await Assets.prepare("fg/first", { w: 300, h: 150 });
    window.createImageBitmap = saved;
    return {
      variant: v, kind: bmSize[0], w: bmSize[1], h: bmSize[2], same, fxW: fx && fx.width, fxH: fx && fx.height,
      biggerKind: bigger && bigger.constructor.name, biggerW: bigger && bigger.width, biggerH: bigger && bigger.height, biggerDifferent: bigger !== bm,
      urlNow, cvKind: cv && cv.constructor.name, cvW: cv && cv.width, cvH: cv && cv.height, decodedPx: Assets.stats().decodedPx, sheetScale: Assets.sheetScale("fx/explosions")
    };
  });
  check("setRenderScale(2): variant x2, urls switch to @2x", prep.variant === "x2" && /bosses\/2@2x\.webp/.test(prep.urlNow), prep.urlNow);
  check("prepare: ImageBitmap of round(w*2) x round(h*2)", prep.kind === "ImageBitmap" && prep.w === 800 && prep.h === 430, `${prep.kind} ${prep.w}x${prep.h}`);
  check("prepare: within 10% returns the resident bitmap; >10% re-prepares", prep.same && prep.biggerDifferent && prep.biggerW === 600 && prep.biggerH === 322, `${prep.biggerKind} ${prep.biggerW}x${prep.biggerH}`);
  check("prepare: canvas fallback yields a canvas of the requested device size", prep.cvKind === "HTMLCanvasElement" && prep.cvW === 600 && prep.cvH === 300, `${prep.cvKind} ${prep.cvW}x${prep.cvH}`);
  check("sheetScale: fx/explosions re-prepared to the full sheet after the flip to x2", prep.sheetScale === 1 && prep.fxW === 2816 && prep.fxH === 1536, `sheetScale=${prep.sheetScale} sheet=${prep.fxW}x${prep.fxH} decodedPx=${prep.decodedPx}`);

  // every unique URL once
  await page.waitForTimeout(400);
  const dupes = Object.entries(report.requests).filter(([, list]) => list.length > 1 && !/\/bosses\/9@|ninthlevelboss/.test(list[0]));
  check("network: each unique asset URL requested once", dupes.length === 0, dupes.map(([k, l]) => `${k} x${l.length}`).join("; ") || `${Object.keys(report.requests).length} urls`);
  const retryUrls = Object.keys(report.requests).filter((u) => /bg\/sixth@1x\.webp|sixthlevelbg\.png/.test(u));
  check("network: fallback requested the PNG master after the webp 404", retryUrls.length === 2, retryUrls.join(","));

  // ---------------------------------------------------------------- 3. levelKeys under the LEVEL_THEMES mapping
  const hasArt = await page.evaluate(() => { try { return typeof getThemeForLevel(0).art === "string"; } catch { return false; } });
  let lkPage = page;
  if (!hasArt) {
    report.notes.push("content track not landed: getThemeForLevel stubbed with LEVEL_THEMES mapping via route");
    lkPage = await ctx.newPage();
    wirePage(lkPage, "levelkeys");
    await lkPage.route("**/assets/js/core/30-content.js*", async (route) => {
      const body = fs.readFileSync(path.join(ROOT, "assets/js/core/30-content.js"), "utf8");
      const re = /const getThemeForLevel = \(index\) => \{[\s\S]*?\n\};/;
      if (!re.test(body)) return route.fulfill({ status: 500, body: "stub regex did not match" });
      await route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: body.replace(re, LEVEL_THEMES_STUB) });
    });
    await lkPage.goto(probeUrl, { waitUntil: "load" });
    await lkPage.waitForFunction(() => !!window.TypeRAssets, null, { timeout: 15000 });
  }
  const lk = await lkPage.evaluate(() => {
    Assets.init({ renderScale: 1 });
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(Assets.levelKeys(i));
    return { rows, outside: [Assets.levelKeys(-1), Assets.levelKeys(10)], missing: rows.flat().filter((k) => !Assets.meta(k)) };
  });
  const arts = lk.rows.map((r) => r[0].slice(3));
  const noDup = lk.rows.flat().every((k) => !/seventh|eighth|ninth/.test(k));
  check("levelKeys(0..9): art sequence per CONTRACT §7", JSON.stringify(arts) === JSON.stringify(EXPECTED_ARTS), arts.join(","));
  check("levelKeys(0..9): never seventh/eighth/ninth; every key in manifest", noDup && lk.missing.length === 0, lk.missing.join(",") || "all keys resolve");
  check("levelKeys: boss key is bosses/(i+1); [] outside 0..9", lk.rows.every((r, i) => r[2] === `bosses/${i + 1}`) && lk.outside.every((r) => r.length === 0), JSON.stringify(lk.rows[9]));
  const lvl10 = await lkPage.evaluate(async () => { const d = await Assets.loadLevel(9); return d.map(Boolean); });
  check("loadLevel(9): tenth + bosses/10 load", lvl10.length === 3 && lvl10.every(Boolean), JSON.stringify(lvl10));

  // ---------------------------------------------------------------- 4. native shell UA -> bare paths (B-17)
  const nativeCtx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh) TypeR198X-macOS/3.0", viewport: { width: 1280, height: 800 } });
  const nativePage = await nativeCtx.newPage();
  wirePage(nativePage, "native");
  await nativePage.goto(probeUrl, { waitUntil: "load" });
  await nativePage.waitForFunction(() => !!window.TypeRAssets, null, { timeout: 15000 });
  const nat = await nativePage.evaluate(async () => {
    Assets.init({ renderScale: 1 });
    const d = await Assets.load("ships/coconut", { priority: "high" });
    return { shell: typeof IS_NATIVE_SHELL !== "undefined" && IS_NATIVE_SHELL, url: Assets.url("bg/first"), fallback: Assets.url("bosses/1", "fallback"), loaded: !!d };
  });
  const nativeReq = Object.values(report.requests).flat().filter((u) => /ships\/coconut@1x\.webp/.test(u));
  check("native UA: Assets.url returns bare paths (no ?v=)", nat.shell && nat.url === "./assets/opt/bg/first@1x.webp" && !nat.fallback.includes("?"), `${nat.url} | ${nat.fallback}`);
  check("native UA: load works with bare paths", nat.loaded && nativeReq.some((u) => !u.includes("?")), nativeReq.join(","));
  await nativeCtx.close();

  // ---------------------------------------------------------------- 5. synthesised manifest (manifest.js missing)
  const synthCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const synthPage = await synthCtx.newPage();
  wirePage(synthPage, "synth");
  await synthPage.route("**/assets/opt/manifest.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "// manifest withheld by probe\n" }));
  await synthPage.goto(probeUrl, { waitUntil: "load" });
  await synthPage.waitForFunction(() => !!window.TypeRAssets, null, { timeout: 15000 });
  const syn = await synthPage.evaluate(async () => {
    Assets.init({ renderScale: 1 });
    const st = Assets.stats();
    const d = await Assets.load("ships/coconut", { priority: "high" });
    const s = Assets.sprite("ships/coconut", 150);
    return { bootReason: st.bootReason, total: st.totalCount, url: Assets.url("ships/coconut"), loaded: !!d, sprite: { x: s.x, y: s.y, w: s.w, h: Math.round(s.h * 1000) / 1000 }, keys: Object.keys(Assets.manifest.images).length };
  });
  check("synth manifest: orig-only entries from the content tables, PNG masters load, sprite is the full box", syn.bootReason === "synth" && syn.total === 35 && /S_S_Coconut\.png/.test(syn.url) && syn.loaded && syn.sprite.x === 0 && syn.sprite.w === 150, JSON.stringify(syn));
  await synthCtx.close();
  await ctx.close();
} catch (e) {
  report.harnessError = String(e && e.stack || e);
  console.error(report.harnessError);
} finally {
  await browser.close();
  server.close();
}

report.resourceErrorsUnexpected = report.resourceErrors.filter((t) => !/bg\/sixth@|ships\/honeybee@|bosses\/9@|ninthlevelboss|favicon\.ico/.test(t));
check("console: no page errors, no unexpected console/resource errors", report.pageErrors.length === 0 && report.consoleErrors.length === 0 && report.resourceErrorsUnexpected.length === 0, JSON.stringify({ pageErrors: report.pageErrors, consoleErrors: report.consoleErrors, unexpected: report.resourceErrorsUnexpected }));

const failed = report.checks.filter((c) => !c.pass);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed; report ${path.join(OUT, "report.json")}`);
process.exit(failed.length || report.harnessError ? 1 : 0);
