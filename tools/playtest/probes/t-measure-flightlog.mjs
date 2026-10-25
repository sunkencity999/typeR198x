// t-measure-flightlog (MEASURE, D6 UI): the Records tabs (ARIA tablist, keyboard), the Flight Log panel from an injected
// profile, the empty state, legacy rows, the menu Best WPM / goal lines, phone layouts and colour-vision buckets.
// PASS = the feature works. Screenshots: tools/playtest/out/t-measure-flightlog/.
// Usage: node tools/playtest/probes/t-measure-flightlog.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openProbe, sleep } from "./measure_lib.mjs";
import { harnessFlags } from "./_lib.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out/t-measure-flightlog");
fs.mkdirSync(OUT, { recursive: true });
const P = await openProbe("t-measure-flightlog");
const page = P.page;

const openRecords = async () => {
  await P.g(() => { if (window.game.mode !== "menu") window.game.stopToMenu(true); });
  await sleep(200);
  await P.g(() => document.getElementById("btnRecords").click());
  await page.waitForFunction(() => { const m = document.getElementById("recordsModal"); return m && !m.classList.contains("is-dismissed") && !m.classList.contains("hidden"); }, null, { timeout: 5000 });
  await sleep(250);
};
const closeRecords = async () => { await P.g(() => document.getElementById("btnRecordsClose").click()); await sleep(300); };
const tabState = () => P.g(() => ({
  hallSel: document.getElementById("tabHall").getAttribute("aria-selected"), logSel: document.getElementById("tabLog").getAttribute("aria-selected"),
  hallHidden: document.getElementById("panelHall").hidden, logHidden: document.getElementById("panelLog").hidden,
  logVisible: getComputedStyle(document.getElementById("panelLog")).display !== "none", tabsVisible: getComputedStyle(document.querySelector(".recordsTabs")).display !== "none",
  active: document.activeElement && document.activeElement.id, hallTab: document.getElementById("tabHall").tabIndex, logTab: document.getElementById("tabLog").tabIndex,
  roles: [document.getElementById("panelHall").getAttribute("role"), document.getElementById("panelLog").getAttribute("role")]
}));

// ---- 4. empty state on a fresh save ----
await P.goto("fresh");
await sleep(300);
await openRecords();
const s0 = await tabState();
await P.g(() => document.getElementById("tabLog").click());
await sleep(150);
const empty = await P.g(() => ({ text: document.getElementById("panelLog").textContent, keys: document.querySelectorAll("#panelLog .flKey").length, goal: (document.querySelector("#panelLog .flGoal") || {}).textContent, want: window.game.typistGoal().text }));
P.check("4. fresh save: the Flight Log shows the empty state (no keyboard) and the goal line",
  /No flights logged yet\. Fly a sector and /.test(empty.text) && /on this device only/.test(empty.text) && empty.keys === 0 && empty.goal === empty.want, empty);

// ---- 1. tabs by pointer ----
const s1 = await tabState();
P.check("1. Records opens on Hall of pilots; clicking #tabLog swaps aria-selected, shows #panelLog, hides #panelHall (tabpanel roles, roving tabindex)",
  s0.tabsVisible && s0.hallSel === "true" && s0.logSel === "false" && !s0.hallHidden && s0.logHidden && !s0.logVisible &&
  s1.hallSel === "false" && s1.logSel === "true" && s1.hallHidden && !s1.logHidden && s1.logVisible && s1.logTab === 0 && s1.hallTab === -1 && s1.roles.every((r) => r === "tabpanel"), { s0, s1 });

// ---- 2. keyboard ----
await P.g(() => document.getElementById("tabHall").click());
await P.g(() => document.getElementById("tabHall").focus());
await page.keyboard.press("ArrowRight");
const k1 = await tabState();
await page.keyboard.press("Home");
const k2 = await tabState();
await page.keyboard.press("End");
const k3 = await tabState();
await page.keyboard.press("ArrowLeft");
const k4 = await tabState();
await page.keyboard.press("Escape");
await sleep(400);
const k5 = await P.g(() => ({ hidden: document.getElementById("recordsModal").classList.contains("is-dismissed"), active: document.activeElement && document.activeElement.id }));
P.check("2. keyboard: ArrowRight -> focus + selection on #tabLog, Home -> #tabHall, End -> #tabLog, ArrowLeft wraps back; Escape closes and focus returns to #btnRecords",
  k1.active === "tabLog" && k1.logSel === "true" && k2.active === "tabHall" && k2.hallSel === "true" && k3.active === "tabLog" && k3.logSel === "true" && k4.active === "tabHall" && k5.hidden && k5.active === "btnRecords",
  { k1, k2, k3, k4, k5 });

// ---- 3. panel content from an injected profile ----
const injected = await P.g(() => {
  const g = window.game;
  const L = "abcdefghijklmnopqrstuvwxyz";
  const keys = {};
  for (let i = 0; i < 26; i++) {
    const c = L[i];
    const n = i < 4 ? 10 : 40;                       // a-d: under 15 attempts
    const err = [0.01, 0.05, 0.12][i % 3];           // lo / mid / hi
    keys[c] = { n, err, ms: 150 + i * 10 };
  }
  const sessions = [];
  for (let i = 0; i < 25; i++) sessions.push([1790000000 + i * 3600, "campaign", 1 + (i % 4), 40 + i, 92 + (i % 6), i % 5 ? "A" : null, 1000 + i, 3, 70, "kp"]);
  g.save.profile = { v: 1, keys, bigrams: { th: { n: 20, ms: 300 } }, speedEma: 52.3, thrEma: 31.4, speedN: 900, sessions,
    sectorBest: { "1": { speed: 61, acc: 98.5, t: 1790000000 }, "3": { speed: 55, acc: 0, t: 1790000000 } },
    bests: { speed: 64, ceiling: 72, drill: { speed: 58, acc: 97.2 } }, days: { n: 5, last: 20261020 } };
  g.save.lastUnlockedLevel = 5;
  g._ty.saveRef = null;
  g.typistState();
  return { ok: true };
});
await openRecords();
await P.g(() => document.getElementById("tabLog").click());
await sleep(200);
await P.shot("flightlog-injected");
const panel = await P.g(() => {
  const g = window.game, ty = g._ty;
  const keyEls = [...document.querySelectorAll("#panelLog .flKey")];
  const timed = [];
  for (let i = 0; i < 26; i++) if (ty.kN[i] >= 15 && ty.kMs[i] > 0) timed.push(ty.kMs[i]);
  timed.sort((a, b) => a - b);
  const med = timed.length >= 3 ? (timed.length % 2 ? timed[(timed.length - 1) / 2] : (timed[timed.length / 2 - 1] + timed[timed.length / 2]) / 2) : 0;
  const bucket = (n, err) => (n < 15 ? "none" : err < 0.03 ? "lo" : err < 0.08 ? "mid" : "hi");
  let badErr = [], badLat = [];
  for (const el of keyEls) {
    const c = el.dataset.key, i = c.charCodeAt(0) - 97;
    if (el.dataset.err !== bucket(ty.kN[i], ty.kErr[i])) badErr.push(c);
    const lat = med > 0 && ty.kMs[i] > 0 ? Math.round(Math.min(1, Math.max(0, ty.kMs[i] / (2 * med))) * 100) / 100 : 0;
    if (Math.abs(parseFloat(el.style.getPropertyValue("--lat")) - lat) > 0.005) badLat.push([c, el.style.getPropertyValue("--lat"), lat]);
  }
  const slow = (document.querySelector('#panelLog [data-fl="slowest"]') || {}).textContent || "";
  const weakText = (document.querySelector('#panelLog [data-fl="weak"]') || {}).textContent || "";
  const weak = g.typistWeakKeys();
  const svg = document.querySelector("#panelLog .flSpark svg");
  const pts = (sel) => [...document.querySelectorAll(sel)].reduce((n, el) => n + (el.tagName === "polyline" ? el.getAttribute("points").trim().split(/\s+/).filter(Boolean).length : 1), 0);
  const speedPts = pts("#panelLog .flSpark__speed"), accPts = pts("#panelLog .flSpark__acc");
  const rows = document.querySelectorAll("#panelLog .flSectors tbody tr");
  const stats = [...document.querySelectorAll("#panelLog .flStat")].map((s) => s.textContent);
  const drillTile = [...document.querySelectorAll("#panelLog .flStat")].find((el) => /^drill$/i.test(el.querySelector(".flStat__label").textContent.trim()));
  const drill = drillTile ? { value: drillTile.querySelector(".flStat__value").textContent, cap: (drillTile.querySelector(".flStat__cap") || {}).textContent || "" } : null;
  const untimed = !!document.querySelector('#panelLog [data-fl="untimed"]');
  return { drill, untimed,
    keys: keyEls.length, badErr, badLat, med, slow, slowCount: slow.split(" · ").filter(Boolean).length, weakText, weak: weak.slice(),
    title: !!(svg && svg.querySelector("title") && svg.querySelector("title").textContent.length > 10), role: svg && svg.getAttribute("role"),
    speedPts, accPts, rows: rows.length, row1: rows[0] && rows[0].textContent, row3: rows[2] && rows[2].textContent, locked: [...rows].filter((r) => r.classList.contains("is-locked")).length,
    goal: (document.querySelector("#panelLog .flGoal") || {}).textContent, wantGoal: g.typistGoal().text,
    sr: (document.querySelector("#panelLog .flSr") || {}).textContent || "", hiddenKeys: document.querySelector("#panelLog .flKeys").getAttribute("aria-hidden"), stats
  };
});
P.check("3. Flight Log from an injected profile: 26 keys with data-err buckets and --lat per formula, 5 slowest, weak keys === typistWeakKeys(), 20-point sparklines with a <title>, 10 sector rows, goal, sr summary; the Drill tile value is the speed alone with the accuracy in its caption (review CT-B2); no untimed-sector note when every cleared row has a WPM",
  panel.keys === 26 && panel.badErr.length === 0 && panel.badLat.length === 0 && panel.slowCount === 5 && /^[A-Z] \d+ MS( · [A-Z] \d+ MS){4}$/.test(panel.slow) &&
  panel.weakText === (panel.weak.length ? panel.weak.map((c) => c.toUpperCase()).join(" · ") : "NONE YET") &&
  panel.speedPts === 20 && panel.accPts === 20 && panel.title && panel.role === "img" && panel.rows === 10 && /^161%?98\.5%$/.test(panel.row1.replace(/\s+/g, "")) && panel.locked === 5 &&
  panel.goal === panel.wantGoal && /^Weak keys: .*Slowest keys: .*Most missed: /.test(panel.sr) && panel.hiddenKeys === "true" &&
  panel.stats.some((t) => /BEST WPM\s*64/i.test(t)) && panel.stats.some((t) => /THROUGHPUT\s*31/i.test(t)) && panel.stats.some((t) => /DAYS FLOWN\s*5/i.test(t)) && panel.stats.some((t) => /CEILING\s*72/i.test(t)) && panel.drill && panel.drill.value === "58" && panel.drill.cap === "at 97.2% · best 60 s drill" && !panel.untimed,
  panel);

// ---- 8. colour vision: the err buckets differ in luminance ----
const lumOf = async (vision) => {
  await P.vision(vision);
  await sleep(150);
  const rects = await P.g(() => {
    const pick = (b) => { const el = document.querySelector(`#panelLog .flKey[data-err="${b}"]`); if (!el) return null; el.scrollIntoView({ block: "center" }); return null; };
    pick("hi");
    const out = {};
    for (const b of ["hi", "mid", "lo", "none"]) { const el = document.querySelector(`#panelLog .flKey[data-err="${b}"]`); const r = el.getBoundingClientRect(); out[b] = { x: r.x + 2, y: r.y + 2, w: Math.max(4, r.width - 4), h: Math.max(4, r.height - 8) }; }
    return out;
  });
  const shot = await page.screenshot({ path: path.join(OUT, `keys-${vision}.png`) });
  const b64 = shot.toString("base64");
  return P.g(async ([b64, rects, dpr]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const out = {};
    for (const [k, r] of Object.entries(rects)) {
      const d = x.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr)).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      out[k] = Math.round(sum / n * 10) / 10;
    }
    return out;
  }, [b64, rects, 1]);
};
const lumNormal = await lumOf("none");
const lumDeut = await lumOf("deuteranopia");
const lumAchro = await lumOf("achromatopsia");
await P.vision("none");
const distinct = (l) => Math.abs(l.hi - l.mid) >= 4 && Math.abs(l.mid - l.lo) >= 4 && Math.abs(l.hi - l.lo) >= 4;
P.check("8. colour vision (deuteranopia / achromatopsia screenshots under out/t-measure-flightlog/): the hi / mid / lo buckets differ in luminance, and the sr summary carries the content",
  distinct(lumDeut) && distinct(lumAchro) && panel.sr.length > 20, { lumNormal, lumDeut, lumAchro });

// ---- 6. menu stats ----
await closeRecords();
await P.g(() => { if (typeof window.game.refreshMenu === "function") window.game.refreshMenu(); else window.game.renderMenuScreens(); });
await sleep(150);
const menu = await P.g(() => ({ wpm: document.getElementById("statWpm").textContent, rowHidden: document.querySelector('[data-typist="bestWpm"]').classList.contains("hidden"),
  goal: document.getElementById("statGoal").textContent, goalHidden: document.getElementById("statGoal").classList.contains("hidden"), want: window.game.typistGoal().text, best: window.game.save.profile.bests.speed }));
P.check("6. menu: #statWpm === bests.speed (row shown), #statGoal === the goal text", !menu.rowHidden && menu.wpm === String(menu.best) && !menu.goalHidden && menu.goal === menu.want, menu);

// ---- 7. phone portrait / landscape ----
// The widest drill best the reviewer measured (104 WPM at 98.4 %), restored after the loop.
const drill0 = await P.g(() => { const b = window.game.save.profile.bests; const d = b.drill; b.drill = { speed: 104, acc: 98.4 }; return d; });
const phone = {};
for (const [name, vp] of [["portrait", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }], ["desktop", { width: 1440, height: 900 }], ["laptop", { width: 1280, height: 800 }]]) {
  await page.setViewportSize(vp);
  await sleep(300);
  await openRecords();
  await P.g(() => document.getElementById("tabLog").click());
  await sleep(200);
  phone[name] = await P.g(() => {
    const modal = document.getElementById("recordsModal");
    const inner = modal.querySelector(".modalInner") || modal;
    const scroll = modal.querySelector(".modalScroll") || modal;
    const log = document.getElementById("panelLog");
    const keyW = Math.min(...[...log.querySelectorAll(".flKey")].map((k) => k.getBoundingClientRect().width));
    const over = (el) => el.scrollWidth - el.clientWidth;
    // every stat label ends inside its own tile's padding box and is not cut by its ellipsis
    const labels = [...log.querySelectorAll(".flStat")].map((t) => {
      const lab = t.querySelector(".flStat__label"), tr = t.getBoundingClientRect(), lr = lab.getBoundingClientRect();
      return { label: lab.textContent, end: Math.round(lr.left + lab.scrollWidth), tileEnd: Math.round(tr.right - parseFloat(getComputedStyle(t).paddingRight)), cut: lab.scrollWidth > lab.clientWidth + 1 };
    });
    const badLabels = labels.filter((l) => l.cut || l.end > l.tileEnd + 1);
    // every stat value is one line (the drill best "58 · 97.2%" wrapped in the 5-across row; review CT-B2)
    const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size; };
    const valueLines = Math.max(...[...log.querySelectorAll(".flStat__value")].map(lines));
    return { valueLines, inner: over(inner), scroll: over(scroll), log: over(log), doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, keyW, badLabels, labels: labels.length };
  });
  await P.shot(`flightlog-${name}`);
  await closeRecords();
}
await page.setViewportSize({ width: 1440, height: 900 });
await P.g((d) => { window.game.save.profile.bests.drill = d; }, drill0);
P.check("7. 390 x 844, 844 x 390, 1440 x 900 and 1280 x 800: no horizontal overflow in the Records modal or the Flight Log, keys >= 26 px wide, every stat label (THROUGHPUT, DAYS FLOWN ...) ends inside its own tile, untruncated, every stat value on one line",
  Object.values(phone).every((p) => p.inner <= 1 && p.scroll <= 1 && p.log <= 1 && p.doc <= 1 && p.keyW >= 26 && p.labels === 5 && p.badLabels.length === 0 && p.valueLines === 1), phone);

// ---- 11. switching to the Flight Log recomputes the scroll cue (release 20261024a, J3) ----
await page.setViewportSize({ width: 1280, height: 720 });
await sleep(300);
await openRecords();
await P.g(() => document.getElementById("tabHall").click());
await sleep(150);
await P.g(() => { document.querySelector("#recordsModal .modalBody").scrollTop = 0; document.getElementById("tabLog").click(); });
await sleep(450);
const cue = await P.g(() => {
  const wrap = document.querySelector("#recordsModal .modalScroll"), body = wrap.querySelector(".modalBody"), pill = wrap.querySelector(".modalScrollHint");
  return { overflow: body.scrollHeight - body.clientHeight, scrollTop: body.scrollTop, cls: wrap.className, fade: getComputedStyle(wrap, "::after").opacity,
    pill: pill ? getComputedStyle(pill).opacity : null };
});
await P.shot("flightlog-cue-1280x720");
await closeRecords();
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(200);
P.check("11. 1280 x 720: Hall -> Flight log tab switch, the overflowing panel shows the scroll cue (is-scrollable, not at-bottom, fade and 'scroll' pill visible)",
  cue.overflow > 2 && cue.scrollTop === 0 && /is-scrollable/.test(cue.cls) && !/at-bottom/.test(cue.cls) && Number(cue.fade) > 0.5 && Number(cue.pill) > 0.5, cue);

// ---- 12. key-map legend and Flight Log accessibility (release 20261024a: J4, PERF-A11Y-1/3/4/6) ----
await openRecords();
await P.g(() => document.getElementById("tabLog").click());
await sleep(200);
const a11y = await P.g(() => {
  const leg = document.querySelector("#panelLog .flKeys__legend");
  const keys = [...document.querySelectorAll("#panelLog .flKey")];
  const none = document.querySelector('#panelLog .flKey[data-err="none"]');
  const locked = document.querySelector("#panelLog .flSectors tr.is-locked td");
  return { legend: leg ? leg.textContent : null, legendShown: !!(leg && leg.getBoundingClientRect().height > 0), legendHidden: leg && leg.getAttribute("aria-hidden"),
    titled: keys.filter((k) => /^[A-Z] · /.test(k.title)).length, keys: keys.length, aTitle: (keys.find((k) => k.dataset.key === "a") || {}).title,
    noneOpacity: none ? Number(getComputedStyle(none).opacity) : null, lockedOpacity: locked ? Number(getComputedStyle(locked).opacity) : null };
});
await P.g(() => document.getElementById("tabLog").focus());
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
a11y.focus = await P.g(() => { const el = document.activeElement; return { id: el && el.id, offset: el ? getComputedStyle(el).outlineOffset : null, visible: el ? el.matches(":focus-visible") : false }; });
await closeRecords();
await page.setViewportSize({ width: 320, height: 640 });
await sleep(300);
await openRecords();
await P.g(() => document.getElementById("tabLog").click());
await sleep(200);
a11y.reflow320 = await P.g(() => {
  const body = document.querySelector("#recordsModal .modalBody"), log = document.getElementById("panelLog");
  const keyRight = Math.max(...[...log.querySelectorAll(".flKey")].map((k) => k.getBoundingClientRect().right));
  return { body: body.scrollWidth - body.clientWidth, log: log.scrollWidth - log.clientWidth, keyRight: Math.round(keyRight), bodyRight: Math.round(body.getBoundingClientRect().right) };
});
await P.shot("flightlog-320x640");
await closeRecords();
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(200);
{
  const ctx = await P.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await harnessFlags(ctx);
  const pg = await ctx.newPage();
  await pg.goto(P.base, { waitUntil: "load" });
  await pg.waitForFunction(() => { const el = document.getElementById("loadingOverlay"); return !el || el.classList.contains("hidden") || getComputedStyle(el).visibility === "hidden"; }, null, { timeout: 120000 });
  await pg.evaluate(() => document.getElementById("btnRecords").click());
  await sleep(500);
  a11y.touchTabs = await pg.evaluate(() => ({ coarse: matchMedia("(pointer: coarse)").matches,
    hall: Math.round(document.getElementById("tabHall").getBoundingClientRect().height), log: Math.round(document.getElementById("tabLog").getBoundingClientRect().height) }));
  await ctx.close();
}
P.check("12. key map: a visible legend names the border colours, the dashed state and the bar, every key has a title; 'none' keys and locked sector rows at opacity >= 0.55; the Flight Log panel's focus ring sits inside the scroller (offset -2px); 320 px: no sideways scroll; touch: Records tabs >= 44 px",
  a11y.legendShown && a11y.legendHidden === "true" && /^Border: misses · red many · amber some · cyan few · dashed under 15 tries · Bar: slower$/.test(a11y.legend || "") &&
  a11y.keys === 26 && a11y.titled === 26 && a11y.aTitle === "A · under 15 tries" && a11y.noneOpacity >= 0.55 && a11y.lockedOpacity >= 0.55 &&
  a11y.focus.id === "panelLog" && a11y.focus.visible && a11y.focus.offset === "-2px" &&
  a11y.reflow320.body <= 1 && a11y.reflow320.log <= 1 && a11y.reflow320.keyRight <= a11y.reflow320.bodyRight &&
  a11y.touchTabs.coarse && a11y.touchTabs.hall >= 44 && a11y.touchTabs.log >= 44, a11y);

// ---- 9. sparkline: legend with the latest values, a dot for a lone point, gaps at speed 0 / acc null, one accessible text ----
const sparkOf = async (sessions) => {
  await P.g((sessions) => {
    const g = window.game;
    g.save.profile = { v: 1, keys: {}, bigrams: {}, speedEma: 50, thrEma: 20, speedN: 70, sessions, sectorBest: {}, bests: { speed: 66, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 1, last: 20261024 } };
    g._ty.saveRef = null;
    g.typistState();
  }, sessions);
  await openRecords();
  await P.g(() => document.getElementById("tabLog").click());
  await sleep(150);
  const r = await P.g(() => {
    const box = document.querySelector("#panelLog .flSpark"), svg = box.querySelector("svg");
    svg.scrollIntoView({ block: "center" });
    const keys = [...box.querySelectorAll(".flSpark__key")];
    const shape = (el) => (el.tagName === "polyline" ? el.getAttribute("points").trim().split(/\s+/).length : "dot");
    const title = (svg.querySelector("title") || {}).textContent || "";
    return {
      legend: keys.map((k) => ({ text: k.textContent, color: getComputedStyle(k).color })), legendHidden: (box.querySelector(".flSpark__legend") || { getAttribute: () => null }).getAttribute("aria-hidden"),
      speedColor: getComputedStyle(box.querySelector(".flSpark__speed")).stroke, accColor: getComputedStyle(box.querySelector(".flSpark__acc")).stroke,
      speed: [...box.querySelectorAll(".flSpark__speed")].map(shape), acc: [...box.querySelectorAll(".flSpark__acc")].map(shape),
      dots: [...box.querySelectorAll(".flSpark__dot")].map((d) => { const m = d.getAttribute("d").match(/^M([\d.]+),([\d.]+)h0$/); const b = svg.getBoundingClientRect(); return { x: b.left + Number(m[1]) / 200 * b.width, y: b.top + Number(m[2]) / 48 * b.height }; }),
      role: svg.getAttribute("role"), aria: svg.getAttribute("aria-label"), title,
      srCopies: box.querySelectorAll(".srOnly").length, titleCount: (box.textContent.split(title).length - 1)
    };
  });
  // each dot paints: bright pixels in a 10 x 10 box around its centre (zero-length path, round cap)
  r.dotPx = [];
  for (const d of r.dots) {
    const shot = await page.screenshot({ clip: { x: Math.max(0, d.x - 5), y: Math.max(0, d.y - 5), width: 10, height: 10 } });
    r.dotPx.push(await P.g(async (b64) => {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = "data:image/png;base64," + b64; });
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const px = x.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 140) n++;
      return n;
    }, shot.toString("base64")));
  }
  r.dotsVisible = r.dotPx.length > 0 && r.dotPx.every((n) => n >= 8);
  await P.shot(`spark-${sessions.length}`);
  await closeRecords();
  return r;
};
const one = await sparkOf([[1790000000, "campaign", 1, 66, 93.9, "A", 10000, 7, 71, "c"]]);
const gap = await sparkOf([[1790000000, "campaign", 1, 66, 93.9, "A", 10000, 7, 71, "c"], [1790003600, "campaign", 2, 0, null, null, 0, 0, null, ""],
  [1790007200, "campaign", 2, 68, 95.2, "A", 9000, 3, 80, ""], [1790010800, "campaign", 3, 67, 96.1, "A", 9000, 3, 80, ""], [1790014400, "campaign", 3, 0, null, null, 0, 0, null, ""]]);
const legendOk = (r, sp, acc) => r.legend.length === 2 && r.legend[0].text === sp && r.legend[1].text === acc && r.legend[0].color === r.speedColor && r.legend[1].color === r.accColor && r.legendHidden === "true";
P.check("9. sparkline: a legend names cyan SPEED / amber ACC with the latest values (66 WPM / 93.9%; after a keyless death the last measured 67 WPM / 96.1%); one session draws a visible dot per series; speed 0 and acc null leave gaps; the svg <title> is the only accessible text (no aria-label, no .srOnly copy) and says 'latest accuracy 96.1' not 100",
  legendOk(one, "SPEED 66 WPM", "ACC 93.9%") && JSON.stringify(one.speed) === '["dot"]' && JSON.stringify(one.acc) === '["dot"]' && one.dotsVisible &&
  legendOk(gap, "SPEED 67 WPM", "ACC 96.1%") && JSON.stringify(gap.speed) === '["dot",2]' && JSON.stringify(gap.acc) === '["dot",2]' && gap.dotsVisible &&
  [one, gap].every((r) => r.role === "img" && r.aria === null && r.srCopies === 0 && r.titleCount === 1 && r.title.length > 10) && /latest 96\.1 percent/.test(gap.title) && !/100 percent/.test(gap.title),
  { one, gap });

// ---- 10. Best WPM explains its 60-interval rule (release 20261024a, CT-01 / J2) ----
await P.g(() => {
  const g = window.game;
  g.save.profile = { v: 1, keys: {}, bigrams: {}, speedEma: 34, thrEma: 20, speedN: 55, sectorBest: { "1": { speed: 0, acc: 89.5, t: 1790000000 } },
    sessions: [[1790000000, "campaign", 1, 34, 89.5, "B", 4000, 9, 70, ""]], bests: { speed: 0, ceiling: 0, drill: { speed: 0, acc: 0 } }, days: { n: 1, last: 20261024 } };
  g._ty.saveRef = null;
  g.typistState();
  if (typeof g.refreshMenu === "function") g.refreshMenu(); else g.renderMenuScreens();
});
await sleep(150);
const rule = await P.g(() => ({ wpm: document.getElementById("statWpm").textContent, title: document.querySelector('[data-typist="bestWpm"]').title,
  help: [...document.querySelectorAll("#helpModal li")].map((li) => li.textContent).find((t) => /^WPM is your hand speed/.test(t)) || "" }));
await openRecords();
await P.g(() => document.getElementById("tabLog").click());
await sleep(150);
rule.tile = await P.g(() => { const t = [...document.querySelectorAll("#panelLog .flStat")].find((el) => /best wpm/i.test(el.querySelector(".flStat__label").textContent)); return t ? { value: t.querySelector(".flStat__value").textContent, cap: (t.querySelector(".flStat__cap") || {}).textContent || "" } : null; });
rule.untimed = await P.g(() => { const n = document.querySelector('#panelLog [data-fl="untimed"]'); return n ? n.textContent : null; });
rule.row1 = await P.g(() => { const r = document.querySelector("#panelLog .flSectors tbody tr"); return r ? r.textContent : null; });
await closeRecords();
P.check("10. a measured speed with no Best WPM yet: the menu row reads 'not set yet' with the rule as its title, the Flight Log tile '--' captions 'needs a clear with 60 timed keys', the help WPM item states the rule; Sector 1 cleared at 89.5 % without a timed best ('1 -- 89.5%') gets the note under the table (review J6)",
  rule.wpm === "not set yet" && rule.title === "Best WPM counts a cleared sector with at least 60 timed keys." && rule.tile && rule.tile.value === "--" &&
  rule.row1 === "1--89.5%" && rule.untimed === "Best WPM --: no clear of that sector had 60 timed keys yet (single letters are not timed)." &&
  rule.tile.cap === "needs a clear with 60 timed keys" && rule.help.includes("Best WPM counts a cleared sector with at least 60 timed keys."), rule);

// ---- 5. legacy rows and the old best ----
const SAVE2 = {
  schema: 2, playerName: "LEGACY", selectedShip: "sofrito", highScore: 1234, lastUnlockedLevel: 4, storySeen: true, keyboardHintSeen: true,
  settings: { muted: true, crt: true }, run: null, bestWpm: 44,
  highScores: [
    { runId: "aaaa1111", name: "LEGACY", score: 1234, levelReached: 3, startLevel: 1, wpm: 38, acc: 95, maxCombo: 20, ship: "sofrito", difficulty: "standard", date: 2 },
    { runId: "bbbb2222", name: "LEGACY", score: 900, levelReached: 2, startLevel: 1, wpm: 31, acc: 92, maxCombo: 12, ship: "sofrito", difficulty: "standard", date: 1 }
  ]
};
await P.goto(SAVE2);
await sleep(300);
await openRecords();
const leg = await P.g(() => ({ legacyCells: document.querySelectorAll("#highScoreTable td.hsLegacy").length, note: !document.getElementById("hsLegacyNote").classList.contains("hidden"),
  noteText: document.getElementById("hsLegacyNote").textContent, opacity: Number(getComputedStyle(document.querySelector("#highScoreTable td.hsLegacy")).opacity) }));
await P.g(() => document.getElementById("tabLog").click());
await sleep(150);
const legLog = await P.g(() => (document.querySelector("#panelLog .flLegacy") || {}).textContent || "");
await closeRecords();
P.check("5. legacy: migrated rows' WPM cells carry .hsLegacy (opacity >= 0.56, PERF-A11Y-2), #hsLegacyNote says 'the old measure', the Flight Log shows 'OLD BEST 44 · OLD MEASURE' (CT-11)",
  leg.legacyCells === 2 && leg.note && leg.opacity >= 0.56 && leg.noteText === "Dimmed WPM used the old measure, from before hand speed." && legLog === "OLD BEST 44 · OLD MEASURE", { leg, legLog });

P.check("zero page errors", P.errors.pageErrors.length === 0, P.errors.pageErrors);
await P.finish();
