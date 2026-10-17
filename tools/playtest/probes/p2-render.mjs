// Phase 2 render/loading/perf acceptance (PLAN A5 / A7 / A8 / A11; CONTRACT sections 3, 5, 7, 8).
// Usage: node probes/p2-render.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 2);
const P = await openProbe("p2-render-dpr" + argDpr, { dpr: argDpr });
const page = P.page;

// Per-frame shadowBlur counter + request log, installed before any game script runs.
await P.context.addInitScript(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "shadowBlur");
  const S = window.__p2 = { cur: 0, frames: [], recording: false, getImageData: 0 };
  Object.defineProperty(proto, "shadowBlur", {
    configurable: true, get() { return d.get.call(this); },
    set(v) { if (v > 0) S.cur++; return d.set.call(this, v); }
  });
  const gid = proto.getImageData;
  proto.getImageData = function () { S.getImageData++; return gid.apply(this, arguments); };
  const tick = () => { if (S.recording) S.frames.push(S.cur); S.cur = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const requests = [];
page.on("request", (r) => requests.push(r.url()));

await P.goto("fresh");
// Render hitch log: every render() over 16 ms with its context (first-frame texture uploads are expected once).
await P.g(() => {
  const g = window.game; const orig = g.render; window.__hitches = [];
  g.render = function (...a) { const t0 = performance.now(); try { return orig.apply(this, a); } finally { const ms = performance.now() - t0; if (ms > 16) window.__hitches.push({ ms: Math.round(ms * 10) / 10, mode: this.mode, level: this.levelIndex, t: Math.round(this.levelT * 10) / 10, inBoss: this.inBoss, frame: this.frameCount, sinceNav: Math.round(performance.now()) }); } };
});

// ---------------- A5: tokens, typography ----------------
const tok = await P.g(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    lime: PALETTE.rgba("lime", 0.92), dur3: cs.getPropertyValue("--dur-3").trim(), fontDisplay: cs.getPropertyValue("--font-display"),
    fontCheck: document.fonts.check("800 52px Orbitron"), shakePad: SHAKE_PAD, target: FONT.target(22), display: FONT.display(52),
    fontsReadyType: typeof game.fontsReady, hasEasings: [typeof easeOutCubic, typeof easeOutExpo, typeof easeOutBack, typeof easeInOutCubic],
    accentDefault: PALETTE.accent, bg0: PALETTE.bg0, strictThrows: (() => { try { PALETTE.rgba("nope", 1); return false; } catch (e) { return true; } })()
  };
});
P.check("PALETTE.rgba('lime',.92) === 'rgba(168,255,58,0.92)'", tok.lime === "rgba(168,255,58,0.92)", tok.lime);
P.check("--dur-3 === '280ms' and --font-display contains Orbitron", tok.dur3 === "280ms" && /Orbitron/.test(tok.fontDisplay), { dur3: tok.dur3, fontDisplay: tok.fontDisplay.trim() });
P.check("document.fonts.check('800 52px Orbitron') true after the overlay hid", tok.fontCheck === true, tok.fontCheck);
P.check("FONT.target is the monospace stack (never Orbitron); FONT.display is Orbitron; SHAKE_PAD 20", !/Orbitron/.test(tok.target) && /Orbitron/.test(tok.display) && tok.shakePad === 20, { target: tok.target, display: tok.display });
P.check("easing helpers + game.fontsReady exist; PALETTE throws on an unknown name on the dev origin", tok.hasEasings.every((t) => t === "function") && tok.fontsReadyType === "object" && tok.strictThrows, tok);
const split = await P.g(() => {
  const c = game.ctx; const f = FONT.target(22);
  c.font = f; const ref = c.measureText("neon").width;
  const r = game.drawSplitText(c, "ne", "on", 0, -100, { font: f });
  return { ref, width: r.width, diff: Math.abs(r.width - ref) };
});
P.check("drawSplitText('ne','on') width equals measureText('neon') within .5 px", split.diff < 0.5, split);

// ---------------- A8: loading overlay end state, ship cards, boot network ----------------
const boot = await P.g(() => {
  const ov = document.getElementById("loadingOverlay"); const bar = document.getElementById("loadingBar");
  const imgs = [...document.querySelectorAll("img[data-ship-id]")].map((i) => ({ src: i.getAttribute("src"), w: i.getAttribute("width"), h: i.getAttribute("height") }));
  return { hidden: ov.classList.contains("hidden"), dismissed: ov.classList.contains("is-dismissed"), busy: ov.getAttribute("aria-busy"), valuenow: bar.getAttribute("aria-valuenow"),
    fill: document.getElementById("loadingBarFill").style.width, label: document.getElementById("loadingLabel").textContent, imgs, bootReason: game.bootReason,
    stats: TypeRAssets.stats(), sheetScale: ExplosionSprite.sheetScale, variant: TypeRAssets.variant, degraded: game.degradedAssets, gid: window.__p2.getImageData };
});
P.check("overlay: aria-valuenow 100, fill 100%, .is-dismissed then .hidden, aria-busy false, bootReason ready", boot.valuenow === "100" && boot.fill === "100%" && boot.hidden && boot.dismissed && boot.busy === "false" && boot.bootReason === "ready", { valuenow: boot.valuenow, fill: boot.fill, hidden: boot.hidden, busy: boot.busy, label: boot.label, bootReason: boot.bootReason });
P.check("ship cards hydrated from Assets.url x1 with explicit width/height", boot.imgs.length === 4 && boot.imgs.every((i) => /ships\/[a-z-]+@1x\.webp\?v=/.test(i.src) && i.w === "350" && Number(i.h) > 0), boot.imgs);
P.check(`critical set resident (4 ships + bg/fg first + fx), variant ${boot.variant}, sheetScale ${boot.sheetScale}`, ["ships/coconut", "ships/little-dark-one", "ships/sofrito", "ships/honeybee", "bg/first", "fg/first", "fx/explosions"].every((k) => boot.stats.resident.includes(k)) && boot.sheetScale === (boot.variant === "x2" ? 1 : 0.5), { resident: boot.stats.resident, decodedPx: boot.stats.decodedPx, errors: boot.stats.errors });
P.check("no getImageData before the first keystroke", boot.gid === 0, boot.gid);
const pngMasters = requests.filter((u) => /assets\/(ships|backgrounds|foregrounds|boss_ships|explosions)\/.*\.png/.test(u));
P.check("boot requested no PNG masters", pngMasters.length === 0, pngMasters);
const shipReqs = requests.filter((u) => /opt\/ships\//.test(u));
P.check("ship WebP requests at boot (x1 only, no @2x)", shipReqs.every((u) => /@1x/.test(u)), shipReqs.map((u) => u.replace(/^.*\/assets/, "assets")));

// ---------------- Enter play: gate, accent, prefetch ----------------
await P.startRun("P2");
await page.waitForFunction(() => window.game.levelReady, null, { timeout: 5000 }).catch(() => {});
const lvl1 = await P.g(() => ({
  levelReady: game.levelReady, gate: game.isLevelGateOpen(), accent: getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim().toUpperCase(),
  theme: document.documentElement.dataset.theme, art: game.currentTheme.art, paletteAccent: PALETTE.accent, resident: TypeRAssets.stats().resident, tileDraws: game.debug.tileDraws
}));
P.check("level 1: levelReady + gate open, --theme-accent #39F5FF, data-theme first", lvl1.levelReady && lvl1.gate && lvl1.accent === "#39F5FF" && lvl1.theme === "first", lvl1);
P.check("bg+fg drawImage calls per frame <= 5 (2 bg tiles + up to 3 fg tiles)", lvl1.tileDraws >= 2 && lvl1.tileDraws <= 5, lvl1.tileDraws);

// 14 enemies, one locked: plates, metrics, shadowBlur over 180 frames
await page.waitForFunction(() => window.game.isLevelGateOpen(), null, { timeout: 4000 }).catch(() => {});
await P.g(() => {
  const g = window.game;
  g.enemies.length = 0;
  const words = ["a", "neon", "arcade", "typewriter", "x", "shift", "pilot", "combo", "spark", "wave", "constellation", "bolt", "trail", "glow"];
  words.forEach((w, i) => { g.enemies.push(new Enemy({ text: w, x: 300 + i * 68, y: 184 + (i % 6) * 68, speed: 0 })); });
  g.handleTyped("n"); // locks "neon"
});
await sleep(300);
await P.g(() => { window.__p2.frames = []; window.__p2.recording = true; });
await sleep(3100);
const plates = await P.g(() => {
  const S = window.__p2; S.recording = false;
  const g = window.game;
  const frames = S.frames.slice(0, 180);
  const en = g.enemies.find((e) => e.text === "constellation");
  return { frames: frames.length, maxBlur: Math.max(...frames), cacheSize: g.plateCache.size, lastIsLock: !!(g.lock && g.lastPlateDrawn === g.lock.ref),
    plateW: en && en.plateW, textW: en && en.textW, plateH: en && en.plateH, lockText: g.lock && g.lock.ref.text, states: g.enemies.map((e) => g.enemyState(e)) };
});
P.check("shadowBlur sets per frame over 180 wave frames with 14 plates === 0", plates.frames >= 150 && plates.maxBlur === 0, { frames: plates.frames, maxBlur: plates.maxBlur });
P.check("plateCache.size <= 96; locked plate drawn last; plateW >= textW + 24", plates.cacheSize <= 96 && plates.lastIsLock && plates.plateW >= plates.textW + 24, plates);
await P.shot("plates-14-locked");
// crop of the locked plate for the crispness check
const clip = await P.g(() => { const g = window.game; const r = g.canvas.getBoundingClientRect(); const k = g.cssScale; const en = g.lock.ref; return { x: r.left + (en.x - en.plateW / 2 - 24) * k, y: r.top + (en.y - 40) * k, width: (en.plateW + 48) * k, height: 80 * k }; });
await page.screenshot({ path: P.out + "/plate-crop.png", clip });

// star drift is dt-based (60 vs 120 steps per second)
const stars = await P.g(() => {
  const g = window.game; const s = g.stars.find((st) => st.x > 900) || g.stars[0];
  const x0 = s.x; for (let i = 0; i < 60; i++) g.updateStars(1 / 60); const d60 = x0 - s.x;
  s.x = x0; for (let i = 0; i < 120; i++) g.updateStars(1 / 120); const d120 = x0 - s.x;
  s.x = x0; return { d60, d120, diff: Math.abs(d60 - d120) };
});
P.check("star drift identical at 60 and 120 steps/s", stars.diff < 1e-6, stars);

// explosion table + caps
const ex = await P.g(() => {
  const g = window.game;
  const sets = EXPLOSION_SETS;
  const bad = Object.values(sets).some((s) => s.frames.some((f) => [10, 18, 20].includes(f)));
  g.explosions.length = 0;
  for (let i = 0; i < 9; i++) g.addExplosionSprite(600, 360, "large");
  for (let i = 0; i < 6; i++) g.addExplosionSprite(600, 360, "medium");
  const large = g.explosions.filter((e) => e.type === "large").length;
  const sheetOk = ExplosionSprite.isReady(ExplosionSprite.sheet);
  return { small: sets.small.frames, bad, large, total: g.explosions.length, sheetOk, blend: g.explosions[0].blendFor(15), blendSmoke: g.explosions[0].blendFor(17) };
});
P.check("EXPLOSION_SETS.small.frames [2,1,0]; no set uses 10/18/20; caps 4 large / 10 total; flash additive, smoke source-over", JSON.stringify(ex.small) === "[2,1,0]" && !ex.bad && ex.large <= 4 && ex.total <= 10 && ex.sheetOk && ex.blend === "lighter" && ex.blendSmoke === "source-over", ex);

// ---------------- Boss: art placement, slab glow budget, artRect ----------------
await P.g(() => { const g = window.game; g.enemies.length = 0; g.explosions.length = 0; g.lock = null; });
await P.forceBoss();
await sleep(1500);
await P.g(() => {
  const g = window.game; const cfg = LEVELS[g.levelIndex];
  for (let i = 0; i < 10; i++) g.enemies.push(new Enemy({ text: "abcdefghij"[i], x: 700 + i * 40, y: 184 + (i % 5) * 68, speed: 0, kind: "bossMinion" }));
  window.__p2.frames = []; window.__p2.recording = true;
});
await sleep(1600);
const bossInfo = await P.g(() => {
  const S = window.__p2; S.recording = false;
  const g = window.game; const b = g.boss;
  const frames = S.frames.slice(0, 90);
  const rect = b.artRect;
  return { inBoss: g.inBoss, maxBlur: Math.max(...frames), frames: frames.length, artRect: rect, bossX: b.x, bossY: b.y, prefetchedFor: g.prefetchedFor, keys: g._sectorPrefetchKeys,
    bossArt: !!TypeRAssets.get("bosses/" + b.artLevel), next: ["bg/sixth", "fg/sixth", "bosses/2"].map((k) => !!TypeRAssets.get(k)) };
});
P.check("boss: shadowBlur per frame <= 2 with 10 minions (slab glow cached)", bossInfo.inBoss && bossInfo.maxBlur <= 2, { maxBlur: bossInfo.maxBlur, frames: bossInfo.frames });
P.check("Boss.artRect getter returns the pre-D6 draw box (w,h > 0, x < boss.x)", bossInfo.artRect && bossInfo.artRect.w > 0 && bossInfo.artRect.h > 0 && bossInfo.artRect.x < bossInfo.bossX, bossInfo.artRect);
P.check("prefetchNextSector ran for sector 1 (keys bg/sixth, fg/sixth, bosses/2) and the art is resident", bossInfo.prefetchedFor === 0 && JSON.stringify(bossInfo.keys) === JSON.stringify(["bg/sixth", "fg/sixth", "bosses/2"]) && bossInfo.next.every(Boolean), bossInfo);
await P.shot("boss-10-minions");

// Finale: type the boss down and sample the near-white fraction mid-finale.
await P.g(() => { const g = window.game; g.enemies.length = 0; });
await page.waitForFunction(() => { const g = window.game; return !(g.bossIntro && g.bossIntro.locked); }, null, { timeout: 5000 }).catch(() => {});
await P.g(async () => {
  const g = window.game;
  for (let guard = 0; guard < 400 && g.inBoss && g.boss && !g.boss.done; guard++) {
    const c = g.boss.nextChar; if (!c) break; g.handleTyped(c);
    if (guard % 8 === 7) await new Promise((r) => requestAnimationFrame(r));
  }
});
await sleep(1500);
const fin = await P.g(() => {
  const g = window.game; const c = g.canvas; const ctx = g.ctx;
  const d = ctx.getImageData(0, 0, c.width, c.height).data; let white = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 16) { if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++; }
  return { bossClear: !!g.bossClear, t: g.bossClear && g.bossClear.t, whiteFrac: white / (n / 4), large: g.explosions.filter((e) => e.type === "large").length, total: g.explosions.length };
});
P.check("finale: near-white pixel fraction < 8 %, <= 4 large / 10 total explosions", fin.bossClear && fin.whiteFrac < 0.08 && fin.large <= 4 && fin.total <= 10, fin);
await P.shot("finale-mid");
await page.waitForFunction(() => window.game.mode !== "playing", null, { timeout: 15000 }).catch(() => {});
const lc = await P.g(() => ({ mode: game.mode, bar: document.getElementById("sectorPrefetch").className, valuenow: document.getElementById("sectorPrefetch").getAttribute("aria-valuenow") }));
P.check("level complete: #sectorPrefetch hidden once the next sector is resident (or showing progress)", lc.mode === "levelComplete" && (/hidden/.test(lc.bar) || Number(lc.valuenow) >= 0), lc);

// Next sector through the real button: textures were pre-uploaded on Level Complete, so no first-frame hitch.
await sleep(400);
await P.g(() => { window.__hitches.length = 0; });
await page.click("#btnNextLevel");
await page.waitForFunction(() => window.game._assetsLevel === 1 && window.game.levelReady, null, { timeout: 5000 }).catch(() => {});
await sleep(300);
const l2 = await P.g(() => ({ level: game.levelIndex, art: game.currentTheme.art, hitches: window.__hitches.slice(), warmed: game._warmedSector, bg: !!TypeRAssets.get("bg/sixth") }));
P.check("advanceLevel from Level Complete: sector 2 draws the sixth art with no render hitch > 16 ms (textures warmed on the clear screen)", l2.level === 1 && l2.art === "sixth" && l2.bg && l2.hitches.length === 0, l2);
await P.shot("level2-start");

// ---------------- Theme tour: startLevel(2) eviction, art sequence 0..9, tenth vista ----------------
await P.g(() => { const g = window.game; g.startLevel(2, { fromMenu: true, fresh: true }); });
await page.waitForFunction(() => window.game._assetsLevel === 2 && window.game.levelReady, null, { timeout: 5000 }).catch(() => {});
const res2 = await P.g(() => TypeRAssets.stats().resident);
P.check("resident after startLevel(2) excludes bg/first, fg/first, bosses/1 (ships + fx pinned)", !res2.includes("bg/first") && !res2.includes("fg/first") && !res2.includes("bosses/1") && res2.includes("fx/explosions") && res2.includes("ships/coconut"), res2);
const arts = [];
const storms = [];
for (let i = 0; i < 10; i++) {
  await P.g((i) => { window.game.startLevel(i, { fromMenu: true, fresh: true }); }, i);
  const t = await P.g(() => ({ art: game.currentTheme.art, storm: !!game.currentTheme.storm }));
  arts.push(t.art); storms.push(t.storm);
}
P.check("currentTheme.art sequence over startLevel(0..9)", JSON.stringify(arts) === JSON.stringify(["first", "sixth", "third", "fourth", "fifth", "third", "second", "fourth", "fifth", "tenth"]) && storms.map((s, i) => s === [5, 7, 8].includes(i)).every(Boolean), { arts, storms });
const t0 = Date.now();
const ready9 = await page.waitForFunction(() => window.game._assetsLevel === 9 && window.game.levelReady, null, { timeout: 5000 }).then(() => true).catch(() => false);
const l10 = await P.g(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim().toUpperCase(), tileFg: game.currentTheme.tileFg,
  bg: !!TypeRAssets.get("bg/tenth"), fg: !!TypeRAssets.get("fg/tenth"), boss: !!TypeRAssets.get("bosses/10"), tileDraws: game.debug.tileDraws
}));
P.check(`startLevel(9): levelReady within 1.5 s (${Date.now() - t0} ms), bg/tenth + fg/tenth + bosses/10 resident, --theme-accent #B86BFF, tileFg false`, ready9 && Date.now() - t0 <= 1500 && l10.bg && l10.fg && l10.boss && l10.accent === "#B86BFF" && l10.tileFg === false, l10);
await sleep(400);
await P.shot("sector10-vista");
const badReq = requests.filter((u) => /seventh|eighth|ninth/.test(u) || /assets\/(ships|backgrounds|foregrounds|boss_ships|explosions)\/.*\.png/.test(u));
P.check("no request for seventh/eighth/ninth art or any PNG master over the tour", badReq.length === 0, badReq);
const urlCounts = {};
for (const u of requests) if (/assets\/opt\//.test(u)) urlCounts[u] = (urlCounts[u] || 0) + 1;
const dupes = Object.entries(urlCounts).filter(([u, n]) => n > 1 && !/\.mp3/.test(u));
P.check("each unique opt image URL requested once (media excluded)", dupes.length === 0, dupes);

const hitches = await P.g(() => window.__hitches);
P.check(`render hitches > 16 ms over the whole probe: ${hitches.length} (first-frame uploads allowed once per sector)`, hitches.length <= 12, hitches);

await P.finish();
