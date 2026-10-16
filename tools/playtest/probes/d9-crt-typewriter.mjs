// D9 acceptance probe: CRT overlay v2 (layers, data-crt toggle, noise tile, pixel darkening, tear) and the typewriter
// ending dialogue (growth, complete-then-advance, speaker colours, reduced motion, menu fps at DPR 2 with CRT on).
// Usage: cd tools/playtest && node probes/d9-crt-typewriter.mjs
import { openProbe, sleep } from "./_lib.mjs";
import { chromium } from "playwright";
import zlib from "node:zlib";

// Minimal PNG reader (8-bit RGB/RGBA, non-interlaced), same as probes/ui-screens.mjs.
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

const P = await openProbe("d9");
const { page } = P;
await P.goto(null);

const layers = await P.g(() => {
  const cs = (id) => getComputedStyle(document.getElementById(id));
  return {
    shade: cs("crtShade").mixBlendMode, lines: cs("crtLines").mixBlendMode, filter: cs("crtOverlay").filter,
    noiseBg: cs("crtNoise").backgroundImage.slice(0, 24), noiseAnim: cs("crtNoise").animationName,
    roll: getComputedStyle(document.getElementById("crtLines"), "::after").animationName,
    rollWillChange: getComputedStyle(document.getElementById("crtLines"), "::after").willChange,
    crt: document.documentElement.dataset.crt, k: document.documentElement.style.getPropertyValue("--crt-k").trim(),
    contain: cs("crtOverlay").contain, display: cs("crtOverlay").display
  };
});
P.check("#crtShade normal, #crtLines screen, #crtOverlay filter none + contain strict", layers.shade === "normal" && layers.lines === "screen" && layers.filter === "none" && /strict/.test(layers.contain), JSON.stringify(layers));
P.check("#crtNoise background is a PNG data URL, noise + roll animate, will-change only on the band", layers.noiseBg.startsWith('url("data:image/png') && layers.noiseAnim === "noiseShift" && layers.roll === "crtRoll" && layers.rollWillChange === "transform", JSON.stringify({ bg: layers.noiseBg, noiseAnim: layers.noiseAnim, roll: layers.roll, wc: layers.rollWillChange }));
P.check("data-crt 'on' and --crt-k 0.75 written from save.settings", layers.crt === "on" && layers.k === "0.75" && layers.display !== "none", JSON.stringify({ crt: layers.crt, k: layers.k }));

// CRT on vs off on a frozen frame: corner >= 25 % darker, centre within 6 % (of full scale).
const box = await P.g(() => { const r = document.getElementById("main").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
await P.g(() => { const g = window.game; if (g.rafId !== null) { cancelAnimationFrame(g.rafId); g.rafId = null; } });
await sleep(120);
const onPng = decodePng(await page.screenshot({ clip: box }));
await P.g(() => { const g = window.game; g.save.settings.crt = false; g.applySettings(); });
await sleep(120);
const off = await P.g(() => ({ crt: document.documentElement.dataset.crt, display: getComputedStyle(document.getElementById("crtOverlay")).display }));
const offPng = decodePng(await page.screenshot({ clip: box }));
await P.g(() => { const g = window.game; g.save.settings.crt = true; g.applySettings(); g.requestFrame(); });
const cornerOn = onPng.avg(6, 6, 4), cornerOff = offPng.avg(6, 6, 4);
const cx = Math.floor(onPng.w / 2) - 8, cy = Math.floor(onPng.h / 2) - 8;
const centreOn = onPng.avg(cx, cy, 16), centreOff = offPng.avg(cx, cy, 16);
P.check("settings.crt=false + applySettings() -> dataset.crt 'off', overlay display none", off.crt === "off" && off.display === "none", JSON.stringify(off));
P.check("CRT on: corner >= 25% darker than off", cornerOn <= cornerOff * 0.75, `on=${cornerOn.toFixed(1)} off=${cornerOff.toFixed(1)}`);
P.check("CRT on: centre differs < 6% of full scale", Math.abs(centreOn - centreOff) / 255 < 0.06, `on=${centreOn.toFixed(1)} off=${centreOff.toFixed(1)} diff=${(Math.abs(centreOn - centreOff) / 255 * 100).toFixed(2)}%`);
const back = await P.g(() => ({ crt: document.documentElement.dataset.crt, raf: window.game.rafId !== null }));
P.check("CRT restored and loop re-armed", back.crt === "on" && back.raf, JSON.stringify(back));

// Tear on real HP loss.
await P.startRun("CRT");
await page.waitForFunction(() => window.game && !window.game.levelIntro, null, { timeout: 8000 }).catch(() => {});
const tear = await P.g(() => new Promise((resolve) => {
  const g = window.game; const ov = document.getElementById("crtOverlay");
  g.invulnT = 0;
  const hp0 = g.player.hp;
  g.takeDamage(1);
  const frames = [];
  let n = 0;
  const t = () => { frames.push(ov.classList.contains("tear")); if (++n < 3) requestAnimationFrame(t); else setTimeout(() => resolve({ frames, later: ov.classList.contains("tear"), hp0, hp: g.player.hp }), 230); };
  requestAnimationFrame(t);
}));
P.check("takeDamage(1) -> #crtOverlay.tear within 2 frames, gone within 200 ms", tear.frames.slice(0, 2).some(Boolean) && tear.later === false && tear.hp < tear.hp0, JSON.stringify(tear));

// Typewriter ending (driven directly: setMode victory + the dialogue helpers).
await P.g(() => { const g = window.game; g.stopToMenu(true); g.setMode("victory"); g.resetEndingDialogue(); g.advanceEndingDialogue(); });
const grow = await P.g(() => new Promise((resolve) => {
  const el = document.getElementById("endingLine"); const out = []; const t0 = performance.now();
  const t = () => { out.push({ t: Math.round(performance.now() - t0), len: el.textContent.length, caret: !!el.querySelector(".twCaret"), caretAnim: el.querySelector(".twCaret") ? getComputedStyle(el.querySelector(".twCaret")).animationName : null }); if (performance.now() - t0 < 1500) setTimeout(t, 120); else resolve({ out, full: window.game.endingScript[0].text.length, progress: document.getElementById("endingProgress").textContent, stage: document.getElementById("endingStage").textContent, speaker: document.querySelector("#screenVictory .dialogueWindow").dataset.speaker }); };
  t();
}));
const lens = grow.out.map((o) => o.len);
P.check("#endingLine grows across frames and equals the line within 1.5 s; lime caret blinks while typing", lens[0] < grow.full && lens.some((l, i) => i > 0 && l > lens[i - 1]) && lens[lens.length - 1] === grow.full && grow.out[0].caret && grow.out[0].caretAnim === "blink", JSON.stringify({ lens, full: grow.full, caret: grow.out[0] }));
P.check("stage INCOMING TRANSMISSION, progress 1 / 23, speaker typegrid", grow.stage === "INCOMING TRANSMISSION" && grow.progress === "1 / 23" && grow.speaker === "typegrid", JSON.stringify({ stage: grow.stage, progress: grow.progress, speaker: grow.speaker }));

// Enter advances to line 2; Enter mid-line completes instantly; Enter again advances.
await P.g(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("Enter");
await sleep(120);
const mid = await P.g(() => ({ idx: window.game.endingIndex, len: document.getElementById("endingLine").textContent.length, full: window.game.endingScript[1].text.length }));
await page.keyboard.press("Enter");
const completed = await P.g(() => new Promise((resolve) => requestAnimationFrame(() => resolve({ idx: window.game.endingIndex, len: document.getElementById("endingLine").textContent.length, full: window.game.endingScript[1].text.length, done: window.game.endingTw === null }))));
await page.keyboard.press("Enter");
await sleep(60);
const advanced = await P.g(() => ({ idx: window.game.endingIndex, progress: document.getElementById("endingProgress").textContent }));
P.check("Enter mid-line completes instantly (same index), the next Enter advances", mid.idx === 2 && mid.len < mid.full && completed.len === completed.full && completed.idx === 2 && advanced.idx === 3 && advanced.progress === "3 / 23", JSON.stringify({ mid, completed, advanced }));

// Speaker keys + colours across the script.
const speakers = await P.g(() => {
  const g = window.game; const win = document.querySelector("#screenVictory .dialogueWindow"); const sp = document.getElementById("endingSpeaker");
  const keys = new Set(); let pilot = null, empress = null;
  g.endingScript.forEach((line, i) => {
    g.showEndingLine(i, { instant: true });
    keys.add(win.dataset.speaker);
    if (sp.dataset.speaker !== win.dataset.speaker) keys.add("MISMATCH");
    if (win.dataset.speaker === "pilot" && !pilot) pilot = getComputedStyle(win).borderLeftColor;
    if (win.dataset.speaker === "empress" && !empress) empress = getComputedStyle(win).borderLeftColor;
  });
  return { keys: [...keys], pilot, empress };
});
P.check("dataset.speaker in typegrid|pilot|empress|control on both window and label; PILOT vs EMPRESS border colours differ", speakers.keys.every((k) => ["typegrid", "pilot", "empress", "control"].includes(k)) && speakers.keys.length === 4 && speakers.pilot && speakers.empress && speakers.pilot !== speakers.empress, JSON.stringify(speakers));

await P.g(() => { const g = window.game; g.resetEndingDialogue(); g.advanceEndingDialogue(); });
await sleep(200);
await page.keyboard.press("Escape");
await sleep(600);
const skipped = await P.g(() => ({ done: window.game.endingDone, idx: window.game.endingIndex, card: !document.getElementById("resultsRun").classList.contains("hidden"), newRun: !document.getElementById("btnNewRun").classList.contains("hidden"), line: document.getElementById("endingLine").textContent === window.game.endingScript[22].text }));
P.check("Escape skips to the last line, results + Play again shown", skipped.done && skipped.idx === 23 && skipped.card && skipped.newRun && skipped.line, JSON.stringify(skipped));
await P.shot("victory-typewriter");
P.check("no page errors", P.errors.pageErrors.length === 0, JSON.stringify(P.errors.pageErrors));

// Reduced motion: noise / roll / caret static, tear disabled, typewriter instant.
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  const rm = await pg.evaluate(() => {
    const root = document.documentElement;
    if (!root.classList.contains("reduce-motion")) root.classList.add("reduce-motion");   // the shell's resolveMotion sets this from the OS query
    const caret = document.createElement("span"); caret.className = "twCaret"; document.body.appendChild(caret);
    const g = window.game; g.setMode("victory"); g.resetEndingDialogue(); g.advanceEndingDialogue();
    const r = { noise: getComputedStyle(document.getElementById("crtNoise")).animationName, roll: getComputedStyle(document.getElementById("crtLines"), "::after").animationName, caret: getComputedStyle(caret).animationName, lineLen: document.getElementById("endingLine").textContent.length, full: g.endingScript[0].text.length, tw: g.endingTw };
    caret.remove();
    return r;
  });
  P.check("reduced motion: #crtNoise + roll animation none, .twCaret steady, first line instant", rm.noise === "none" && rm.roll === "none" && rm.caret === "none" && rm.lineLen === rm.full && rm.tw === null, JSON.stringify(rm));
  await browser.close();
}

// Menu fps at DPR 2 with CRT on (attract canvas at full rate).
{
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 60000 });
  await sleep(800);
  const fps = await pg.evaluate(() => new Promise((resolve) => { let frames = 0; const t0 = performance.now(); const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve({ fps: Math.round(frames / ((performance.now() - t0) / 1000)), crt: document.documentElement.dataset.crt, dpr: devicePixelRatio, renderScale: window.game.renderScale }); }; requestAnimationFrame(tick); }));
  P.check("menu fps >= 58 at DPR 2 with CRT on", fps.fps >= 58 && fps.crt === "on", JSON.stringify(fps));
  await browser.close();
}

await P.finish();
