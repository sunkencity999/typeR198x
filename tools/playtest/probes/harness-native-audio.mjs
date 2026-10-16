// Records what the audio layer does on Start under a given user agent (default: the native shell UA).
// Usage: node probes/harness-native-audio.mjs --root ../.. [--ua native|"<string>"] [--wait 8000]
// Prints every HTMLMediaElement's src/readyState/networkState/error and whether the game reached
// `playing` after clicking Start, so the audio owner can see why `unlock()` stalls (A9 acceptance:
// unlock awaits only the laser/bigexplosion buffers, never music).
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"] : null).filter(Boolean));
const ROOT = path.resolve(args.root || ".");
const UA = args.ua === "native" || !args.ua ? "TypeR198X-macOS" : args.ua;
const WAIT = Number(args.wait || 8000);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2" };

const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(); }
  const stat = fs.statSync(fp); const total = stat.size;
  let start = 0, end = total - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (m) { start = Number(m[1] || 0); if (m[2]) end = Math.min(total - 1, Number(m[2])); status = 206; }
  const h = { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Content-Length": end - start + 1, "Accept-Ranges": "bytes" };
  if (status === 206) h["Content-Range"] = `bytes ${start}-${end}/${total}`;
  res.writeHead(status, h); fs.createReadStream(fp, { start, end }).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA });
await ctx.addInitScript(() => {
  // Trace every HTMLMediaElement.play()/pause() so a stalled unlock() can be attributed.
  window.__mediaLog = [];
  const P = HTMLMediaElement.prototype;
  const origPlay = P.play, origPause = P.pause;
  P.play = function () {
    const rec = { src: (this.currentSrc || this.src || "").replace(/^http:\/\/[^/]+/, ""), t: Math.round(performance.now()), settled: null };
    window.__mediaLog.push(rec);
    const r = origPlay.apply(this, arguments);
    if (r && r.then) r.then(() => { rec.settled = "resolved"; rec.tSettled = Math.round(performance.now()); }, (e) => { rec.settled = "rejected: " + (e && e.name); rec.tSettled = Math.round(performance.now()); });
    return r;
  };
  P.pause = function () { window.__mediaLog.push({ pause: (this.currentSrc || this.src || "").replace(/^http:\/\/[^/]+/, ""), t: Math.round(performance.now()) }); return origPause.apply(this, arguments); };
});
const page = await ctx.newPage();
const failures = [];
page.on("requestfailed", r => failures.push(`${r.url().replace(/^http:\/\/[^/]+/, "")} ${r.failure()?.errorText}`));
page.on("pageerror", e => console.log("pageerror:", String(e).split("\n")[0]));
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden"); }, null, { timeout: 60000 }).catch(() => console.log("loading overlay never hid"));
const t0 = Date.now();
await page.click("#btnStart");
const playing = await page.waitForFunction(() => window.game && (window.game.mode === "playing" || !document.getElementById("storyModal")?.classList.contains("hidden")), null, { timeout: WAIT }).then(() => true).catch(() => false);
const snap = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("audio, video"));
  const sfx = window.game && window.game.sfx;
  const extra = [];
  // media elements that are never attached to the DOM: look at common holders on the SFX instance
  if (sfx) for (const [k, v] of Object.entries(sfx)) {
    const list = Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
    for (const x of list) if (x && typeof HTMLMediaElement !== "undefined" && x instanceof HTMLMediaElement && !els.includes(x)) { els.push(x); extra.push(k); }
  }
  return {
    mediaLog: window.__mediaLog,
    setupPromiseState: (() => { const sfx = window.game && window.game.sfx; if (!sfx) return null; return { hasSetupPromise: !!sfx.htmlSetupPromise, audioUnavailable: window.game.audioUnavailable }; })(),
    ua: navigator.userAgent, mode: window.game && window.game.mode,
    sfxFlags: sfx ? { forceHtmlAudio: sfx.forceHtmlAudio ?? sfx.useHtmlAudio ?? null, unlocked: sfx.unlocked ?? sfx._unlocked ?? null, ctxState: sfx.ctx && sfx.ctx.state } : null,
    holders: extra,
    media: els.map(e => ({ src: (e.currentSrc || e.src || "").replace(/^http:\/\/[^/]+/, ""), readyState: e.readyState, networkState: e.networkState, error: e.error && e.error.code, paused: e.paused, preload: e.preload }))
  };
});
console.log(JSON.stringify({ ua: UA, startToPlayingOrStoryMs: playing ? Date.now() - t0 : null, enteredPlayOrStory: playing, snapshot: snap, requestFailures: failures }, null, 2));
await browser.close(); server.close();
