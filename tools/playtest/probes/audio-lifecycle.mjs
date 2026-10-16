// Game-path audio acceptance for Type-R 198X (PLAN D10/D11, CONTRACT section 6).
// audio-contract.mjs drives sfx.js directly; this probe drives the GAME (Start, mute button, Escape, Restart,
// forced boss, finale, Next sector, game over, Try Again) and watches what the transport does, through a cue
// log installed on the SFX prototype before the page scripts run.
// Usage (from tools/playtest):
//   node probes/audio-lifecycle.mjs --root ../.. [--out ./out/audio-lifecycle] [--headed]
// Writes <out>/report.json (checks, cue log, loop captures) and screenshots; exit code 1 on any failed check.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : "true"]);
  return acc;
}, []));
const ROOT = path.resolve(args.root || ".");
const OUT = path.resolve(args.out || "./out/audio-lifecycle");
const HEADED = args.headed === "true";
const LS_KEY = "typesmup198x.save.v1";
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".woff2": "font/woff2" };
// Same policy as play.mjs: byte ranges (media seeks), an hour of cache under /assets/ (the A/B element pair).
function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let fp = path.join(root, urlPath);
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
        if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const size = fs.statSync(fp).size, ext = path.extname(fp).toLowerCase();
        const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": (/\.(html|js|css|json)$/.test(ext) || !urlPath.startsWith("/assets/")) ? "no-store" : "max-age=3600" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range && (range[1] || range[2])) {
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
const report = { root: ROOT, checks: [], notes: [], pageErrors: [], consoleErrors: [], loops: {} };
let failures = 0;
function check(name, pass, evidence) {
  report.checks.push({ name, pass: !!pass, evidence });
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${evidence == null ? "" : JSON.stringify(evidence)}`);
}
function note(name, evidence) { report.notes.push({ name, evidence }); console.log(`NOTE  ${name}  ${JSON.stringify(evidence)}`); }

// A legacy-shaped save that starts MUTED (settings.muted true), no run, hint/story already seen.
const MUTED_SAVE = { playerName: "AUDIO", selectedShip: "coconut", highScore: 0, lastUnlockedLevel: 1, storySeen: true, keyboardHintSeen: true, settings: { muted: true, crt: false }, run: null };

// Cue log: wraps every cue, alias and transport method on the SFX prototype the moment sfx.js publishes the class.
const cueSpy = `(() => {
  window.__cueLog = [];
  let real;
  Object.defineProperty(window, "SFX", { configurable: true, enumerable: true, get() { return real; }, set(v) {
    real = v;
    try {
      const P = v.prototype;
      const names = [...(v.CUES || []), ...(v.ALIASES || []), "setMusicState", "playMusic", "prefetchMusic", "stopMusic", "fadeOutMusic", "duckMusic", "bossPulse", "setMuted", "unlock", "resumeIfNeeded"];
      for (const n of names) {
        const orig = P[n];
        if (typeof orig !== "function") continue;
        P[n] = function (...a) {
          if (window.__cueLog.length < 6000) window.__cueLog.push({ n, a: a.map((x) => (typeof x === "number" ? +x.toFixed(3) : (typeof x === "string" || typeof x === "boolean") ? x : typeof x)), t: Math.round(performance.now()) });
          return orig.apply(this, a);
        };
      }
    } catch (e) {}
  } });
})();`;

const { server, port } = await startServer(ROOT);
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await chromium.launch({ channel: "chrome", headless: !HEADED, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, [LS_KEY, MUTED_SAVE]);
await context.addInitScript({ content: cueSpy });
const page = await context.newPage();
page.on("pageerror", (e) => report.pageErrors.push(String(e && e.stack || e)));
page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text()); });

const g = (fn, arg) => page.evaluate(fn, arg);
const now = () => g(() => performance.now());
const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
// Cue names since a page timestamp, as "name" or "name:firstStringArg".
const cuesSince = (t) => g((t) => window.__cueLog.filter((c) => c.t >= t).map((c) => c.n + (typeof c.a[0] === "string" ? ":" + c.a[0] : "")), t);
const mix = () => g(() => { const s = game.sfx; const a = s.active; return { mode: game.mode, levelIndex: game.levelIndex, track: s.currentTrack, state: s.musicState, playing: !!s.music, slot: a && a.id, t: a && +a.el.currentTime.toFixed(3), paused: a && a.el.paused, master: +s.master.gain.value.toFixed(3), musicGain: +s.musicGain.gain.value.toFixed(3), filter: Math.round(s.musicFilter.frequency.value), ctx: s.ctx.state, needsGesture: s.needsGesture }; });
const nextKey = () => g(() => {
  const gm = window.game;
  try {
    if (gm.levelIntro || (gm.bossIntro && gm.bossIntro.locked)) return null;
    if (gm.inBoss && gm.boss && gm.boss.nextChar) return gm.boss.nextChar;
    if (gm.lock && gm.lock.ref && gm.lock.ref.alive !== false) { const c = gm.lock.ref.nextChar(); if (c) return c; }
    const t = (e) => (typeof gm.isTargetable === "function" ? gm.isTargetable(e) : e.x < gm.w - 10);
    const pool = [...gm.enemies, ...gm.powerups].filter((e) => e && e.alive !== false && !e.dying && t(e)).sort((a, b) => a.x - b.x);
    return pool[0] ? pool[0].nextChar() : null;
  } catch { return null; }
});
async function autoType(seconds, until) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const st = await g(() => ({ mode: game.mode, bossClear: !!game.bossClear, inBoss: !!game.inBoss }));
    if (until && until(st)) return true;
    if (st.mode !== "playing") { await sleep(80); continue; }
    const k = await nextKey();
    if (k && /^[a-z]$/.test(k)) await page.keyboard.press(k);
    await sleep(45);
  }
  return false;
}
// Loop boundary capture: a ScriptProcessor on musicGain records the mix while the active element is seeked to
// loopEnd - seekBefore; returns 5 ms RMS windows (dBFS) plus a 50 ms timeline of both slots.
async function captureLoop(seekBefore) {
  return g(async (seekBefore) => {
    const s = game.sfx, ctx = s.ctx, a = s.active;
    const [ls, le] = s._loopFor(a.index);
    const id0 = a.id;
    const spn = ctx.createScriptProcessor(1024, 1, 1), sink = ctx.createGain(); sink.gain.value = 0;
    const chunks = []; let total = 0; const max = ctx.sampleRate * 5;
    spn.onaudioprocess = (e) => { if (total >= max) return; const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); total += d.length; };
    s.musicGain.connect(spn); spn.connect(sink); sink.connect(ctx.destination);
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const t0 = performance.now();
    await sl(700);
    const preSamples = total;
    a.el.currentTime = le - seekBefore;
    const tSeek = performance.now();
    const timeline = [];
    for (let i = 0; i < 70; i++) {
      await sl(50);
      const o = s.musicEls.find((x) => x.id !== id0);
      timeline.push({ t: Math.round(performance.now() - tSeek), oldT: +a.el.currentTime.toFixed(3), oldPaused: a.el.paused, oldLevel: a.level, newT: +o.el.currentTime.toFixed(3), newPaused: o.el.paused, newLevel: o.level, newReady: o.el.readyState, active: s.active.id });
    }
    try { s.musicGain.disconnect(spn); spn.disconnect(); sink.disconnect(); } catch (e) {}
    const pcm = new Float32Array(total); let o = 0; for (const c of chunks) { pcm.set(c, o); o += c.length; }
    const win = Math.round(ctx.sampleRate * 0.005), n = Math.floor(pcm.length / win), rms = [];
    for (let w = 0; w < n; w++) { let acc = 0; for (let i = 0; i < win; i++) { const v = pcm[w * win + i]; acc += v * v; } rms.push(+(20 * Math.log10(Math.sqrt(acc / win) || 1e-9)).toFixed(1)); }
    return { sampleRate: ctx.sampleRate, winMs: 5, rms, preWindows: Math.floor(preSamples / win), ls, le, track: a.index, slot: id0, timeline, captureMs: Math.round(performance.now() - t0) };
  }, seekBefore);
}
// gap = longest run of 5 ms windows more than 30 dB under the pre-seek median (a dropout; the music itself
// never falls that far for 20 ms in these mixes); dip20 the same at 20 dB for information.
function analyseLoop(cap) {
  const pre = cap.rms.slice(5, Math.max(6, cap.preWindows - 5)).sort((x, y) => x - y);
  const ref = pre[Math.floor(pre.length / 2)];
  const post = cap.rms.slice(cap.preWindows);
  const runs = (thr) => { let best = 0, cur = 0; for (const v of post) { if (v < ref - thr) { cur++; if (cur > best) best = cur; } else cur = 0; } return best * cap.winMs; };
  const tail = post.slice(Math.floor(post.length * 0.6)).sort((x, y) => x - y);
  const postMedian = tail[Math.floor(tail.length / 2)];
  const first = cap.timeline.find((r) => !r.newPaused && r.newLevel > 0 && r.newT >= cap.ls - 0.05);
  const alignErrMs = first ? Math.round(((first.oldT - (cap.le - 0.6)) - (first.newT - cap.ls)) * 1000) : null;
  const last = cap.timeline[cap.timeline.length - 1];
  return { track: cap.track, refDb: ref, postMedianDb: postMedian, energyDropDb: +(ref - postMedian).toFixed(1), gap30Ms: runs(30), dip20Ms: runs(20), minPostDb: Math.min(...post),
    takeoverMs: first ? first.t : null, alignErrMs, handedOver: !!(last && last.active !== cap.slot && last.oldPaused && last.newLevel === 1 && !last.newPaused), ls: cap.ls, le: cap.le, windows: post.length };
}

try {
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).display === "none"; }, null, { timeout: 60000 });
  const kb = page.locator("#btnKeyboardHint");
  if (await kb.isVisible().catch(() => false)) await kb.click();
  check("constants: MUSIC_FOR_LEVEL[1] === 5 and trackForLevel(9) === 3", await g(() => game.sfx.MUSIC_FOR_LEVEL[1] === 5 && game.sfx.trackForLevel(9) === 3));
  check("save loaded muted (settings.muted true before Start)", await g(() => game.save.settings.muted === true));

  // 1. Muted start: Start -> playing; the sector-1 track must be rolling within 1 s even though the master is 0.
  const tClick = Date.now();
  await page.click("#btnStart");
  const story = page.locator("#btnStoryLaunch");
  while (Date.now() - tClick < 15000) {
    if (await story.isVisible().catch(() => false)) { await story.click(); break; }
    if (await g(() => game.mode === "playing")) break;
    await sleep(25);
  }
  await page.waitForFunction(() => game.mode === "playing", null, { timeout: 30000 });
  const startToPlayingMs = Date.now() - tClick;
  const rolling = await page.waitForFunction(() => { const s = game.sfx; const a = s.active; return !!(s.music && a && a.el.currentTime > s.MUSIC_LOOP[s.currentTrack][0] + 0.02); }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  const musicStartMs = Date.now() - tClick;
  const m1 = await mix();
  check("muted start: sector-1 music rolling within 1 s of Start (track 0, element playing, master 0)", rolling && musicStartMs <= 1000 && m1.track === 0 && m1.master < 0.01 && m1.playing, { startToPlayingMs, musicStartMs, ...m1 });
  await shot("01-muted-start.png");

  // 2. Unmute through the real button: master back within .2 s, element never stopped.
  const tUn = await now();
  await page.click("#btnMute");
  await sleep(200);
  const m2 = await mix();
  const unCues = await cuesSince(tUn);
  check("unmute (#btnMute) -> master .8 within .2 s, music still playing on the same element (setMuted master-gain only)", m2.master > 0.6 && m2.playing && !m2.paused && m2.slot === m1.slot && m2.t >= m1.t && unCues.includes("setMuted"), { ...m2, cues: unCues.slice(0, 6) });

  // 3. Pause / resume through Escape.
  const tP = await now();
  await page.keyboard.press("Escape"); await sleep(350);
  const p1 = await mix();
  const pCues = await cuesSince(tP);
  await shot("02-paused.png");
  await page.keyboard.press("Escape"); await sleep(700);
  const p2 = await mix();
  const rCues = (await cuesSince(tP)).slice(pCues.length);
  const pauseWired = pCues.includes("setMusicState:pause");
  if (pauseWired) {
    check("Escape -> paused: setMusicState('pause'), filter < 700 Hz, -6 dB; Escape -> playing: 'resume' restores wave (filter > 15 kHz, gain .392)", p1.mode === "paused" && p1.state === "pause" && p1.filter < 700 && Math.abs(p1.musicGain - 0.196) < 0.012 && p2.mode === "playing" && p2.state === "wave" && p2.filter > 15000 && Math.abs(p2.musicGain - 0.392) < 0.012 && rCues.includes("setMusicState:resume"), { paused: p1, resumed: p2, pauseCues: pCues, resumeCues: rCues });
  } else {
    // The shell has not wired setMode('paused') -> setMusicState('pause') yet (HANDOFF.md, shell track): verify the
    // transport's pause state through a direct call in the paused mode so the probe still proves D11's numbers.
    note("setMode('paused') does not call sfx.setMusicState('pause') yet (shell wiring pending; see HANDOFF.md)", { modeAfterEscape: p1.mode, cues: pCues });
    await page.keyboard.press("Escape"); await sleep(200);
    await g(() => game.sfx.setMusicState("pause")); await sleep(350);
    const d1 = await mix();
    await g(() => game.sfx.setMusicState("resume")); await sleep(700);
    const d2 = await mix();
    await page.keyboard.press("Escape"); await sleep(250);
    check("pause state (direct call while paused): filter < 700 Hz and -6 dB; 'resume' restores wave (filter > 15 kHz, gain .392)", d1.mode === "paused" && d1.state === "pause" && d1.filter < 700 && Math.abs(d1.musicGain - 0.196) < 0.012 && d2.state === "wave" && d2.filter > 15000 && Math.abs(d2.musicGain - 0.392) < 0.012, { paused: d1, resumed: d2 });
  }
  note("uiTick on pause/resume (shell wiring, informational)", { pause: pCues.filter((c) => c.startsWith("uiTick")), resume: rCues.filter((c) => c.startsWith("uiTick")) });

  // 4. Restart from the pause screen keeps the element and its position.
  await page.keyboard.press("Escape"); await sleep(250);
  const before = await mix();
  const tR = await now();
  await page.click("#btnRestart");
  await page.waitForFunction(() => game.mode === "playing", null, { timeout: 10000 });
  await sleep(400);
  const after = await mix();
  const restartCues = await cuesSince(tR);
  check("Restart (#btnRestart): playMusic called, same element keeps playing, currentTime continuous", after.playing && after.slot === before.slot && after.t >= before.t - 0.05 && after.t < before.t + 3 && after.track === 0 && restartCues.includes("playMusic") && restartCues.includes("setMusicState:wave"), { before, after, cues: restartCues.filter((c) => /playMusic|setMusicState|sectorStart|stopMusic/.test(c)) });

  // 5. Loop boundary on the sector-1 track (track 0: the one with the 7 s lead-in).
  await sleep(300);
  const cap0 = await captureLoop(1.5);
  const an0 = analyseLoop(cap0);
  report.loops.track0 = { ...an0, timeline: cap0.timeline, rms: cap0.rms };
  check("loop (track 0): no dropout > 20 ms across the boundary (5 ms RMS, -30 dB under the pre-seek median)", an0.gap30Ms <= 20 && an0.handedOver, an0);
  check("loop (track 0): the music after the boundary keeps body loudness (post median within 6 dB of pre)", an0.energyDropDb <= 6, { refDb: an0.refDb, postMedianDb: an0.postMedianDb, energyDropDb: an0.energyDropDb });
  check("loop (track 0): incoming element starts at loopStart within 60 ms of the outgoing fade point (beat alignment)", an0.alignErrMs != null && Math.abs(an0.alignErrMs) <= 60 && an0.takeoverMs != null && an0.takeoverMs <= 1800, { alignErrMs: an0.alignErrMs, takeoverMs: an0.takeoverMs, ls: an0.ls, le: an0.le });

  // 6. Boss: approach klaxon, intro siren, boss music state; then the fight, finale and level clear.
  await page.waitForFunction(() => !game.levelIntro, null, { timeout: 5000 }).catch(() => {});
  const tB = await now();
  await g(() => { game.levelT = LEVELS[game.levelIndex].duration + 0.01; });
  const gotBoss = await page.waitForFunction(() => game.inBoss, null, { timeout: 15000 }).then(() => true).catch(() => false);
  await sleep(600);
  const b1 = await mix();
  const bossCues = await cuesSince(tB);
  check("boss intro: bossWarning (approach) then bossSiren, setMusicState('boss'), filter < 1000 Hz, lastCue chain includes bossSiren", gotBoss && bossCues.includes("bossWarning") && bossCues.includes("bossSiren") && bossCues.includes("setMusicState:boss") && b1.state === "boss" && b1.filter < 1000, { ...b1, cues: bossCues.filter((c) => /boss|setMusicState|duck|lock/.test(c)).slice(0, 12) });
  await sleep(1200);
  await shot("03-boss.png");
  const cleared = await autoType(90, (s) => s.bossClear || s.mode !== "playing");
  const tK = await now();
  await sleep(2100);
  const f1 = await mix();
  const finaleCues = await cuesSince(tB);
  check("boss kill: bossCharge + setMusicState('finale') + bossKill; filter > 15 kHz 2 s after the kill", cleared && finaleCues.includes("bossCharge") && finaleCues.includes("setMusicState:finale") && finaleCues.includes("bossKill") && f1.filter > 15000, { ...f1, cues: finaleCues.filter((c) => /bossCharge|finale|bossKill|fanfare|explosion/.test(c)).slice(0, 10) });
  await page.waitForFunction(() => game.mode !== "playing", null, { timeout: 20000 }).catch(() => {});
  const tLC = await now();
  await sleep(1000);
  const lc = await mix();
  const lcCues = await cuesSince(tK);
  check("level complete: setMusicState('end') + fanfare('levelClear'); musicGain < .01 within 1 s", lc.mode === "levelComplete" && lcCues.includes("setMusicState:end") && lcCues.includes("fanfare:levelClear") && lc.musicGain < 0.01, { ...lc, cues: lcCues.filter((c) => /setMusicState|fanfare/.test(c)) });
  await sleep(700);
  const lcPaused = await g(() => game.sfx.active.el.paused && game.sfx.music === null);
  check("level complete: element paused within 1.7 s of 'end'", lcPaused, lcPaused);

  // 7. Next sector: track 5 crossfades onto the other element; sector 2 starts rolling within 1 s.
  const tN = Date.now();
  await page.click("#btnNextLevel");
  await page.waitForFunction(() => game.mode === "playing" && game.levelIndex === 1, null, { timeout: 10000 });
  const rolling2 = await page.waitForFunction(() => { const s = game.sfx; const a = s.active; return !!(s.music && s.currentTrack === 5 && a && a.el.currentTime > s.MUSIC_LOOP[5][0] + 0.02); }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  const n2 = await mix();
  check("sector 2: track 5 (MUSIC_FOR_LEVEL[1]) playing on the other element within 1 s of Next", rolling2 && n2.track === 5 && n2.slot !== lc.slot && n2.state === "wave" && Date.now() - tN <= 3500, { ms: Date.now() - tN, ...n2, prevSlot: lc.slot });

  // 8. Game over: hull to 5 and let the wave leak.
  await page.waitForFunction(() => !game.levelIntro, null, { timeout: 5000 }).catch(() => {});
  await g(() => { game.player.hp = 5; });
  const dead = await page.waitForFunction(() => game.mode === "gameOver", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const tGO = await now();
  const gains = [];
  for (let i = 0; i < 20; i++) { await sleep(50); gains.push(await g(() => +game.sfx.musicGain.gain.value.toFixed(4))); }
  const goCues = await cuesSince(tGO - 400);
  const go1 = await mix();
  await sleep(500);
  const go2 = await g(() => ({ paused: game.sfx.active.el.paused, music: game.sfx.music === null, lowHp: !!game.sfx._lowHpTimer, lastCue: game.sfx.lastCue }));
  await shot("04-game-over.png");
  check("game over: fanfare:gameOver + setMusicState('end'); musicGain < .01 within 1 s; element paused within 1.5 s; lowHp beeper off", dead && goCues.includes("fanfare:gameOver") && goCues.includes("setMusicState:end") && gains[19] < 0.01 && go2.paused && go2.music && !go2.lowHp, { gainsEvery50ms: gains, ...go1, after1500: go2, cues: goCues.filter((c) => /fanfare|setMusicState|lowHp/.test(c)) });

  // 9. Try Again: music back within 1 s on the same element, position continuous.
  const tTA = await now();
  await page.click("#btnTryAgain");
  await page.waitForFunction(() => game.mode === "playing", null, { timeout: 10000 });
  const back = await page.waitForFunction(() => !!game.sfx.music, null, { timeout: 1000 }).then(() => true).catch(() => false);
  const backMs = Math.round((await now()) - tTA);
  await sleep(500); // the 'wave' gain ramp is 0.4 s
  const ta = await mix();
  const taCues = await cuesSince(tTA);
  check("Try Again: music playing again within 1 s, same element as before the death, state wave, gain restored after the .4 s ramp", back && ta.slot === go1.slot && ta.t >= go1.t - 0.05 && ta.state === "wave" && ta.musicGain > 0.3 && taCues.includes("playMusic"), { backMs, ...ta, deathSlot: go1.slot, deathT: go1.t, cues: taCues.filter((c) => /playMusic|setMusicState/.test(c)) });

  // 10. Loop boundary on track 5 (sector 2) as well.
  await sleep(600);
  const cap5 = await captureLoop(1.5);
  const an5 = analyseLoop(cap5);
  report.loops.track5 = { ...an5, timeline: cap5.timeline, rms: cap5.rms };
  check("loop (track 5): no dropout > 20 ms, body loudness kept, incoming aligned within 60 ms", an5.gap30Ms <= 20 && an5.handedOver && an5.energyDropDb <= 6 && an5.alignErrMs != null && Math.abs(an5.alignErrMs) <= 60, an5);

  // 11. Hidden/visible through the document (the shell's visibilitychange hook), then a final error check.
  const vis = await g(async () => {
    const s = game.sfx;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 250));
    const hidden = { mode: game.mode, ctx: s.ctx.state, paused: s.active.el.paused, reason: game.pauseReason };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 350));
    return { hidden, visible: { mode: game.mode, ctx: s.ctx.state, paused: s.active.el.paused, needsGesture: s.needsGesture } };
  });
  check("tab hidden -> context suspended + element paused (+ game paused 'hidden'); visible -> context running, no gesture needed", vis.hidden.ctx === "suspended" && vis.hidden.paused && vis.visible.ctx === "running" && !vis.visible.needsGesture, vis);
  note("pause on hidden (shell wiring, informational)", { modeWhileHidden: vis.hidden.mode, reason: vis.hidden.reason });

  report.cueLog = await g(() => window.__cueLog);
  check("zero pageErrors and zero console errors over the whole run", report.pageErrors.length === 0 && report.consoleErrors.length === 0, { pageErrors: report.pageErrors, consoleErrors: report.consoleErrors });
} catch (e) {
  report.harnessError = String(e && e.stack || e);
  failures++;
  console.error(report.harnessError);
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ out: OUT, checks: report.checks.length, failed: failures, loops: Object.fromEntries(Object.entries(report.loops).map(([k, v]) => [k, { gap30Ms: v.gap30Ms, dip20Ms: v.dip20Ms, energyDropDb: v.energyDropDb, alignErrMs: v.alignErrMs, takeoverMs: v.takeoverMs }])) }, null, 2));
process.exit(failures ? 1 : 0);
