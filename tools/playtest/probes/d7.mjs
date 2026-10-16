// D7 acceptance: sector art tour, storm pass, finale vista, warp-in card (PLAN D7 / VIS-09 / JUICE-11 / amendment E-9).
// Usage: node probes/d7.mjs [--dpr 2]
import { openProbe, sleep } from "./_lib.mjs";

const argDpr = Number((process.argv.find((a, i, arr) => arr[i - 1] === "--dpr")) || 1);
const P = await openProbe("d7-dpr" + argDpr, { dpr: argDpr });
const page = P.page;
const requests = [];
page.on("request", (r) => requests.push(r.url()));

await P.goto("fresh");
const themes = await P.g(() => {
  const f = (typeof getThemeForLevel === "function") ? getThemeForLevel : (window.TypeRDebug && window.TypeRDebug.getThemeForLevel);
  const rows = []; for (let i = 0; i < 10; i++) { const t = f(i); rows.push({ art: t.art, storm: !!t.storm, speedMul: t.speedMul, accent: t.accent }); }
  return rows;
});
const wantArts = ["first", "sixth", "third", "fourth", "fifth", "third", "second", "fourth", "fifth", "tenth"];
P.check("currentTheme.art sequence per A7 and storm === true only for indices 5, 7, 8 (speedMul 1.25 there)", themes.every((t, i) => t.art === wantArts[i] && t.storm === [5, 7, 8].includes(i) && t.speedMul === (t.storm ? 1.25 : 1)), themes.map((t) => `${t.art}${t.storm ? "*" : ""}`).join(" "));

// ---- warp-in: levelIntro gate, no spawns, keys ignored, cyan title ----
await page.fill("#playerName", "D7").catch(() => {});
await page.click("#btnStart");
try { const st = page.locator("#btnStoryLaunch"); await st.waitFor({ state: "visible", timeout: 2500 }); await st.click(); } catch {}
await page.waitForFunction(() => window.game && window.game.mode === "playing", null, { timeout: 30000 });
const intro0 = await P.g(async () => { const g = window.game; const first = { levelIntro: !!g.levelIntro, levelT: g.levelT, enemies: g.enemies.length, total: g.stats.total }; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return { ...first, warp: g.parallaxWarp, levelTAfterFrame: g.levelT }; });
P.check("immediately after Start: levelIntro exists, levelT === 0 (still 0 a frame later), no enemies, parallaxWarp > 1", intro0.levelIntro && intro0.levelT === 0 && intro0.levelTAfterFrame === 0 && intro0.enemies === 0 && intro0.warp > 1, intro0);
await page.keyboard.type("asd");
const keys = await P.g(() => ({ total: game.stats.total, levelIntro: !!game.levelIntro }));
P.check("keys during the sector card leave stats.total unchanged", keys.total === intro0.total && keys.levelIntro, keys);
await page.waitForFunction(() => window.game.levelIntro && window.game.levelIntro.t >= 0.78, null, { timeout: 5000 }).catch(() => {});
const cyan = await P.g(() => {
  const g = window.game, s = g.renderScale || 1;
  const rect = { x: g.w / 2 - 200, y: g.h * 0.46 - 35, w: 400, h: 70 };
  const d = g.ctx.getImageData(Math.round(rect.x * s), Math.round(rect.y * s), Math.round(rect.w * s), Math.round(rect.h * s)).data;
  let n = 0, cy = 0;
  for (let i = 0; i < d.length; i += 4) { n++; if (d[i + 2] > 170 && d[i + 1] > 170 && d[i] < 140 && d[i + 2] - d[i] > 80) cy++; }
  return { t: g.levelIntro && g.levelIntro.t, pct: Math.round(cy / n * 1000) / 10, warp: g.parallaxWarp, title: g.banner && g.banner.title, eyebrow: g.banner && g.banner.eyebrow };
});
await P.shot("sector-card-0.8");
P.check(".8 s screenshot: cyan title pixels in the centre band (> 5 % of a 400x70 rect)", cyan.pct > 5 && cyan.title === "SECTOR 01", cyan);
const spawnT = await P.g(async () => {
  const g = window.game; let enemiesDuring = 0;
  while (g.levelIntro) { enemiesDuring = Math.max(enemiesDuring, g.enemies.length); await new Promise((r) => requestAnimationFrame(r)); }
  const t0 = performance.now();
  while (!g.enemies.length && performance.now() - t0 < 2000) await new Promise((r) => requestAnimationFrame(r));
  return { enemiesDuring, firstSpawnMs: Math.round(performance.now() - t0), warpAfter: g.parallaxWarp, whiteFlash: g.whiteFlash, lastCue: g.sfx.lastCue };
});
P.check("no enemies until the card ends, then a spawn within .4 s; parallaxWarp back to 1", spawnT.enemiesDuring === 0 && spawnT.firstSpawnMs <= 400 && spawnT.warpAfter === 1, spawnT);
const acc1 = await P.g(() => getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim().toUpperCase());
P.check("--theme-accent is #39F5FF at L1", acc1 === "#39F5FF", acc1);

// ---- returning player skips the card (E-9) ----
const skip = await P.g(async () => {
  const g = window.game;
  g.save.lastUnlockedLevel = 5;
  g.startLevel(0, { fromMenu: true, fresh: true });
  const before = g.stats.total;
  await new Promise((r) => setTimeout(r, 150));
  const early = g.canSkipLevelIntro();
  while (g.levelIntro && g.levelIntro.t < 0.5) await new Promise((r) => requestAnimationFrame(r));
  const can = g.canSkipLevelIntro();
  const did = can && g.skipLevelIntro();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { early, can, did, levelIntro: !!g.levelIntro, total: g.stats.total === before, bannerKind: g.banner && g.banner.kind };
});
P.check("canSkipLevelIntro() false before .4 s, true for a returning player after; skipLevelIntro() ends the card next frame without counting keys", skip.early === false && skip.can && skip.did && !skip.levelIntro && skip.total, skip);

// ---- L10 vista + accent, L7 refinery ----
await P.g(() => game.startLevel(9, { fromMenu: true, fresh: true }));
await page.waitForFunction(() => window.game.levelReady && window.game.levelIndex === 9, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
await sleep(400);
const l10 = await P.g(() => ({ accent: getComputedStyle(document.documentElement).getPropertyValue("--theme-accent").trim().toUpperCase(), tileFg: game.currentTheme.tileFg, art: game.currentTheme.art, theme: document.documentElement.dataset.theme }));
await P.shot("level10-vista");
P.check("L10: --theme-accent #B86BFF, art tenth with tileFg === false (cover-width vista)", l10.accent === "#B86BFF" && l10.tileFg === false && l10.art === "tenth", l10);
await P.g(() => game.startLevel(6, { fromMenu: true, fresh: true }));
await page.waitForFunction(() => window.game.levelReady && window.game.levelIndex === 6, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
await sleep(600);
await P.shot("level7-refinery");
P.check("L7 uses the refinery art (second) — see level7-refinery.png for the SECTOR 7 sign", (await P.g(() => game.currentTheme.art)) === "second", "visual");

// ---- storm pass (L6): tint + lightning off under reduce-motion ----
await P.g(() => game.startLevel(5, { fromMenu: true, fresh: true }));
await page.waitForFunction(() => window.game.levelReady && window.game.levelIndex === 5, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
const storm = await P.g(async () => {
  const g = window.game;
  const out = { storm: g.currentTheme.storm, speedMul: g.currentTheme.speedMul, starMul: g.starSpeedMul(), eyebrowWas: null };
  g.showBanner({ kind: "sector" }); out.eyebrowWas = g.banner.eyebrow; g.banner = null;
  // lightning on (not reduced): wait up to 12 s for one bolt
  g.stormNextBolt = 0.5; g.debug.stormBolts = 0;
  const t0 = performance.now();
  while ((g.debug.stormBolts | 0) === 0 && performance.now() - t0 < 4000) await new Promise((r) => requestAnimationFrame(r));
  out.boltsNormal = g.debug.stormBolts | 0;
  // reduce-motion: tint stays, no bolt, no full-field brightness jump
  if (g.save && g.save.settings) g.save.settings.reduceMotion = true;
  if (typeof g.resolveMotion === "function") g.resolveMotion(); else if (typeof g.ensureMotionFlag === "function") g.ensureMotionFlag();
  g.reduceMotion = true; document.documentElement.classList.add("reduce-motion");
  g.stormNextBolt = 0.3; g.debug.stormBolts = 0;
  const s = g.renderScale || 1; const lum = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const d = g.ctx.getImageData(0, Math.round(200 * s), Math.round(g.w * s), Math.round(300 * s)).data;
    let sum = 0, n = 0; for (let j = 0; j < d.length; j += 64) { sum += 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]; n++; }
    lum.push(sum / n);
  }
  let maxJump = 0; for (let i = 1; i < lum.length; i++) maxJump = Math.max(maxJump, Math.abs(lum[i] - lum[i - 1]) / Math.max(1, lum[i - 1]));
  out.maxJumpPct = Math.round(maxJump * 1000) / 10; out.boltsRM = g.debug.stormBolts | 0; out.meanLum = Math.round(lum.reduce((a, b) => a + b, 0) / lum.length);
  if (g.save && g.save.settings) g.save.settings.reduceMotion = null;
  g.reduceMotion = false; document.documentElement.classList.remove("reduce-motion");
  return out;
});
await P.shot("level6-storm");
P.check("L6 storm: storm true, speedMul 1.25 applied to the stars, sector eyebrow STORM PASS, lightning fires with motion on", storm.storm === true && storm.starMul === 1.25 && storm.eyebrowWas === "STORM PASS" && storm.boltsNormal >= 1, storm);
P.check("L6 under reduce-motion: no lightning and no frame-to-frame field brightness jump > 10 % over 4 s while the tint is on", storm.boltsRM === 0 && storm.maxJumpPct <= 10, storm);
const bad = requests.filter((u) => /(seventh|eighth|ninth)/.test(u));
P.check("no request for seventh / eighth / ninth art", bad.length === 0, bad);

// ---- Continue into a saved boss skips the card ----
// (a page reload would re-run the 'fresh' fixture's storage wipe, so this takes the same path the menu button takes:
// Save & quit, then Continue -> continueRun() -> startLevel(i, { restoredRun }) with run.inBoss.)
await P.g(() => game.startLevel(0, { fromMenu: true, fresh: true }));
await page.waitForFunction(() => !window.game.levelIntro, null, { timeout: 6000 }).catch(() => {});
await P.g(() => { const g = window.game; g.levelT = LEVELS[g.levelIndex].duration + 0.01; });
await page.waitForFunction(() => window.game.inBoss && !(window.game.bossIntro && window.game.bossIntro.locked), null, { timeout: 20000 });
const saved = await P.g(() => { const g = window.game; g.stopToMenu(true); const run = g.save.run; return { mode: g.mode, inBoss: !!(run && run.inBoss), hasBoss: !!(run && run.boss), stored: !!JSON.parse(localStorage.getItem("typesmup198x.save.v1") || "null")?.run?.inBoss }; });
const cont = await P.g(async () => {
  const g = window.game;
  g.continueRun();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { mode: g.mode, levelIntro: g.levelIntro, inBoss: g.inBoss, bossIntro: !!g.bossIntro, locked: !!(g.bossIntro && g.bossIntro.locked), banner: g.banner && g.banner.kind, segIndex: g.boss && g.boss.segmentIndex };
});
P.check("Save & quit inside a boss, then Continue: levelIntro === null, inBoss, the (skippable) boss intro and its banner run instead of the sector card", saved.inBoss && saved.stored && cont.mode === "playing" && cont.levelIntro === null && cont.inBoss && cont.bossIntro && cont.banner === "bossIntro", { saved, cont });
const errs = { pageErrors: P.errors.pageErrors.length, consoleErrors: P.errors.consoleErrors.length };
P.check("no page / console errors during the D7 probe", errs.pageErrors === 0 && errs.consoleErrors === 0, errs);
await P.finish();
