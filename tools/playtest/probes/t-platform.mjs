// PLATFORM acceptance (12-access.js, sw.js, site.webmanifest): the accessibility settings round-trip through save ->
// reload and mirror into the panel; High contrast swaps PLATE_STYLES to the colour-blind-safe set (>= 4.5:1 on the bg0
// fill, from assets/style/palette.json) and draws the shape cues (white bracket pair on the lock, dashes under danger
// plates) as pixels; Plate size 130 % scales plateGeometry and still fits a lane; Screen shake 0 leaves the camera still
// on a kill; Reduce flashes caps motion().flash and drops storm lightning frames; the Keyboard layout select changes
// the Flight log heatmap rows; Install / Reload links behave; the frame budget holds under contrast; harness contexts
// never register the worker, while an opt-in context ({ sw: true }) registers it, fills the precache and serves the
// second load from the cache (Performance API: workerStart > 0, transferSize 0).
// Usage: node probes/t-platform.mjs [--dpr 2]
import fs from "node:fs";
import path from "node:path";
import { openProbe, sleep, jumpTo, clearField, placeEnemy, press, hold, waitFor } from "./b_lib.mjs";
import { ROOT } from "./_lib.mjs";

const DPR = process.argv.includes("--dpr") ? Number(process.argv[process.argv.indexOf("--dpr") + 1]) : 1;
const P = await openProbe("t-platform", { dpr: DPR });
await P.installCanvasCounters();
await P.goto();   // no fixture init script: a fresh context is a fresh save, and later navigations keep the stored settings

// ---------------------------------------------------------------- R1 settings round-trip (save -> reload -> UI)
await P.g(() => {
  const g = window.game;
  g.setSetting("plateColor", "contrast");
  g.setSetting("plateFont", "dyslexic");
  g.setSetting("plateScale", 1.3);
  g.setSetting("shakeAmount", 0);
  g.setSetting("reduceFlashes", true);
  g.setSetting("keyboardLayout", "azerty");
  g.flushSettingsSave();
});
const blob = await P.saveBlob();
const stored = blob && blob.settings ? blob.settings : {};
P.check("R1a the six settings land in the save", stored.plateColor === "contrast" && stored.plateFont === "dyslexic" && stored.plateScale === 1.3 && stored.shakeAmount === 0 && stored.reduceFlashes === true && stored.keyboardLayout === "azerty", stored);
await P.goto();
const after = await P.g(() => {
  const g = window.game, $ = (id) => document.getElementById(id);
  return {
    settings: { ...g.save.settings }, info: g.accessInfo(), strokes: { idle: PLATE_STYLES.idle.stroke, locked: PLATE_STYLES.locked.stroke, danger: PLATE_STYLES.danger.stroke, minion: PLATE_STYLES.minion.stroke },
    ui: { color: $("setPlateColor").value, font: $("setPlateFont").value, size: $("setPlateSize").value, sizeOut: $("setPlateSizeOut").textContent, shake: $("setShake").value, shakeOut: $("setShakeOut").textContent, flashes: $("setReduceFlashes").checked, layout: $("setKeyboardLayout").value },
    motion: g.motion(), rows: g.keyboardRows(), fontPx: g.plateFontPx()
  };
});
P.check("R1b after reload: settings restored, plate strokes swapped, motion shake 0 / flash .3, AZERTY rows, 130 % glyphs", after.settings.plateColor === "contrast" && after.settings.plateScale === 1.3 && after.settings.shakeAmount === 0 && after.settings.reduceFlashes === true && after.settings.keyboardLayout === "azerty" && after.strokes.locked === "hcLocked" && after.strokes.danger === "hcDanger" && after.strokes.idle === "hcIdle" && after.strokes.minion === "hcMinion" && after.motion.shake === 0 && Math.abs(after.motion.flash - 0.3) < 1e-9 && after.rows[0] === "azertyuiop" && after.fontPx === 33, { strokes: after.strokes, motion: after.motion, rows: after.rows, fontPx: after.fontPx });
P.check("R1c the panel mirrors every value (selects, ranges + outputs, switch)", after.ui.color === "contrast" && after.ui.font === "dyslexic" && after.ui.size === "130" && after.ui.sizeOut === "130%" && after.ui.shake === "0" && after.ui.shakeOut === "0%" && after.ui.flashes === true && after.ui.layout === "azerty", after.ui);
P.check("R1d every new control has an accessible name (label[for] + aria-label)", await P.g(() => ["setPlateColor", "setPlateFont", "setPlateSize", "setShake", "setReduceFlashes", "setKeyboardLayout"].every((id) => { const el = document.getElementById(id); return !!el && !!document.querySelector(`label[for="${id}"]`) && !!el.getAttribute("aria-label"); })), "label[for] and aria-label on all six");

// dyslexia-friendly face: fetched only when chosen, applied once document.fonts has it
const fontOk = await waitFor(P, () => typeof FONT !== "undefined" && !!FONT.accessFamily && /TypeR Dyslexic Mono/.test(FONT.accessFamily), 12000);
const fontInfo = await P.g(() => ({ family: FONT.accessFamily, check: document.fonts.check('600 25px "TypeR Dyslexic Mono"'), plateFont: window.game.plateGeometry().font, loaded: window.game.accessInfo().fontLoaded }));
P.check("R2 plate font: the OFL face loads on demand and plateGeometry().font names it", fontOk && fontInfo.check && /TypeR Dyslexic Mono/.test(fontInfo.plateFont) && fontInfo.loaded, fontInfo);

// ---------------------------------------------------------------- R3 high-contrast palette vs the plate fill
const palette = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/style/palette.json"), "utf8"));
const hc = await P.g(() => ({ ...ACCESS_CONTRAST_HEX }));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const fill = palette.bg.space0;
const ratios = Object.fromEntries(Object.entries(hc).map(([k, v]) => [k, Math.round(ratio(v, fill) * 10) / 10]));
const lums = Object.fromEntries(Object.entries(hc).map(([k, v]) => [k, Math.round(lum(v) * 100) / 100]));
const lumList = Object.values(lums).sort((a, b) => a - b);
let distinct = true;
for (let i = 1; i < lumList.length; i++) if (lumList[i] - lumList[i - 1] < 0.08) distinct = false;
P.check("R3 high-contrast strokes >= 4.5:1 on the bg0 plate fill (palette.json) with distinct luminance", Object.values(ratios).every((r) => r >= 4.5) && distinct, { fill, ratios, lums });

// ---------------------------------------------------------------- R4 shape cues as pixels (contrast on, other options default)
await P.g(() => { const g = window.game; g.setSetting("plateFont", "mono"); g.setSetting("plateScale", 1); g.setSetting("shakeAmount", 1); g.setSetting("reduceFlashes", false); g.setSetting("keyboardLayout", "auto"); g.flushSettingsSave(); });
await jumpTo(P, 3);
await hold(P);
await clearField(P);
await sleep(1500);
await placeEnemy(P, "spark", 300, 2);    // x < DANGER_X * w: danger
await placeEnemy(P, "warp", 900, 4);
await press(P, "w");                       // locks "warp"
await sleep(1300);                         // the key recoil's camera trauma settles
const cueFrames0 = await P.g(() => window.game.debug.accessCues | 0);
await sleep(300);
const cueFrames1 = await P.g(() => window.game.debug.accessCues | 0);
P.check("R4a the renderOverlay listener runs every frame under High contrast", cueFrames1 > cueFrames0 + 5, { cueFrames0, cueFrames1 });
await P.g(() => { window.TypeRHarness = Object.assign(window.TypeRHarness || {}, { bloom: false }); });
const cues = await P.g(() => {
  const g = window.game, c = g.canvas, s = g.renderScale || 1;
  const dz = g.enemies.find((e) => e.text === "spark"), lk = g.enemies.find((e) => e.text === "warp");
  const bucket = Math.max(lk.plateH, Math.ceil(lk.plateW / PLATE_BUCKET) * PLATE_BUCKET);
  const regions = {
    dash: [dz.x - dz.plateW / 2, dz.y + dz.plateH / 2 + 2, dz.plateW, 7],
    bracket: [lk.x - bucket / 2 - 15, lk.y - lk.plateH / 2 - 15, 18, 18],
    inside: [lk.x - 6, lk.y - 6, 12, 12]
  };
  const grab = ([x, y, w, h]) => c.getContext("2d").getImageData(Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))).data;
  const snap = () => { g.render(0); const o = {}; for (const k of Object.keys(regions)) o[k] = grab(regions[k]); return o; };
  const on = snap();
  const keep = g.accessDrawCues;
  g.accessDrawCues = () => {};
  const off = snap();
  g.accessDrawCues = keep;
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n; };
  return { state: { danger: g.enemyState(dz), locked: g.enemyState(lk) }, dash: diff(on.dash, off.dash), bracket: diff(on.bracket, off.bracket), inside: diff(on.inside, off.inside) };
});
P.check("R4b hazard dashes under the danger plate and a white bracket corner outside the lock change pixels; the plate interior does not", cues.state.danger === "danger" && cues.state.locked === "locked" && cues.dash >= 10 && cues.bracket >= 6 && cues.inside === 0, cues);
await P.shot("contrast-cues");
await P.g(() => { delete window.TypeRHarness.bloom; });
await press(P, "Backspace");

// ---------------------------------------------------------------- R5 plate size 130 % scales plateGeometry and fits a lane
const size = await P.g(() => {
  const g = window.game;
  const base = g.plateGeometry();
  g.setSetting("plateScale", 1.3);
  const big = g.plateGeometry();
  const pitch = LANE_YS[1] - LANE_YS[0];
  g.setSetting("plateScale", 1);
  const back = g.plateGeometry();
  return { basePx: base.px, baseH: base.h, bigPx: big.px, bigH: big.h, ratio: big.h / base.h, pitch, backH: back.h, epochBumped: true };
});
P.check("R5 Plate size 130 %: plateFontPx x1.3 (25 -> 33), plate height x~1.3 and still under the 68 px lane pitch; 100 % restores", size.bigPx === Math.round(size.basePx * 1.3) && size.ratio > 1.25 && size.ratio < 1.36 && size.bigH <= size.pitch && size.backH === size.baseH, size);

// ---------------------------------------------------------------- R6 screen shake 0: no camera offset on a kill (1: control)
async function killAndSample(text, x, lane) {
  await placeEnemy(P, text, x, lane);
  await sleep(120);
  for (const ch of text) await press(P, ch);
  const samples = [];
  for (let i = 0; i < 12; i++) { samples.push(await P.g(() => ({ x: window.game.shakeNow ? window.game.shakeNow.x : 0, y: window.game.shakeNow ? window.game.shakeNow.y : 0, trauma: window.game.trauma || 0 }))); await sleep(30); }
  return { maxOff: Math.max(...samples.map((s) => Math.max(Math.abs(s.x), Math.abs(s.y)))), maxTrauma: Math.max(...samples.map((s) => s.trauma)) };
}
await clearField(P);
await P.g(() => { window.game.setSetting("shakeAmount", 0); });
const still = await killAndSample("orbit", 700, 2);
await P.g(() => { window.game.setSetting("shakeAmount", 1); });
const moving = await killAndSample("comet", 700, 3);
P.check("R6 Screen shake 0 %: camera offset and trauma stay 0 through a kill; at 100 % the same kill shakes", still.maxOff === 0 && still.maxTrauma === 0 && moving.maxTrauma > 0, { still, moving });

// ---------------------------------------------------------------- R7 reduce flashes: flash .3, no storm lightning frames
const flashes = await P.g(() => {
  const g = window.game;
  g.setSetting("reduceFlashes", true);
  const m = { ...g.motion() };
  const theme = g.currentTheme;
  g.currentTheme = Object.assign({}, theme, { storm: true });
  g.stormBoltFrames = 2;
  g.render(0);
  const framesAfter = g.stormBoltFrames | 0;
  g.currentTheme = theme;
  g.setSetting("reduceFlashes", false);
  const m2 = { ...g.motion() };
  return { flash: m.flash, shake: m.shake, anim: m.anim, framesAfter, flashBack: m2.flash };
});
P.check("R7 Reduce flashes: motion().flash .3 with full motion (shake / anim untouched), storm lightning frames dropped, off restores 1", Math.abs(flashes.flash - 0.3) < 1e-9 && flashes.shake === 1 && flashes.anim === 1 && flashes.framesAfter === 0 && flashes.flashBack === 1, flashes);

// ---------------------------------------------------------------- R8 keyboard layout -> Flight log heatmap rows
// The heatmap draws once a key has TYPIST_WEAK_MIN_N attempts (a fresh profile shows the empty state): 21 e's first.
await clearField(P);
for (let i = 0; i < 3; i++) {
  await placeEnemy(P, "eeeeeee", 700, 2);
  await sleep(100);
  for (let k = 0; k < 7; k++) await press(P, "e");
  await sleep(150);
}
await P.g(() => { window.game.stopToMenu(true); });
await waitFor(P, () => window.game.mode === "menu", 5000);
const rowsFor = async (layout) => {
  await P.g((l) => { window.game.setSetting("keyboardLayout", l); window.game.openRecords(); }, layout);
  await sleep(150);
  const rows = await P.g(() => Array.from(document.querySelectorAll("#panelLog .flKeys__row")).map((r) => Array.from(r.querySelectorAll(".flKey")).map((k) => k.dataset.key).join("")));
  await P.g(() => { const m = document.getElementById("recordsModal"); window.game.closeModal(m, { result: "cancel" }); });
  await sleep(150);
  return rows;
};
const dvorak = await rowsFor("dvorak");
const qwertz = await rowsFor("qwertz");
P.check("R8a the Keyboard layout select changes the Flight log heatmap rows (Dvorak, QWERTZ)", dvorak.join("|") === "pyfgcrl|aoeuidhtns|qjkxbmwvz" && qwertz.join("|") === "qwertzuiop|asdfghjkl|yxcvbnm", { dvorak, qwertz });
const auto = await P.g(async () => { const g = window.game; g.setSetting("keyboardLayout", "auto"); const det = await g.accessDetectLayout(); return { det, eff: g.keyboardLayout(), label: document.querySelector('#setKeyboardLayout option[value="auto"]').textContent, sig: g.accessInfo().layoutSignature }; });
P.check("R8b Auto: getLayoutMap classifies (or the API is absent) and keyboardLayout() resolves to one of the five", (auto.det === null || ["qwerty", "azerty", "qwertz", "dvorak", "colemak"].includes(auto.det)) && ["qwerty", "azerty", "qwertz", "dvorak", "colemak"].includes(auto.eff) && (auto.det ? auto.label.includes("Auto (") : auto.label === "Auto"), auto);

// ---------------------------------------------------------------- R9 install / update affordances at the menu
const pwaUi = await P.g(() => {
  const g = window.game, inst = document.getElementById("btnInstall"), rel = document.getElementById("btnPwaReload");
  const hiddenBefore = inst.classList.contains("hidden") && rel.classList.contains("hidden");
  const ev = new Event("beforeinstallprompt", { cancelable: true });
  let prompted = 0;
  ev.prompt = () => { prompted++; return Promise.resolve(); };
  ev.userChoice = Promise.resolve({ outcome: "dismissed" });
  window.dispatchEvent(ev);
  const shownAfterEvent = !inst.classList.contains("hidden") && g.accessInfo().installAvailable;
  inst.click();
  const hiddenAfterClick = inst.classList.contains("hidden");
  g.pwaUpdateReady({ postMessage() {} });
  const toast = document.querySelector('.toast[data-key="pwaUpdate"]');
  return { hiddenBefore, shownAfterEvent, prompted, hiddenAfterClick, toast: !!toast, toastText: toast ? toast.textContent : null, reloadShown: !rel.classList.contains("hidden"), standalone: g.accessInfo().standalone };
});
P.check("R9 Install link appears on beforeinstallprompt, prompts once and hides; an installed update shows the toast + Reload link at the menu", pwaUi.hiddenBefore && pwaUi.shownAfterEvent && pwaUi.prompted === 1 && pwaUi.hiddenAfterClick && pwaUi.toast && /NEW VERSION READY/.test(pwaUi.toastText) && pwaUi.reloadShown && pwaUi.standalone === false, pwaUi);

// ---------------------------------------------------------------- R10 budget under High contrast: 14 plates, 3 s
await jumpTo(P, 3);
await hold(P);
await clearField(P);
await sleep(1500);
const words = ["game over", "high score", "neon city", "zero gravity", "time warp", "solar wind", "power grid", "spark", "orbit", "laser", "nexus", "probe", "relay", "comet"];
for (let i = 0; i < words.length; i++) await placeEnemy(P, words[i], 380 + (i % 7) * 130, i % 6, 0);
await press(P, "g");   // lock one so the bracket cue draws too
await P.g(() => window.__e2Probe.mark());
await sleep(3000);
const perf = await P.g(() => window.__e2Probe.snapshot());
P.check("R10 High contrast, 14 plates (7 two-word, 3 in the danger zone) for 3 s: shadowBlur 0/frame, composite sets <= 6, maxRenderMs <= 16", perf.shadowBlurPerFrame === 0 && perf.compositeSetsPerFrame <= 6 && perf.maxRenderMs <= 16, perf);

// ---------------------------------------------------------------- R11 harness contexts never register the worker
const noSw = await P.g(async () => ({ flag: window.TypeRHarness && window.TypeRHarness.sw, regs: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : -1, attempted: window.game.accessInfo().swAttempted, registered: window.game.accessInfo().swRegistered }));
P.check("R11 harness context: TypeRHarness.sw === false, registerServiceWorker ran and declined, no registration", noSw.flag === false && noSw.regs === 0 && noSw.attempted === true && noSw.registered === false, noSw);
P.check("zero pageErrors / consoleErrors (settings context)", P.errors.pageErrors.length === 0 && P.errors.consoleErrors.length === 0, P.errors);

// ---------------------------------------------------------------- R12 opt-in context: the worker installs, precaches the shell, serves the second load
const S = await openProbe("t-platform-sw", { dpr: DPR, sw: true });
await S.goto();
const swReady = await waitFor(S, async () => {
  if (!("serviceWorker" in navigator)) return false;
  const regs = await navigator.serviceWorker.getRegistrations();
  if (!regs.length || !(regs[0].active)) return false;
  const names = await caches.keys();
  const shell = names.find((n) => n === "typer-shell-" + ASSET_VERSION);
  if (!shell) return false;
  const keys = await (await caches.open(shell)).keys();
  return keys.length >= 60;
}, 30000);
const pre = await S.g(async () => {
  const names = await caches.keys();
  const shell = names.find((n) => n === "typer-shell-" + ASSET_VERSION);
  const keys = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search) : [];
  const has = (p) => keys.some((k) => k.endsWith(p));
  return { names, count: keys.length, access: has("/assets/js/game/12-access.js?v=" + ASSET_VERSION), index: has("/index.html"), root: keys.some((k) => k === "/" ), manifest: has("/site.webmanifest"), font: has("/assets/fonts/TypeRDyslexicMono-Regular.woff2"), optInShell: keys.some((k) => k.includes("/assets/opt/") && !k.includes("manifest.js")), info: window.game.accessInfo() };
});
P.check("R12a opt-in context: sw.js registered after boot, the shell cache holds the precache (scripts, pages, manifest, fonts; no assets/opt art)", swReady && pre.count >= 60 && pre.access && pre.index && pre.root && pre.manifest && pre.font && !pre.optInShell && pre.info.swRegistered === true, { names: pre.names, count: pre.count, access: pre.access, index: pre.index, root: pre.root, manifest: pre.manifest, font: pre.font, optInShell: pre.optInShell });
await S.goto();   // second load: controlled by the worker
const second = await S.g(() => {
  const res = performance.getEntriesByType("resource").filter((e) => /\/assets\/js\/|\/game\.js\?|\/style\.css\?/.test(e.name));
  const sw = res.filter((e) => e.workerStart > 0).length;
  const zero = res.filter((e) => e.transferSize === 0).length;
  return { controlled: !!navigator.serviceWorker.controller, total: res.length, viaWorker: sw, zeroTransfer: zero, nav: (performance.getEntriesByType("navigation")[0] || {}).workerStart || 0 };
});
P.check("R12b second load: the page is controlled, every shell script went through the worker and was served from the cache (transferSize 0)", second.controlled && second.total >= 30 && second.viaWorker === second.total && second.zeroTransfer >= Math.floor(second.total * 0.9), second);
const manifest = await S.g(async () => {
  const r = await fetch("./site.webmanifest");
  const m = await r.json();
  const icons = await Promise.all((m.icons || []).map(async (i) => { const ir = await fetch(i.src); return { src: i.src, sizes: i.sizes, purpose: i.purpose, status: ir.status, type: ir.headers.get("content-type") }; }));
  return { status: r.status, name: m.name, short: m.short_name, start: m.start_url, display: m.display, orientation: m.orientation, bg: m.background_color, theme: m.theme_color, icons };
});
const iconsOk = manifest.icons.length === 4 && manifest.icons.every((i) => i.status === 200 && /image\/png/.test(i.type || "")) && ["192x192/any", "512x512/any", "192x192/maskable", "512x512/maskable"].every((want) => manifest.icons.some((i) => `${i.sizes}/${i.purpose}` === want));
P.check("R12c site.webmanifest parses with name / start_url / standalone / landscape / #0B1030 and four 200 PNG icons (192 + 512, any + maskable)", manifest.status === 200 && manifest.name === "Type-R 198X" && manifest.short === "Type-R" && manifest.start === "./?source=pwa" && manifest.display === "standalone" && manifest.orientation === "landscape" && manifest.bg === "#0B1030" && manifest.theme === "#0B1030" && iconsOk, manifest);
P.check("zero pageErrors / consoleErrors (worker context)", S.errors.pageErrors.length === 0 && S.errors.consoleErrors.length === 0, S.errors);
await S.browser.close();
await P.finish();
