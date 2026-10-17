// Audio contract probe for Type-R 198X (CONTRACT section 6, tasks A9/D10/D11).
// Usage (from tools/playtest):
//   node probes/audio-contract.mjs --root ../.. [--out ./out/audio] [--legacy] [--headed]
// index.html loads assets/opt/manifest.js, so the MP3 streaming path is the default. --legacy serves a
// manifest without its music/sfx members (the art loader keeps working) so sfx.js takes the WAV fallback.
// Writes <out>/report.json; exit code 1 on any failed check.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
const ROOT = path.resolve(args.root || ".");
const OUT = path.resolve(args.out || "./out/audio");
const LEGACY = args.legacy === "true";
const HEADED = args.headed === "true";
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2" };
function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const size = fs.statSync(fp).size;
        const headers = { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range && (range[1] || range[2])) {
          // Media elements seek with Range requests (production nginx supports them); serve 206 like it does.
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
          res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
          return fs.createReadStream(fp, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, "Content-Length": size });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { root: ROOT, legacy: LEGACY, checks: [], pageErrors: [], consoleErrors: [], laser404: {}, native: {} };
let failures = 0;
function check(name, pass, evidence) {
  report.checks.push({ name, pass: !!pass, evidence });
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${evidence == null ? "" : JSON.stringify(evidence)}`);
}

const { server, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const manifestJs = fs.readFileSync(path.join(ROOT, "assets/opt/manifest.js"), "utf8");
const decodeSpy = `(() => { window.__decodes = []; const P = (window.BaseAudioContext || window.AudioContext).prototype; const orig = P.decodeAudioData; P.decodeAudioData = function (buf, ...rest) { window.__decodes.push(buf.byteLength); return orig.call(this, buf, ...rest); }; })();`;

async function newPage(context, { legacy = LEGACY } = {}) {
  const page = await context.newPage();
  const errors = [], consoleErrors = [], requests = { laser: 0, bigExplosion: 0, music: [] };
  page.on("pageerror", (e) => errors.push(String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("request", (r) => {
    const u = r.url();
    if (/laser\.wav/i.test(u)) requests.laser++;
    else if (/bigexplosion\.wav/i.test(u)) requests.bigExplosion++;
    else if (/\.mp3|galactic_high_score/i.test(u)) requests.music.push(u.replace(/^.*\/assets\//, "assets/"));
  });
  if (legacy) {
    const body = manifestJs + "\n;(function () { var m = window.TYPER_ASSET_MANIFEST; if (m) { delete m.music; delete m.sfx; } })();\n";
    await page.route(/\/assets\/opt\/manifest\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body }));
  }
  await page.addInitScript({ content: decodeSpy });
  return { page, errors, consoleErrors, requests };
}

async function boot(page) {
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).display === "none"; }, null, { timeout: 60000 });
  const kb = page.locator("#btnKeyboardHint");
  if (await kb.isVisible().catch(() => false)) await kb.click();
}

// Calls every cue with representative arguments; returns names that are missing or threw.
const exerciseRegistry = `(() => {
  const s = game.sfx;
  const calls = {
    zap: [0.5], lock: ["enemy"], lockRelease: [], lockLost: [], error: [1], explosion: [0.5], impact: [], damage: [],
    shieldHit: [], shieldBreak: [], lowHp: [true], pickup: ["MULTI"], powerDown: [], chainZap: [], comboTier: [3],
    comboBreak: [12], sectorStart: [], waveStart: [1], waveClear: [2], bossWarning: [], bossSiren: [3], segmentDown: [],
    bossPhaseClear: [], surgeCharge: [1], surgeFire: [], surgeCancel: [], bossCharge: [], bossKill: [], fanfare: ["levelClear"],
    uiTick: ["confirm"], typeTick: ["empress"], multTierUp: [2]
  };
  const names = [...SFX.CUES, ...SFX.ALIASES];
  const missing = names.filter((n) => typeof s[n] !== "function");
  const threw = [];
  for (const n of names) {
    if (typeof s[n] !== "function") continue;
    try { s[n](...(calls[n] || [])); } catch (e) { threw.push(n + ": " + e.message); }
  }
  for (const k of ["SHIELD", "RAPID", "SPREAD", "PIERCE", "REPAIR"]) { try { s.pickup(k); } catch (e) { threw.push("pickup:" + k); } }
  for (const k of ["bossDown", "victory", "gameOver"]) { try { s.fanfare(k); } catch (e) { threw.push("fanfare:" + k); } }
  for (const k of ["powerup", "boss", "go"]) { try { s.lock(k); } catch (e) { threw.push("lock:" + k); } }
  for (const k of ["back", "pause", "resume", "count", "stamp", "slam", "tick"]) { try { s.uiTick(k); } catch (e) { threw.push("uiTick:" + k); } }
  try { s.lowHp(false); } catch (e) { threw.push("lowHp:off"); }
  const transport = ["unlock", "playMusic", "prefetchMusic", "stopMusic", "fadeOutMusic", "duckMusic", "setMusicState", "bossPulse", "setMuted", "setMusicVolume", "setSfxVolume", "resumeIfNeeded", "onHidden", "onVisible", "trackForLevel"].filter((n) => typeof s[n] !== "function");
  return { missing, threw, transport, lastCue: s.lastCue, ctx: !!s.ctx };
})()`;

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, errors, consoleErrors, requests } = await newPage(context);
  await boot(page);

  // 1. Registry before unlock (ctx === null)
  const pre = await page.evaluate(exerciseRegistry);
  check("registry: every cue + alias is a function", pre.missing.length === 0 && pre.transport.length === 0, { missing: pre.missing, transport: pre.transport });
  check("registry: no cue throws before unlock (ctx null)", pre.threw.length === 0 && pre.ctx === false, pre.threw);
  check("constants: MUSIC_FOR_LEVEL[1]===5, trackForLevel(9)===3", await page.evaluate(() => game.sfx.MUSIC_FOR_LEVEL[1] === 5 && game.sfx.trackForLevel(9) === 3 && game.sfx.trackForLevel(0) === 0));

  // 2. Five concurrent unlock() calls -> one request each for the one-shots, no mp3 decode
  requests.laser = 0; requests.bigExplosion = 0;
  const unlocked = await page.evaluate(() => Promise.all([1, 2, 3, 4, 5].map(() => game.sfx.unlock())).then(() => ({
    ctx: !!game.sfx.ctx, state: game.sfx.ctx && game.sfx.ctx.state, laser: game.sfx.laserBuffer instanceof AudioBuffer,
    big: game.sfx.bigExplosionBuffer instanceof AudioBuffer, slots: game.sfx.musicEls.length, routed: game.sfx.musicEls.every((s) => !!s.gain),
    decodes: window.__decodes.slice(), master: game.sfx.master.gain.value, comp: game.sfx.compressor.threshold.value, filter: game.sfx.musicFilter.frequency.value
  })));
  check("unlock x5: one fetch each for laser/bigexplosion", requests.laser === 1 && requests.bigExplosion === 1, { laser: requests.laser, bigExplosion: requests.bigExplosion });
  check("unlock: both one-shots decoded, bus built, two routed media slots", unlocked.ctx && unlocked.laser && unlocked.big && unlocked.slots === 2 && unlocked.routed && Math.abs(unlocked.master - 0.8) < 0.001 && unlocked.comp === -12, unlocked);
  check("unlock: decodeAudioData only for the two one-shots (no mp3)", unlocked.decodes.length === 2 && unlocked.decodes.every((n) => n < 1e6), unlocked.decodes);

  // 3. Registry after unlock
  const post = await page.evaluate(exerciseRegistry);
  check("registry: no cue throws after unlock", post.threw.length === 0 && post.ctx === true, post.threw);
  const cues = await page.evaluate(() => { const s = game.sfx; const out = []; s.zap(0.2); out.push(s.lastCue); s.zap(0.6); out.push(s.lastCue); s.explosion(0.4); out.push(s.lastCue); s.fanfare("gameOver"); out.push(s.lastCue); s.bossSiren(); out.push(s.lastCue); return out; });
  check("lastCue: zap, zap, explosion, fanfare:gameOver, bossSiren", JSON.stringify(cues) === JSON.stringify(["zap", "zap", "explosion", "fanfare:gameOver", "bossSiren"]), cues);

  await sleep(3200); // let the ducks from the registry exercise restore
  const steady = await page.evaluate(() => +game.sfx.musicGain.gain.value.toFixed(3));
  check("musicGain back at .8*.7^2 after the registry ducks settle", Math.abs(steady - 0.392) < 0.005, steady);

  // 4. Offline render: zap x3 + explosion(1) + damage() peak < .95; single zap tail < -40 dBFS by .2 s
  const render = await page.evaluate(async () => {
    const sr = 44100;
    const mk = (sec) => { const s = new SFX(); const off = new OfflineAudioContext(1, Math.ceil(sr * sec), sr); s._buildBus(off); s.laserBuffer = game.sfx.laserBuffer; s.bigExplosionBuffer = game.sfx.bigExplosionBuffer; return { s, off }; };
    const peakOf = (d, a = 0, b = d.length) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); return p; };
    const rmsDb = (d, a, b) => { let acc = 0; for (let i = a; i < b; i++) acc += d[i] * d[i]; return 20 * Math.log10(Math.sqrt(acc / (b - a)) || 1e-9); };
    const m = mk(1.2);
    m.s.zap(0); m.s._timeShift = 0.03; m.s.zap(0.5); m.s._timeShift = 0.06; m.s.zap(1); m.s._timeShift = 0; m.s.explosion(1); m.s.damage();
    const mix = (await m.off.startRendering()).getChannelData(0);
    const z = mk(0.6); z.s.zap(0.5);
    const zap = (await z.off.startRendering()).getChannelData(0);
    const burst = mk(1.0); for (let i = 0; i < 12; i++) { burst.s._timeShift = i * 0.012; burst.s.zap(i / 11); } burst.s._timeShift = 0; burst.s.explosion(1); burst.s.bossKill();
    const worst = (await burst.off.startRendering()).getChannelData(0);
    return { mixPeak: +peakOf(mix).toFixed(3), zapPeak: +peakOf(zap).toFixed(3), zapTailDb: +rmsDb(zap, Math.round(0.2 * sr), Math.round(0.3 * sr)).toFixed(1), zapBodyDb: +rmsDb(zap, 0, Math.round(0.1 * sr)).toFixed(1), burstPeak: +peakOf(worst).toFixed(3), laserVoicesCapHit: burst.s.laserVoices.length };
  });
  check("offline: zap x3 + explosion(1) + damage() peak < .95", render.mixPeak < 0.95, render);
  check("offline: single zap tail < -40 dBFS by .2 s", render.zapTailDb < -40 && render.zapBodyDb > -40, { zapTailDb: render.zapTailDb, zapBodyDb: render.zapBodyDb });
  check("offline: 12 zaps + explosion + bossKill stay < .95 (compressor headroom)", render.burstPeak < 0.95, render.burstPeak);

  // 5. Start a run: music starts without blocking Start
  await page.fill("#playerName", "AUDIO").catch(() => {});
  const tStart = Date.now();
  await page.click("#btnStart");
  const story = page.locator("#btnStoryLaunch");
  try { await story.waitFor({ state: "visible", timeout: 4000 }); await story.click(); } catch {}
  await page.waitForFunction(() => game.mode === "playing", null, { timeout: 30000 });
  const startToPlayingMs = Date.now() - tStart;
  check("startToPlayingMs <= 900", startToPlayingMs <= 900, startToPlayingMs);
  await page.waitForFunction(() => game.sfx.music && game.sfx.music.currentTime > 0, null, { timeout: 15000 }).catch(() => {});
  const m0 = await page.evaluate(() => { const s = game.sfx; const a = s.active; return { currentTrack: s.currentTrack, state: s.musicState, src: a && a.src, playing: !!s.music, t: a && +a.el.currentTime.toFixed(2), loopStart: s.MUSIC_LOOP[s.currentTrack][0], musicGain: +s.musicGain.gain.value.toFixed(3), wantMusic: s.wantMusic, levelIndex: game.levelIndex }; });
  check("L1: currentTrack === 0 and the element is playing from loop start", m0.currentTrack === 0 && m0.playing && m0.t >= m0.loopStart - 0.05, m0);
  check(LEGACY ? "legacy: music src is the WAV master" : "manifest: music src is the opt MP3", LEGACY ? /\.wav$/i.test(m0.src) : /\.mp3$/i.test(m0.src), m0.src);
  await page.screenshot({ path: path.join(OUT, "01-playing.png") });

  // 6. Loop crossfade: seek the active element to loopEnd - 1; the other element must take over near loopStart
  //    within 2 s, and the analyser RMS on musicGain must not dip more than 12 dB below the pre-seek level
  //    during the fade window (the song's own quiet intro after loopStart is not a gap).
  await sleep(600);
  const loop = await page.evaluate(async () => {
    const s = game.sfx; const an = s.ctx.createAnalyser(); an.fftSize = 2048; s.musicGain.connect(an); const buf = new Float32Array(an.fftSize);
    const rms = () => { an.getFloatTimeDomainData(buf); let acc = 0; for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i]; return +(20 * Math.log10(Math.sqrt(acc / buf.length) || 1e-9)).toFixed(1); };
    const a = s.active; const [ls, le] = s._loopFor(a.index); const id = a.id; const rows = [];
    const snap = (t) => { const o = s.musicEls.find((x) => x.id !== id); rows.push({ t, rms: rms(), oldT: +a.el.currentTime.toFixed(2), oldLevel: a.level, oldPaused: a.el.paused, newT: +o.el.currentTime.toFixed(2), newLevel: o.level, newPaused: o.el.paused, active: s.active.id }); };
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) { snap(+(performance.now() - t0).toFixed(0)); await new Promise((r) => setTimeout(r, 50)); }
    a.el.currentTime = le - 1; const tSeek = performance.now();
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 50)); snap(+(performance.now() - t0).toFixed(0)); }
    s.musicGain.disconnect(an);
    return { id, ls, le, readyState: a.el.readyState, seekAt: +(tSeek - t0).toFixed(0), rows };
  });
  const preDb = loop.rows.slice(0, 10).map((r) => r.rms).sort((x, y) => x - y)[5];
  const post10 = loop.rows.slice(10);
  const takeover = post10.find((r) => !r.newPaused && r.newT >= loop.ls - 0.1 && r.newT < loop.ls + 1.6 && r.active !== loop.id);
  const tookMs = takeover ? takeover.t - loop.seekAt : null;
  check("loop: other element playing near loopStart within 2 s of loopEnd-1", tookMs != null && tookMs <= 2000, { tookMs, ls: loop.ls, le: loop.le, readyState: loop.readyState, takeover });
  const fadeStart = post10.findIndex((r) => r.newLevel > 0 && !r.newPaused);
  const fadeEnd = post10.findIndex((r, i) => i > fadeStart && r.oldLevel === 0 && r.oldPaused);
  const win = fadeStart >= 0 ? post10.slice(Math.max(0, fadeStart - 1), fadeEnd > 0 ? fadeEnd : fadeStart + 16) : [];
  const winMin = win.length ? Math.min(...win.map((r) => r.rms)) : null;
  report.loopRms = { preSteadyDb: preDb, fadeWindowMinDb: winMin, fadeSamples: win.length, rows: loop.rows };
  check("loop: RMS across the crossfade window stays within 12 dB of the pre-seek level", winMin != null && preDb - winMin <= 12 && preDb > -60, { preSteadyDb: preDb, fadeWindowMinDb: winMin, fadeSamples: win.length });
  const last = post10[post10.length - 1];
  check("loop: outgoing element paused after the fade, incoming at level 1", last.oldPaused && last.oldLevel === 0 && last.newLevel === 1 && !last.newPaused, last);

  // 7. Mute is master gain only
  await page.evaluate(() => game.sfx.setMuted(true)); await sleep(200);
  const muted = await page.evaluate(() => ({ master: +game.sfx.master.gain.value.toFixed(3), playing: !!game.sfx.music, paused: game.sfx.active.el.paused }));
  await page.evaluate(() => game.sfx.setMuted(false)); await sleep(200);
  const unmuted = await page.evaluate(() => ({ master: +game.sfx.master.gain.value.toFixed(3), playing: !!game.sfx.music }));
  check("mute: setMuted(true) -> master ~0, element keeps playing; setMuted(false) -> master .8, music playing", muted.master < 0.01 && !muted.paused && unmuted.master > 0.79 && unmuted.playing, { muted, unmuted });

  // 8. Volume curves
  const vol = await page.evaluate(async () => { const s = game.sfx; const osc = s.ctx.createOscillator(); const g = s.ctx.createGain(); g.gain.value = 0.0001; osc.connect(g); g.connect(s.sfxGain); osc.start(); s.setMusicVolume(0.2); s.setSfxVolume(0.5); const samples = []; for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 60)); samples.push([+s.musicGain.gain.value.toFixed(4), +s.sfxGain.gain.value.toFixed(4)]); } const out = { music: +s.musicGain.gain.value.toFixed(4), sfx: +s.sfxGain.gain.value.toFixed(4), samples, sfxVol: s.sfxVol }; osc.stop(); s.setMusicVolume(0.7); s.setSfxVolume(0.8); return out; });
  check("volume: musicGain = .8*v^2, sfxGain = v^2 (squared curve)", Math.abs(vol.music - 0.8 * 0.04) < 0.003 && Math.abs(vol.sfx - 0.25) < 0.01, vol);

  // 9. Restart continuity: playMusic(sameIndex) keeps the element
  const before = await page.evaluate(() => ({ id: game.sfx.active.id, t: game.sfx.active.el.currentTime }));
  await page.evaluate(() => { game.sfx.playMusic(game.sfx.currentTrack); game.sfx.playMusic(); });
  await sleep(300);
  const after = await page.evaluate(() => ({ id: game.sfx.active.id, t: game.sfx.active.el.currentTime, playing: !!game.sfx.music }));
  check("restart: playMusic(same) and playMusic() keep the same element with continuous currentTime", before.id === after.id && after.t >= before.t && after.playing, { before, after });

  // 10. Boss -> finale -> wave
  await page.evaluate(() => game.sfx.setMusicState("boss")); await sleep(700);
  const boss = await page.evaluate(() => ({ filter: Math.round(game.sfx.musicFilter.frequency.value), gain: +game.sfx.musicGain.gain.value.toFixed(3), pulse: !!game.sfx._pulse, pulseGain: game.sfx._pulse && +game.sfx._pulse.out.gain.value.toFixed(3) }));
  await page.evaluate(() => game.sfx.bossPulse(true, 0.9)); await sleep(700);
  const pulse = await page.evaluate(() => +game.sfx._pulse.out.gain.value.toFixed(3));
  check("boss: filter < 1000 Hz, gain .55 level, bossPulse layer on and intensity-driven", boss.filter < 1000 && Math.abs(boss.gain - 0.8 * 0.49 * 0.55) < 0.01 && boss.pulse && pulse > 0.3, { boss, pulseGainAt09: pulse });
  await page.evaluate(() => game.sfx.setMusicState("finale")); await sleep(2100);
  const finale = await page.evaluate(() => ({ filter: Math.round(game.sfx.musicFilter.frequency.value), gain: +game.sfx.musicGain.gain.value.toFixed(3), pulse: !!game.sfx._pulse }));
  check("finale: filter > 15000 Hz 2 s after the kill, pulse off, gain ramping 1.0 -> .3", finale.filter > 15000 && !finale.pulse && finale.gain < 0.8 * 0.49 && finale.gain > 0.8 * 0.49 * 0.3 - 0.01, finale);
  await page.evaluate(() => game.sfx.setMusicState("wave")); await sleep(500);

  // 11. Pause / resume
  await page.evaluate(() => game.sfx.setMusicState("pause")); await sleep(300);
  const paused = await page.evaluate(() => ({ filter: Math.round(game.sfx.musicFilter.frequency.value), gain: +game.sfx.musicGain.gain.value.toFixed(3), state: game.sfx.musicState }));
  await page.evaluate(() => game.sfx.setMusicState("resume")); await sleep(600);
  const resumed = await page.evaluate(() => ({ filter: Math.round(game.sfx.musicFilter.frequency.value), gain: +game.sfx.musicGain.gain.value.toFixed(3), state: game.sfx.musicState }));
  check("pause: filter < 700 Hz and -6 dB; resume restores wave", paused.filter < 700 && Math.abs(paused.gain - 0.8 * 0.49 * 0.5) < 0.01 && resumed.filter > 15000 && Math.abs(resumed.gain - 0.8 * 0.49) < 0.01 && resumed.state === "wave", { paused, resumed });

  // 12. End state then Try Again
  const posBefore = await page.evaluate(() => ({ id: game.sfx.active.id, t: game.sfx.active.el.currentTime }));
  await page.evaluate(() => { game.sfx.lowHp(true); game.sfx.setMusicState("end"); game.sfx.fanfare("gameOver"); });
  await sleep(1000);
  const end1 = await page.evaluate(() => ({ gain: +game.sfx.musicGain.gain.value.toFixed(4), lastCue: game.sfx.lastCue, lowHp: !!game.sfx._lowHpTimer }));
  await sleep(600);
  const end2 = await page.evaluate(() => ({ paused: game.sfx.active.el.paused, music: game.sfx.music, state: game.sfx.musicState }));
  check("end: musicGain < .01 within 1 s, element paused within 1.6 s, lastCue fanfare:gameOver, lowHp beeper stopped", end1.gain < 0.01 && end2.paused && end2.music === null && end1.lastCue === "fanfare:gameOver" && !end1.lowHp, { end1, end2 });
  await page.evaluate(() => { game.sfx.playMusic(game.sfx.trackForLevel(game.levelIndex)); game.sfx.setMusicState("wave"); });
  await sleep(500);
  const again = await page.evaluate(() => ({ id: game.sfx.active.id, t: game.sfx.active.el.currentTime, playing: !!game.sfx.music, gain: +game.sfx.musicGain.gain.value.toFixed(3), state: game.sfx.musicState }));
  check("try again: music playing again on the same element, position continuous, gain restored", again.playing && again.id === posBefore.id && again.t >= posBefore.t - 0.05 && again.gain > 0.3, { posBefore, again });

  // 13. Track change crossfades to the other element (sector 3 -> track 2), no-arg call follows game.levelIndex
  const sw = await page.evaluate(async () => { const s = game.sfx; const was = s.active.id; s.playMusic(s.trackForLevel(2)); await new Promise((r) => setTimeout(r, 900)); return { was, now: s.active.id, track: s.currentTrack, playing: !!s.music, oldLevel: s.musicEls.find((x) => x.id === was).level }; });
  check("track change: new track on the other element with the old one faded out", sw.was !== sw.now && sw.track === 2 && sw.playing && sw.oldLevel === 0, sw);
  const noArg = await page.evaluate(async () => { const s = game.sfx; const idBefore = s.active.id; s.playMusic(); await new Promise((r) => setTimeout(r, 900)); return { idBefore, idAfter: s.active.id, track: s.currentTrack, levelIndex: game.levelIndex }; });
  check("legacy playMusic() follows game.levelIndex (back to track 0 at L1)", noArg.track === 0 && noArg.idBefore !== noArg.idAfter, noArg);

  // 14. Voice cap at 8 cps and in a burst
  const cap = await page.evaluate(async () => { const s = game.sfx; let max = 0; for (let i = 0; i < 16; i++) { s.zap(i / 15); s.hit(); max = Math.max(max, s.laserVoices.length); await new Promise((r) => setTimeout(r, 125)); } let burstMax = 0; for (let i = 0; i < 20; i++) { s.zap(0.5); burstMax = Math.max(burstMax, s.laserVoices.length); } return { max, burstMax }; });
  check("laserVoices.length <= 4 at 8 cps (zap+hit) and in a 20-zap burst", cap.max <= 4 && cap.burstMax <= 4, cap);

  // 15. Hidden / visible
  await page.evaluate(() => game.sfx.onHidden()); await sleep(200);
  const hidden = await page.evaluate(() => ({ state: game.sfx.ctx.state, paused: game.sfx.active.el.paused, needsGesture: game.sfx.needsGesture }));
  await page.evaluate(() => game.sfx.onVisible()); await sleep(300);
  const visible = await page.evaluate(() => ({ state: game.sfx.ctx.state, paused: game.sfx.active.el.paused, needsGesture: game.sfx.needsGesture }));
  check("onHidden suspends + pauses, onVisible resumes + plays, needsGesture false", hidden.state === "suspended" && hidden.paused && !hidden.needsGesture && visible.state === "running" && !visible.paused && !visible.needsGesture, { hidden, visible });

  // 15b. needsGesture: a context that leaves 'running' on its own flags the toast; resumeIfNeeded clears it
  const gesture = await page.evaluate(async () => { const s = game.sfx; await s.ctx.suspend(); await new Promise((r) => setTimeout(r, 50)); const flagged = s.needsGesture; await s.resumeIfNeeded(); await new Promise((r) => setTimeout(r, 50)); return { flagged, state: s.ctx.state, cleared: !s.needsGesture, playing: !!s.music }; });
  check("needsGesture set when the context is interrupted/suspended, cleared by resumeIfNeeded()", gesture.flagged && gesture.cleared && gesture.state === "running" && gesture.playing, gesture);
  const legacySrc = await page.evaluate(async () => { const s = game.sfx; s.playMusic(s.musicTracks[2]); await new Promise((r) => setTimeout(r, 300)); const t = s.currentTrack; s.playMusic(s.trackForLevel(game.levelIndex)); await new Promise((r) => setTimeout(r, 300)); return { viaSrc: t, back: s.currentTrack }; });
  check("legacy playMusic(srcString) resolves to the track index", legacySrc.viaSrc === 2 && legacySrc.back === 0, legacySrc);

  // 16. Legacy game loop still works with the new cues (type for a few seconds)
  const t1 = Date.now(); let typed = 0;
  while (Date.now() - t1 < 6000) {
    const k = await page.evaluate(() => { const g = game; if (g.mode !== "playing") return null; const pool = [...g.powerups, ...g.enemies].filter((e) => e && e.alive && e.x < g.w - 10).sort((a, b) => a.x - b.x); const c = g.lock && g.lock.ref && g.lock.ref.alive ? g.lock.ref : pool[0]; if (!c) return null; return typeof c.nextChar === "function" ? c.nextChar() : c.nextChar; });
    if (k) { await page.keyboard.press(k === " " ? "Space" : k); typed++; }
    await sleep(70);
  }
  const play = await page.evaluate(() => ({ score: game.stats.score, kills: game.stats.kills || null, lastCue: game.sfx.lastCue, voices: game.sfx.laserVoices.length, playing: !!game.sfx.music }));
  check("gameplay: typing drives zap/explosion through the legacy call sites", typed >= 10 && play.score > 0 && play.playing, { typed, ...play });
  await page.screenshot({ path: path.join(OUT, "02-gameplay.png") });

  // 17. stopMusic + prefetch
  const stop = await page.evaluate(async () => { const s = game.sfx; s.prefetchMusic(4); const idle = s.musicEls.find((x) => x !== s.active); const pre = { src: idle.src, idx: idle.index }; s.stopMusic(); await new Promise((r) => setTimeout(r, 200)); return { pre, allPaused: s.musicEls.every((x) => x.el.paused), currentTrack: s.currentTrack, music: s.music }; });
  check("prefetchMusic sets the idle element src; stopMusic pauses both", /galactic_high_score_5/i.test(stop.pre.src) && stop.allPaused && stop.currentTrack === -1 && stop.music === null, stop);

  report.pageErrors = errors.slice();
  report.consoleErrors = consoleErrors.slice();
  report.requests = { laser: requests.laser, bigExplosion: requests.bigExplosion, music: requests.music };
  check("main page: zero pageErrors and zero console errors", errors.length === 0 && consoleErrors.length === 0, { pageErrors: errors, consoleErrors });
  await context.close();

  // 18. laser.wav routed to 404: typing still works, laserBuffer === null
  const ctx404 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx404.route(/laser\.wav/i, (route) => route.fulfill({ status: 404, body: "gone" }));
  const p404 = await newPage(ctx404);
  await boot(p404.page);
  const r404 = await p404.page.evaluate(async () => { await game.sfx.unlock(); let threw = null; try { game.sfx.zap(0.3); game.sfx.hit(); } catch (e) { threw = e.message; } return { laser: game.sfx.laserBuffer, big: game.sfx.bigExplosionBuffer instanceof AudioBuffer, threw, voices: game.sfx.laserVoices.length }; });
  report.laser404 = { ...r404, pageErrors: p404.errors, consoleErrors: p404.consoleErrors };
  check("laser 404: laserBuffer === null, synth zap plays, bigexplosion still decoded, no pageErrors", r404.laser === null && r404.big && !r404.threw && r404.voices === 2 && p404.errors.length === 0, report.laser404);
  await ctx404.close();

  // 19. Native shell UA: FORCE_HTML_AUDIO path (elements play directly, volume = v*v, synths still run)
  const ctxNative = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) TypeR198X-macOS/1.0" });
  const pn = await newPage(ctxNative);
  await boot(pn.page);
  await pn.page.fill("#playerName", "NATIVE").catch(() => {});
  await pn.page.click("#btnStart");
  const storyN = pn.page.locator("#btnStoryLaunch");
  try { await storyN.waitFor({ state: "visible", timeout: 4000 }); await storyN.click(); } catch {}
  await pn.page.waitForFunction(() => game.mode === "playing", null, { timeout: 30000 });
  await pn.page.waitForFunction(() => game.sfx.music && game.sfx.music.currentTime > 0, null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  const nat = await pn.page.evaluate(async () => {
    const s = game.sfx; const a = s.active;
    const out = { force: s.forceHtmlAudio, ctx: !!s.ctx, routed: s.musicEls.some((x) => !!x.gain), playing: !!s.music, volume: a && +a.el.volume.toFixed(3), src: a && a.src, bare: a && !/\?v=/.test(a.el.src), laser: s.laserBuffer, decodes: window.__decodes.length };
    s.setMusicVolume(0.5); await new Promise((r) => setTimeout(r, 200)); out.volumeAt05 = a && +a.el.volume.toFixed(3); s.setMusicVolume(0.7);
    s.setMusicState("boss"); await new Promise((r) => setTimeout(r, 500)); out.volumeBoss = a && +a.el.volume.toFixed(3); s.setMusicState("wave");
    let threw = null; try { s.zap(0.5); s.explosion(0.8); s.bossKill(); s.fanfare("levelClear"); } catch (e) { threw = e.message; }
    await new Promise((r) => setTimeout(r, 1700)); out.volumeAfterDucks = a && +a.el.volume.toFixed(3);
    s.setMuted(true); await new Promise((r) => setTimeout(r, 150)); out.mutedEl = a && a.el.muted; out.pausedWhileMuted = a && a.el.paused; s.setMuted(false);
    out.threw = threw; out.lastCue = s.lastCue;
    return out;
  });
  report.native = { ...nat, pageErrors: pn.errors, consoleErrors: pn.consoleErrors };
  check("native UA: forceHtmlAudio, unrouted elements, bare URLs, volume = v*v, synth cues run, zero pageErrors", nat.force && nat.ctx && !nat.routed && nat.playing && Math.abs(nat.volume - 0.49) < 0.02 && nat.bare && nat.laser === null && nat.decodes === 0 && !nat.threw && nat.mutedEl && !nat.pausedWhileMuted && Math.abs(nat.volumeAt05 - 0.25) < 0.02 && Math.abs(nat.volumeBoss - 0.49 * 0.55) < 0.02 && Math.abs(nat.volumeAfterDucks - 0.49) < 0.02 && pn.errors.length === 0, report.native);
  await pn.page.screenshot({ path: path.join(OUT, "03-native-ua.png") });
  await ctxNative.close();
} catch (e) {
  report.harnessError = String(e && e.stack || e);
  failures++;
  console.error(report.harnessError);
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
const { rows, ...loopSummary } = report.loopRms || {};
console.log(JSON.stringify({ out: OUT, legacy: LEGACY, checks: report.checks.length, failed: failures, loopRms: loopSummary }, null, 2));
process.exit(failures ? 1 : 0);
